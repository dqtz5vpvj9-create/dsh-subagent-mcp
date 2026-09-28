<p align="center">
  <img src="https://raw.githubusercontent.com/dqtz5vpvj9-create/dsh-subagent-mcp/main/docs/assets/readme-hero.png?v=0.5.3" alt="DSH Subagent MCP：给 Codex 配一支 DeepSeek 团队。蓝发鲸鱼娘在 Codex 终端图标旁协作完成代码实现、排查与测试。" width="1200">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-subagent-mcp"><img src="https://img.shields.io/npm/v/dsh-subagent-mcp?style=flat-square&amp;color=CB3837" alt="npm version"></a>
  <a href="skills/dsh-subagent/SKILL.md"><img src="https://img.shields.io/badge/Codex-skill-4D6BFE?style=flat-square" alt="Codex skill included"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-A6ADBB?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">中文 · <a href="README.md">English</a> · <a href="#开始使用">开始使用</a> · <a href="docs/usage.md">使用指南</a></p>

DSH Subagent MCP 让 Codex 直接调用 DeepSeek 子代理。Codex 负责规划和验收，子代理在 DSH 中完成各自的任务，结束后自动回传结果。需要修改时，可以继续使用原来的代理，无需重新交代上下文。

<table>
<tr>
<td width="33%"><strong>并行执行</strong><br>多个代理可以同时处理独立任务。</td>
<td width="33%"><strong>自动回传</strong><br>完成后带着答复和证据唤醒 Codex，无需轮询。</td>
<td width="33%"><strong>继续同一会话</strong><br>保留上下文，交给原来的代理继续修改。</td>
</tr>
</table>

## 开始使用

```sh
npx -y dsh-subagent-mcp@latest setup --skill
```

安装器会将 DSH 接入 Codex，并安装配套 skill。环境要求、凭据配置和升级方法见[安装指南](docs/setup.md)。

新开 Codex 会话后，可以这样安排任务：

```text
用 $dsh-subagent 并发实现已经确认的方案。
让代理完成相关测试，再验收并集成结果。
```

也可以先试一个小任务：

```text
用 $dsh-subagent 查一下，为什么请求取消后 worker 还在运行。
保持只读，给出根因和对应代码位置。
```

之后可以查询进度，或让同一个代理继续修复并运行测试。任务方向变化时，也可以直接要求 Codex 中断它。

## 为什么将 Codex 与 DSH 结合？

使用 GPT-6 Astra 处理长任务时，模型用量不只花在制定方案上。每轮执行后的判断、进度查询和结果检查也会消耗 token。DSH Subagent MCP 将范围明确的工作交给 DeepSeek，让 Codex 负责方案设计和最终验收。例如，Codex 可以将一个模块的实现交给子代理，待代码和测试结果返回后统一检查。

DeepSeek 在自己的 Harness 中执行任务，Codex 则通过完成回调接收结果。子任务运行期间，父模型无需反复查询进度。

### 让 DeepSeek 在 DSH 中执行任务

编程代理需要读取项目、编辑文件和执行命令，也需要管理执行过程中不断增长的上下文。桥接器直接启动 DeepSeek Harness，由 DSH 处理这些工作。每个代理在指定目录中运行，使用各自的工具权限并保留会话。标准预设会压缩过长的上下文、裁剪工具结果；后续修改可以在同一会话中继续。

Codex 在委派时说明目标、允许修改的范围、约束和验收要求。子代理负责完成实现，并处理相关测试中发现的问题。父代理收到结果后集中检查，无需逐步指导子代理调用工具。

### 完成后自动通知 Codex

Codex 通过 MCP 启动子代理，配套 skill 随后为这次任务注册后台监听器。监听器进行一次无超时等待，待任务结束后保存完整结果，再通过 Codex App Server 送回原生工具结果 `dsh_completion`。追问同一个代理时，也会为新任务注册监听器。

等待发生在监听器中，不触发模型请求。Codex 有其他工作时可以继续处理，没有工作时则结束当前轮次。各个子代理分别回传：父代理仍在运行时，结果进入当前轮次；父代理已空闲时，结果会自动启动下一轮，让它继续验收和集成。

任务因错误或上下文耗尽而结束时，也会通知父代理。如果只是某次工具调用失败，而子代理还在处理，监听器会继续等待。主动中断或关闭的代理不会触发继续执行的回调。

### 委派开销还取决于任务和上下文

父代理仍要准备任务、传递必要的上下文并检查结果。如果模型每隔几秒查询一次进度，这些查询又会产生新的推理轮次，每轮都带上父会话上下文。一次持续的工具等待可以避免轮询；后台监听器还允许父会话结束当前轮次，由调度器在完成事件到达时恢复执行。

任务应该一次交代清楚，并划分好各代理可以修改的文件。子代理完成后提交简短结论和验收证据，父代理集中检查；详细日志保留在文件中，检查到具体问题时再读取。需要修复的缺陷可以合并成一次后续任务，交给原来的代理处理。

父会话本身也会不断变长。配套 skill 建议在大阶段完成后，用简短交接开启新的父会话，交接内容包括目标、已验收结论和后续需要的产物及代理 ID。同一任务的追问仍可使用原来的 DSH 代理，父会话则不必继续携带全部历史。

### 实测验证了什么？

测试让一个真实 DSH 代理执行了 75 秒的 shell 等待，并记录了其中父 Codex 连续空闲的 55.834 秒。

| 观测项 | 结果 |
| :--- | :--- |
| 测量等待区间内，父模型新增请求 | 0 |
| 该区间内，父模型输入 / 输出 token | 0 / 0 |
| 父代理正在运行时收到结果 | 工具结果进入当前轮次 |
| 父代理空闲时收到结果 | 自动恢复执行 |
| 为送达结果而额外发送的用户消息 | 0 |

在这段等待时间里，父模型没有产生用量，结果到达后也成功恢复了执行。任务安排和验收仍会消耗 Codex token，DeepSeek 的用量另行计算。上述数字只覆盖等待阶段，不能据此计算整个任务节省了多少额度。测试过程见[验证记录](docs/codex-callback-validation.md)。

## 在 DSH Web 查看执行记录

DSH 将子代理按工作区归档。每个工作区有一条名为“Claude Code / Codex 子代理”的会话，打开其中的子代理列表，就能查看各项任务的对话和工具执行记录。

网页显示已保存的记录，可能晚于实际执行进度，运行标识也不反映这些代理的实时状态。需要当前进度时，让 Codex 通过 MCP 查询；追问和中断同样由桥接器处理。

已有的普通 DSH Web 会话可以通过 `dsh_attach` 接入，继续原来的工作。具体用法见[使用指南](docs/usage.md)。

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

使用问题和功能建议请提交到 [Issues](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/issues)。

## 致谢

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) 构建。感谢 [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) 与 [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex) 对 DSH 委派的探索，以及启发本项目的终端界面 [DSH-Code](https://github.com/unlinearity/dsh-code)。

[MIT 许可](LICENSE)，独立社区项目。
