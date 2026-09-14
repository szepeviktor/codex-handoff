# codex-handoff

Token-saving, session-root-aware handoff for Codex sessions.

`codex-handoff` is for people who want continuity without paying to reload or
re-summarize a long conversation. It only carries forward a small, explicit
handoff block from the latest previous Codex session started in the same root
directory.

## What It Does

- Adds a `handoff` skill for writing a compact continuation note.
- Adds a cheap `SessionStart` hook that scans local Codex session logs.
- Loads handoff context only when a previous final answer contains a
  `codex-handoff` fenced block.
- Matches by the session root directory.
- Shows a hook status message after the first prompt when handoff context was loaded.

## Why Not Compact?

Compaction is useful when you want to keep working in the same conversation, but
it still starts from the conversation you already filled. A handoff is better
when you want a fresh session that carries only the durable facts you chose to
preserve.

Compared with compaction, `codex-handoff`:

- Starts the next session with less inherited noise.
- Carries only an explicit, reviewable handoff block.
- Avoids spending another model call to summarize old context at startup.
- Lets you skip the handoff for one session with `CODEX_HANDOFF=0`.

## Usage

At the end of a useful session, ask Codex:

```text
Use the handoff skill.
```

Codex will write a block like:

````text
```codex-handoff
{
  "version": 1,
  "root": "/path/to/project",
  "created_at": "2026-09-14T00:00:00Z",
  "ttl_hours": 72,
  "summary": [
    "Implemented the first version."
  ],
  "open_items": [
    "Add tests."
  ],
  "verification": [
    "Ran node --check."
  ]
}
```
````

When a later Codex session starts in the same root directory, the hook injects
that block as optional background context.

To start a session without loading handoff context:

```bash
CODEX_HANDOFF=0 codex
```

## Install

Install it from GitHub:

```bash
npx codex plugin marketplace add szepeviktor/codex-handoff
npx codex plugin add codex-handoff@codex-handoff
```

This installs both the `SessionStart` hook and the bundled `handoff` skill.

To check that Codex sees it:

```bash
npx codex plugin list --marketplace codex-handoff
```

## Notes

No model call runs in the hook. It only reads local session JSONL files and
parses explicit handoff blocks.

Environment knobs:

- `CODEX_HANDOFF=0`: disable handoff loading for the current Codex process
- `CODEX_HANDOFF_MAX_FILES`: maximum session files to inspect, default `200`
- `CODEX_HANDOFF_MAX_BYTES`: skip session files larger than this, default `50MB`
- `CODEX_HANDOFF_MAX_CONTEXT_CHARS`: maximum injected handoff size, default `12000`
