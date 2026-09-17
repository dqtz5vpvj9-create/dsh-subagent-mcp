# Working with DSH agents


| Tool | What it does |
|---|---|
| `dsh_start` | Starts asynchronously and returns a compact receipt; requires an absolute `cwd`. |
| `dsh_attach` | Connects to an existing DSH Web session using its exact session ID and authenticated launch URL. |
| `dsh_send` | Queues or steers a message into an attached external session, including while it is busy. |
| `dsh_status` | Returns compact lifecycle state; use `legacy:true` for the complete historical state. |
| `dsh_events` | Returns assistant-visible text after a cursor; set `include_tool_events:true` before using `event_id` for a targeted full tool event. |
| `dsh_list` | Finds agents from current and previous client sessions. |
| `dsh_wait` | Waits until the root agent settles; omit `seconds` for persistent work. The settled response contains the final answer once. |
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

New agents default to `preset: "standard"`. DSH's standard preset includes
context compaction and tool-result pruning, and mounts before the first prompt.
Pass `preset: "minimal"` explicitly only when a fixed prompt and a single
persistent shell without automatic compaction are intended. The preset is
separate from the launch profile and permission preset.

Follow-ups retain the original preset. Existing sessions created before preset
support keep their SDK composition and report `preset: null`; they are not
silently converted mid-conversation. A daemon upgrade requires interrupting active
work first, then explicitly continuing the same agent IDs after restart.

The MCP client may impose its own request timeout independently of the bridge.
Configure that timeout to cover the expected task duration when using an
unbounded wait. Cancelling a wait detaches the observer without stopping the
agent; use `dsh_interrupt` to stop the work itself.

## Connect to an existing Web session

Call `dsh_attach` with `session_id` and `web_url`. Keep the `session-` prefix if
it is part of the original ID. Supply the authenticated launch URL privately;
the bridge exchanges its token for a cookie stored in a mode-0600 file under
`web-auth` in bridge state. Tool results contain only the clean server origin.
HTTP is supported on loopback; remote servers require HTTPS.

The returned `id` works with the existing observation and lifecycle tools.
The external session keeps its cwd, model, preset and permissions. No second
SDK runtime or replacement conversation is created. Ordinary Web sessions are
supported; Web-owned subagent children retain their parent's delivery routing.

Use `dsh_followup` when idle; it returns a receipt, so use `dsh_wait` for the final
answer. Use `dsh_send` with `mode: "queue"` to deliver
after the current turn, or `mode: "steer"` to deliver at the next step. A send
receipt proves admission, not model completion. Status and events expose the
response; `dsh_wait` waits for the session, which may include ongoing work that
predates the bridge connection. The bridge does not answer Web approvals or
user questions on anyone's behalf.

`dsh_interrupt` removes observed queued input and requests cancellation, then
waits for confirmation. `dsh_close` only detaches the observer and removes its
saved cookie; the external Web session and its history remain intact. A bridge
restart does not interrupt external work. The next observation reconnects,
recovers missed history and never automatically resends a prompt. Reattach with
a fresh launch URL when the cookie expires. Refresh the MCP connection after
upgrading so the client discovers `dsh_attach` and `dsh_send`.
