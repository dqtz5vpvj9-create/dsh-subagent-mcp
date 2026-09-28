# Installation

Windows, Linux and macOS use the same command:

```sh
npx -y dsh-subagent-mcp@latest
```

Run it in a normal terminal with Node.js 24 or newer. On first use, it reuses an existing
Node.js DSH installation and Codex CLI, or installs missing dependencies in a
private user directory. It prepares the DSH profile, starts the background
service, connects Codex's MCP tools, installs the companion skill, and opens
Codex. Later runs open Codex directly without reinstalling. Python,
root access and a global npm installation are not required.

Missing dependencies are installed at the versions validated by this release:
DSH `0.1.5-rc.1` and Codex CLI `0.158.0`. Setup preserves existing installations
and their provider configuration.

## Connect your account

If DSH already has working provider credentials, keep using them. To save a key
from the current terminal for the background service:

```sh
npx -y dsh-subagent-mcp@latest setup --capture-key
```

Set `DEEPSEEK_API_KEY` before running that command. `DEEPSEEK_BASE_URL` is also
supported. The values go into a private provider file, never into Codex's MCP
configuration or command output. Repeating `--capture-key` updates the supplied
values while preserving other provider settings. Existing Linux `environment`
files remain readable during migration.

For a new DSH account, use the API key from your DeepSeek provider. On Windows
(PowerShell):

```powershell
$env:DEEPSEEK_API_KEY = 'your-api-key'
npx -y dsh-subagent-mcp@latest setup --capture-key
Remove-Item Env:DEEPSEEK_API_KEY
```

On Linux or macOS:

```sh
read -r -s DEEPSEEK_API_KEY
export DEEPSEEK_API_KEY
npx -y dsh-subagent-mcp@latest setup --capture-key
unset DEEPSEEK_API_KEY
```

Paste the key when `read` waits for input and press Enter. The input is hidden.

If Codex is newly installed, sign in with:

```sh
npx -y dsh-subagent-mcp codex login
```

## Start working

Use the same command whenever you want to work:

```sh
npx -y dsh-subagent-mcp@latest
```

Then ask:

```text
Use $dsh-subagent to investigate this repository in read-only mode.
Find where request cancellation reaches the worker process.
```

The launcher connects Codex to its own local App Server with authentication and
passes the callback connection to the parent session. It uses your existing Codex
configuration and login. Use the explicit `codex` subcommand to forward arguments
such as `--cd` and `--model`; it also installs automatically on first use.
Linux and macOS can use ordinary Codex sessions with their local control socket,
or use the same launcher. Windows uses the launcher for automatic callbacks.

Automatic callbacks require a Codex App Server with `turn/start.toolOutput`.
The listener checks the exact parent before registering. If the client lacks
that capability, use a single pending `dsh_wait`; it is not an automatic wakeup.
See [completion delivery](usage.md) for the protocol and remote-parent options.

To open DSH's Web interface with the same runtime, sessions and captured provider
settings:

```sh
npx -y dsh-subagent-mcp dsh web
```

Open the local URL printed by DSH. Other DSH arguments can be passed after `dsh`;
you do not need a separate global installation.

## Check and manage the installation

```sh
npx -y dsh-subagent-mcp doctor
npx -y dsh-subagent-mcp status
npx -y dsh-subagent-mcp logs
npx -y dsh-subagent-mcp restart
```

`doctor` checks the runtime, service and MCP connection separately. Run it inside
Codex to also check access to the parent thread. `--json` is available for scripts.
The checks do not submit a model task or verify provider billing/account access.

| System | Background startup | Installation directory |
| :--- | :--- | :--- |
| Windows | Per-user Scheduled Task | `%LOCALAPPDATA%\dsh-subagent-mcp` |
| macOS | User LaunchAgent | `~/Library/Application Support/dsh-subagent-mcp` |
| Linux | systemd user service when available | `${XDG_DATA_HOME:-~/.local/share}/dsh-subagent-mcp` |

On systems without a usable login service, setup uses a detached background
process. Codex starts it on connection; closing an MCP connection leaves tasks
running. You can choose this mode explicitly with `setup --service background`.
Setup reports the selected backend. It does not ask for elevated privileges to
register a login service.

If another installation owns the per-user login service, automatic setup uses a
separate background process. It preserves the existing service and tasks.

On Windows, local IPC uses an authenticated loopback connection and private
Windows ACLs. Linux and macOS use a mode-0600 Unix socket in a private directory.
No bridge port is exposed to the network.

## Upgrade and uninstall

```sh
npx -y dsh-subagent-mcp@latest setup
npx -y dsh-subagent-mcp uninstall
```

Setup stages a versioned installation outside the npx cache before switching the
service. A failed activation restores the previous managed installation.
Upgrades and ordinary stops refuse to interrupt active tasks. Finish those tasks
first; use `stop --force` only when you intend to interrupt them.

Uninstall removes the service, owned skill link, MCP registration and managed
packages. It retains bridge history, captured provider settings and DSH sessions.
`uninstall --purge` also removes bridge history and captured settings; DSH's own
sessions remain intact. A globally installed CLI can then be removed with
`npm uninstall -g dsh-subagent-mcp`.

## Advanced configuration

- `setup` installs or updates the bridge without opening Codex.
- `mcp` runs the MCP stdio transport. Existing clients that invoke the CLI with
  no arguments over a pipe remain compatible; interactive terminals open Codex.
- `--no-install-deps` requires preinstalled DSH and Codex.
- `--no-skill` preserves a separately managed skill. Setup also preserves
  conflicting custom skill directories and tells you how to continue.
- `--skill` remains accepted for commands written for earlier versions.
- `DSH_CLI` selects DSH's JavaScript entrypoint; `DSH_HOME` selects its home.
- `DSH_SUBAGENT_DATA`, `DSH_SUBAGENT_CONFIG` and `DSH_SUBAGENT_STATE` override
  bridge directories. Linux also follows the corresponding XDG variables.
- `CODEX_HOME` selects the Codex home. `DSH_CODEX_CLI` can select an explicit
  executable or JavaScript CLI entrypoint.

For source development, `npm ci --ignore-scripts` followed by
`npm run setup -- --service background` points the service at that checkout.
For legacy session migration, `adopt` still requires Linux's `flock`; new sessions
are grouped by workspace on all three platforms.

Callback artifacts use `TMPDIR`, otherwise `/mnt/cache/data-cache` if present,
then the system temporary directory. Keep evidence needed for review and remove
callback directories after acceptance. Use `--output-dir` to choose a fresh path.
