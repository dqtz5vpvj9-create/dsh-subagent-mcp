<p align="center">
  <img src="https://raw.githubusercontent.com/dqtz5vpvj9-create/dsh-subagent-mcp/main/docs/assets/hero.svg" alt="DSH Subagent MCP — Codex delegates to DeepSeek Harness, with live progress in DSH Web" width="1200">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-subagent-mcp"><img src="https://img.shields.io/npm/v/dsh-subagent-mcp?style=flat-square&amp;color=CB3837" alt="npm version"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek-Harness-4D6BFE?style=flat-square" alt="Built on DeepSeek Harness"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-server-222222?style=flat-square" alt="MCP server"></a>
  <a href="skills/dsh-subagent/SKILL.md"><img src="https://img.shields.io/badge/Codex-skill-167D72?style=flat-square" alt="Codex skill included"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%E2%89%A524-417E38?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-A6ADBB?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/stargazers"><img src="https://img.shields.io/github/stars/dqtz5vpvj9-create/dsh-subagent-mcp?style=flat-square&amp;label=Stars&amp;color=E9B44C" alt="GitHub stars"></a>
</p>

<p align="center">English · <a href="README.zh-CN.md">中文</a> · <a href="#get-started">Quick start</a> · <a href="docs/usage.md">Usage guide</a></p>

Give Codex a DeepSeek coding agent that can read your repo, edit files, and run tests. Ask it another question when it finishes. Check in while it works. Stop it when the plan changes.

**Your Codex conversation becomes the place you direct the work. DSH handles the delegated task in its own session.**

## Built for ongoing collaboration

| | What you get |
| :--- | :--- |
| **Minimal by default** | DSH's native minimal preset, mounted before the first task: a fixed system prompt and persistent shell. |
| **Live in your browser** | With the Web adapter installed, tool activity and streamed replies arrive in DSH Web without refreshing. |
| **A conversation that continues** | Ask the same agent to investigate, implement, or verify. Its earlier context stays with it. |
| **Interrupt and redirect** | Stop the current task, then give the agent a new direction. |
| **Workspaces that make sense** | Sessions are registered under their working directory in DSH. |
| **Work survives a disconnect** | The local service keeps running when the Codex client closes. Reconnect to check progress. |

## Get started

You'll need **Linux with systemd**, Node.js satisfying the [package requirement](package.json), Codex CLI, and a working DSH installation with provider credentials.

```sh
npx -y dsh-subagent-mcp@latest setup --skill
```

No clone needed. Setup installs the runtime in a persistent user directory, so the service and skill do not depend on the npx cache. Add `--web` during setup to connect an already initialized DSH Web profile in the same command.

If your DeepSeek key is only in the current shell's `DEEPSEEK_API_KEY`, add `--capture-key` to the setup command. See [installation and credentials](docs/setup.md) for details.

If you also use DSH Web, initialize its Web profile and install the adapter:

```sh
npx -y dsh-subagent-mcp@latest web
```

Profiles with `patchReload: live` load it automatically; otherwise restart the Web profile after its work finishes. See [Web integration and upgrades](docs/operations.md#live-progress-in-the-dsh-web-ui).

Open a new Codex session and try:

```text
Use $dsh-subagent to review this repository's error handling in read-only mode.
Keep the agent available for follow-up questions.
```

The skill handles the delegation workflow; the MCP server supplies the execution tools. DSH appears in Codex as MCP activity.

## From “look into this” to “make the change”

An example workflow with the bundled skill:

```text
You → Codex
Use $dsh-subagent to investigate why cancelled requests leave workers running.
Have it trace the code and report what it finds. Don't change files yet.

You → Codex
What has DSH found so far?

You → Codex
Ask that same agent whether the timeout path has the same problem.
```

For an agent given permission to edit:

```text
You → Codex
Have DSH implement the agreed fix and run the relevant tests.

You → Codex
Stop it. We've changed the approach. Wait until it stops, then give it this plan: …
```

## Minimal by default, visible in DSH Web

New subagents use DSH's **minimal preset** by default. Its complete system prompt is:

> You are a helpful software engineer assistant.

The preset supplies a persistent shell as its only tool. It is mounted before the first task, and follow-ups keep the same preset. Pass `preset` explicitly to choose another installed preset. Older sessions retain their original configuration.

Sessions are registered under their working directory in DSH. With the Web adapter installed, **the DSH Web conversation receives tool activity and streamed replies without a manual refresh**. You can watch a task delegated from Codex in the browser; when following the latest output, long replies scroll into view as they arrive.

## Go further

[Follow-ups, progress and cancellation](docs/usage.md) · [Permissions and architecture](docs/architecture.md) · [Service management](docs/operations.md) · [Validation](docs/validation.md)

If this makes DSH useful in your workflow, a star helps others find it. Share what you build—or what gets in the way—in [Issues](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/issues).

## Built on

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk). Thanks to [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) and [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) for exploring DSH delegation, and [DSH-Code](https://github.com/unlinearity/dsh-code) for the terminal UI that sparked this project.

[MIT](LICENSE). Independent community project.
