# DSH Subagent MCP

**把任务交给 DeepSeek Harness，让协作继续下去。**

[English](README.md) · [Codex skill](skills/dsh-subagent/SKILL.md) · [验证范围](docs/validation.md)

让 Codex 拥有可以持续追问、查看进度和打断的 DSH 子代理。即使关闭客户端，下次回来仍能找到它。

> “让 DSH 排查解析器的问题。”
>
> “它现在做到哪了？”
>
> “先停下来，让同一个代理去检查 tokenizer。”

这三句话应该属于同一次协作。稳定的代理 ID、保留下来的对话，以及明确的执行控制，让这个过程成为可能。

## 为什么做这个项目

任务委派经常从第二个问题才真正开始。第一次调查提供了线索，你想沿着它追问；执行方向发生变化，你需要叫停；关掉编辑器后，你还想接着讨论。

一次性 worker 可以交回结果，但父代理仍然需要管理后续协作：继续同一段对话、了解执行进度，以及确认任务已经停止。

这个项目让 **Codex 负责协调，DeepSeek Harness 负责执行**。DSH 使用自己的模型循环、工具、沙箱和会话历史处理任务，Codex 根据结果决定下一步。追问会回到原来的 DSH 会话，父对话按需获取进度和结果。

## 可以做什么

- **持续追问**：用同一个代理 ID 继续讨论；服务重启后也能恢复对话。
- **查看真实进度**：读取可见输出、工具调用、生命周期事件和最终结果；用游标获取新增事件。
- **确认停止后再转向**：中断调用等待 DSH 回到 idle，再接受新的任务。
- **跨客户端会话工作**：MCP 客户端断开后，后台服务继续管理任务。
- **明确执行权限**：使用 DSH 的只读、工作区可写或明确授权的完全访问模式。
- **配套 Codex skill**：指导父代理正确使用这些能力，保留后续追问所需的会话。

接入的是完整的 **DSH harness**。在 Codex 中，它显示为 MCP 工具活动，不会自动出现在原生 `/agent` 线程列表中。

## 安装

目前支持 **Linux + systemd 用户服务**，需要 Node.js **24+**、Codex CLI 和 Node.js 版本的 DSH。已测试的 DSH 版本为 **0.1.5-rc.1**；已有可用安装可以直接复用。

```sh
npm install -g @deepseek-ai/dsh@0.1.5-rc.1
git clone https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp.git
cd dsh-subagent-mcp
npm ci --ignore-scripts
npm run setup -- --skill
```

DSH 需要配置模型凭据。已有 DSH 凭据存储可以复用。如果 key 只存在于当前 shell 的 `DEEPSEEK_API_KEY` 环境变量中，运行：

```sh
npm run setup -- --skill --capture-key
```

`--capture-key` 会将当前模型环境保存到权限为 0600 的服务文件，不打印其值，也不覆盖已有文件。不要把 key 放入任务文本或 Codex MCP 配置。

安装器会创建独立的 `codex-subagent` DSH profile、安装并启动用户级服务、注册 Codex MCP，并可选安装 skill；不会修改已安装的 DSH 源码。重新运行安装器会重启本服务，升级前应先完成或中断正在执行的任务。

新开 Codex 会话，在 `/mcp` 中确认 `dsh_subagent`，然后说：

```text
用 $dsh-subagent 只读调查这个项目，找出请求取消如何传到 worker 进程。
保留代理 ID，方便后续追问。
```

之后可以直接问进度，或者要求中断并继续同一段对话。

## 工具与生命周期

| 工具 | 行为 |
|---|---|
| `dsh_start` | 异步启动，立即返回稳定的 `id`；必须指定绝对路径 `cwd`。 |
| `dsh_status` | 获取状态、可见的部分输出、回答和结束原因。 |
| `dsh_events` | 按游标获取新增进度事件。 |
| `dsh_list` | 找回当前或先前客户端会话中的代理。 |
| `dsh_wait` | 单次等待最多 25 秒，然后返回当前状态；不会停止任务。 |
| `dsh_followup` | 向空闲代理继续提问，必要时恢复持久化会话。 |
| `dsh_interrupt` | 取消正在执行和排队的输入，等待 idle 并刷新历史。 |
| `dsh_close` | 释放运行时并关闭该代理，保留历史。 |

后续调用将返回的 `id` 填入 `agent_id`。运行中的代理会拒绝追问；需要改变方向时，先中断并等待确认。还要继续追问时不要关闭代理，因为关闭后不能再通过 bridge 追问它。

**25 秒是单次观察窗口，不是任务超时。** 到点只会返回当前状态，DSH 可以继续运行很久。父代理可以先处理其他工作，需要进度时再查询，不必每 25 秒轮询一次。整个 DSH 任务没有因这个等待窗口而被设定总时限。

默认使用 `deepseek-official` / `deepseek-v4-flash`、`max` 推理档位和 `workspace-write` 权限，可在创建时选择其他配置。

客户端断开不会停止任务。后台服务重启会停止它的 DSH 进程，将未完成工作标记为 interrupted；只有明确追问后才恢复对话，不会自动重放旧任务。

## 使用边界

DSH 不继承 Codex 的对话和权限。委派时应提供相关上下文、允许的操作及验收要求，并选择不超出父任务授权的权限。当前 bridge 没有人工审批答复界面，需要升级权限的请求会被拒绝。

中断不会撤销已经修改的文件。最终文字也不能替代实际文件、命令输出或测试结果。进度通过工具查询，不会自动推送进父对话；过大的工具事件会标明截断。

本服务使用当前 Unix 用户的私有 socket，同一用户的客户端共享代理列表。目前安装器不支持 macOS 或 Windows。DSH 仍在演进，升级后应重跑真实验证。

## 管理和验证

```sh
systemctl --user status dsh-subagent-mcp.service
codex mcp get dsh_subagent
npm test
```

真实验证会产生模型调用，使用临时工作区，可通过 `TMPDIR` 指定位置：

```sh
node test/live.mjs
node test/mcp-live.mjs
```

验证覆盖会话延续、恢复、进度、中断、重连、文件写入和沙箱拒绝。原始报告只保留在本地，不上传 Git。单独 Codex CLI 的模型驱动验收曾因认证错误而未执行到工具调用；完整的验证范围见 [validation.md](docs/validation.md)。本项目没有据此宣称速度、成本或编码准确率提升。

只断开接入、保留源码和历史：

```sh
codex mcp remove dsh_subagent
systemctl --user disable --now dsh-subagent-mcp.service
```

更多存储路径、配置变量和架构信息见 [English README](README.md)。

## 致谢与许可

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) 构建。调研参考了 [dsh-mcp](https://github.com/Mr-potato-123/dsh-mcp) 和 [dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex)；本实现聚焦持久会话和生命周期控制。[DSH-Code](https://github.com/unlinearity/dsh-code) 是独立的终端界面项目。

MIT 许可。独立社区项目，与 OpenAI、DeepSeek 无隶属关系。
