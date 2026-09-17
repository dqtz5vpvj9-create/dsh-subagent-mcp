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

<p align="center">中文 · <a href="README.md">English</a> · <a href="#开始使用">开始使用</a> · <a href="docs/usage.md">使用指南</a></p>

给 Codex 配一个能读代码、改文件、跑测试的 DeepSeek 编程代理。做完了继续追问，执行中随时查看进度，方向变了就叫停。

**你在 Codex 里把握全局，DSH 在自己的会话里完成委派的工作。**

## 为持续协作而做

| | 用起来是什么样 |
| :--- | :--- |
| **默认标准模式** | 首个任务开始前加载 DSH 原生 standard preset，包含自动上下文压缩和工具结果裁剪。 |
| **网页实时更新** | 安装 Web 适配器后，工具活动和流式回复直接出现在网页中，无须 Ctrl-R。 |
| **完成后继续处理** | skill 要求父代理等待任务结束、检查产物并继续已授权的后续工作。 |
| **接着原会话追问** | 让同一个代理继续分析、修改或验证，保留前文。 |
| **连接已有 Web 会话** | 接入在 bridge 之外启动的会话，查看进展，并在原会话中排队发送或即时补充消息。 |
| **随时中断和调整** | 改变方向时先停止当前任务，再把新要求交给它。 |
| **按目录归组** | 会话登记到对应的 DSH 工作区，方便在网页端找回。 |
| **后台持续执行** | 关闭 Codex 客户端后，本地服务仍可继续任务；重新连接后查看进度。 |

## 开始使用

需要 **Linux + systemd**、满足 [项目要求](package.json) 的 Node.js、Codex CLI，以及已配置模型凭据的 DSH。

```sh
npx -y dsh-subagent-mcp@latest setup --skill
```

无需 clone。安装器会把运行文件放到固定的用户目录，后台服务和 skill 不依赖 npx 缓存。也可以在首次安装时加上 `--web`，一起接入已初始化的 DSH Web profile。

如果 DeepSeek key 只在当前 shell 的 `DEEPSEEK_API_KEY` 中，在安装命令后加上 `--capture-key`。详细配置见 [安装与凭据](docs/setup.md)。

如果也使用 DSH 网页端，先初始化 Web profile，再安装适配器：

```sh
npx -y dsh-subagent-mcp@latest web
```

配置了 `patchReload: live` 的 Web profile 会自动加载；否则请等其任务结束后重启。详见 [网页接入与升级说明](docs/operations.md#live-progress-in-the-dsh-web-ui)。

新开 Codex 会话，试试：

```text
用 $dsh-subagent 只读检查这个项目的错误处理。
保留代理，方便我继续追问。
```

skill 指导 Codex 如何委派和跟进，MCP 提供实际执行工具。DSH 的工作会显示为 Codex 中的 MCP 活动。

## 从“帮我查一下”，到“就按这个改”

完成结果通过等待中的工具调用返回。父代理需要保持当前轮次；这不会自动唤醒已经结束的对话。详见 [完成交接](docs/usage.md)。

装好配套 skill 后，你可以这样使用：

```text
你 → Codex
用 $dsh-subagent 查一下，为什么请求取消后 worker 还在运行。
让它追踪代码并报告原因，先不要修改文件。

你 → Codex
DSH 现在查到哪了？

你 → Codex
让刚才那个代理继续看看，超时路径是不是也有同样的问题。
```

对于已获准修改文件的代理，还可以接着安排：

```text
你 → Codex
让 DSH 按确认的方案修复，并运行相关测试。

你 → Codex
先停一下，我们换个思路。确认它停止后，把这个新方案交给它：……
```

## 默认标准模式，网页同步查看进度

新子代理默认使用 DSH 的 **standard preset（标准模式）**，包含自动上下文压缩和工具结果裁剪，在首个任务开始前加载。后续追问和重启恢复沿用原有 preset。

需要固定提示词和单一持久 shell 时，可显式传入 `preset: "minimal"`；该模式不包含自动 compaction。已有会话保留原来的配置。

会话会按工作目录登记到 DSH 工作区。安装网页适配器后，**DSH 网页端会实时收到工具活动和流式回复，无须手动刷新**。你可以在 Codex 中委派任务，同时在浏览器里看执行过程；跟随最新输出时，长回复会随内容到达自动滚动。

## 进一步使用

MCP 默认只返回精简结果：`dsh_start` 和 `dsh_followup` 返回回执，
`dsh_status` 与 `dsh_list` 返回生命周期状态，`dsh_wait` 在结束后只返回一次最终答复。
持久任务请省略 `seconds`。`dsh_events` 默认只返回新增的代理可见文本；需要工具摘要时显式选择，
再用 `event_id` 定向读取单个工具事件。大事件会返回续读游标。只有兼容旧客户端时才使用 `legacy: true`。

[追问、进度与中断](docs/usage.md) · [权限与架构](docs/architecture.md) · [服务管理](docs/operations.md) · [验证记录](docs/validation.md)

如果这个项目让你更方便地使用 DSH，欢迎点个 Star，也欢迎通过 [Issues](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/issues) 分享使用场景和遇到的问题。

## 致谢

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) 构建。感谢 [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) 与 [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) 对 DSH 委派的探索，以及启发本项目的终端界面 [DSH-Code](https://github.com/unlinearity/dsh-code)。

[MIT 许可](LICENSE)，独立社区项目。
