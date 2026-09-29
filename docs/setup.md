# Installation

Install [Node.js 24 or newer](https://nodejs.org/), then run:

```sh
npx -y dsh-subagent-mcp@latest
```

The same command works on Windows, Linux and macOS. It prepares DSH, starts the
background service, registers the MCP tools and installs the Codex skill. When
installation finishes, you return to your terminal.

Existing DSH and Codex installations are reused when compatible. Missing
dependencies are installed for your user account; no administrator access,
Python or global npm installation is required. Repeating the command checks the
installation and applies available updates. If DSH tasks are still running, it
keeps the installed version so they can finish.

## Connect your account

Setup shows account configuration separately from installation status. Existing
Codex sign-in and DSH provider settings are reused. A configured credential does
not prove that an account has remaining quota or that a model request will succeed.

If Codex needs a login:

```sh
npx -y dsh-subagent-mcp@latest login
```

This opens Codex's sign-in flow without starting a coding task.

If DeepSeek needs a key, get one from your provider and run:

```sh
npx -y dsh-subagent-mcp@latest configure
```

Paste the key at the prompt; input is hidden. Press Enter without a key to leave
the existing settings unchanged. Interactive setup can also offer this prompt.

If `DEEPSEEK_API_KEY` is already set in your terminal, save it for background tasks:

```sh
npx -y dsh-subagent-mcp@latest configure --capture-key
```

`DEEPSEEK_BASE_URL` is also captured when present. Values are saved in a private
provider file and never printed or inserted into Codex's MCP configuration.
New DSH agents use the saved settings; running agents keep their existing settings.
Noninteractive installation does not wait for account input.

## Start working

Open your project folder and run Codex normally:

```sh
codex
```

If setup installed a separate compatible Codex because yours was missing or too
old, use its copy explicitly:

```sh
npx -y dsh-subagent-mcp@latest codex
```

Arguments after `codex` are passed to Codex, for example `--cd` or `--model`.
An already-open Codex session needs to reload the newly installed MCP tools and
skill; starting a fresh Codex session is sufficient.

Try a small task:

```text
Ask DSH to inspect this project without changing files.
Find the main entry points and how the tests are run, then summarize what it finds.
```

Codex manages delegation and completion notifications. You can keep working or
leave Codex idle while DSH executes. The [usage guide](usage.md) covers follow-ups,
progress questions and cancellation.

To inspect the execution history in DSH Web:

```sh
npx -y dsh-subagent-mcp@latest dsh web --port 0
```

The system selects a free port. Open the local URL printed by DSH. This uses the same DSH installation, history
and saved provider settings.

## Check the installation

```sh
npx -y dsh-subagent-mcp@latest doctor
npx -y dsh-subagent-mcp@latest status
npx -y dsh-subagent-mcp@latest logs
```

`doctor` checks the runtime, service, MCP connection and account configuration.
Inside Codex it also checks access to the current parent conversation. It does
not submit a model task. `doctor --json` and `status --json` are available for scripts.

| System | Background startup | Installation directory |
| :--- | :--- | :--- |
| Windows | Per-user Scheduled Task | `%LOCALAPPDATA%\dsh-subagent-mcp` |
| macOS | User LaunchAgent | `~/Library/Application Support/dsh-subagent-mcp` |
| Linux | systemd user service when available | `${XDG_DATA_HOME:-~/.local/share}/dsh-subagent-mcp` |

If a login service is unavailable or belongs to another installation, setup uses
a separate background process and preserves the existing service. To choose that
mode explicitly, run `setup --service background`. Codex starts the service when
it connects; closing an MCP connection does not stop DSH tasks.

## Upgrade and uninstall

Run the installation command again to update:

```sh
npx -y dsh-subagent-mcp@latest
```

Installation files live outside the npm cache. Setup stages each version before
switching the service, and restores the previous installation if activation fails.
Updates are deferred while DSH tasks are active. Explicit `setup` and `upgrade`
commands also refuse to interrupt them.

To remove the integration:

```sh
npx -y dsh-subagent-mcp@latest uninstall
```

Uninstall removes the DSH bridge service, owned skill link, MCP registration and
managed packages. It retains bridge history, saved provider settings and DSH
conversations. `uninstall --purge` also removes bridge history and saved settings;
DSH's own conversations remain intact.

## Advanced configuration

- `setup --yes` skips interactive account prompts. `setup --capture-key` remains
  available when installation and credential capture belong in the same script.
- `mcp` runs the MCP stdio transport. Clients must pass this subcommand explicitly;
  the no-argument command installs the integration even when input is piped.
- `setup --no-install-deps` requires preinstalled compatible DSH and Codex.
- `setup --no-skill` preserves a separately managed skill. Conflicting custom
  skill directories are also preserved, with instructions printed by setup.
- `--skill` remains accepted for older installation commands.
- `DSH_CLI` selects DSH's JavaScript entrypoint; `DSH_HOME` selects its home.
- `DSH_SUBAGENT_DATA`, `DSH_SUBAGENT_CONFIG` and `DSH_SUBAGENT_STATE` override
  bridge directories. Linux also follows the corresponding XDG variables.
- `CODEX_HOME` selects the Codex home. `DSH_CODEX_CLI` selects an explicit
  executable or JavaScript CLI entrypoint.

Missing dependencies use the versions validated by this release: DSH
`0.1.5-rc.1` and Codex CLI `0.158.0`. Existing global installations are preserved.

For source development, run `npm ci --ignore-scripts` followed by
`npm run setup -- --service background` to use the checkout. Legacy session
migration with `adopt` requires Linux's `flock`; new DSH agents are grouped by
workspace on all three platforms.

Callback results and receipts are saved under `callbacks` in the bridge state
directory. Keep the evidence needed for review and remove individual callback
directories after acceptance. A manual listener can use `--output-dir` to select
a different empty directory.
