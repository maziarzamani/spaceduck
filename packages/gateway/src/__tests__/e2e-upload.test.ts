import { describe, it, expect, afterEach } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Message, Provider, ProviderOptions, ProviderChunk, ToolDefinition } from "@spaceduck/core";
import { ToolRegistry } from "@spaceduck/core";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

/**
 * Mock provider that detects marker_scan tool calls and returns their output.
 * When it sees the marker_scan tool is available, it emits a tool_call for it.
 */
class AttachmentTestProvider implements Provider {
  readonly name = "attachment-test";
  callCount = 0;

  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    this.callCount++;
    const tools = options?.tools ?? [];

    // On the first call, if we see a system hint about an attachment and marker_scan
    // is available, call the tool
    if (this.callCount === 1) {
      const hasHint = messages.some(
        (m) => m.role === "system" && m.content.includes("marker_scan"),
      );
      const hasTool = tools.some((t: ToolDefinition) => t.name === "marker_scan");

      if (hasHint && hasTool) {
        // Extract attachmentId from the hint
        const hintMsg = messages.find(
          (m) => m.role === "system" && m.content.includes("attachmentId"),
        );
        const idMatch = hintMsg?.content.match(/attachmentId:\s*"([^"]+)"/);
        const attachmentId = idMatch?.[1] ?? "unknown";

        yield {
          type: "tool_call",
          toolCall: {
            id: "call-1",
            name: "marker_scan",
            args: { attachmentId },
          },
        };
        return;
      }
    }

    // On round 2+ (after tool execution), produce final text response
    const hasToolResult = messages.some((m) => m.role === "tool");
    if (hasToolResult) {
      const toolMsg = messages.filter((m) => m.role === "tool").pop();
      yield { type: "text", text: `Document scanned: ${(toolMsg?.content ?? "").slice(0, 80)}` };
      return;
    }

    yield { type: "text", text: "No attachment detected." };
  }
}

async function createTestGateway(port: number): Promise<{ gateway: Gateway; provider: AttachmentTestProvider }> {
  const provider = new AttachmentTestProvider();
  const gateway = await createGateway({
    provider,
    config: {
      port,
      logLevel: "error",
      provider: { name: "attachment-test", model: "test" },
      memory: { backend: "sqlite", connectionString: ":memory:" },
      channels: ["web"],
    },
  });
  return { gateway, provider };
}

function createMinimalPdf(): Uint8Array {
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj
xref
0 5
trailer
<< /Size 5 /Root 1 0 R >>
startxref
0
%%EOF`;
  return new TextEncoder().encode(content);
}

describe("PDF upload + attachment E2E", () => {
  let gateway: Gateway;
  const PORT = 49152 + Math.floor(Math.random() * 10000);

  afterEach(async () => {
    if (gateway?.status === "running") {
      await gateway.stop();
    }
  });

  it("should accept a PDF upload and return attachment metadata", async () => {
    const result = await createTestGateway(PORT);
    gateway = result.gateway;
    await gateway.start();

    const pdf = createMinimalPdf();
    const formData = new FormData();
    formData.append("file", new File([pdf as BlobPart], "test.pdf", { type: "application/pdf" }));

    const res = await fetch(`http://localhost:${PORT}/api/upload`, {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^att-/);
    expect(body.filename).toBe("test.pdf");
    expect(body.mimeType).toBe("application/pdf");
    expect(body.size).toBeGreaterThan(0);
  });

  it("should reject non-PDF files", async () => {
    const result = await createTestGateway(PORT);
    gateway = result.gateway;
    await gateway.start();

    const formData = new FormData();
    formData.append("file", new File([new TextEncoder().encode("not a pdf")], "fake.pdf", { type: "application/pdf" }));

    const res = await fetch(`http://localhost:${PORT}/api/upload`, {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(415);
  });

  it("should persist attachments on messages and load them back", async () => {
    const result = await createTestGateway(PORT);
    gateway = result.gateway;
    await gateway.start();

    const { conversationStore, sessionManager } = gateway.deps;

    const session = await sessionManager.resolve("web", "test-user");
    await conversationStore.create(session.conversationId);

    const attachment = { id: "att-test-123", filename: "report.pdf", mimeType: "application/pdf", size: 1024 };

    const userMsg: Message = {
      id: "msg-att-1",
      role: "user",
      content: "Please read this document",
      timestamp: Date.now(),
      attachments: [attachment],
    };

    await conversationStore.appendMessage(session.conversationId, userMsg);

    const loaded = await conversationStore.loadMessages(session.conversationId);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toHaveLength(1);
      expect(loaded.value[0].attachments).toBeDefined();
      expect(loaded.value[0].attachments).toHaveLength(1);
      expect(loaded.value[0].attachments![0].id).toBe("att-test-123");
      expect(loaded.value[0].attachments![0].filename).toBe("report.pdf");
    }
  });

  it("should inject attachment hint into context for the LLM", async () => {
    const result = await createTestGateway(PORT);
    gateway = result.gateway;
    await gateway.start();

    // Register a mock marker_scan tool directly on the agent's tool registry
    // so the test doesn't depend on `marker_single` being on PATH.
    const agentDeps = (gateway.deps.agent as unknown as { deps: { toolRegistry: ToolRegistry } }).deps;
    const registry = agentDeps.toolRegistry;
    if (registry && !registry.has("marker_scan")) {
      registry.register(
        {
          name: "marker_scan",
          description: "Mock marker_scan for testing",
          parameters: {
            type: "object",
            properties: {
              attachmentId: { type: "string", description: "The attachment ID." },
            },
            required: ["attachmentId"],
          },
        },
        async (args) => `Mock PDF content for ${args.attachmentId}`,
      );
    }

    const { conversationStore, sessionManager } = gateway.deps;
    const session = await sessionManager.resolve("web", "test-user");
    await conversationStore.create(session.conversationId);

    // Upload a real PDF
    const pdf = createMinimalPdf();
    const formData = new FormData();
    formData.append("file", new File([pdf as BlobPart], "report.pdf", { type: "application/pdf" }));

    const uploadRes = await fetch(`http://localhost:${PORT}/api/upload`, {
      method: "POST",
      body: formData,
    });
    const uploadBody = await uploadRes.json();

    // Send a message with the attachment through the agent
    const attachment = {
      id: uploadBody.id,
      filename: uploadBody.filename,
      mimeType: uploadBody.mimeType,
      size: uploadBody.size,
    };

    const userMsg: Message = {
      id: "msg-hint-1",
      role: "user",
      content: "Summarize this document",
      timestamp: Date.now(),
      attachments: [attachment],
    };

    const chunks: string[] = [];
    const toolCalls: string[] = [];
    for await (const chunk of gateway.deps.agent.run(session.conversationId, userMsg)) {
      if (chunk.type === "text") chunks.push(chunk.text);
      if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall.name);
    }

    // The mock provider should have seen the hint and called marker_scan
    expect(result.provider.callCount).toBeGreaterThanOrEqual(1);
    expect(toolCalls).toContain("marker_scan");
  }, 120_000);
});
