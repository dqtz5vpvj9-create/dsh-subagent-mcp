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


## Live progress in the DSH Web UI

Install the read-only Web adapter into an existing Web profile:

```sh
node scripts/install-web.mjs
```

A Web profile with `patchReload: live` loads it without restarting its agents.
Otherwise restart that Web profile after its work has finished. The MCP daemon
must also run the matching bridge version; finish or interrupt its work before
restarting it.

Each SDK runtime exposes its native DSH history and control streams through a
mode-0600 Unix socket under the bridge state's `web` directory. The Web adapter
uses that owner for live history, assistant deltas, projections, and pagination.
Ordinary Web sessions keep their original path. It does not forward execution,
prompt, or cancellation commands to the SDK, and does not write a second copy of
its session log. Once the owner exits, reopening the conversation reads the
persisted history normally.

`DSH_RUNTIME_TEST=1 npm test` checks the actual minimal prompt and tool catalog,
resume, and live event replay with an installed DSH. `node test/web-live.mjs`
additionally runs a real-model, isolated Web/SDK/browser acceptance test. Set
`PLAYWRIGHT_MODULE` to an installed Playwright module if it is outside this
package, and optionally `CHROMIUM_EXECUTABLE` to the browser executable.

## Completion handoff acceptance

```sh
DSH_RUNTIME_TEST=1 DSH_PACKAGE_TEST=1 npm test
node test/completion-live.mjs
```

The real-model test sends a task through MCP, waits for its completion, checks
its file, produces a dependent parent artifact, and asks the same child to verify
it. This tests delivery and programmatic continuation. It does not prove that
an arbitrary host model will follow the skill or that a finished Codex turn can
be awakened. The CLI test separately exercises daemon startup and the stdio MCP
handshake, rather than accepting `--help` as server validation.
