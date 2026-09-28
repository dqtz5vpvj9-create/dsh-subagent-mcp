# Native Codex callback validation

The 2026-09-28 live test used Codex CLI 0.157.1 with the running App Server
0.157.0. It checked the same `turn/start.toolOutput` protocol used by the
callback adapter.

| Case | Observed result |
| --- | --- |
| Parent active | One `function_call_output` entered the existing turn |
| Real DSH task | Completed a shell delay and returned the expected result |
| Parent idle | Automatically started the next turn from tool output |
| Waiting | Parent telemetry showed no token usage while Codex was idle |
| User interaction | Delivery required no follow-up message from the user |

The result arrived inline, followed by one evidence review. The parent rollout
was checked for token usage between the end of its turn and completion delivery.
Setup, dispatch, wakeup and acceptance consume model tokens and are outside that
waiting period. This sample does not establish a total savings percentage, native
task-panel rendering, cancellation races or restart recovery.

Raw rollout evidence was retained locally; it is not shipped in the package.
The automated tests cover native framing, parent preflight, failure
without automatic retry, one unbounded wait, independent child completion,
cancellation, full-result retention and explicit queue compatibility.

After integration, the installed skill's default `codex_notify.py --agent …`
path was also exercised against that completed DSH agent. It delivered through
the packaged WebSocket adapter as `dsh_completion` in the active parent turn;
the receipt recorded `delivery: tool-output` and `status: delivered`. This
integration check reused the saved child result and made no new DSH model call.
