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

Open a new Codex session and try:

```text
Use $dsh-subagent to review this repository's error handling in read-only mode.
Keep the agent available for follow-up questions.
```

The skill handles the delegation workflow; the MCP server supplies the execution tools. DSH appears in Codex as MCP activity.

## Go further

[Follow-ups, progress and cancellation](docs/usage.md) · [Permissions and architecture](docs/architecture.md) · [Service management](docs/operations.md) · [Validation](docs/validation.md)

## Built on

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk). Thanks to [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) and [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) for exploring DSH delegation, and [DSH-Code](https://github.com/unlinearity/dsh-code) for the terminal UI that sparked this project.

[MIT](LICENSE). Independent community project.

## Workspace and agent preset

`dsh_start` registers the session in the DSH workspace for its absolute `cwd`.
The process directory alone does not establish sidebar membership. Status returns
`workspace_id` once initialization finishes.

New agents default to `preset: "minimal"` (极简模式). This mounts DSH's actual
preset before the first prompt: a fixed system prompt and the persistent shell
as its only tool. Pass `preset` explicitly to choose another installed preset;
this is separate from the launch profile and the permission preset.

Follow-ups retain the original preset. Existing sessions created before preset
support keep their SDK composition and report `preset: null`; they are not
silently converted mid-conversation. A daemon upgrade requires interrupting active
work first, then explicitly continuing the same agent IDs after restart.
