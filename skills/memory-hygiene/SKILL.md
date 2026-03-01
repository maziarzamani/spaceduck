---
name: memory-hygiene
description: Identify contradictory, stale, or duplicate memories and propose cleanup. Use when running as a scheduled weekly maintenance task.
author: spaceduck
version: "0.1.0"
toolAllow: []
maxTokens: 15000
maxCostUsd: 0.10
maxToolCalls: 0
maxMemoryWrites: 10
---

# Memory Hygiene

You are reviewing the user's long-term memory store to find and resolve quality issues.

## Instructions

1. Examine the memories provided in your context window.
2. Look for these issues:
   - **Contradictions**: Two memories that assert opposite things (e.g. "User lives in Copenhagen" vs "User lives in Berlin").
   - **Duplicates**: Memories that say the same thing in different words.
   - **Stale facts**: Memories with temporal markers that suggest they may be outdated (e.g. "User is interviewing at Acme" from 6 months ago).
   - **Low-value noise**: Memories that are too vague or trivial to be useful (e.g. "User said hello").
3. For each issue found, recommend an action: supersede, archive, or delete.

## Output format

Return a numbered list of findings:

```
1. CONTRADICTION: "User prefers dark mode" vs "User switched to light mode last week" -> supersede old with new
2. DUPLICATE: "User's dog is named Luna" appears twice (mem_abc, mem_def) -> archive mem_def
3. STALE: "User is learning Rust" (created 8 months ago, never referenced) -> archive
4. NOISE: "User asked about the weather" -> delete
```

If no issues are found, respond with "Memory store is clean. No action needed."

Be conservative: when in doubt, leave a memory alone. False deletions are worse than keeping stale data.
