---
name: dsh-subagent
description: Delegate tasks to persistent DeepSeek Harness agents through the dsh_subagent MCP server. Use when the user asks to use DSH as a subagent, continue its conversation, inspect progress, or interrupt its work.
---

# DSH subagent

Use the installed `dsh_subagent` MCP tools. This runs the DSH harness with its own tools and conversation, not merely a DeepSeek model inside Codex. Tool prefixes depend on the client; identify tools by their `dsh_*` names.

## Delegate and retain context

Call `dsh_start` with an explicit absolute `cwd` and a self-contained task: objective, relevant context, allowed files/actions, constraints and expected evidence. The child does not inherit the Codex transcript. Respect the user's model choice; otherwise the server defaults to DeepSeek V4 Flash with `max` effort.

Set `permission: read-only` for investigation. Use `workspace-write` for authorized changes. DSH permissions are independent of Codex permissions; select no broader access than the parent task permits. `danger-full-access` requires authorization for that access. Missing approval support is not permission to escalate.

Keep the returned `id` and pass it as `agent_id` on later calls. Starting returns immediately and is not proof that the model task succeeded. For parallel agents, divide write ownership so they do not edit the same files concurrently.

## Completion handoff is mandatory

You own the delegated task until its result has been checked and incorporated
into the authorized parent work. Starting a child is not a completed handoff.
Track its agent ID, objective, expected evidence, and the parent action that
will follow completion. Preserve these across context compaction.

The bridge does not wake an ended Codex turn. Do not end your turn with a promise
of a future callback while required children are still running. Keep the parent
turn active: do independent work when available, then call `dsh_wait`. It holds a
pending tool call and returns as soon as the root agent settles. If it times out,
continue waiting; a 25-second observation window is not a task deadline. Give
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

- Use `dsh_status` for lifecycle state, visible partial output, answer and finish reason.
- Use `dsh_events` with the previous `next_cursor` as `after` for incremental tool activity. Large events may be truncated.
- Use `dsh_wait` for completion delivery. `wait_outcome: timeout` with `next_action: continue_waiting` means the child still needs supervision. `wait_outcome: settled` returns its final status and answer. Repeated waits are required when the parent has no independent work left; avoid tight `dsh_status` polling.
- When the agent is idle, call `dsh_followup` on the same ID. Do not create a replacement agent for a follow-up question.
- If it is busy and the user redirects or stops it, call `dsh_interrupt`. Wait for acknowledgement before sending the replacement task. A timeout is not confirmation that work stopped.

Interruption cancels current execution and queued input; it does not roll back completed file changes. After an interruption, preserve the stop instruction and do not resume until the user authorizes continuation.

Use `dsh_list` to recover an earlier agent ID, matching the workspace and task rather than taking the newest entry blindly. Client disconnects leave tasks running. Service restart marks unfinished work interrupted; an explicit follow-up restores the persisted conversation. `dsh_close` releases a runtime and permanently closes that bridge agent while retaining its history. Keep it open while follow-ups are expected.

## Report results

Distinguish `completed` from `error` and `interrupted`, and check `finish_reason`. A final text or successful MCP response alone is not task acceptance. Verify important claims against changed files, command output or test artifacts. Include the agent ID when it helps the user continue the work.

If the MCP tools are unavailable, say so rather than silently substituting a one-shot shell command. Installation is documented in the repository README. This skill does not itself install services, change credentials, or authorize additional tasks. DSH activity appears through MCP rather than Codex's native `/agent` UI.

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

For live progress in DSH's browser, install the companion Web adapter with
`npx -y dsh-subagent-mcp@latest web`. MCP progress and Web
progress are separate transports; verify the Web adapter before promising live
browser updates. See `docs/operations.md` for installation and acceptance tests.
