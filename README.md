<p align="center">
  <img src="https://raw.githubusercontent.com/dqtz5vpvj9-create/dsh-subagent-mcp/main/docs/assets/readme-hero.png?v=0.5.3" alt="DSH Subagent MCP — Give Codex a DeepSeek crew. Blue-haired whale-girl agents write code, investigate, and test beside the Codex terminal emblem." width="1200">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-subagent-mcp"><img src="https://img.shields.io/npm/v/dsh-subagent-mcp?style=flat-square&amp;color=CB3837" alt="npm version"></a>
  <a href="skills/dsh-subagent/SKILL.md"><img src="https://img.shields.io/badge/Codex-skill-4D6BFE?style=flat-square" alt="Codex skill included"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-A6ADBB?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">English · <a href="README.zh-CN.md">中文</a> · <a href="#get-started">Quick start</a> · <a href="docs/usage.md">Usage guide</a></p>

Give Codex a team of DeepSeek agents. Let them implement, investigate, and test in parallel while Codex plans and reviews. Results return automatically, and each agent keeps its context for the next task.

<table>
<tr>
<td width="33%"><strong>Work in parallel</strong><br>Move independent tasks forward at the same time.</td>
<td width="33%"><strong>Return automatically</strong><br>Finished work wakes Codex with the answer and evidence.</td>
<td width="33%"><strong>Keep the context</strong><br>Continue the same agent for fixes, questions, and verification.</td>
</tr>
</table>

## Get started

With [Node.js 24+](https://nodejs.org/) installed:

```sh
npx -y dsh-subagent-mcp@latest
```

This installs the integration on Windows, Linux or macOS, then returns to your terminal. It reuses your existing DSH and Codex configuration and installs missing dependencies for your user account. Setup reports any [account configuration](docs/setup.md#connect-your-account) still needed.

Open your project folder and start Codex as usual:

```sh
codex
```

If setup installed a separate compatible copy of Codex, use `npx -y dsh-subagent-mcp@latest codex` instead. If Codex was already open during installation, start a fresh Codex session to load the MCP tools and skill.

Try a small task in Codex:

```text
Ask DSH to inspect this project without changing files.
Find the main entry points and how the tests are run, then summarize what it finds.
```

Codex delegates the task and receives the result when DSH finishes. You can ask “What has it found?”, have the same agent investigate further, or stop it when the plan changes. For implementation work, ask Codex to split the agreed plan into independent DSH tasks, run the relevant tests, and review the results.

## Why combine Codex and DSH?

Software work combines decisions that need broad project context with execution that can be assigned a clear scope: implementing a module, tracing a defect, or running and repairing tests. DSH Subagent MCP separates these responsibilities. GPT-6 in Codex handles task decomposition, cross-task decisions, and acceptance; DeepSeek handles bounded deliverables through its own runtime. This keeps the parent's model budget focused on coordination and review.

Two requirements shape the design: preserve DeepSeek's execution environment, and integrate delegation into Codex without repeated parent-model activity while children run.

### Preserve the full DSH execution environment

Tool access, context management, and the execution loop all affect how an agent completes a task. The bridge starts a real DeepSeek Harness agent with its own conversation, working directory, tools, and permissions. The standard DSH preset provides context compaction and tool-result pruning, while persisted sessions allow the same agent to continue related work.

Codex supplies a self-contained brief with the objective, allowed changes, constraints, and acceptance evidence. The child then owns implementation, relevant tests, and in-scope repairs. The parent does not have to relay each tool call or supervise every intermediate step.

### Deliver completion to the parent scheduler

Codex starts and follows up with agents through MCP. After each accepted task, the bundled skill registers a detached host-side listener. That listener makes one unbounded wait, saves the full result, and sends the answer back through the Codex App Server's native tool-output channel.

This separates the lifetime of the DSH task from the current parent turn. Codex can work on another task or end its turn when nothing else is ready. Each child can complete independently. Its `dsh_completion` result enters an active parent turn or starts the next turn for an idle parent; the parent then reviews the artifacts and continues the authorized work.

Errors and context exhaustion also return to the parent. A tool error that the child is still repairing does not prematurely complete its task. Explicitly interrupted or closed agents do not trigger a continuation callback.

### Reduce orchestration overhead as well as execution work

Delegation introduces its own costs: preparing briefs, inspecting status, transferring context, and reviewing results. Short model-driven status checks repeatedly bring the parent conversation into another model turn. A single pending tool wait avoids that repetition; the detached callback additionally lets the parent end its turn and resume when the result arrives.

The bundled skill combines completion callbacks with three practices:

- Assign complete deliverables with clear file ownership, so independent agents can make progress without continual parent instructions.
- Request a concise final answer and artifact evidence, then perform one consolidated acceptance pass. Keep detailed execution logs available for targeted inspection.
- Keep the parent focused on the current phase, with accepted conclusions and artifact references. Continue the same DSH agent for related fixes and questions.

These practices reduce parent execution and polling turns, unnecessary transcript transfer, and repeated review. The callback removes model-driven waiting; brief quality, parent-context size, and acceptance work still determine the rest of the overhead.

### Waiting for results

Live testing confirmed that Codex can stay idle while DSH works, without spending GPT quota on waiting. When the child finishes, its result arrives automatically and an idle Codex resumes to review it, without another user message. If Codex is already working, the result enters its current turn.

Assigning tasks and reviewing results still consume Codex tokens; DeepSeek usage is billed separately by its provider. The [validation record](docs/codex-callback-validation.md) describes the test environment and method.

## See the work, keep the conversation

Each workspace has a **Claude Code / Codex 子代理** entry in DSH Web. Open its subagent catalog to inspect individual conversations and traces without filling the sidebar with every delegated run.

The browser reads persisted history, so it can lag and its running indicators are not authoritative for bridge-owned agents. Ask Codex for live status or tool activity through MCP. Follow-ups and cancellation also go through the bridge.

Already working in an ordinary DSH Web session? Attach it with `dsh_attach` and continue that same conversation. Details are in the [usage guide](docs/usage.md).

## Explore the bridge

| Guide | Contents |
| :--- | :--- |
| [Setup](docs/setup.md) | Credentials, persistent installation, upgrades, and older-session migration |
| [Usage](docs/usage.md) | Tools, callbacks, follow-ups, progress, external sessions, and context budgets |
| [Architecture](docs/architecture.md) | Runtime ownership, permissions, and lifecycle |
| [Operations](docs/operations.md) | Service management, result inspection, and browser history |
| [Callback validation](docs/codex-callback-validation.md) | Completion delivery, idle waiting, and parent review |
| [Changelog](CHANGELOG.md) | Release changes and compatibility notes |

The execution tools work with other MCP clients, including Claude Code. Automatic parent wakeup described here uses the Codex-specific callback; other clients use their supported notification or waiting mechanism. DSH appears as MCP activity in Codex today.

If this improves your workflow, [star the project](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/stargazers) or share your experience in [Issues](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/issues).

## Built on

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk). Thanks to [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) and [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) for exploring DSH delegation, and [DSH-Code](https://github.com/unlinearity/dsh-code) for the terminal UI that sparked this project.

[MIT](LICENSE). Independent community project.
