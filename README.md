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

```sh
npx -y dsh-subagent-mcp@latest setup --skill
```

Setup connects DSH to Codex and installs the skill. See the [installation guide](docs/setup.md) for environment requirements, credentials, and upgrades.

Open a new Codex session and ask:

```text
Use $dsh-subagent to implement the agreed plan in parallel.
Have the agents run the relevant tests, then review and integrate their results.
```

For a smaller first task:

```text
Use $dsh-subagent to investigate why cancelled requests leave workers running.
Keep it read-only and return the root cause with code references.
```

You can later ask “What has it found?”, continue with “Have that same agent fix it and run the tests”, or stop it when the plan changes.

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
- Start major phases with a concise parent-session handoff instead of carrying the entire project history into every phase. Continue the same DSH agent for related fixes and questions.

These practices reduce parent execution and polling turns, unnecessary transcript transfer, and repeated review. The callback removes model-driven waiting; brief quality, parent-context size, and acceptance work still determine the rest of the overhead.

### What the live test established

The callback test used a real DSH task containing a 75-second shell delay. Parent telemetry measured a 55.834-second idle interval within that run.

| Observation | Result |
| :--- | :--- |
| New parent-model requests during the measured idle interval | **0** |
| Parent input / output tokens during that interval | **0 / 0** |
| Completion while the parent was active | Tool output entered the existing turn |
| Completion while the parent was idle | The parent resumed automatically |
| Extra user messages needed for delivery | **0** |

This validates native completion delivery and zero model usage during the measured wait. Planning, dispatch, resumed reasoning, and acceptance still consume Codex tokens; DSH has its own provider usage. An overall savings percentage requires comparable complete-task measurements. The [validation record](docs/codex-callback-validation.md) describes the test and evidence scope.

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
| [Operations](docs/operations.md) | Service management, callback recovery, and browser history |
| [Callback validation](docs/codex-callback-validation.md) | Active/idle parent delivery and measured idle usage |
| [Changelog](CHANGELOG.md) | Release changes and compatibility notes |

The execution tools work with other MCP clients, including Claude Code. Automatic parent wakeup described here uses the Codex-specific callback; other clients use their supported notification or waiting mechanism. DSH appears as MCP activity in Codex today.

If this improves your workflow, [star the project](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/stargazers) or share your experience in [Issues](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/issues).

## Built on

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk). Thanks to [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) and [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) for exploring DSH delegation, and [DSH-Code](https://github.com/unlinearity/dsh-code) for the terminal UI that sparked this project.

[MIT](LICENSE). Independent community project.
