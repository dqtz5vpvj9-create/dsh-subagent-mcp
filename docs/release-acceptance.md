# Release acceptance follows the user journey

The release workflow tests installation and a real delegated task from the
public entry points. A successful model request alone does not satisfy the gate.
The candidate is packed once. Every installation job, the real model jobs and the
publication step use that same artifact. Publication depends on all three
platform installation jobs and both real Windows journeys passing.

## What the gate requires

On fresh Windows, Linux and macOS CI machines, the packed npm command runs with
isolated settings and no Codex or DeepSeek credentials. It must install, explain
account readiness and the next step, then return to the shell. It must not open a
Codex task. On Linux and macOS the first installation runs in a real terminal:
the driver presses Enter at the optional hidden-key prompt and requires a normal
process exit without Ctrl+C. Repeating the command must have the same meaning. The test also runs
the suggested work command's help, checks account status and uninstalls. These
jobs use real dependency packages and real service initialization. They do not
validate a provider login or make model requests.

On `win` and `dorm`, the controller follows the public commands in a real Windows
terminal. These two machines already have working accounts. Codex and DeepSeek
both make real model requests:

1. Install the candidate and confirm that installation returns to the shell.
   Install the actual previous public release, `0.6.2`, while idle, then use the
   candidate installation command to upgrade it. Run the public `configure`
   command in the terminal, press Enter to cancel, and require a normal exit
   with the existing provider settings untouched.
2. Explicitly open ordinary Codex in a directory containing spaces and non-ASCII
   text. Give a natural-language task: ask DSH to write a delayed file, then ask
   Codex to read and check it. The prompt supplies no skill name, callback tool
   name, required waiting phrase or polling instructions.
3. Observe the pending delegated task and the end of the parent's waiting turn.
   DSH must complete the task, deliver one native completion, and let the same
   parent read the actual file and report its contents. File bytes, tool calls,
   tool output and final reply must agree.
4. Give a natural follow-up using the same DSH child. Require another real
   completion and parent acceptance. Close Codex after its work finishes; no
   private endpoint or bearer-token command may be shown as a user next step.
5. In a separate ordinary Codex invocation, require approval for `dsh_start`
   through a per-tool `approval_mode="prompt"` override. Reject the real prompt.
   No DSH child or requested file may be created, and the parent must finish its
   response. This invocation never changes the user's global approval settings.
6. Restart the integration service while idle and check that it is usable again.

The driver may choose **Allow once** for the task the test explicitly requested.
Each such choice is recorded. It never chooses session-wide or permanent
approval. An unexpected confirmation fails the journey for review instead of
being accepted blindly. The permission-refusal case is required, not a skipped
case counted as success.

Script observations read callback receipts and the saved parent transcript.
They do not send progress prompts to either model. The idle interval must contain
no extra parent turn before completion, but that assertion is not a measurement
of billable tokens. Ordinary Codex owns its terminal and conversation history;
this integration does not introduce a second parent-session or resume system.

The gate separates the evidence boundaries: Windows real-model journeys reuse
configured accounts; three-platform fresh installs cover missing accounts but
do not complete sign-in. It does not claim that a human has used the product, or
that real-model macOS and Linux journeys have been exercised. An independent
README walkthrough remains a separate review.

## Running the gate

The trusted Linux controller needs Node.js 24+, GitHub CLI, Python with `pexpect`,
the official GitHub Actions runner, and working SSH aliases `win` and `dorm`.
The Windows controller scripts use PowerShell 7. The acceptance hosts need their
normal provider accounts configured and must be available for reinstalling the
integration. Credentials and unrelated task history are preserved. An active
unrelated task prevents preparation rather than being interrupted.

```sh
python3 test/e2e/dispatch.py --runner /path/to/actions-runner
```

Add `--publish` to publish after every gate succeeds. The helper registers a
one-job runner with a unique label and dispatches the workflow from `main`.
The runner waits while GitHub-hosted installation jobs finish. Pull requests
cannot dispatch this workflow with its trusted host access.

GitHub artifacts contain the installation reports and
`real-codex-dsh-acceptance` assertion reports. Terminal transcripts stay private
on the controller under `/mnt/cache/data-cache/dsh-release-e2e`. Reports identify
which user actions were exercised and where a failed journey stopped. They
contain no account credentials, callback tokens or private terminal transcript.
