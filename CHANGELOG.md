# Changelog

## 0.4.0

- Apply the requested permission after DSH pins its default preset, and refuse a runtime whose effective permission differs. Earlier `workspace-write` agents ran with the user's DSH default when that default was `danger-full-access`.
- Cap DeepSeek completion at 128k tokens so standard-preset compaction runs before the request limit.
- Report `context_tokens` and `context_limit_tokens`, settle overflowed turns as `context_exhausted` with the last completed answer, and refuse follow-ups that cannot fit.
- Name sessions in DSH Web from `name` or the task's first line, and add `dsh_rename`.
- Keep observing an attached Web session after a DSH session error instead of detaching it, and keep terminal `error` and `closed` states when an attached session is observed again.
- Make the companion skill client-neutral so Claude Code can use it as well as Codex.

## 0.3.2

- Register the Host model-selection settings required to mount the standard preset.
- Add real standard initialization and compaction service coverage alongside minimal preset checks.

## 0.3.1

- New agents default to the standard preset with automatic context compaction and tool-result pruning.
- Explicit presets and existing session configurations remain unchanged on follow-up and restart.

## 0.3.0

- Added compact MCP projections for starts, follow-ups, status, waits, lists, and events.
- Default events contain assistant-visible text only; tool summaries and targeted full tool records are explicit.
- Added bounded event pages with continuation cursors for large assistant messages.
- Added `legacy: true` compatibility projections for status, list, wait, start, and follow-up.
