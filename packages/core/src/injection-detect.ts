// Injection boundary detection for memory content.
//
// Prevents memory poisoning where adversarial content gets stored as
// a memory and later injected into the agent's context window.
//
// Two modes:
//   strict = true  (task-sourced memories) — any single match rejects
//   strict = false (user input)           — 2+ matches required

const BASELINE_PATTERNS: RegExp[] = [
  // System prompt / role injection
  /\[INST\]/i,
  /<<SYS>>/i,
  /<\/?system>/i,
  /^(assistant|user|system)\s*:/im,

  // Instruction override
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(prior|previous|above)/i,
  /new\s+instructions?\s*:/i,
  /override\s+(system|instructions|prompt)/i,
  /forget\s+(everything|all|what)\s+(you|i)\s+(told|said|know)/i,

  // XML/tag injection targeting agent internals
  /<\/?tool_call>/i,
  /<\/?tool_result>/i,
  /<\/?function>/i,
  /<\/?tool_use>/i,
  /<\/?previous_task_output>/i,

  // Prompt framing patterns
  /you\s+are\s+(now\s+)?(a|an|the)\s+/i,
  /as\s+an?\s+ai\s+(language\s+)?model/i,
  /from\s+now\s+on\s*,?\s*you/i,
];

let extraPatterns: RegExp[] = [];

/**
 * Load additional patterns from config. Call on startup and on hot-reload.
 * Patterns are strings that get compiled to case-insensitive RegExp.
 */
export function loadExtraPatterns(patterns: string[]): void {
  extraPatterns = patterns.map((p) => new RegExp(p, "i"));
}

/**
 * Detect potential injection in memory content.
 *
 * @param content  The text to check
 * @param strict   If true (task-sourced), single match rejects.
 *                 If false (user input), requires 2+ matches.
 * @returns true if injection detected (content should be rejected)
 */
export function detectInjection(content: string, strict = false): boolean {
  const allPatterns = [...BASELINE_PATTERNS, ...extraPatterns];
  let matchCount = 0;
  const threshold = strict ? 1 : 2;

  for (const pattern of allPatterns) {
    if (pattern.test(content)) {
      matchCount++;
      if (matchCount >= threshold) return true;
    }
  }

  return false;
}
