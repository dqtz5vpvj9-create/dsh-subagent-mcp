# Service operations


```sh
systemctl --user status dsh-subagent-mcp.service
codex mcp get dsh_subagent
npm test
```

Live tests make real model calls and use temporary workspaces:

```sh
node test/live.mjs
node test/mcp-live.mjs
```

Set `TMPDIR` to choose the temporary-file location. Raw validation reports are generated locally and excluded from Git. See [validation coverage and limits](validation.md).

State lives under `~/.local/state/dsh-subagent-mcp`; full conversation history belongs to DSH's configured home. The socket is mode 0600 inside a mode-0700 directory. Provider environment, when captured, lives at `~/.config/dsh-subagent-mcp/environment`. Refresh that private file when rotating credentials, then restart the service.

Advanced installation overrides: `DSH_CLI` (the JavaScript CLI entrypoint), `DSH_HOME`, and `DSH_SUBAGENT_STATE`.

To disconnect without deleting source or history:

```sh
codex mcp remove dsh_subagent
systemctl --user disable --now dsh-subagent-mcp.service
```

The optional skill remains a link to [`skills/dsh-subagent`](../skills/dsh-subagent); remove that link separately if you no longer need it.


## DSH Web history and live status

Open the workspace's **Claude Code / Codex 子代理** entry and its subagent catalog
to inspect delegated conversations and traces. The old Web relay is removed;
setup cleans its profile entry. The browser reads persisted history, while the
bridge owns the running process. Browser activity indicators may therefore show
an active bridge agent as idle.

Use `dsh_status` for live lifecycle state and `dsh_events` with
`include_progress:true, include_tool_events:true` for requested diagnostics.
A browser `TOOL_OUTCOME_UNKNOWN` marker means the loaded history contains a
tool call without a recorded result. Check the matching live tool result before
concluding that the agent crashed; the persisted view can lag behind execution.

`DSH_RUNTIME_TEST=1 npm test` checks actual DSH initialization, presets,
permissions, persistence, and event behavior without making model calls.

## Completion handoff acceptance

```sh
DSH_RUNTIME_TEST=1 DSH_PACKAGE_TEST=1 npm test
node test/completion-live.mjs
```

The real-model test sends a task through MCP, waits for its completion, checks
its file, produces a dependent parent artifact, and asks the same child to verify
it. This tests delivery and programmatic continuation. Native Codex wakeup was
verified separately in the [callback validation](codex-callback-validation.md).
The CLI test exercises daemon startup and the stdio MCP
handshake, rather than accepting `--help` as server validation.

The Codex callback has separate coverage: `npm test` runs both its WebSocket
protocol tests and the detached-listener tests. The default helper uses
`turn/start.toolOutput`; `--delivery queue` selects the compatibility path.
Receipts distinguish `delivered`, `delivery_failed`, `cancelled` and `stopped`.
After an acknowledgement failure, inspect the result and parent history before
resending: the first delivery may have succeeded.

`error` and `context_exhausted` results notify the parent. A broken DSH observer
connection produces `watch_error`, which is distinct from a failed task.
Explicitly interrupted or closed children do not notify, preserving the stop.
There is no inactivity watchdog: a live process that never settles or closes its
connection can keep a listener waiting. Callback delivery also requires the
parent App Server to remain reachable; `delivery_failed` retains the result for
manual recovery.

Live acceptance must check both an active parent and an idle parent. Verify
`function_call_output` in the parent rollout and compare `token_usage_record`
entries over the idle interval. Protocol tests alone do not establish idle
wakeup or token savings; see [native callback validation](codex-callback-validation.md).
