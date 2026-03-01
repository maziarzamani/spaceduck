// Security scanner for SKILL.md content.
//
// Static pattern matching only. Catches obvious injection attempts, dangerous
// tool references, prompt overrides, and budget evasion in skill instructions.
//
// Known limitation: semantic attacks (e.g. "read ~/.ssh/id_rsa") pass the
// scanner because they don't use flagged syntax. Tool scoping via toolAllow
// is the real enforcement layer -- if the skill lacks filesystem tools, the
// attack fails at execution time regardless.

import { detectInjection } from "@spaceduck/core";
import type { SkillManifest, ScanResult, ScanFinding, ScanSeverity } from "./types";

const DANGEROUS_TOOL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bexec\s*\(/i, description: "exec() call" },
  { pattern: /\bshell[\s_-]?(exec|run|command)/i, description: "shell execution reference" },
  { pattern: /\b(rm\s+-rf|sudo\s|chmod\s|chown\s)/i, description: "destructive shell command" },
  { pattern: /\beval\s*\(/i, description: "eval() call" },
  { pattern: /\bchild_process/i, description: "child_process module" },
  { pattern: /\bfs\.(write|unlink|rmdir|rm)/i, description: "filesystem write operation" },
  { pattern: /\b(curl|wget)\s.*\|.*\b(sh|bash)\b/i, description: "remote code execution via pipe" },
];

const PROMPT_OVERRIDE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /ignore\s+(your\s+)?system\s+prompt/i, description: "system prompt override" },
  { pattern: /you\s+are\s+no\s+longer/i, description: "identity reset" },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+(a|an)\s+different/i, description: "identity substitution" },
  { pattern: /do\s+not\s+follow\s+(your|the)\s+(original|system|default)/i, description: "instruction override" },
  { pattern: /new\s+system\s+prompt\s*:/i, description: "system prompt injection" },
];

const BUDGET_EVASION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /retry\s+(indefinitely|forever|unlimited|without\s+limit)/i, description: "unlimited retry" },
  { pattern: /never\s+stop\s+(trying|retrying|running)/i, description: "infinite loop instruction" },
  { pattern: /spawn\s+(a\s+)?new\s+(task|agent|sub[-\s]?agent)/i, description: "sub-agent spawning" },
  { pattern: /increase\s+(your\s+)?budget/i, description: "budget escalation" },
  { pattern: /ignore\s+(the\s+)?(budget|token|cost)\s+(limit|cap)/i, description: "budget override" },
];

export function scanSkill(manifest: SkillManifest): ScanResult {
  const findings: ScanFinding[] = [];
  const text = manifest.instructions;

  // 1. Injection patterns (reuse core detectInjection with strict=true for skill content)
  if (detectInjection(text, true)) {
    findings.push({
      rule: "injection_pattern",
      severity: "critical",
      message: "Skill instructions contain injection patterns that could poison the agent context",
    });
  }

  // 2. Dangerous tool references without explicit toolAllow
  for (const { pattern, description } of DANGEROUS_TOOL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      findings.push({
        rule: "dangerous_tool_ref",
        severity: manifest.toolAllow ? "warning" : "critical",
        message: `Instructions reference ${description} without explicit tool scoping`,
        matchedText: match[0],
      });
    }
  }

  // 3. Prompt override attempts
  for (const { pattern, description } of PROMPT_OVERRIDE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      findings.push({
        rule: "prompt_override",
        severity: "critical",
        message: `Instructions attempt ${description}`,
        matchedText: match[0],
      });
    }
  }

  // 4. Budget evasion
  for (const { pattern, description } of BUDGET_EVASION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      findings.push({
        rule: "budget_evasion",
        severity: "warning",
        message: `Instructions contain ${description}`,
        matchedText: match[0],
      });
    }
  }

  const maxSeverity: ScanSeverity = findings.some((f) => f.severity === "critical")
    ? "critical"
    : findings.length > 0
      ? "warning"
      : "none";

  return {
    passed: maxSeverity !== "critical",
    severity: maxSeverity,
    findings,
  };
}
