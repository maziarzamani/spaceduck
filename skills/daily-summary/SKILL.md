---
name: daily-summary
description: Summarize the day's conversations and store key takeaways to long-term memory. Use when running as a scheduled end-of-day review.
author: spaceduck
version: "0.1.0"
toolAllow: []
maxTokens: 10000
maxCostUsd: 0.05
maxToolCalls: 0
maxMemoryWrites: 5
---

# Daily Summary

You are reviewing today's conversations to extract durable insights worth remembering.

## Instructions

1. Read the conversation history provided in your context window.
2. Identify facts, preferences, decisions, or commitments the user made today.
3. Ignore small talk, greetings, and transient questions that won't matter tomorrow.
4. For each takeaway, write a concise one-sentence summary.
5. Categorize each as: fact (something true about the user), episode (something that happened), or procedure (a workflow or preference the user described).

## Output format

Return a numbered list of takeaways. Each line should follow this format:

```
1. [fact] User's preferred language for code reviews is TypeScript.
2. [episode] User deployed v2.3 of the billing service to production.
3. [procedure] User wants PR descriptions to include a test plan section.
```

Keep the total under 5 items. Quality over quantity. If nothing worth remembering happened today, respond with "No notable takeaways today."
