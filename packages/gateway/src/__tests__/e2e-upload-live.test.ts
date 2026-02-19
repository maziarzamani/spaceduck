/**
 * Live E2E test: uploads a real PDF, sends a message with the attachment,
 * and verifies the LLM calls marker_scan and returns document content.
 *
 * Requires:
 *   - RUN_LIVE_TESTS=1
 *   - marker_single on PATH (pip install marker-pdf)
 *   - A configured LLM provider (uses .env settings)
 *
 * Run:
 *   RUN_LIVE_TESTS=1 bun test packages/gateway/src/__tests__/e2e-upload-live.test.ts
 */

import { describe, it, expect, afterEach } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Message } from "@spaceduck/core";
import { MarkerTool } from "@spaceduck/tool-marker";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

const LIVE =
  Bun.env.RUN_LIVE_TESTS === "1" && (await MarkerTool.isAvailable());

describe.if(LIVE)("Live PDF upload + marker_scan E2E", () => {
  let gateway: Gateway;
  const PORT = 49152 + Math.floor(Math.random() * 10000);

  afterEach(async () => {
    if (gateway?.status === "running") {
      await gateway.stop();
    }
  });

  it("should upload a PDF, call marker_scan, and return document content", async () => {
    // Boot gateway with real provider (from .env)
    gateway = await createGateway();

    // Override port to avoid conflicts with a running dev server
    const { config } = gateway.deps;
    await gateway.stop().catch(() => {});
    gateway = await createGateway({
      config: { ...config, port: PORT },
    });
    await gateway.start();

    // Wait for async marker_scan registration
    await new Promise((r) => setTimeout(r, 500));

    const { agent, conversationStore, sessionManager, attachmentStore } = gateway.deps;

    // Create a minimal but valid PDF with readable text
    const pdfContent = createTestPdf("Spaceduck is a local-first AI assistant with persistent memory.");
    const formData = new FormData();
    formData.append(
      "file",
      new File([pdfContent as BlobPart], "test-doc.pdf", { type: "application/pdf" }),
    );

    // Upload
    const uploadRes = await fetch(`http://localhost:${PORT}/api/upload`, {
      method: "POST",
      body: formData,
    });
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
    };
    expect(uploadBody.id).toMatch(/^att-/);

    // Verify the attachment store has it
    expect(attachmentStore.resolve(uploadBody.id)).not.toBeNull();

    // Create a conversation and run the agent with the attachment
    const session = await sessionManager.resolve("web", "live-test-user");
    await conversationStore.create(session.conversationId, "Live upload test");

    const userMsg: Message = {
      id: `live-msg-${Date.now()}`,
      role: "user",
      content: "Please read and summarize this document.",
      timestamp: Date.now(),
      attachments: [
        {
          id: uploadBody.id,
          filename: uploadBody.filename,
          mimeType: uploadBody.mimeType,
          size: uploadBody.size,
        },
      ],
    };

    console.log("[live-test] Running agent with PDF attachment...");

    const chunks: string[] = [];
    const toolCalls: string[] = [];
    const toolResults: string[] = [];

    for await (const chunk of agent.run(session.conversationId, userMsg)) {
      switch (chunk.type) {
        case "text":
          chunks.push(chunk.text);
          break;
        case "tool_call":
          console.log(`[live-test] Tool called: ${chunk.toolCall.name}`, chunk.toolCall.args);
          toolCalls.push(chunk.toolCall.name);
          break;
        case "tool_result":
          console.log(`[live-test] Tool result (${chunk.toolResult.name}): ${chunk.toolResult.content.slice(0, 200)}...`);
          toolResults.push(chunk.toolResult.content);
          break;
      }
    }

    const fullResponse = chunks.join("");
    console.log(`[live-test] LLM response (${fullResponse.length} chars): ${fullResponse.slice(0, 300)}...`);
    console.log(`[live-test] Tool calls made: ${toolCalls.join(", ") || "(none)"}`);

    // Verify marker_scan was called
    expect(toolCalls).toContain("marker_scan");

    // Verify the tool returned content (not an error about missing attachment)
    expect(toolResults.length).toBeGreaterThan(0);
    const markerResult = toolResults[0];
    expect(markerResult).not.toContain("attachment not found");

    // Verify the LLM produced a response
    expect(fullResponse.length).toBeGreaterThan(10);

    // Verify messages were persisted with attachments
    const msgs = await conversationStore.loadMessages(session.conversationId);
    expect(msgs.ok).toBe(true);
    if (msgs.ok) {
      const userPeristed = msgs.value.find((m) => m.role === "user");
      expect(userPeristed?.attachments).toBeDefined();
      expect(userPeristed?.attachments?.length).toBe(1);
    }
  }, 120_000); // 2 min timeout for Marker + LLM
});

function createTestPdf(text: string): Uint8Array {
  // Minimal valid PDF with embedded text
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const streamLen = stream.length;

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj

4 0 obj
<< /Length ${streamLen} >>
stream
${stream}
endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000${(317 + streamLen).toString().padStart(3, "0")} 00000 n 

trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;

  return new TextEncoder().encode(pdf);
}
