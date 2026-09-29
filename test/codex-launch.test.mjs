import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../src/platform.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

for (const scenario of [
  {name: 'an explicit plain Codex launch', args: [], code: 0},
  {name: 'project paths, configuration and a nonzero exit', args: ['--cd', 'A folder 雪', '--model', 'test-model', '-c', 'approval_policy="on-request"'], code: 7},
  {name: 'the ordinary Codex resume command', args: ['resume', '01a0eb42-386d-7582-bcef-a37bcd88acae'], code: 0},
]) test(`Codex entrypoint preserves ${scenario.name}`, () => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-launch-'));
  const project = join(root, 'Project space 雪'), config = join(root, 'config');
  mkdirSync(project); mkdirSync(config);
  const fake = join(root, 'codex fixture.mjs'), report = join(root, 'calls.jsonl');
  writeFileSync(fake, `
import {appendFileSync} from 'node:fs';
appendFileSync(process.env.LAUNCH_REPORT, JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(),
  privateConnection: process.env.DSH_CODEX_CONNECTION,
  privateRemote: process.env.DSH_CODEX_REMOTE,
  privateToken: process.env.DSH_CODEX_TOKEN
}) + '\\n');
process.exit(Number(process.env.LAUNCH_EXIT));
`);
  // Launching an existing installation must not trigger an implicit upgrade.
  const record = {version: '0.0.1', codex: [process.execPath, fake]};
  writeFileSync(join(config, 'installation.json'), JSON.stringify(record));
  const env = {...process.env, DSH_SUBAGENT_CONFIG: config, DSH_SUBAGENT_STATE: join(root, 'state'), LAUNCH_REPORT: report, LAUNCH_EXIT: String(scenario.code)};
  for (const name of ['SSH_CONNECTION', 'DSH_CODEX_CONNECTION', 'DSH_CODEX_REMOTE', 'DSH_CODEX_TOKEN']) delete env[name];
  try {
    const result = spawnSync(process.execPath, [cli, 'codex', ...scenario.args], {cwd: project, env, encoding: 'utf8', timeout: 10000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, scenario.code, result.stderr);
    const calls = readFileSync(report, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(calls, [{args: scenario.args, cwd: realpathSync(project)}]);
    assert.deepEqual(JSON.parse(readFileSync(join(config, 'installation.json'), 'utf8')), record);
    assert.equal(existsSync(join(root, 'state', 'codex')), false);
    assert.doesNotMatch(result.stdout + result.stderr, /ws:\/\/|DSH_CODEX_TOKEN|First run:|Updating DSH/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('a missing Codex executable fails without creating private session state', () => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-launch-missing-'));
  const config = join(root, 'config'); mkdirSync(config);
  writeFileSync(join(config, 'installation.json'), JSON.stringify({codex: [join(root, 'absent.exe')]}));
  const env = {...process.env, DSH_SUBAGENT_CONFIG: config, DSH_SUBAGENT_STATE: join(root, 'state')};
  delete env.SSH_CONNECTION;
  try {
    const result = spawnSync(process.execPath, [cli, 'codex'], {env, encoding: 'utf8', timeout: 10000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT|not found/);
    assert.equal(existsSync(join(root, 'state', 'codex')), false);
  } finally {rmSync(root, {recursive: true, force: true});}
});
