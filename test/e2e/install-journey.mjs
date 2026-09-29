// Installation-only user journey. Real npm package and real dependencies; no
// provider credentials, model request, mock CLI or simulated service.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {commandSpec} from '../../src/commands.mjs';
import {temporaryDirectory} from '../../src/platform.mjs';

const {values} = parseArgs({options: {package: {type: 'string'}, output: {type: 'string'}}});
assert.ok(values.package && values.output, 'Pass --package candidate.tgz --output report.json');
const root = mkdtempSync(join(temporaryDirectory(), 'dsh-install-journey-'));
const project = join(root, 'Project space 雪');
mkdirSync(project);
const env = {...process.env, DSH_SUBAGENT_DATA: join(root, 'data'), DSH_SUBAGENT_CONFIG: join(root, 'config'),
  DSH_SUBAGENT_STATE: join(root, 'state'), DSH_HOME: join(root, 'dsh-home'), CODEX_HOME: join(root, 'codex-home')};
for (const key of Object.keys(env)) if (/^(DEEPSEEK_|OPENAI_|AZURE_OPENAI_|DSH_CODEX_|DSH_CLI$|CODEX_THREAD_ID$|NODE_TEST_CONTEXT$)/.test(key)) delete env[key];
const [npm, ...prefix] = commandSpec('npm');
const npmArgs = [...prefix, 'exec', '--yes', '--package=' + resolve(values.package), '--', 'dsh-subagent-mcp'];
const report = {platform: process.platform, node: process.version, ok: false, modelRequests: 'not exercised', checks: []};
const run = (args = [], statuses = [0]) => {
  const result = spawnSync(npm, [...npmArgs, ...args], {cwd: project, env, encoding: 'utf8', timeout: 480000});
  assert.equal(result.error, undefined);
  assert.ok(statuses.includes(result.status), result.stdout + result.stderr);
  return result.stdout + result.stderr;
};
const assertNoSession = () => {
  const directory = join(env.DSH_SUBAGENT_STATE, 'codex');
  assert.ok(!existsSync(directory) || readdirSync(directory).length === 0, 'An installation must not start a Codex work session');
};
let installed;
try {
  const text = run();
  installed = JSON.parse(readFileSync(join(env.DSH_SUBAGENT_CONFIG, 'installation.json'), 'utf8'));
  assertNoSession();
  assert.doesNotMatch(text, /Ask Codex to do anything|Disconnected from this task/);
  assert.match(text, /Installation complete|Installed|already installed/i);
  assert.match(text, /npx -y dsh-subagent-mcp@latest codex/);
  assert.match(text, /dsh-subagent-mcp@latest login|codex login/);
  assert.match(text, /DEEPSEEK_API_KEY|provider/i);
  report.checks.push({journey: 'new user installs without credentials', returnedToShell: true,
    noWorkSessionStarted: true, explicitWorkCommand: true, accountNextStepsShown: true});
  run();
  assertNoSession();
  report.checks.push({journey: 'repeat the install command', returnedToShell: true, noWorkSessionStarted: true});
  const doctor = run(['doctor', '--json'], [0, 1]);
  const health = JSON.parse(doctor.slice(doctor.indexOf('{')));
  const accounts = health.checks.filter(check => /account|login|provider/i.test(check.name));
  assert.ok(accounts.length >= 2, 'Doctor must distinguish Codex and DSH account readiness');
  assert.ok(accounts.every(check => check.status !== 'ok'), 'An empty account configuration cannot be reported as connected');
  report.checks.push({journey: 'check readiness before first task', missingAccountsVisible: true, accounts});
  run(['codex', '--help']);
  assertNoSession();
  report.checks.push({journey: 'inspect the suggested work command', helpWorksWithoutLogin: true});
  run(['uninstall']);
  assert.ok(!existsSync(join(env.DSH_SUBAGENT_CONFIG, 'installation.json')));
  report.checks.push({journey: 'uninstall', installationRemoved: true});
  report.ok = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  // Cleanup is limited to this isolated installation, even after a failed step.
  if (installed && existsSync(join(installed.root, 'src/cli.mjs')))
    spawnSync(process.execPath, [join(installed.root, 'src/cli.mjs'), 'stop', '--force'], {env, timeout: 40000, stdio: 'ignore'});
  mkdirSync(resolve(values.output, '..'), {recursive: true});
  writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  rmSync(root, {recursive: true, force: true});
}
