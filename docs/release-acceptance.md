# Real end-to-end release acceptance

The `Real end-to-end release acceptance` GitHub Actions workflow is the publication
gate. It runs the packed candidate through npm in a real Windows terminal on both
`win` and `dorm`, using the machines' existing Codex accounts and DSH providers.
Both Codex and DeepSeek make real model requests.

For each host, the workflow installs the candidate and opens Codex. Codex delegates
a file-writing task through MCP, registers the packaged completion listener, and
yields. The listener delivers native completion tool output. Codex then reads the
child's file and writes a separate acceptance artifact. The test requires the
delegation and native callback to appear in the actual parent rollout, as well as
a pending callback receipt and the expected contents of both files.

The workflow then closes Codex, restarts the background service, opens Codex again,
and continues the same DSH agent for another task. Both hosts must pass both rounds.
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
