# Working with DSH agents


| Tool | What it does |
|---|---|
| `dsh_start` | Starts asynchronously and returns a compact receipt; requires an absolute `cwd`. The session belongs to the workspace's DSH Web subagent catalog. |
| `dsh_attach` | Connects to an existing DSH Web session using its exact session ID and authenticated launch URL. |
| `dsh_send` | Queues or steers a message into an attached external session, including while it is busy. |
| `dsh_status` | Returns compact lifecycle state; use `legacy:true` for the complete historical state. |
| `dsh_events` | Returns completed root-turn replies (`assistant/final`) after a cursor; use `include_progress:true` for intermediate text and `include_descendants:true` for child activity; set `include_tool_events:true` before using `event_id` for a targeted full tool event. |
| `dsh_list` | Finds agents from current and previous client sessions; active agents first and then by most recent activity, bounded by `limit` (default 20) and `max_chars` (default 12000). Narrow with `status`, `cwd` or `match` instead of raising the cap; `total` counts the whole store and `matched` the filtered rows. |
| `dsh_wait` | Waits until the root agent settles; omit `seconds` for persistent work. A completed settled response contains the final answer; repeated waits return the same result. |
| `dsh_followup` | Continues an idle agent, restoring its persisted DSH conversation if necessary. |
| `dsh_interrupt` | Cancels active and queued input, waits for idle, and flushes history. |
| `dsh_rename` | Sets the agent name and its DSH session title. |
| `dsh_close` | Releases the runtime and closes that bridge agent while retaining history. |

`dsh_wait` subscribes to root state changes and returns immediately on completion,
error, interruption, or closure. Omit `seconds` to wait without a server-side
timeout. Supply `seconds` only for an explicit observation window, not a task
deadline. `wait_outcome: timeout` and `next_action: continue_waiting`
mean the parent must keep supervising the task. Completion between calls remains
available from persisted state, so the next wait returns it immediately.

In Codex, the bundled skill registers `scripts/codex_notify.mjs` after each start
or follow-up. Its default delivery is App Server `turn/start.toolOutput`: one
host-side wait, then a `dsh_completion` tool result containing the answer and
evidence path. The parent can do independent work or yield until that result
arrives. Accept the artifacts once and continue authorized work. A child's
answer does not complete the parent's integration or deployment work.

`dsh_events` identifies a final reply from the root `turn/end` with reason
`completed`, using that turn's last assistant message. It emits nothing for
running, failed, or interrupted turns. The end event supplies the reply's cursor,
so reading while a reply is still being generated cannot consume its future
final result. Continue with `next_cursor` (including string continuation cursors)
and keep the same options while paging. Previously stored events use the same
turn-boundary rules; no history migration is required. Progress mode includes
intermediate messages and the final boundary, so the last text can appear in
both forms. Child messages are progress only and cannot become root replies.
Use these options for a specific progress or debugging question. A registered
callback delivers the result; use `dsh_wait` when no callback is available.

The native Codex callback can wake an ended parent turn. It requires the parent
App Server to support `turn/start.toolOutput`, Node.js and this
package's dependencies. `--delivery queue` explicitly selects legacy queued
input; a failed native delivery never retries via queue. The callback defaults
to the parent `CODEX_THREAD_ID` and local App Server; use `--remote` for an
existing `unix://PATH`, `ws://` or `wss://` endpoint.

Without a registered callback, keep one `dsh_wait` without `seconds` pending
until completion. Cancel the host-side listener before interrupting its child;
cancelling a wait alone only removes the observer. Delivery receipts and full
results remain in the callback directory for recovery. See the
[skill](../skills/dsh-subagent/SKILL.md) for receipt handling.

Pass the returned `id` as `agent_id` in later calls. A busy agent rejects follow-ups: interrupt it first when changing direction. Keep the agent open while further questions are expected; closing it disables follow-ups through the bridge.

Give each agent a short `name`. It becomes the DSH Web session title, so a
workspace with many delegated sessions stays readable. Without a name the bridge
uses the first line of the task, truncated to 60 characters.

## Context budget

Context accumulates across follow-ups. Reuse an agent for more work on the same
task and start a new one for unrelated work. Status, wait and receipts report
`context_tokens`, the size of the conversation at its last model step, and for
DeepSeek routes `context_limit_tokens`, the largest prompt a request can carry.

DeepSeek rejects a request whose prompt and reserved completion exceed its
1,048,576-token window. DSH reserved 256k completion tokens while compacting at
80% of a nominal 1M window, so prompts near 793k failed before compaction could
run. The bridge caps completion at 128k tokens, which leaves compaction headroom
below the 920,576-token request limit.

A turn that still overflows settles as `context_exhausted` with
`next_action: start_new_agent`. The agent refuses follow-ups, and `dsh_wait`
returns `last_completed_answer` from its previous successful turn for the
handoff. Minimal-preset agents never compact, so they refuse follow-ups once
the conversation reaches 75% of the request limit.

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
