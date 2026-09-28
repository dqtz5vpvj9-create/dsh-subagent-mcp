# Real end-to-end release acceptance

The `Real end-to-end release acceptance` GitHub Actions workflow is the publication
gate. It runs the packed candidate through npm in a real Windows terminal on both
`win` and `dorm`, using the machines' existing Codex accounts and DSH providers.
Both Codex and DeepSeek make real model requests.

For each host, the workflow installs the candidate and opens Codex. Codex delegates
a file-writing task through MCP, registers the host listener through `dsh_watch`, and
yields. The listener delivers native completion tool output. Codex then reads the
child's file and replies with the verified contents. The test checks the exact
bytes on disk, the parent's read call and tool output, and its final acceptance
reply. Delegation and exactly one native callback must appear in the real parent
rollout, alongside an observed pending callback receipt. This works with a
read-only parent; the explicitly authorized DSH child writes the artifact.
It also checks that the parent finishes its waiting turn before the callback and
finishes its acceptance turn before the terminal is closed. A dropped SSH
observer reconnects without sending the model prompt again.

The workflow then closes Codex, restarts the background service, opens Codex again,
and continues the same DSH agent for another task. Both hosts must pass both rounds.
Before reopening, it installs the previous public release (0.6.1) as an upgrade
fixture. Explicit dependency paths let that old installer run despite its known
Windows shim bug. The candidate then receives no setup flags: the single launch
command must upgrade the old installation and retain the delegated conversation.
The terminal driver accepts only one-time approvals for the requested DSH tools;
it leaves the host's sandbox and approval settings in place.
Only then can the publish step upload the exact tested tarball to npm.

## Running the gate

The trusted Linux controller needs Node.js 24+, GitHub CLI, Python with `pexpect`,
the official GitHub Actions runner, and working SSH aliases `win` and `dorm`.
The Windows hosts need PowerShell 7 and their normal provider accounts configured.
The test preserves credentials and task history. It refuses to replace an
installation with active DSH tasks. Acceptance reinstalls the bridge on these
hosts, so run it when they are available for release validation.

```sh
python3 test/e2e/dispatch.py --runner /path/to/actions-runner
```

Add `--publish` to publish after acceptance succeeds. The helper registers a
one-job runner with a unique label and dispatches the workflow from `main`.
Credentials stay on their respective machines; no model or SSH credentials are
uploaded to GitHub. Pull requests do not trigger this trusted workflow.

The workflow uploads assertion reports as `real-codex-dsh-acceptance`. Terminal
transcripts stay private on the controller under
`/mnt/cache/data-cache/dsh-release-e2e`. Reports identify each host, DSH agent,
Codex parent, callback result, artifact checks, and service restart. A missing
result or failed assertion fails the job and prevents publication.
