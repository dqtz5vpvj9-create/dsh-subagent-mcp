# Installation


The installer targets Linux with systemd user services. Install Node.js matching [`engines.node`](../package.json), Codex CLI, and the Node.js distribution of DSH. See the [compatibility test record](validation.md) when choosing a DSH version. Existing working DSH installations can be reused.

```sh
git clone https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp.git
cd dsh-subagent-mcp
npm ci --ignore-scripts
npm run setup -- --skill
```

DSH needs a configured provider credential. If you already use DSH's credential store, the service can reuse it. If your key exists only in the current shell as `DEEPSEEK_API_KEY`, use:

```sh
npm run setup -- --skill --capture-key
```

`--capture-key` saves the current provider environment in a mode-0600 service file without printing it. It preserves an existing file. Keys never belong in task prompts or Codex's MCP configuration.

The installer creates a dedicated `codex-subagent` DSH profile, installs and starts a systemd user service, registers `dsh_subagent` with Codex, and optionally links the bundled skill into `${CODEX_HOME:-~/.codex}/skills`. It does not modify installed DSH source. Re-running setup restarts this service, so finish or interrupt active bridge tasks before upgrading.

Open a new Codex session, check `/mcp`, and ask:

```text
Use $dsh-subagent to investigate this repository in read-only mode.
Find where request cancellation reaches the worker process.
Keep the DSH agent ID so we can ask follow-up questions.
```

Then:

```text
Show that agent's progress and latest tool activity.
```

```text
Interrupt it. Once it has stopped, ask the same agent to inspect timeout handling.
```

