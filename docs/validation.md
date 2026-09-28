# Validation

## 0.6.0 cross-platform installation — 2026-09-28

The [native CI matrix](https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp/actions/runs/36398283382)
passed on all three operating systems with Node.js 24. Each platform ran
71 unit and integration tests, a fresh-install test, and two real DSH runtime
tests. Linux and macOS also ran the 12 legacy Python compatibility tests.

| Platform | Verified service backends | Fresh dependency installation |
| :--- | :--- | :--- |
| Windows | Scheduled Task and background process | Codex CLI 0.158.0 and DSH 0.1.5-rc.1 |
| macOS | launchd and background process | Codex CLI 0.158.0 and DSH 0.1.5-rc.1 |
| Linux | systemd user service and background process | Codex CLI 0.158.0 and DSH 0.1.5-rc.1 |

Packed-package tests cover paths containing spaces, Unicode and `&`, real native
service registration, MCP discovery, restart after deleting the npx cache,
rollback after a failed Codex registration, and uninstall that retains history
and provider settings. Windows additionally checks private credential ACLs and
rejection of unauthenticated bridge connections.

Fresh-install tests download missing dependencies, use the actual Codex CLI to
register and read back the MCP entry, check its native callback protocol schema,
and initialize both real DSH presets with persistence and resume. Provider calls
are not part of these installation tests.

The Node.js listener tests cover independent completions, cancellation, task
errors, context exhaustion, loss of delivery acknowledgement, and full saved
results. Launcher tests cover authenticated connections, argument forwarding,
exit status and credential cleanup. A separate local check used the actual
Codex App Server to accept an authenticated connection and reject an
unauthenticated one.

The native matrix verifies installation and protocol behavior. Model-driven
parent wakeup was previously exercised on Linux as recorded below; this release
does not claim a separate live-model wakeup measurement on Windows or macOS.

## 0.5.0 release checks — 2026-09-28

`TMPDIR=/mnt/cache/data-cache DSH_RUNTIME_TEST=1 DSH_PACKAGE_TEST=1 npm test`
passed all **58 Node.js tests and 12 Python tests**, with no skips, on Linux,
Node.js 24.19.0 and DSH 0.1.5-rc.1. This includes real DSH preset initialization
and persistence, native callback protocol behavior, and installation from a
packed npm artifact into an isolated home with stubbed service/client commands.
The package test checks that the installed runtime survives removal of its
original package cache. It does not restart the production service.

## Native Codex completion — 2026-09-28

The current callback path was exercised with both active and idle parent turns.
An idle parent waited without spending GPT quota and resumed automatically when
the result arrived. See [the callback validation record](codex-callback-validation.md)
for versions, method, and scope. `npm test` now includes the WebSocket adapter
and detached Node.js listener tests, with legacy Python checks on POSIX systems.

## Initial bridge validation — 2026-09-12

Tested on Linux with Node 24.19.0, DSH 0.1.5-rc.1 and Codex CLI 0.154.0.

### Automated regression tests

`npm test` covers independent agents, incremental event cursors, busy follow-up rejection, cancellation continuity, incomplete termination, descendant/root result separation, and restart without automatic replay.

### Real DSH and MCP tests

`test/live.mjs` exercises the manager against a real DSH runtime:

- A second question recovers a token from the first turn.
- Closing and recreating the runtime still permits recovery of the same token.
- Tool-start events are visible before completion.
- Cancellation reaches idle with DSH's `aborted` / `user` finish reason.
- The interrupted conversation accepts a new task.

`test/mcp-live.mjs` uses the official MCP client through the deployed stdio proxy:

- Discovers all eight tools.
- Disconnects and reconnects while work is running.
- Verifies a real file write and a follow-up about it.
- Attempts a write under read-only permissions and checks that no file was created.
- Cancels an active tool call and continues the same conversation.

These paths passed during development. Tests make real provider calls; they are not run in CI. Generated raw reports and local session identifiers are excluded from the public repository.

### Scope of the initial tests

Codex's MCP registration was verified. A separate model-driven smoke test in a fresh standalone Codex CLI failed with an OpenAI authentication error before making its tool call. We therefore distinguish successful MCP-client-to-DSH validation from unverified model-driven use in that standalone Codex environment.

No speed, cost, or coding-accuracy advantage is claimed by these lifecycle tests. That release used the original Linux-only installer. Current cross-platform validation is described above.
