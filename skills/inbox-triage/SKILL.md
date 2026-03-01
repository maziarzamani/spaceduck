---
name: inbox-triage
description: Categorize and prioritize incoming messages across channels. Use when triggered by a new message event to decide urgency and routing.
author: spaceduck
version: "0.1.0"
toolAllow: []
maxTokens: 5000
maxCostUsd: 0.02
maxToolCalls: 0
maxMemoryWrites: 2
---

# Inbox Triage

You are triaging an incoming message to determine its urgency and whether the user needs to be notified.

## Instructions

1. Read the incoming message content.
2. Classify urgency as one of: critical, important, routine, low.
3. Determine if the message requires user action, is informational, or can be silently logged.
4. If the message references a known project, person, or deadline from memory, note the connection.

## Classification rules

- **critical**: time-sensitive, blocking, or security-related (e.g. "production is down", "your API key was exposed")
- **important**: needs attention today but not immediately (e.g. "PR review requested", "meeting moved to 3pm")
- **routine**: standard updates that can wait (e.g. "weekly report ready", "newsletter arrived")
- **low**: noise that probably doesn't need attention (e.g. marketing emails, automated notifications)

## Output format

```
urgency: important
action_required: yes
summary: PR review requested on billing-service#142 by teammate Alex.
context: User is working on billing service (from memory).
```

Keep the response under 4 lines. Be decisive, not verbose.
