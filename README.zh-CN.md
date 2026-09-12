# DSH Subagent MCP

### Codex 带队，DeepSeek 干活。

[English](README.md) · [开始使用](#开始使用) · [Codex skill](skills/dsh-subagent/SKILL.md)

给 Codex 配一个能读代码、改文件、跑测试的 DeepSeek 编程代理。做完了继续追问，执行中随时查看进度，方向变了就叫停。

**你在 Codex 里把握全局，DSH 在自己的会话里完成委派的工作。**

## 把精力留给决策，把具体工作交出去

排查一个大仓库里的 bug，往往要翻几十个文件，才能找到值得讨论的线索。做一次迁移，可能要逐个修改模块，再处理一轮测试失败。这些工作可以交给一个独立的代理去完成。

DSH Subagent MCP 让 Codex 直接调用 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。DSH 带着自己的模型、工具和工作区访问能力处理任务，Codex 可以继续研究另一部分问题，也可以随时查看进展，根据结果决定下一步。

而且，第一次回答之后，这个代理还在。让它沿着刚找到的线索继续查，让它动手修改，再把你的反馈交给它。**跟已经了解任务的代理接着做。**

## 从“帮我查一下”，到“就按这个改”

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

- **追问不用从头交代。** 继续原来的 DSH 对话，让它接着分析、修改或验证。
- **交出去的工作，看得见进度。** 查询当前输出和工具执行情况，也可以让 Codex 先处理别的任务。
- **长任务也能随时调整。** 需要时中断并改变方向；关闭客户端后，后台服务继续执行，下次连接还能找回任务。

## 开始使用

需要 **Linux + systemd**、满足 [项目要求](package.json) 的 Node.js、Codex CLI，以及已配置模型凭据的 DSH。

```sh
git clone https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp.git
cd dsh-subagent-mcp
npm ci --ignore-scripts
npm run setup -- --skill
```

如果 DeepSeek key 只在当前 shell 的 `DEEPSEEK_API_KEY` 中，在安装命令后加上 `--capture-key`。详细配置见 [安装与凭据](docs/setup.md)。

如果也使用 DSH 网页端，先初始化 Web profile，再安装适配器：

```sh
node scripts/install-web.mjs
```

配置了 `patchReload: live` 的 Web profile 会自动加载；否则请等其任务结束后重启。详见 [网页接入与升级说明](docs/operations.md#live-progress-in-the-dsh-web-ui)。

新开 Codex 会话，试试：

```text
用 $dsh-subagent 只读检查这个项目的错误处理。
保留代理，方便我继续追问。
```

skill 指导 Codex 如何委派和跟进，MCP 提供实际执行工具。DSH 的工作会显示为 Codex 中的 MCP 活动。

## 默认极简模式，网页同步查看进度

新子代理默认使用 DSH 的**极简模式**，完整系统提示词是：

> You are a helpful software engineer assistant.

这个模式只配备持久 shell 工具，在首个任务开始前加载，后续追问沿用同一模式。需要其他模式时，可以显式传入 `preset`；升级前创建的旧会话保留原有配置。

会话会按工作目录登记到 DSH 工作区。安装网页适配器后，**DSH 网页端会实时收到工具活动和流式回复，无须手动刷新**。你可以在 Codex 中委派任务，同时在浏览器里看执行过程；跟随最新输出时，长回复会随内容到达自动滚动。

## 进一步使用

[追问、进度与中断](docs/usage.md) · [权限与架构](docs/architecture.md) · [服务管理](docs/operations.md) · [验证记录](docs/validation.md)

## 致谢

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) 构建。感谢 [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) 与 [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) 对 DSH 委派的探索，以及启发本项目的终端界面 [DSH-Code](https://github.com/unlinearity/dsh-code)。

[MIT 许可](LICENSE)，独立社区项目。
