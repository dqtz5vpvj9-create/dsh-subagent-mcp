# Service operations

## Check the integration

```sh
npx -y dsh-subagent-mcp@latest status
npx -y dsh-subagent-mcp@latest doctor
npx -y dsh-subagent-mcp@latest logs
```

`status` reports the DSH background service and active tasks. `doctor` checks the
runtime, MCP connection and account configuration; it does not make a model
request. Run it inside Codex to also check completion delivery to the current
conversation.

Bridge state follows the platform locations in the [installation guide](setup.md).
Full conversation history belongs to DSH's configured home. Saved provider
settings live in `provider.json` under the bridge configuration directory. Use
`configure` to enter a key privately, or `configure --capture-key` to save one
already present in your terminal. New DSH agents use the updated settings.

## Start, stop and remove the service

```sh
npx -y dsh-subagent-mcp@latest start
npx -y dsh-subagent-mcp@latest stop
npx -y dsh-subagent-mcp@latest restart
```

An ordinary stop or restart refuses to interrupt active DSH tasks. Finish them
first, or ask Codex to stop the task. Use `stop --force` only when you intend to
interrupt all active DSH work owned by the bridge.

Closing an MCP connection leaves DSH work running. The service commands manage
DSH; they do not manage your Codex conversations.

To remove the integration:

```sh
npx -y dsh-subagent-mcp@latest uninstall
```

Uninstall removes the bridge service, its owned skill link, MCP registration and
managed packages. History and saved provider settings are retained. See
[upgrade and uninstall](setup.md#upgrade-and-uninstall) for the purge option.

## Inspect DSH work

Manage subagents directly from your terminal:

```sh
npx -y dsh-subagent-mcp@latest agents list
npx -y dsh-subagent-mcp@latest agents ps
npx -y dsh-subagent-mcp@latest agents show AGENT_ID
npx -y dsh-subagent-mcp@latest agents result AGENT_ID
npx -y dsh-subagent-mcp@latest agents events AGENT_ID --progress
npx -y dsh-subagent-mcp@latest agents start --task "Inspect this project and report back" --permission read-only
npx -y dsh-subagent-mcp@latest agents wait AGENT_ID
npx -y dsh-subagent-mcp@latest agents followup AGENT_ID --task "Check the first finding"
npx -y dsh-subagent-mcp@latest agents interrupt AGENT_ID
npx -y dsh-subagent-mcp@latest agents gc
```

`agents --help` lists all commands. IDs accept unique prefixes; `--json` provides
machine-readable output. `wait` holds one connection until the task settles.
Terminal tasks do not automatically notify a Codex parent.

Finished and interrupted bridge tasks save their conversation and automatically
release their runtime. Results remain readable, and `followup` restores the same
DSH session. `agents ps` lists resident runtime PIDs. `agents gc` releases idle
runtimes without stopping active tasks or deleting history. `agents release ID`
does the same for one agent. `agents close ID` permanently closes that bridge
agent; external Web agents are only detached and keep running in their own host.

Open DSH Web with:

```sh
npx -y dsh-subagent-mcp@latest dsh web --port 0
```

In the workspace's **Claude Code / Codex 子代理** entry, open the subagent catalog
to inspect conversations and traces. The browser reads saved history, while the
bridge owns the running process. Browser activity indicators can therefore lag.

Ask Codex for current progress when needed. For targeted diagnostics, `dsh_status`
reports live lifecycle state and `dsh_events` can include progress and tool events.
A browser `TOOL_OUTCOME_UNKNOWN` marker means a recorded tool call has no result in
the loaded history. Check the live state before treating it as a crashed agent.

## If a completion result does not arrive

Ask Codex to check the DSH task. Results and delivery receipts are saved under
`callbacks` in the bridge state directory, so delivery failure does not discard
the answer. A receipt distinguishes `delivered`, `delivery_failed`, `cancelled`
and `stopped`. The complete result is in the same callback directory.

The callback requires Codex's App Server to remain reachable. A failed
acknowledgement may follow successful delivery; inspect the parent history before
resending so the result is not delivered twice. No alternate delivery route is
tried automatically.

Tasks that finish with `error` or `context_exhausted` notify the parent. An
observer connection failure produces `watch_error`, which is separate from a
failed DSH task. Explicitly interrupted or closed agents do not trigger continued
work. A process that remains live without finishing can keep its listener waiting;
ask Codex to inspect or interrupt that task when necessary.

## Validation for maintainers

Release acceptance is documented in [release end-to-end tests](release-acceptance.md).
Installation checks and real-model tests have separate roles: a successful
installation proves that the service and MCP tools are available; a real-model
run must also check delegation, the saved artifact, completion delivery and
Codex's review.

For local development:

```sh
npm test
DSH_RUNTIME_TEST=1 DSH_PACKAGE_TEST=1 npm test
```

The runtime checks exercise actual DSH initialization, presets, permissions and
persistence without making model calls. The following tests make real model
requests in temporary workspaces:

```sh
node test/live.mjs
node test/mcp-live.mjs
node test/completion-live.mjs
```

Set `TMPDIR` for test workspaces. Reports are generated locally and excluded from
Git. These tests do not replace observing a real Codex parent receive and review
a result. See [callback validation](codex-callback-validation.md) for the
method, including checking an idle parent without model-driven progress polling.
