# Installation


The installer targets Linux with systemd user services. Install Node.js matching [`engines.node`](../package.json), Python 3 for the callback helper, Codex CLI, and the Node.js distribution of DSH. Existing working DSH installations can be reused. See the [validation record](validation.md) for tested versions.

Automatic completion delivery requires a running Codex App Server that supports `turn/start.toolOutput`. It was verified with Codex CLI 0.157.1 and App Server 0.157.0. The helper uses the parent's `CODEX_THREAD_ID` and local control socket by default. A remote parent can be selected with `--remote`; see [usage](usage.md). Clients without this capability use one pending `dsh_wait` instead.

```sh
npx -y dsh-subagent-mcp@latest setup --skill
```

DSH needs a configured provider credential. If you already use DSH's credential store, the service can reuse it. If your key exists only in the current shell as `DEEPSEEK_API_KEY`, use:

```sh
npx -y dsh-subagent-mcp@latest setup --skill --capture-key
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


## npm installation and upgrades

The CLI installs its package and dependencies under
`${XDG_DATA_HOME:-~/.local/share}/dsh-subagent-mcp`. Service and skill
paths point to that installation, so clearing the npx cache does not break them.
Finish or interrupt active tasks before rerunning setup to upgrade.

DSH Web discovers the persisted workspace parent and its subagents directly.
Setup removes a Web relay entry left by older releases. The `web` command and
`setup --web` are no longer supported.

For sessions created before workspace grouping, finish active tasks, stop the
service, run `npx -y dsh-subagent-mcp@latest adopt`, and start the service again.
Adoption updates historical session metadata; it skips sessions held by a live
process and reports workspaces that cannot be mounted. New agents are grouped
automatically.

Callback results use a fresh directory under `TMPDIR`, otherwise
`/mnt/cache/data-cache` if it exists, then the system temporary directory.
Use the helper's `--output-dir` to choose an explicit location. Retain the evidence
needed for acceptance and remove temporary results once accepted.

You can also install the CLI globally with `npm install -g dsh-subagent-mcp`
and run `dsh-subagent-mcp setup --skill`. The same persistent runtime is used.

## Development from source

```sh
git clone https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp.git
cd dsh-subagent-mcp
npm ci --ignore-scripts
npm run setup -- --skill
```

Source setup points the service at that checkout. When migrating an existing
source installation to npm, remove its old skill symlink before using `--skill`;
the installer preserves conflicting skill locations instead of replacing them.
