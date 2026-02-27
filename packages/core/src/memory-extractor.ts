/**
 * MemoryExtractor: typed memory extraction pipeline for Memory v2.
 *
 * Pipeline:
 *   1. Candidate extraction (delegates to FactExtractor regex + LLM)
 *   2. Classification + retention gate (single LLM call with discrete rubrics)
 *   3. Deterministic post-LLM validation ("steel gate")
 *   4. Dedup check (content-hash in MemoryStore.store())
 *   5. Store via MemoryStore
 *
 * Runs asynchronously on `message:response` events. Extraction failures
 * are non-fatal and never block the agent response loop.
 */

import type {
  Logger,
  Provider,
  Message,
  MemoryStore,
  MemoryInput,
  MemoryKind,
  ProcedureSubtype,
  MemorySource,
  RetentionDecision,
  RetentionReason,
  ImportanceBucket,
  ConfidenceBucket,
} from "./types";
import { IMPORTANCE_MAP, CONFIDENCE_MAP } from "./types";
import type { EventBus, SpaceduckEvents } from "./events";
import { FactExtractor, guardFact, type FactCandidate } from "./fact-extractor";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface MemoryExtractorConfig {
  readonly timeoutMs?: number;
  readonly maxCandidatesPerMessage?: number;
  readonly minContentLength?: number;
  readonly minUserContentLength?: number;
}

const DEFAULTS: Required<MemoryExtractorConfig> = {
  timeoutMs: 15_000,
  maxCandidatesPerMessage: 8,
  minContentLength: 80,
  minUserContentLength: 5,
};

// ---------------------------------------------------------------------------
// LLM classification prompt
// ---------------------------------------------------------------------------

const CLASSIFICATION_PROMPT = `You are a memory classification system for a personal AI assistant called Spaceduck. Given a conversation message, extract and classify memories worth storing long-term.

For EACH candidate memory, output a JSON object with these fields:
- "kind": "fact" | "episode" | "procedure"
- "title": short descriptive title (max 80 chars)
- "content": the full memory content as a canonical English sentence
- "summary": a concise 1-sentence summary for embedding (max 120 chars)
- "importance": "trivial" | "standard" | "significant" | "core" | "critical"
- "confidence": "speculative" | "likely" | "stated" | "certain"
- "tags": array of 1-4 lowercase tags
- "should_store": true | false
- "rejection_reason": if should_store is false, one of: "ephemeral_noise" | "duplicate_candidate" | "low_confidence" | "ambiguous"

For procedures, also include:
- "procedure_subtype": "behavioral" | "workflow" | "constraint"

For episodes, also include:
- "occurred_at_hint": "now" | "recent" | "past" (the system will assign the actual timestamp)

IMPORTANCE RUBRIC:
- "trivial": Minor preference, casual mention (e.g., "likes coffee")
- "standard": Normal fact, typical event, general knowledge
- "significant": Strong preference, project decision, notable event
- "core": Core identity, architectural constraint, critical workflow
- "critical": Safety instruction, security requirement, must-never-forget

CONFIDENCE RUBRIC:
- "speculative": Inferred, not directly stated, could be wrong
- "likely": Reasonable inference from context
- "stated": User or tool directly stated this
- "certain": Explicit, unambiguous, repeated or confirmed

WHAT TO STORE:
- Facts: stable truths, preferences, identities, settings, project info
- Episodes: user-caused decisions, milestones, completions, failures with future relevance, notable state changes
- Procedures: behavioral instructions, workflow patterns, hard constraints

WHAT NOT TO STORE (set should_store: false):
- Intermediate tool chatter ("read file X", "called API Y")
- Routine browsing observations ("visited docs page")
- Failed searches without downstream consequence
- Partial plan steps or speculative reasoning
- Transient execution noise ("retrying after timeout")
- Greetings, acknowledgments, filler
- Questions without answers
- The assistant's own opinions or suggestions (only store user facts)
- Facts that the assistant is merely echoing or confirming from the user's message — these are already stored from the user message itself

Return a JSON array: [{...}, {...}]
Return [] if nothing is worth storing.
Maximum {maxCandidates} memories per message.`;

// ---------------------------------------------------------------------------
// LLM output shape (raw, before validation)
// ---------------------------------------------------------------------------

interface RawLLMClassification {
  kind?: string;
  title?: string;
  content?: string;
  summary?: string;
  importance?: string;
  confidence?: string;
  tags?: string[];
  should_store?: boolean;
  rejection_reason?: string;
  procedure_subtype?: string;
  occurred_at_hint?: string;
}

// ---------------------------------------------------------------------------
// Validated classification result
// ---------------------------------------------------------------------------

export interface ClassifiedMemory {
  readonly input: MemoryInput;
  readonly retention: RetentionDecision;
}

// ---------------------------------------------------------------------------
// guardMemory: kind-aware firewall extending guardFact
// ---------------------------------------------------------------------------

export function guardMemory(content: string, kind: MemoryKind): { pass: boolean; reason?: string } {
  const base = guardFact(content);
  if (!base.pass) return { pass: false, reason: "base_guard_rejected" };

  if (kind === "episode") {
    const hasVerb = /\b(deployed|migrated|created|deleted|changed|updated|fixed|broke|shipped|released|added|removed|decided|discovered|completed|failed|enabled|disabled)\b/i.test(content);
    if (!hasVerb) return { pass: false, reason: "episode_missing_verb" };
  }

  if (kind === "procedure") {
    const hasImperative = /\b(always|never|must|should|ensure|avoid|prefer|use|do not|don't|make sure|validate|check)\b/i.test(content);
    if (!hasImperative) return { pass: false, reason: "procedure_missing_imperative" };
  }

  return { pass: true };
}

// ---------------------------------------------------------------------------
// MemoryExtractor
// ---------------------------------------------------------------------------

export class MemoryExtractor {
  private handler: ((data: SpaceduckEvents["message:response"]) => void) | null = null;
  private userHandler: ((data: SpaceduckEvents["message:received"]) => void) | null = null;
  private readonly config: Required<MemoryExtractorConfig>;
  private readonly factExtractor: FactExtractor | undefined;

  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly logger: Logger,
    private readonly provider?: Provider,
    factExtractor?: FactExtractor,
    config?: MemoryExtractorConfig,
  ) {
    this.factExtractor = factExtractor;
    this.config = { ...DEFAULTS, ...config };
  }

  register(eventBus: EventBus): void {
    this.handler = (data) => { this.extractSafe(data); };
    eventBus.on("message:response", this.handler);

    this.userHandler = (data) => {
      this.extractSafe({ ...data, durationMs: 0 });
    };
    eventBus.on("message:received", this.userHandler);
  }

  unregister(eventBus: EventBus): void {
    if (this.handler) {
      eventBus.off("message:response", this.handler);
      this.handler = null;
    }
    if (this.userHandler) {
      eventBus.off("message:received", this.userHandler);
      this.userHandler = null;
    }
  }

  /**
   * Public extraction entry point for testing. Processes a single message
   * and returns all classified + stored memories.
   */
  async extractFromMessage(
    message: Message,
    conversationId: string,
  ): Promise<ClassifiedMemory[]> {
    return this.extract({ conversationId, message, durationMs: 0 });
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private async extractSafe(data: SpaceduckEvents["message:response"]): Promise<void> {
    try {
      await this.extract(data);
    } catch (err) {
      this.logger.warn("Memory extraction failed (non-fatal)", {
        conversationId: data.conversationId,
        error: String(err),
      });
    }
  }

  private async extract(
    data: SpaceduckEvents["message:response"],
  ): Promise<ClassifiedMemory[]> {
    const { conversationId, message } = data;

    if (message.role !== "user" && message.role !== "assistant") return [];

    const minLen = message.role === "user"
      ? this.config.minUserContentLength
      : this.config.minContentLength;
    if (message.content.length < minLen) return [];

    this.logger.info("Memory extraction starting", {
      conversationId, role: message.role,
      contentLength: message.content.length,
    });

    const source: MemorySource = {
      type: message.role === "user" ? "user_message" : "assistant_message",
      id: message.id,
      conversationId,
    };

    // Stage 1: Candidate extraction via FactExtractor regex (user messages only)
    const regexCandidates: FactCandidate[] =
      message.role === "user" && this.factExtractor
        ? this.factExtractor.extractRegexFromText(message.content)
        : [];

    // Stage 2: LLM classification + retention gate
    const classified = this.provider
      ? await this.classifyViaLLM(message, source)
      : [];

    // Hard filter: never store facts from assistant messages — they're echoes
    // of what was already extracted from the user message.
    const filtered = message.role === "assistant"
      ? classified.filter((cm) => cm.input.kind !== "fact" || !cm.retention.shouldStore)
      : classified;

    this.logger.info("Memory extraction classified", {
      conversationId, role: message.role,
      llmCandidates: filtered.length,
      regexCandidates: regexCandidates.length,
    });

    // Merge regex candidates as high-confidence facts if LLM didn't already capture them
    const classifiedContents = new Set(
      filtered.map((c) => c.input.content.toLowerCase().trim()),
    );

    for (const rc of regexCandidates) {
      const key = rc.content.toLowerCase().trim();
      if (classifiedContents.has(key)) continue;

      const guard = guardMemory(rc.content, "fact");
      if (!guard.pass) continue;

      filtered.push({
        input: {
          kind: "fact",
          title: rc.content.slice(0, 80),
          content: rc.content,
          scope: { type: "global" },
          source,
          importance: 0.7,
          confidence: 0.85,
          tags: rc.slot !== "other" ? [rc.slot] : [],
        },
        retention: {
          shouldStore: true,
          reason: "durable_fact",
          initialStatus: "active",
        },
      });
    }

    // Stage 3-5: Store memories that passed retention gate (in parallel)
    const toStore = filtered.filter((cm) => {
      if (!cm.retention.shouldStore) {
        this.logger.info("Memory rejected by retention gate", {
          conversationId,
          title: cm.input.title,
          reason: cm.retention.reason,
        });
        return false;
      }
      return true;
    });

    const results = await Promise.allSettled(
      toStore.map((cm) => this.memoryStore.store(cm.input)),
    );

    const stored: ClassifiedMemory[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const cm = toStore[i];
      if (result.status === "fulfilled" && result.value.ok) {
        stored.push(cm);
        this.logger.info("Memory stored", {
          conversationId,
          kind: cm.input.kind,
          title: cm.input.title,
          reason: cm.retention.reason,
        });
      } else {
        const error = result.status === "rejected"
          ? String(result.reason)
          : !result.value.ok ? String(result.value.error) : "unknown";
        this.logger.warn("Memory store failed", {
          conversationId,
          title: cm.input.title,
          error,
        });
      }
    }

    this.logger.debug("Memory extraction summary", {
      conversationId,
      regexCandidates: regexCandidates.length,
      llmClassified: filtered.length,
      stored: stored.length,
    });

    return stored;
  }

  // ── LLM classification ────────────────────────────────────────────────

  private async classifyViaLLM(
    message: Message,
    source: MemorySource,
  ): Promise<ClassifiedMemory[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const systemPrompt = CLASSIFICATION_PROMPT.replace(
        "{maxCandidates}",
        String(this.config.maxCandidatesPerMessage),
      );

      const messages: Message[] = [
        { id: "sys", role: "system", content: systemPrompt, timestamp: Date.now() },
        {
          id: "msg",
          role: "user",
          content: `Classify memories from this ${message.role} message:\n\n${message.content}`,
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

      const rawItems = this.parseJsonArray(response);
      if (!rawItems || rawItems.length === 0) return [];

      const results: ClassifiedMemory[] = [];
      for (const item of rawItems) {
        if (!item || typeof item !== "object") continue;
        const raw = item as RawLLMClassification;
        const validated = this.validateAndConvert(raw, source);
        if (validated) results.push(validated);
      }

      return results.slice(0, this.config.maxCandidatesPerMessage);
    } catch (err) {
      this.logger.debug("LLM classification failed", { error: String(err) });
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Deterministic post-LLM validation ("steel gate") ──────────────────

  private validateAndConvert(
    raw: RawLLMClassification,
    source: MemorySource,
  ): ClassifiedMemory | null {
    // Validate kind
    const kind = raw.kind as MemoryKind | undefined;
    if (!kind || !["fact", "episode", "procedure"].includes(kind)) {
      this.logger.debug("LLM output rejected: invalid kind", { kind: raw.kind });
      return null;
    }

    // Validate required fields
    const content = typeof raw.content === "string" ? raw.content.trim() : "";
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 80) : "";
    if (!content || content.length < 5) return null;
    if (!title) return null;

    // Validate retention decision
    const shouldStore = raw.should_store !== false;
    if (!shouldStore) {
      const reason = this.parseRetentionReason(raw.rejection_reason);
      return {
        input: this.buildInput(kind, title, content, raw, source),
        retention: { shouldStore: false, reason },
      };
    }

    // Steel gate: kind-specific validation
    if (kind === "procedure") {
      const subtype = raw.procedure_subtype as ProcedureSubtype | undefined;
      if (!subtype || !["behavioral", "workflow", "constraint"].includes(subtype)) {
        this.logger.debug("Procedure rejected: missing/invalid subtype", {
          title, subtype: raw.procedure_subtype,
        });
        return null;
      }
    }

    if (kind === "episode") {
      // occurredAt will be assigned by the system; just validate the content
      const hasAction = /\b(deployed|migrated|created|deleted|changed|updated|fixed|broke|shipped|released|added|removed|decided|discovered|completed|failed|enabled|disabled|started|finished|launched|configured|installed|moved|built|designed|implemented|resolved|merged|reverted|upgraded|downgraded)\b/i.test(content);
      if (!hasAction) {
        this.logger.debug("Episode rejected: no action verb detected", { title });
        return null;
      }
    }

    // guardMemory firewall
    const guard = guardMemory(content, kind);
    if (!guard.pass) {
      this.logger.debug("Memory rejected by guardMemory", {
        title, kind, reason: guard.reason,
      });
      return null;
    }

    // Map discrete buckets to numeric values
    const importance = this.mapImportance(raw.importance);
    const confidence = this.mapConfidence(raw.confidence);
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string").slice(0, 4)
      : [];
    const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 200) : undefined;

    // Build retention decision
    const reason = this.inferRetentionReason(kind, raw.procedure_subtype as ProcedureSubtype | undefined);
    const initialStatus: "candidate" | "active" = confidence >= 0.7 ? "active" : "candidate";

    const input = this.buildInputFull(kind, title, content, summary, importance, confidence, tags, raw, source);

    return {
      input,
      retention: { shouldStore: true, reason, initialStatus },
    };
  }

  private buildInput(
    kind: MemoryKind,
    title: string,
    content: string,
    raw: RawLLMClassification,
    source: MemorySource,
  ): MemoryInput {
    const base = {
      title,
      content,
      scope: { type: "global" as const },
      source,
    };

    switch (kind) {
      case "episode":
        return { ...base, kind: "episode", occurredAt: Date.now() };
      case "procedure":
        return {
          ...base,
          kind: "procedure",
          procedureSubtype: (raw.procedure_subtype as ProcedureSubtype) || "behavioral",
        };
      default:
        return { ...base, kind: "fact" };
    }
  }

  private buildInputFull(
    kind: MemoryKind,
    title: string,
    content: string,
    summary: string | undefined,
    importance: number,
    confidence: number,
    tags: string[],
    raw: RawLLMClassification,
    source: MemorySource,
  ): MemoryInput {
    const base = {
      title,
      content,
      summary,
      scope: { type: "global" as const },
      source,
      importance,
      confidence,
      tags,
      status: confidence >= 0.7 ? "active" as const : "candidate" as const,
    };

    switch (kind) {
      case "episode": {
        let occurredAt = Date.now();
        if (raw.occurred_at_hint === "recent") occurredAt -= 86_400_000;
        else if (raw.occurred_at_hint === "past") occurredAt -= 7 * 86_400_000;
        return { ...base, kind: "episode", occurredAt };
      }
      case "procedure":
        return {
          ...base,
          kind: "procedure",
          procedureSubtype: raw.procedure_subtype as ProcedureSubtype,
        };
      default:
        return { ...base, kind: "fact" };
    }
  }

  private mapImportance(bucket: string | undefined): number {
    if (!bucket) return 0.5;
    return IMPORTANCE_MAP[bucket as ImportanceBucket] ?? 0.5;
  }

  private mapConfidence(bucket: string | undefined): number {
    if (!bucket) return 0.7;
    return CONFIDENCE_MAP[bucket as ConfidenceBucket] ?? 0.7;
  }

  private inferRetentionReason(kind: MemoryKind, subtype?: ProcedureSubtype): RetentionReason {
    switch (kind) {
      case "fact": return "durable_fact";
      case "episode": return "relevant_episode";
      case "procedure":
        if (subtype === "constraint") return "constraint_procedure";
        if (subtype === "workflow") return "workflow_procedure";
        return "behavioral_instruction";
    }
  }

  private parseRetentionReason(raw: string | undefined): RetentionReason {
    const valid: RetentionReason[] = [
      "ephemeral_noise", "duplicate_candidate", "low_confidence", "ambiguous",
    ];
    if (raw && valid.includes(raw as RetentionReason)) return raw as RetentionReason;
    return "ephemeral_noise";
  }

  // ── JSON parsing ──────────────────────────────────────────────────────

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
      return null;
    }
  }
}
