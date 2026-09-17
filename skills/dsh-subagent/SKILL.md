---
name: dsh-subagent
description: Delegate tasks to persistent DeepSeek Harness agents through the dsh_subagent MCP server. Use when the user asks to use DSH as a subagent, continue its conversation, inspect progress, or interrupt its work.
---

# DSH subagent

Use the installed `dsh_subagent` MCP tools. This runs the DSH harness with its own tools and conversation, not merely a DeepSeek model inside the parent agent. It works from Codex, Claude Code, or any other MCP client. Tool prefixes depend on the client; identify tools by their `dsh_*` names.

## Delegate and retain context

Call `dsh_start` with an explicit absolute `cwd`, a short descriptive `name`, and a self-contained task: objective, relevant context, allowed files/actions, constraints and expected evidence. The child does not inherit the parent transcript. The name becomes the session title in DSH Web, where many agents share one workspace; without it the bridge uses the task's first line. Use `dsh_rename` to correct a name later. Respect the user's model choice; otherwise the server defaults to DeepSeek V4 Flash with `max` effort.

Set `permission: read-only` for investigation. Use `workspace-write` for authorized changes inside `cwd`: its sandbox denies writes elsewhere, gives the shell a private `/tmp`, and cannot ask for escalation. Network access, such as adb over TCP, still works. DSH permissions are independent of the parent client's permissions; select no broader access than the parent task permits. `danger-full-access` requires authorization for that access. Missing approval support is not permission to escalate.

Keep the returned `id` and pass it as `agent_id` on later calls. Starting returns immediately and is not proof that the model task succeeded. For parallel agents, divide write ownership so they do not edit the same files concurrently.

## Completion handoff is mandatory

You own the delegated task until its result has been checked and incorporated
into the authorized parent work. Starting a child is not a completed handoff.
Track its agent ID, objective, expected evidence, and the parent action that
will follow completion. Preserve these across context compaction.

The bridge does not wake an ended parent turn. Do not end your turn with a promise
of a future callback while required children are still running. Keep the parent
turn active: do independent work when available, then call `dsh_wait` without `seconds`. It holds a
pending tool call and returns as soon as the root agent settles. It has no
server-side timeout by default. Set `seconds` only when an explicit
bounded wait is useful. If that wait times out, continue waiting; it is not a
task deadline. Give
concise progress updates between waits, without asking the user to remind you.

On `completed`, check the finish reason and actual artifacts, then immediately
perform the next already authorized parent step, such as review, integration,
validation, or deployment. Do not stop at forwarding the child's final answer.
On `error`, diagnose and resolve within scope. On `interrupted` or `closed`,
respect the user's stop instruction; do not automatically resume.

If the user explicitly requests detached background work or stops the parent,
state that later retrieval requires a resumed parent turn. Web live updates and
child process persistence do not provide parent wake-up. After reconnecting,
recover the exact agent ID and inspect its state before continuing.

## Observe and continue

### Existing external DSH Web sessions

Use `dsh_attach` with the exact `session_id` (including `session-` when present)
and the user's authenticated `web_url` to connect to an existing ordinary Web
session. This creates a bridge registration, not a new DSH conversation. It
retains the session's original cwd, preset, model and permissions. Attaching does
not grant permission to expand its task or interrupt unrelated work. Web-owned
subagent children must be contacted through their parent.

Keep the returned `id` for the usual status, events, wait, followup and interrupt
tools. `dsh_followup` requires idle. For communication while the session is busy,
use `dsh_send`: `mode: queue` delivers at the next turn; `mode: steer` delivers
at the next step without cancelling the current turn. Choose steer only when
the user wants input delivered during the active work. An accepted receipt is
not a reply; inspect events or status for the actual response. Waiting for the
session to settle may also wait for its original task. Observing an existing
session does not make all of that task part of the parent's assignment.

`dsh_close` only detaches an external session; it does not stop the Web agent.
Bridge restarts reconnect on observation without replaying prompts. Web must
remain available. Credentials are exchanged for a private cookie in bridge state
and omitted from tool results. Do not put launch tokens in source, test fixtures,
reports or chat replies. Reattach with a fresh launch URL if authentication expires.
External servers require HTTPS; loopback HTTP is supported.

If these new tools are absent from the client's cached tool list after upgrading,
refresh its MCP connection or reconnect the client.

### Bridge agent lifecycle

- Use `dsh_status` sparingly for compact lifecycle state; it does not include answer or partial text by default.
- Use `dsh_events` with the previous `next_cursor` as `after`. Default events contain only new assistant-visible text. Set `include_tool_events:true` for tool summaries; use a specific `event_id` together with that flag for one full tool record. Pass continuation cursors unchanged so large events resume without loss or duplication.
- Use `dsh_wait` for completion delivery. Omit `seconds` for persistent work. `wait_outcome: timeout` with `next_action: continue_waiting` means the child still needs supervision. `wait_outcome: settled` returns the final answer once and never promotes partial progress to an answer. Use `legacy:true` only for compatibility with old full state payloads.
- When the agent is idle, call `dsh_followup` on the same ID for a question or next step about the same work. Do not create a replacement agent for that.
- Start a new agent for an unrelated task. Context accumulates across follow-ups; an agent that serves a long series of separate tasks eventually exceeds the model window. Status and receipts report `context_tokens` against `context_limit_tokens`. A minimal-preset agent refuses follow-ups past 75% of the limit.
- `context_exhausted` means the last turn overflowed the model window and produced nothing. The agent cannot continue. `dsh_wait` returns `last_completed_answer` from its previous successful turn; start a new agent with a self-contained handoff, including what the failed request asked for.
- If it is busy and the user redirects or stops it, call `dsh_interrupt`. Wait for acknowledgement before sending the replacement task. A timeout is not confirmation that work stopped.

Interruption cancels current execution and queued input; it does not roll back completed file changes. After an interruption, preserve the stop instruction and do not resume until the user authorizes continuation.

Use `dsh_list` to recover an earlier agent ID, matching the workspace and task rather than taking the newest entry blindly. Client disconnects leave tasks running. Service restart marks unfinished work interrupted; an explicit follow-up restores the persisted conversation. `dsh_close` releases a runtime and permanently closes that bridge agent while retaining its history. Keep it open while follow-ups are expected.

## Report results

Distinguish `completed` from `error`, `context_exhausted` and `interrupted`, and check `finish_reason`. A final text or successful MCP response alone is not task acceptance. Verify important claims against changed files, command output or test artifacts. Include the agent ID when it helps the user continue the work.

If the MCP tools are unavailable, say so rather than silently substituting a one-shot shell command. Installation is documented in the repository README. This skill does not itself install services, change credentials, or authorize additional tasks. DSH activity appears through MCP rather than the client's native subagent UI.

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

For live progress in DSH's browser, install the companion Web adapter with
`npx -y dsh-subagent-mcp@latest web`. MCP progress and Web
progress are separate transports; verify the Web adapter before promising live
browser updates. See `docs/operations.md` for installation and acceptance tests.
