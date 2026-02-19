// Fact extractor: deterministic regex-first pipeline + optional LLM extraction.
//
// Pipeline order:
//   1. Regex extraction (high precision, deterministic, canonical English)
//   2. LLM extraction (higher recall, may return empty)
//   3. Merge + content-hash dedupe (regex wins ties since it ran first)
//   4. Negation filter (symmetric: before + after match)
//   5. guardFact() firewall
//   6. Slot conflict resolution (SQL in LTM.remember)
//
// All facts are stored as canonical English sentences.
// The `lang` field records the detected source language.

import type { Logger, LongTermMemory, Provider, Message, FactSlot } from "./types";
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

// ── Text normalization (run once before regex) ──────────────────────────

function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

// ── Negation detection ──────────────────────────────────────────────────

const NEGATION_TOKENS = /\b(ikke|ikk|sgu\s+ikke|ikke\s+rigtig|hverken|not|don't|doesn't|isn't|wasn't|never|no\s+longer|ikke\s+l\S*ngere|not\s+really)\b/i;

function hasNegation(fullText: string, matchStart: number, matchEnd: number): boolean {
  const before = fullText.slice(Math.max(0, matchStart - 40), matchStart);
  const within = fullText.slice(matchStart, matchEnd);
  const after = fullText.slice(matchEnd, Math.min(fullText.length, matchEnd + 40));
  return NEGATION_TOKENS.test(before) || NEGATION_TOKENS.test(within) || NEGATION_TOKENS.test(after);
}

// ── Regex patterns ──────────────────────────────────────────────────────

// Unicode-aware name: 1-3 tokens, allows hyphens, apostrophes, letter chars
// Must not match across conjunctions/pronouns (og/and/i/er/jeg/du/vi)
const NAME_CAPTURE = String.raw`([\p{L}][\p{L}'\-]*(?:\s+(?!og\b|and\b|i\b|er\b|jeg\b|du\b|vi\b|men\b|or\b|but\b)[\p{L}][\p{L}'\-]*){0,2})`;

interface IdentityPattern {
  pattern: RegExp;
  template: (m: RegExpMatchArray) => string;
  lang: string;
  slot: FactSlot;
  valueIndex: number;
}

const IDENTITY_PATTERNS: IdentityPattern[] = [
  // Name (EN)
  { pattern: new RegExp(String.raw`\b(?:my name is|I'm|I am)\s+${NAME_CAPTURE}`, "iu"),
    template: m => `User's name is ${m[1].trim()}`, lang: "en", slot: "name", valueIndex: 1 },
  { pattern: new RegExp(String.raw`\bcall me\s+${NAME_CAPTURE}`, "iu"),
    template: m => `User's name is ${m[1].trim()}`, lang: "en", slot: "name", valueIndex: 1 },
  // Name (DA) — standard SVO
  { pattern: new RegExp(String.raw`\b(?:jeg hedder|mit navn er)\s+${NAME_CAPTURE}`, "iu"),
    template: m => `User's name is ${m[1].trim()}`, lang: "da", slot: "name", valueIndex: 1 },
  // Name (DA) — V2 inversion: "Nu hedder jeg X", "Fremover hedder jeg X"
  { pattern: new RegExp(String.raw`\bhedder\s+jeg\s+${NAME_CAPTURE}`, "iu"),
    template: m => `User's name is ${m[1].trim()}`, lang: "da", slot: "name", valueIndex: 1 },
  // Name (DA) — "kald mig X", "du kan kalde mig X"
  { pattern: new RegExp(String.raw`\b(?:kald|kalde|kalder)\s+(?:du\s+)?mig\s+${NAME_CAPTURE}`, "iu"),
    template: m => `User's name is ${m[1].trim()}`, lang: "da", slot: "name", valueIndex: 1 },
  // Name (DA) — "mit nye navn er X", "mit rigtige navn er X"
  { pattern: new RegExp(String.raw`\bmit\s+(?:nye|rigtige)\s+navn\s+er\s+${NAME_CAPTURE}`, "iu"),
    template: m => `User's name is ${m[1].trim()}`, lang: "da", slot: "name", valueIndex: 1 },
  // Name (DA) — "jeg har skiftet navn til X"
  { pattern: new RegExp(String.raw`\bjeg\s+(?:har\s+)?skiftet\s+navn\s+til\s+${NAME_CAPTURE}`, "iu"),
    template: m => `User's name is ${m[1].trim()}`, lang: "da", slot: "name", valueIndex: 1 },
  // Age (EN)
  { pattern: /\bI(?:'m| am)\s+(\d{1,3})\s*(?:years?\s*old)/i,
    template: m => `User is ${m[1]} years old`, lang: "en", slot: "age", valueIndex: 1 },
  // Age (DA)
  { pattern: /\bjeg er\s+(\d{1,3})\s*(?:år|aar)\b/iu,
    template: m => `User is ${m[1]} years old`, lang: "da", slot: "age", valueIndex: 1 },
  // Location (EN) — stops at conjunctions
  { pattern: /\bI live in\s+([\p{L}\s'-]+?)(?:\.|,|\band\b|\bbut\b|$)/iu,
    template: m => `User lives in ${m[1].trim()}`, lang: "en", slot: "location", valueIndex: 1 },
  // Location (DA) — stops at conjunctions
  { pattern: /\bjeg bor i\s+([\p{L}\s'-]+?)(?:\.|,|\bog\b|\bmen\b|$)/iu,
    template: m => `User lives in ${m[1].trim()}`, lang: "da", slot: "location", valueIndex: 1 },
];

// Legacy generic patterns (produce free-form content, slot=other, lang=en)
const GENERIC_PATTERNS: RegExp[] = [
  /(?:you (?:prefer|like|want|need|use|have))\s+(.+?)(?:\.|$)/gi,
  /(?:your (?:name|email|role|team|project) is)\s+(.+?)(?:\.|$)/gi,
  /(?:remember that)\s+(.+?)(?:\.|$)/gi,
  /(?:important:)\s+(.+?)(?:\.|$)/gi,
];

// ── Structured fact candidate ───────────────────────────────────────────

export interface FactCandidate {
  content: string;
  slot: FactSlot;
  slotValue?: string;
  lang: string;
  source: "regex" | "llm";
}

// ── Language detection heuristic ────────────────────────────────────────

function detectLang(text: string): string {
  if (/[æøåÆØÅ]/.test(text)) return "da";
  return "en";
}

// ── LLM extraction prompt ───────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a fact extraction system. Given a conversation message, extract personal facts about the user that are worth remembering long-term.

Rules:
- The message may be in any language. Always extract facts as canonical English sentences.
- Extract ONLY concrete, durable facts (preferences, personal info, decisions, technical choices)
- Do NOT extract transient information (current task, temporary context, greetings)
- Do NOT extract opinions the assistant expresses — only facts about the USER
- Return a JSON array of objects: [{"type": "name"|"age"|"location"|"preference"|"decision"|"other", "value": "extracted value", "sentence": "canonical English sentence"}]
- "sentence" must be a single self-contained English sentence (e.g., "User's name is Alice")
- If no durable facts exist, return []. Do not guess or infer facts not explicitly stated.
- Maximum {maxFacts} facts per message

Examples of good output:
- [{"type": "name", "value": "Alice", "sentence": "User's name is Alice"}]
- [{"type": "preference", "value": "TypeScript", "sentence": "User prefers TypeScript over JavaScript"}]

Examples of what NOT to extract:
- User asked about embeddings (transient task)
- The weather is nice today (not personal)`;

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

  /**
   * Pure regex extraction: runs identity + generic patterns on raw text.
   * Returns candidates without performing any DB writes.
   * Used for pre-context extraction in the agent loop.
   */
  extractRegexFromText(text: string): FactCandidate[] {
    const normalized = normalizeText(text);
    return this.extractByRegexPipeline(normalized);
  }

  /** Register this extractor as a listener on the event bus. */
  register(eventBus: EventBus): void {
    this.handler = (data) => {
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

    if (message.role === "assistant" && !this.config.extractFromAssistant) return;
    if (message.role === "user" && !this.config.extractFromUser) return;
    if (message.role !== "assistant" && message.role !== "user") return;

    const lengthThreshold =
      message.role === "user" ? this.config.minUserLength : this.config.minLength;
    if (message.content.length < lengthThreshold) return;

    const normalized = normalizeText(message.content);

    // ── Step 1: Regex extraction (always runs) ────────────────────────
    const regexCandidates = this.extractByRegexPipeline(normalized);

    // ── Step 2: LLM extraction (if provider available) ────────────────
    let llmCandidates: FactCandidate[] = [];
    if (this.provider) {
      llmCandidates = await this.extractByLLM(message);
    }

    // ── Step 3: Merge + dedupe (regex wins ties) ──────────────────────
    const seenContent = new Set<string>();
    const merged: FactCandidate[] = [];

    for (const c of regexCandidates) {
      const key = c.content.toLowerCase().trim();
      if (!seenContent.has(key)) {
        seenContent.add(key);
        merged.push(c);
      }
    }
    for (const c of llmCandidates) {
      const key = c.content.toLowerCase().trim();
      if (!seenContent.has(key)) {
        seenContent.add(key);
        merged.push(c);
      }
    }

    // ── Step 4-6: Guard + store ───────────────────────────────────────
    let stored = 0;
    let guardRejected = 0;

    for (const candidate of merged) {
      if (candidate.content.length > this.config.maxFactLength) continue;
      if (candidate.content.length < 5) continue;

      const guard = guardFact(candidate.content);
      if (!guard.pass) {
        guardRejected++;
        this.logger.debug("Fact rejected by firewall", {
          conversationId,
          content: candidate.content.slice(0, 60),
        });
        continue;
      }

      // Identity slots use upsertSlotFact with write guards
      const isIdentitySlot = candidate.slot !== "other" && candidate.slot !== "preference" && candidate.slotValue;
      if (isIdentitySlot && this.ltm.upsertSlotFact) {
        const result = await this.ltm.upsertSlotFact({
          slot: candidate.slot,
          slotValue: candidate.slotValue!,
          content: candidate.content,
          conversationId,
          lang: candidate.lang,
          source: candidate.source === "regex" ? "pre_regex" : "post_llm",
          derivedFromMessageId: message.id,
          confidence: guard.confidence,
        });
        if (result.ok && result.value) stored++;
      } else {
        const result = await this.ltm.remember({
          conversationId,
          content: candidate.content,
          source: candidate.source,
          confidence: guard.confidence,
          expiresAt: guard.expiresAt,
          slot: candidate.slot,
          slotValue: candidate.slotValue,
          lang: candidate.lang,
        });
        if (result.ok) stored++;
      }

      if (stored > 0) {
        this.logger.debug("Fact stored", {
          conversationId,
          slot: candidate.slot,
          source: candidate.source,
          confidence: guard.confidence,
          content: candidate.content.slice(0, 60),
        });
      }
    }

    this.logger.debug("Fact extraction summary", {
      conversationId,
      regexCandidates: regexCandidates.length,
      llmCandidates: llmCandidates.length,
      guardRejected,
      stored,
    });
  }

  // ── Regex pipeline ──────────────────────────────────────────────────

  private extractByRegexPipeline(text: string): FactCandidate[] {
    const candidates: FactCandidate[] = [];

    // Identity patterns (multilingual, typed)
    for (const p of IDENTITY_PATTERNS) {
      const match = text.match(p.pattern);
      if (!match) continue;

      const matchStart = match.index ?? 0;
      const matchEnd = matchStart + match[0].length;

      if (hasNegation(text, matchStart, matchEnd)) continue;

      const value = match[p.valueIndex]?.trim();
      if (!value) continue;

      candidates.push({
        content: p.template(match),
        slot: p.slot,
        slotValue: value,
        lang: p.lang,
        source: "regex",
      });
    }

    // Generic English patterns (legacy, slot=other)
    for (const pattern of GENERIC_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const content = match[1]?.trim();
        if (!content || content.length <= 10 || content.length > this.config.maxFactLength) {
          continue;
        }

        const matchStart = match.index ?? 0;
        const matchEnd = matchStart + match[0].length;
        if (hasNegation(text, matchStart, matchEnd)) continue;

        candidates.push({
          content,
          slot: "other",
          lang: "en",
          source: "regex",
        });
      }
    }

    return candidates;
  }

  // ── LLM extraction ─────────────────────────────────────────────────

  private async extractByLLM(message: { content: string; role: string }): Promise<FactCandidate[]> {
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

      let response = "";
      for await (const chunk of this.provider!.chat(messages, {
        signal: controller.signal,
      })) {
        if (chunk.type === "text") {
          response += chunk.text;
        }
      }

      return this.parseLLMResponse(response, message.content);
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse structured LLM output. Supports two formats:
   * 1. Array of objects: [{ type, value, sentence }]
   * 2. Array of strings: ["fact 1", "fact 2"] (backward compat)
   */
  private parseLLMResponse(raw: string, originalText: string): FactCandidate[] {
    const parsed = this.parseJsonArray(raw);
    if (!parsed || parsed.length === 0) return [];

    const lang = detectLang(originalText);
    const candidates: FactCandidate[] = [];

    for (const item of parsed) {
      if (typeof item === "string") {
        if (item.length >= 5 && item.length <= this.config.maxFactLength) {
          candidates.push({
            content: item,
            slot: "other",
            lang,
            source: "llm",
          });
        }
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const sentence = (obj.sentence ?? obj.content ?? "") as string;
        const type = (obj.type ?? "other") as string;
        const value = (obj.value ?? "") as string;

        if (typeof sentence === "string" && sentence.length >= 5 && sentence.length <= this.config.maxFactLength) {
          const slot = LLM_TYPE_TO_SLOT[type] ?? "other";
          candidates.push({
            content: sentence,
            slot,
            slotValue: typeof value === "string" && value.length > 0 ? value : undefined,
            lang,
            source: "llm",
          });
        }
      }
    }

    return candidates.slice(0, this.config.maxFactsPerMessage);
  }

  private parseJsonArray(raw: string): unknown[] | null {
    let cleaned = raw.replace(/```(?:json)?\s*\n?([\s\S]*?)```/g, "$1").trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return null;

    cleaned = arrayMatch[0].replace(/,\s*]/g, "]");

    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      const strings: string[] = [];
      const re = /"((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(cleaned)) !== null) {
        const s = m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
        if (s.length >= 5) strings.push(s);
      }
      return strings.length > 0 ? strings : null;
    }
  }
}

const LLM_TYPE_TO_SLOT: Record<string, FactSlot> = {
  name: "name",
  age: "age",
  location: "location",
  preference: "preference",
  decision: "preference",
  other: "other",
};
