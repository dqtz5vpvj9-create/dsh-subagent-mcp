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

