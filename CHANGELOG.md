# Changelog

## 0.6.2

- Run the Codex App Server for Windows SSH terminals through the existing login service. This keeps Codex's sandbox in the logged-in Windows session and closes the owned process tree when the terminal disconnects.
- Resolve both local `node_modules/.bin` and global npm wrappers on Windows to the package's JavaScript entrypoint. Existing DSH installations no longer cause Node to execute a shell script during setup.
- Prepare a private, compatible Codex installation when the existing CLI predates the authenticated callback launcher. Existing global installations remain available.
- Gate publication on real end-to-end acceptance on two Windows machines: install the packed CLI, launch the Codex terminal, delegate a real DSH file task, deliver a native completion callback, verify the artifact in Codex, restart the service, reopen Codex, and continue the same DSH agent.

## 0.6.1 — 2026-09-28

- Start with one command: `npx -y dsh-subagent-mcp@latest`. In a terminal, the first run installs the bridge and opens Codex; later runs open Codex directly. The explicit `codex` command also installs on first use.
- Keep `setup` for installation and configuration without launching. New MCP registrations use the explicit `mcp` transport; existing piped connections without arguments remain compatible.
- Preserve login services owned by another installation. Automatic setup uses a separate background process when configuration directories differ; explicit conflicting service installation and removal are refused.
- Update the English and Chinese quick starts to use the single entry point.

## 0.6.0 — 2026-09-28

Install and run DSH subagents on Windows, Linux and macOS with the same commands.

- Setup installs missing DSH and Codex dependencies in a private user directory, prepares the profile, registers MCP and installs the companion skill by default. Existing installations and account settings are reused. Python is no longer required.
- Use native per-user startup: Scheduled Tasks on Windows, launchd on macOS and systemd on Linux. A background-process fallback supports environments without login services. Windows IPC uses authenticated loopback connections and private ACLs; long macOS paths use a short private Unix socket.
- Add `doctor`, `status`, `start`, `stop`, `restart`, `logs`, `upgrade` and `uninstall`. Installs survive npx cache cleanup. Activation failures restore the previous installation, active tasks block ordinary stops and upgrades, and uninstall retains task history and provider settings by default.
- Add `dsh-subagent-mcp codex`, an authenticated local App Server launcher for automatic callbacks across all three systems. The Node.js listener preserves the existing completion, cancellation and evidence semantics; the old Python helper remains available for compatibility.
- Open DSH Web with `dsh-subagent-mcp dsh web`, using the managed runtime and saved provider settings without a global installation.
- Test packed installation, native service lifecycle, rollback, Unicode paths, callback delivery and real DSH presets on Windows, Linux and macOS in CI. Fresh-install coverage uses the actual Codex CLI and managed DSH dependency.

**Upgrade:** finish active tasks, then run `npx -y dsh-subagent-mcp@latest setup`.
The companion skill is now installed by default; use `--no-skill` to retain a
separately managed skill. Start Windows Codex sessions with
`npx -y dsh-subagent-mcp codex` for automatic callbacks. See the
[installation guide](docs/setup.md) for accounts, service options and migration.

## 0.5.4 — 2026-09-28

- Expand both READMEs with the design rationale for combining Codex and DSH, native completion scheduling, delegation overhead, and the measured callback results. Runtime behavior is unchanged.

## 0.5.3 — 2026-09-28

- Refine the README artwork: a floating blue Codex emblem exchanges tasks and results with the whale-girl agents, without a slab or pedestal. Runtime behavior is unchanged.

## 0.5.2 — 2026-09-28

- Give the README a distinct visual identity with the Codex terminal emblem and a whale-girl coding crew based on the supplied character reference.
- Simplify the English and Chinese quick starts: lead with the install command and natural task examples; keep environment and credential details in the installation guide. Runtime behavior is unchanged.

## 0.5.1 — 2026-09-28

- Redesign the English and Chinese README introductions with an illustrated hero, three focused product benefits, fewer badges, and an earlier installation entry point.
- Replace the default Mermaid overview with a packaged static image that renders consistently on GitHub and npm. Runtime behavior is unchanged.

## 0.5.0 — 2026-09-28

Codex can now delegate parallel work, stop reasoning while it waits, and resume automatically when DSH returns a result. This release also groups delegated sessions by workspace and reduces the context consumed by routine MCP responses.

**Upgrade notes:** `dsh_list` now returns an object with `items` instead of a bare array; `dsh_events` defaults to completed root replies. The old `web` command and `setup --web` option have been removed. Finish active tasks before running setup; use `adopt` with the service stopped to move older sessions under workspace mount points. Native callbacks require Python 3 and a compatible Codex App Server; see [setup](docs/setup.md).

- Return DSH completions through Codex `turn/start.toolOutput` by default. The skill's detached listener waits once, saves the full result and delivers the answer inline, waking an idle parent without polling or queued user input. Queue delivery remains an explicit compatibility option; failures retain evidence without automatic retry.
- Honor `TMPDIR` for callback artifacts and fall back to an available temporary directory on other hosts. Cover callback delivery and installed-package behavior in CI.
- Hang bridge sessions under one virtual parent per workspace instead of listing them beside the user's own DSH Web sessions. A new agent's session header carries `origin: 'subagent'`, `parentSession` and `delegationDepth: 1`, and its log opens with a `subagent/descriptor` event, which is what DSH Web's enumeration reads; the sidebar hides subagent-origin sessions, so each workspace shows one mount-point session titled "Claude Code / Codex 子代理" whose subagent catalog is where delegated runs are reviewed. The mount point is created by a runtime that exits immediately, because a DSH process persists a session only while it owns it and an owner holds the write lease DSH Web needs to open it.
- Add `dsh-subagent-mcp adopt` for sessions created before mount points existed. A session header is immutable and there is no re-parent operation, so adoption rewrites the durable record: DSH stores a session as concatenated zstd frames whose first frame is exactly the header line, and the header is replaced without touching the log behind it. Sessions held by a live process are skipped, and a workspace whose directory no longer exists gets no mount point but its sessions are still adopted.
- Remove the DSH Web relay. Live history reached the browser through a plugin injected into the Web process; a subagent is addressed through its parent, so that interception can never match again. `setup` now removes any entry an earlier install left in the Web profile, and the `web` command is gone. Progress during a run comes from `dsh_events` and `dsh_wait`; the browser reads a child from persistence, at flush granularity.
- Attach only the mount point to its workspace, and reassert that membership on every start: any live DSH process republishes the whole workspace record from what it loaded at boot, so a membership added while it was running would otherwise be lost.
- Make `dsh_events` return completed root-turn final replies by default. Intermediate text requires `include_progress:true`; child activity additionally requires `include_descendants:true`. Existing stored events and continuation cursors remain readable, and tool summaries/full records remain available explicitly.
- Clarify completion waiting versus progress inspection in the tool descriptions and companion skill.
- Bound `dsh_list`: active agents first and then by most recent activity, at most `limit` rows (default 20) and `max_chars` of text (default 12000), whichever comes first. The response reports `total` stored agents, `matched` when a filter ran, and an `omitted` note stating what was dropped and how to reach it, so a filter that finds nothing cannot read as an empty store. Narrow with `status`, `cwd` (that directory or below) or `match` (name substring or `agent_id` prefix) instead of raising the cap. A listing row drops the duplicate `id`, `workspace_id`, `context_limit_tokens` and a `finish_reason` that only restates `status`, clips `error` to 200 characters plus the number of characters dropped, and keeps `progress` only while running. `legacy:true` still carries the complete per-agent record but obeys the same bounds. Against a 96-agent store this takes the default response from about 42,000 characters to about 4,400, and `legacy:true` from about 1,270,000.
- Lead every tool result with `len`, the exact size in characters of that response, and move identifiers and cursors (`agent_id`, `id`, `workspace_id`, `next_cursor`, `event_id`, …) to the end, so the readable part of a truncated result is visible first. `dsh_list` now returns `{len, count, items}` instead of a bare array.

## 0.4.1

- Default new agents to DeepSeek V4.1 Flash (`deepseek-flash`) instead of DeepSeek V4 Flash. Existing agents keep the model they were created with.

## 0.4.0

- Apply the requested permission after DSH pins its default preset, and refuse a runtime whose effective permission differs. Earlier `workspace-write` agents ran with the user's DSH default when that default was `danger-full-access`.
- Cap DeepSeek completion at 128k tokens so standard-preset compaction runs before the request limit.
- Report `context_tokens` and `context_limit_tokens`, settle overflowed turns as `context_exhausted` with the last completed answer, and refuse follow-ups that cannot fit.
- Name sessions in DSH Web from `name` or the task's first line, and add `dsh_rename`.
- Keep observing an attached Web session after a DSH session error instead of detaching it, and keep terminal `error` and `closed` states when an attached session is observed again.
- Make the companion skill client-neutral so Claude Code can use it as well as Codex.

## 0.3.2

- Register the Host model-selection settings required to mount the standard preset.
- Add real standard initialization and compaction service coverage alongside minimal preset checks.

## 0.3.1

- New agents default to the standard preset with automatic context compaction and tool-result pruning.
- Explicit presets and existing session configurations remain unchanged on follow-up and restart.

## 0.3.0

- Added compact MCP projections for starts, follow-ups, status, waits, lists, and events.
- Default events contain assistant-visible text only; tool summaries and targeted full tool records are explicit.
- Added bounded event pages with continuation cursors for large assistant messages.
- Added `legacy: true` compatibility projections for status, list, wait, start, and follow-up.
