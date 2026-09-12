# DSH Subagent MCP

### Let Codex lead. Put DeepSeek to work.

[中文](README.zh-CN.md) · [Get started](#get-started) · [Codex skill](skills/dsh-subagent/SKILL.md)

Give Codex a DeepSeek coding agent that can read your repo, edit files, and run tests. Ask it another question when it finishes. Check in while it works. Stop it when the plan changes.

**Your Codex conversation becomes the place you direct the work. DSH handles the delegated task in its own session.**

## Keep the big picture. Delegate the legwork.

Tracing a bug through a large repo can mean opening dozens of files before making one decision. A migration can mean repeating an edit across modules, then working through test failures. That work needs doing—and it can have its own agent.

With DSH Subagent MCP, Codex hands a task to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), which brings its own model loop, tools, and workspace access. Codex can work on another part of the problem, inspect the worker's progress, and use its findings to decide what happens next.

The agent stays available after its first answer. Follow the lead it found, ask it to make the change, or give it feedback on the result. **Keep working with the agent that already knows the task.**

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

- **Follow up without briefing a new agent.** The original DSH conversation carries forward.
- **See the work as it happens.** Ask for current output and tool activity, or let Codex handle another task while DSH runs.
- **Stay in control of long tasks.** Interrupt and redirect. Close your client and reconnect later; the local service keeps the task running.

## Get started

You'll need **Linux with systemd**, Node.js satisfying the [package requirement](package.json), Codex CLI, and a working DSH installation with provider credentials.

```sh
git clone https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp.git
cd dsh-subagent-mcp
npm ci --ignore-scripts
npm run setup -- --skill
```

If your DeepSeek key is only in the current shell's `DEEPSEEK_API_KEY`, add `--capture-key` to the setup command. See [installation and credentials](docs/setup.md) for details.

If you also use DSH Web, initialize its Web profile and install the adapter:

```sh
node scripts/install-web.mjs
```

Profiles with `patchReload: live` load it automatically; otherwise restart the Web profile after its work finishes. See [Web integration and upgrades](docs/operations.md#live-progress-in-the-dsh-web-ui).

Open a new Codex session and try:

```text
Use $dsh-subagent to review this repository's error handling in read-only mode.
Keep the agent available for follow-up questions.
```

The skill handles the delegation workflow; the MCP server supplies the execution tools. DSH appears in Codex as MCP activity.

## Minimal by default, visible in DSH Web

New subagents use DSH's **minimal preset** by default. Its complete system prompt is:

> You are a helpful software engineer assistant.

The preset supplies a persistent shell as its only tool. It is mounted before the first task, and follow-ups keep the same preset. Pass `preset` explicitly to choose another installed preset. Older sessions retain their original configuration.

Sessions are registered under their working directory in DSH. With the Web adapter installed, **the DSH Web conversation receives tool activity and streamed replies without a manual refresh**. You can watch a task delegated from Codex in the browser; when following the latest output, long replies scroll into view as they arrive.

## Go further

[Follow-ups, progress and cancellation](docs/usage.md) · [Permissions and architecture](docs/architecture.md) · [Service management](docs/operations.md) · [Validation](docs/validation.md)

## Built on

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk). Thanks to [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) and [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) for exploring DSH delegation, and [DSH-Code](https://github.com/unlinearity/dsh-code) for the terminal UI that sparked this project.

[MIT](LICENSE). Independent community project.
