<p align="center">
  <img src="https://raw.githubusercontent.com/dqtz5vpvj9-create/dsh-subagent-mcp/main/docs/assets/readme-hero.png?v=0.5.3" alt="DSH Subagent MCP：给 Codex 配一支 DeepSeek 团队。蓝发鲸鱼娘在 Codex 终端图标旁协作完成代码实现、排查与测试。" width="1200">
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

## 为什么将 Codex 与 DSH 结合？

软件任务既包含需要全局上下文的决策，也包含能够明确划定范围的执行工作，例如实现一个模块、定位一处缺陷、运行并修复测试。DSH Subagent MCP 将两类职责分开：Codex 中的 GPT-6 负责任务拆解、跨任务决策和结果验收，DeepSeek 则通过独立运行环境完成有界任务，让父模型的额度更多用于统筹和判断。

这一分工需要同时解决两个问题：保留 DeepSeek 完整的执行环境，以及将委派融入 Codex 的工作流，避免子任务运行期间反复调用父模型。

### 保留 DSH 的完整执行环境

工具可用性、上下文管理和执行循环都会影响代理完成任务的方式。桥接器启动真正的 DeepSeek Harness 代理，为其保留独立会话、工作目录、工具和权限。DSH 标准预设提供上下文压缩和工具结果裁剪，持久会话则让同一个代理能够继续处理相关工作。

Codex 交付的任务描述包含目标、允许修改的范围、约束和验收证据。子代理随后负责实现、相关测试及范围内的修复，父代理无需逐次转发工具调用或介入每个中间步骤。

### 将完成事件交给父代理调度器

Codex 通过 MCP 启动和追问子代理。每次任务被接受后，配套 skill 注册一个独立的后台监听器。监听器只进行一次无超时等待，完成后保存完整结果，再通过 Codex App Server 的原生工具结果通道送回答复。

这样，DSH 任务的执行周期就可以跨越父代理的当前轮次。Codex 有其他工作时继续推进，没有工作时结束当前轮次。各个子代理独立完成，返回的 `dsh_completion` 进入正在运行的父轮次，或自动启动空闲父代理的下一轮；父代理随后验收产物，继续已授权的工作。

任务错误退出或上下文耗尽也会回传。子代理仍在修复的单次工具错误不会提前结束任务；明确中断或关闭的代理不会触发继续执行的回调。

### 同时减少执行开销与调度开销

委派本身也有成本，包括准备任务、查看状态、传递上下文和验收结果。由模型发起的短周期状态查询，会反复将父会话带入新的模型轮次。保持一次待返回的工具等待可以避免重复查询；独立后台回调进一步允许父代理结束当前轮次，在结果到达后恢复。

配套 skill 将完成回调与三项做法结合：

- 一次交付完整任务，明确文件归属，使独立子代理能够持续执行，减少父代理逐步指挥。
- 返回简洁结论和产物证据，由父代理集中验收一次；详细执行日志保留在产物中，按需检查。
- 大阶段之间使用简短交接开启新的父会话，减少反复携带完整历史；同一任务的修复和追问继续使用原来的 DSH 代理。

这些做法减少父模型的执行和查询轮次、无关历史传递以及重复验收。回调解决等待期间的模型调用，任务描述质量、父上下文长度和验收工作量仍会影响其余开销。

### 实测验证了什么？

回调测试使用了一个包含 75 秒 shell 等待的真实 DSH 任务，并在其中测量到父 Codex 连续空闲 55.834 秒。

| 观测项 | 结果 |
| :--- | :--- |
| 测量等待区间内，父模型新增请求 | **0** |
| 该区间内，父模型输入 / 输出 token | **0 / 0** |
| 父代理正在运行时收到结果 | 工具结果进入当前轮次 |
| 父代理空闲时收到结果 | 自动恢复执行 |
| 为送达结果而额外发送的用户消息 | **0** |

这项测试验证了原生结果回传，以及所测等待区间内的零模型用量。规划、委派、唤醒后的推理和验收仍消耗 Codex token，DSH 也有自己的模型用量；整体节省比例需要通过可比的完整任务测量得出。[验证记录](docs/codex-callback-validation.md)给出了测试过程和证据范围。

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
