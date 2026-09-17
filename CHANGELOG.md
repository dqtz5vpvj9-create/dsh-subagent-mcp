# Changelog

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
