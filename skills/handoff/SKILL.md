---
name: handoff
description: Create an explicit Codex handoff block for continuing the current session root in a later session while preserving only token-worthy context. Use when the user asks for a handoff, checkpoint, continuation note, or session resume context.
---

# Handoff

Create a concise handoff for the next Codex session.

Use this only when explicitly requested by the user. Do not add a handoff block to every response.

The goal is token saving: preserve only durable context that would be expensive or annoying to rediscover in a later session. Do not include general conversation history.

Before writing the handoff, inspect the current session state when available:

- Current session root or working directory
- Recent work completed in this session
- Open items, blockers, or verification gaps

Output exactly one fenced block with JSON:

```codex-handoff
{
  "version": 1,
  "root": "<current session root or cwd>",
  "created_at": "<current ISO-8601 timestamp>",
  "ttl_hours": 72,
  "summary": [
    "..."
  ],
  "open_items": [
    "..."
  ],
  "verification": [
    "..."
  ]
}
```

Keep it short and durable. Include only context that should survive into a later session started from this same root directory.
