// LLM-based fact extractor: listens for assistant responses and extracts
// durable personal facts using an LLM call with structured JSON output.
//
// Design decisions:
//   - Fire-and-forget: extraction runs async, never blocks the response flow
//   - Memory firewall: guardFact() validates and scores each candidate before storage
//   - Tiered transient expiry: "today" → 24h, "currently" → 3d, "this week" → 7d
//   - Hardened JSON parsing: tolerates markdown fences, trailing commas, partial output
//   - Configurable: min content length, max facts per message, extraction timeout
//   - Non-destructive: if extraction fails, the response is unaffected

import type { Logger, LongTermMemory, Provider, Message } from "./types";
import type { EventBus, SpaceduckEvents } from "./events";

export interface FactExtractorConfig {
  /** Minimum assistant message length to trigger extraction (default: 80) */
  readonly minLength?: number;
  /** Minimum user message length to trigger extraction (default: 5) */
  readonly minUserLength?: number;
  /** Maximum facts to extract per message (default: 5) */
  readonly maxFactsPerMessage?: number;
  /** Maximum length of a single fact (default: 200) */
  readonly maxFactLength?: number;
  /** Timeout for the LLM extraction call in ms (default: 10000) */
  readonly timeoutMs?: number;
  /** Whether to extract from user messages too (default: true) */
  readonly extractFromUser?: boolean;
  /** Whether to extract from assistant messages (default: true) */
  readonly extractFromAssistant?: boolean;
}

const D = 86_400_000; // 1 day in ms

/**
 * Tiered transient detection: matches → store with short expiry and low confidence
 * instead of discarding. Ordered from shortest to longest expiry.
 */
const TRANSIENT_TIERS: Array<{ pattern: RegExp; ttlMs: number }> = [
  { pattern: /\b(today|right now)\b/i,       ttlMs: 1 * D },  // 24h
  { pattern: /\b(currently|asked about)\b/i, ttlMs: 3 * D },  // 3d
  { pattern: /\b(this week|working on)\b/i,  ttlMs: 7 * D },  // 7d
];

export interface GuardResult {
  pass: boolean;
  confidence: number;
  expiresAt?: number;
}

/**
 * Memory firewall: validates a fact candidate before it enters long-term memory.
 *
 * - Rejects questions and too-short content outright.
 * - Stores transient facts (time-scoped phrases) with a short expiry and low
 *   confidence rather than discarding them entirely.
 * - Computes a length-based confidence heuristic for durable facts.
 *
 * Exported for unit testing.
 */
export function guardFact(content: string): GuardResult {
  // Hard rejects
  if (content.trim().endsWith("?")) return { pass: false, confidence: 0 };
  if (content.trim().length < 8)    return { pass: false, confidence: 0 };
  if (content.split(" ").length < 3) return { pass: false, confidence: 0 };

  // Tiered transients: store with expiry instead of discarding
  for (const { pattern, ttlMs } of TRANSIENT_TIERS) {
    if (pattern.test(content)) {
      return { pass: true, confidence: 0.3, expiresAt: Date.now() + ttlMs };
    }
  }

  // Durable fact: confidence heuristic (longer = more specific = higher confidence)
  const confidence = Math.min(1.0, 0.5 + content.length / 400);
  return { pass: confidence >= 0.4, confidence };
}

const EXTRACTION_PROMPT = `You are a fact extraction system. Given a conversation message, extract personal facts about the user that are worth remembering long-term.

Rules:
- Extract ONLY concrete, durable facts (preferences, personal info, decisions, technical choices)
- Do NOT extract transient information (current task, temporary context, greetings)
- Do NOT extract opinions the assistant expresses — only facts about the USER
- Each fact should be a single, self-contained sentence
- Return valid JSON array of strings: ["fact 1", "fact 2"]
- Return empty array [] if no facts worth remembering
- Maximum {maxFacts} facts per message

Examples of good facts:
- "User's name is Alice"
- "User prefers TypeScript over JavaScript"
- "User is building a personal AI called Spaceduck"
- "User uses Bun runtime with SQLite"

Examples of what NOT to extract:
- "User asked about embeddings" (transient task)
- "The weather is nice today" (not personal)
- "User said hello" (trivial)`;

export class FactExtractor {
  private handler: ((data: SpaceduckEvents["message:response"]) => void) | null = null;
  private readonly provider: Provider | undefined;
  private readonly config: Required<FactExtractorConfig>;

  constructor(
    private readonly ltm: LongTermMemory,
    private readonly logger: Logger,
    provider?: Provider,
    config?: FactExtractorConfig,
  ) {
    this.provider = provider;
    this.config = {
      minLength: config?.minLength ?? 80,
      minUserLength: config?.minUserLength ?? 5,
      maxFactsPerMessage: config?.maxFactsPerMessage ?? 5,
      maxFactLength: config?.maxFactLength ?? 200,
      timeoutMs: config?.timeoutMs ?? 10_000,
      extractFromUser: config?.extractFromUser ?? true,
      extractFromAssistant: config?.extractFromAssistant ?? true,
    };
  }

  /** Register this extractor as a listener on the event bus. */
  register(eventBus: EventBus): void {
    this.handler = (data) => {
      // Fire-and-forget: never block the response flow
      this.extractSafe(data);
    };
    eventBus.on("message:response", this.handler);
  }

  /** Unregister from the event bus. */
  unregister(eventBus: EventBus): void {
    if (this.handler) {
      eventBus.off("message:response", this.handler);
      this.handler = null;
    }
  }

  /**
   * Safe wrapper that catches all errors — extraction must never crash the app.
   */
  private async extractSafe(data: SpaceduckEvents["message:response"]): Promise<void> {
    try {
      await this.extract(data);
    } catch (err) {
      this.logger.warn("Fact extraction failed (non-fatal)", {
        conversationId: data.conversationId,
        error: String(err),
      });
    }
  }

  private async extract(data: SpaceduckEvents["message:response"]): Promise<void> {
    const { conversationId, message } = data;

    // Filter by role
    if (message.role === "assistant" && !this.config.extractFromAssistant) return;
    if (message.role === "user" && !this.config.extractFromUser) return;
    if (message.role !== "assistant" && message.role !== "user") return;

    // Skip short messages — user messages have a much lower threshold since
    // personal facts ("I'm 36", "I live in New York") are typically short phrases.
    const lengthThreshold =
      message.role === "user" ? this.config.minUserLength : this.config.minLength;
    if (message.content.length < lengthThreshold) return;

    // If no provider, fall back to simple regex extraction
    if (!this.provider) {
      await this.extractByRegex(conversationId, message);
      return;
    }

    // LLM-based extraction with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const systemPrompt = EXTRACTION_PROMPT.replace(
        "{maxFacts}",
        String(this.config.maxFactsPerMessage),
      );

      const messages: Message[] = [
        { id: "sys", role: "system", content: systemPrompt, timestamp: Date.now() },
        {
          id: "msg",
          role: "user",
          content: `Extract facts from this ${message.role} message:\n\n${message.content}`,
          timestamp: Date.now(),
        },
      ];

      // Collect full response from streaming provider
      let response = "";
      for await (const chunk of this.provider.chat(messages, {
        signal: controller.signal,
      })) {
        if (chunk.type === "text") {
          response += chunk.text;
        }
      }

      const candidates = this.parseFactsJson(response);

      if (candidates.length === 0) {
        this.logger.debug("No facts extracted", { conversationId });
        return;
      }

      this.logger.debug("Facts extracted by LLM", {
        conversationId,
        count: candidates.length,
      });

      for (const content of candidates) {
        if (content.length > this.config.maxFactLength) continue;
        if (content.length < 5) continue;

        const guard = guardFact(content);
        if (!guard.pass) {
          this.logger.debug("Fact rejected by firewall", {
            conversationId,
            content: content.slice(0, 60),
          });
          continue;
        }

        const result = await this.ltm.remember({
          conversationId,
          content,
          source: "auto-extracted",
          confidence: guard.confidence,
          expiresAt: guard.expiresAt,
        });

        if (result.ok) {
          this.logger.debug("Fact stored", {
            factId: result.value.id,
            confidence: guard.confidence,
            expiresAt: guard.expiresAt,
            content: content.slice(0, 60),
          });
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse JSON facts array from LLM output.
   * Tolerates: markdown code fences, trailing commas, partial JSON, extra text.
   */
  private parseFactsJson(raw: string): string[] {
    // Strip markdown code fences (```json ... ``` or ``` ... ```)
    let cleaned = raw.replace(/```(?:json)?\s*\n?([\s\S]*?)```/g, "$1").trim();

    // Find the JSON array in the response
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];

    cleaned = arrayMatch[0];

    // Fix trailing commas before ]
    cleaned = cleaned.replace(/,\s*]/g, "]");

    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item: unknown): item is string => typeof item === "string")
        .slice(0, this.config.maxFactsPerMessage);
    } catch {
      // Last resort: try to extract quoted strings
      const strings: string[] = [];
      const re = /"((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(cleaned)) !== null) {
        const s = m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
        if (s.length >= 5) strings.push(s);
      }
      return strings.slice(0, this.config.maxFactsPerMessage);
    }
  }

  /**
   * Fallback regex extraction when no Provider is available.
   * Simple pattern matching for obvious personal facts.
   */
  private async extractByRegex(
    conversationId: string,
    message: { content: string },
  ): Promise<void> {
    const factPatterns = [
      /(?:you (?:prefer|like|want|need|use|have))\s+(.+?)(?:\.|$)/gi,
      /(?:your (?:name|email|role|team|project) is)\s+(.+?)(?:\.|$)/gi,
      /(?:remember that)\s+(.+?)(?:\.|$)/gi,
      /(?:important:)\s+(.+?)(?:\.|$)/gi,
    ];

    for (const pattern of factPatterns) {
      const matches = message.content.matchAll(pattern);
      for (const match of matches) {
        const content = match[1]?.trim();
        if (!content || content.length <= 10 || content.length > this.config.maxFactLength) {
          continue;
        }

        const guard = guardFact(content);
        if (!guard.pass) continue;

        const result = await this.ltm.remember({
          conversationId,
          content,
          source: "auto-extracted",
          confidence: guard.confidence,
          expiresAt: guard.expiresAt,
        });

        if (result.ok) {
          this.logger.debug("Fact extracted (regex)", {
            conversationId,
            factId: result.value.id,
            content: content.slice(0, 50),
          });
        }
      }
    }
  }
}
