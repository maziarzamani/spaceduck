---
name: web-research
description: Research any topic using web search and browsing, then store a concise summary to memory. Use for scheduled research tasks or one-off deep dives.
author: spaceduck
version: "0.1.0"
toolAllow:
  - web_search
  - web_fetch
  - browser_navigate
  - browser_snapshot
  - browser_click
  - browser_scroll
  - browser_wait
maxTokens: 20000
maxCostUsd: 0.15
maxToolCalls: 15
maxMemoryWrites: 3
---

# Web Research

You are conducting web research on a topic provided in the user prompt.

## Instructions

1. Start by using `web_search` to find relevant, recent sources on the topic.
2. Pick the 2-3 most promising results and use `web_fetch` or `browser_navigate` to read them.
3. If a page requires interaction (cookie banners, "show more" buttons), use `browser_click` and `browser_scroll` to access the content.
4. Cross-reference facts across sources. Prefer primary sources over aggregators.
5. Synthesize your findings into a concise summary.

## Output format

```
## [Topic]

**Key findings:**
1. [First finding with source URL]
2. [Second finding with source URL]
3. [Third finding with source URL]

**Confidence:** high / medium / low
**Sources consulted:** [count]
**Last checked:** [date]
```

Keep the summary under 300 words. Focus on facts, not opinions. If sources disagree, note the disagreement rather than picking a side.
