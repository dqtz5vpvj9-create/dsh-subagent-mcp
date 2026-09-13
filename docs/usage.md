# Working with DSH agents


| Tool | What it does |
|---|---|
| `dsh_start` | Starts asynchronously and returns a stable `id`; requires an absolute `cwd`. |
| `dsh_status` | Returns state, visible partial text, answer, and `finish_reason`. |
| `dsh_events` | Returns chronological progress after a cursor. |
| `dsh_list` | Finds agents from current and previous client sessions. |
| `dsh_wait` | Waits until the root agent settles; optional `seconds` bounds the wait. |
| `dsh_followup` | Continues an idle agent, restoring its persisted DSH conversation if necessary. |
| `dsh_interrupt` | Cancels active and queued input, waits for idle, and flushes history. |
| `dsh_close` | Releases the runtime and closes that bridge agent while retaining history. |

`dsh_wait` subscribes to root state changes and returns immediately on completion,
error, interruption, or closure. Omit `seconds` to wait without a server-side
timeout. Supply `seconds` only for an explicit observation window, not a task
deadline. `wait_outcome: timeout` and `next_action: continue_waiting`
mean the parent must keep supervising the task. Completion between calls remains
available from persisted state, so the next wait returns it immediately.

The parent should do independent work while the child runs, then call
`dsh_wait` without `seconds` to await the child settling. On completion, verify the artifacts and
continue the next authorized step. A child's final answer does not complete the
parent's integration or deployment work.

There is no unsolicited wake-up of an ended parent turn. Completion is delivered
through a pending tool response. The skill therefore requires the parent to keep
its turn active while dependent work remains. Explicit background-only requests
can detach, but require a later parent turn to retrieve and process the result.
Cancelling a wait only removes its observer; use `dsh_interrupt` to stop the child.

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

The MCP client may impose its own request timeout independently of the bridge.
Configure that timeout to cover the expected task duration when using an
unbounded wait. Cancelling a wait detaches the observer without stopping the
agent; use `dsh_interrupt` to stop the work itself.
