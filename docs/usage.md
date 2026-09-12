# Working with DSH agents


| Tool | What it does |
|---|---|
| `dsh_start` | Starts asynchronously and returns a stable `id`; requires an absolute `cwd`. |
| `dsh_status` | Returns state, visible partial text, answer, and `finish_reason`. |
| `dsh_events` | Returns chronological progress after a cursor. |
| `dsh_list` | Finds agents from current and previous client sessions. |
| `dsh_wait` | Waits for up to 25 seconds and returns current state. |
| `dsh_followup` | Continues an idle agent, restoring its persisted DSH conversation if necessary. |
| `dsh_interrupt` | Cancels active and queued input, waits for idle, and flushes history. |
| `dsh_close` | Releases the runtime and closes that bridge agent while retaining history. |

The 25-second wait limit applies only to one observation call, not to the DSH task. When it expires, work keeps running. There is no task deadline implied by this window; the parent can do other work and check progress when needed.

Pass the returned `id` as `agent_id` in later calls. A busy agent rejects follow-ups: interrupt it first when changing direction. Keep the agent open while further questions are expected; closing it disables follow-ups through the bridge.

Model, provider, effort and permission are selected at creation. Defaults are defined by `Manager.start` in [manager.mjs](../src/manager.mjs); provider routes must be available in the DSH composition.


## Workspace and agent preset

`dsh_start` registers the session in the DSH workspace for its absolute `cwd`.
The process directory alone does not establish sidebar membership. Status returns
`workspace_id` once initialization finishes.

New agents default to `preset: "minimal"` (极简模式). This mounts DSH's actual
preset before the first prompt: a fixed system prompt and the persistent shell
as its only tool. Pass `preset` explicitly to choose another installed preset;
this is separate from the launch profile and the permission preset.

Follow-ups retain the original preset. Existing sessions created before preset
support keep their SDK composition and report `preset: null`; they are not
silently converted mid-conversation. A daemon upgrade requires interrupting active
work first, then explicitly continuing the same agent IDs after restart.
