<p align="center">
  <img src="https://raw.githubusercontent.com/dqtz5vpvj9-create/dsh-subagent-mcp/main/docs/assets/readme-hero.png" alt="DSH Subagent MCP：给 Codex 配一支 DeepSeek 团队。蓝发鲸鱼娘在 Codex 终端图标旁协作完成代码实现、排查与测试。" width="1200">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-subagent-mcp"><img src="https://img.shields.io/npm/v/dsh-subagent-mcp?style=flat-square&amp;color=CB3837" alt="npm version"></a>
  <a href="skills/dsh-subagent/SKILL.md"><img src="https://img.shields.io/badge/Codex-skill-4D6BFE?style=flat-square" alt="Codex skill included"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-A6ADBB?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">中文 · <a href="README.md">English</a> · <a href="#开始使用">开始使用</a> · <a href="docs/usage.md">使用指南</a></p>

给 Codex 配一支 DeepSeek 团队。让子代理并行完成实现、排查与测试，Codex 负责规划和验收。结果自动回传，后续任务也能交给保留着上下文的同一个代理。

<table>
<tr>
<td width="33%"><strong>并行推进</strong><br>把独立任务分给多个代理，同时推进。</td>
<td width="33%"><strong>自动回传</strong><br>完成后带着答复和证据唤醒 Codex，无需轮询。</td>
<td width="33%"><strong>持续协作</strong><br>保留上下文，让同一个代理继续修复和验证。</td>
</tr>
</table>

## 开始使用

```sh
npx -y dsh-subagent-mcp@latest setup --skill
```

安装器会将 DSH 接入 Codex，并安装配套 skill。环境要求、凭据配置和升级方法见[安装指南](docs/setup.md)。

新开 Codex 会话，直接安排：

```text
用 $dsh-subagent 并发实现已经确认的方案。
让代理完成相关测试，再验收并集成结果。
```

也可以先试一个小任务：

```text
用 $dsh-subagent 查一下，为什么请求取消后 worker 还在运行。
保持只读，给出根因和对应代码位置。
```

之后随时问“查到哪了”，接着安排“让刚才那个代理修好并跑测试”，或者在方向变化时叫停。

## 把模型调用用在工作上

配套 skill 在每次启动或追问后注册一个后台监听器。监听器等待 DSH 结束，保存完整结果，再将答复作为原生 `dsh_completion` 工具结果送回。Codex 可以继续处理独立工作，也可以结束当前轮次，等待回调。

一次真实测试中，父 Codex 空闲 **55.834 秒，新增模型请求为 0，输入和输出 token 均为 0**，随后由 DSH 结果自动唤醒。委派和验收仍消耗 Codex token，DSH 也有自己的模型用量。这项测量针对等待阶段，不能换算成整个任务的节省百分比。详见[测试记录](docs/codex-callback-validation.md)。

任务错误退出或上下文耗尽也会回传。子代理正在处理的单次工具失败不会提前结束整个任务；明确中断或关闭的代理不会触发继续执行的回调。

## 过程看得见，后续接得上

DSH 网页中，每个工作区有一条 **Claude Code / Codex 子代理** 会话。打开其中的子代理列表，即可查看各个任务的对话和轨迹，自己的会话列表不会被委派任务淹没。

网页读取的是持久化历史，可能落后于实际执行，其运行标识也不能代表 bridge 代理的实时状态。需要实时进度或工具活动时，直接让 Codex 通过 MCP 查询；追问和中断也由 bridge 处理。

已经在普通 DSH Web 会话中开始了工作？可以用 `dsh_attach` 接入并继续原来的会话，详见[使用指南](docs/usage.md)。

## 进一步了解

| 文档 | 内容 |
| :--- | :--- |
| [安装](docs/setup.md) | 凭据、持久安装、升级和旧会话迁移 |
| [使用](docs/usage.md) | 工具、回调、追问、进度、外部会话和上下文预算 |
| [架构](docs/architecture.md) | 进程归属、权限和生命周期 |
| [运维](docs/operations.md) | 服务管理、回调恢复和网页历史 |
| [回调验证](docs/codex-callback-validation.md) | 忙碌与空闲父代理的回传、等待期间的实际用量 |
| [更新日志](CHANGELOG.md) | 版本变化和兼容性说明 |

执行工具也可用于 Claude Code 等其他 MCP 客户端。这里的自动唤醒使用 Codex 专用回调；其他客户端采用各自支持的通知或等待方式。目前 DSH 在 Codex 中显示为 MCP 活动。

如果它让你的工作更顺手，欢迎[点个 Star](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/stargazers)，也欢迎在 [Issues](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/issues) 分享用法和遇到的问题。

## 致谢

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) 构建。感谢 [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) 与 [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) 对 DSH 委派的探索，以及启发本项目的终端界面 [DSH-Code](https://github.com/unlinearity/dsh-code)。

[MIT 许可](LICENSE)，独立社区项目。
