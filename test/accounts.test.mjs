import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync, writeFileSync, rmSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {codexAccount, hiddenInput} from '../src/accounts.mjs';
import {temporaryDirectory} from '../src/platform.mjs';

test('login diagnostics never repeat account command output or key values', t => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-account-diagnostic-'));
  t.after(() => rmSync(root, {recursive: true}));
  const cli = join(root, 'codex.mjs');
  writeFileSync(cli, 'console.error("Logged in using API key: SECRET_FIXTURE");');
  const report = codexAccount([process.execPath, cli]);
  assert.equal(report.status, 'configured');
  assert.ok(!JSON.stringify(report).includes('SECRET_FIXTURE'));
  writeFileSync(cli, 'console.error("Not logged in"); process.exitCode=1;');
  assert.equal(codexAccount([process.execPath, cli]).status, 'missing');
  writeFileSync(cli, 'console.error("Unexpected account error: SECRET_FIXTURE"); process.exitCode=2;');
  const unknown = codexAccount([process.execPath, cli]);
  assert.equal(unknown.status, 'unknown');
  assert.ok(!JSON.stringify(unknown).includes('SECRET_FIXTURE'));
});

test('interactive key entry hides pasted secrets and restores terminal on cancellation', async () => {
  const input = new EventEmitter();
  input.isTTY = true; input.isRaw = false; input.paused = true;
  input.isPaused = () => input.paused;
  input.setRawMode = value => {input.isRaw = value;};
  input.pause = () => {input.paused = true;};
  input.resume = () => {input.paused = false;};
  let printed = '';
  const output = {isTTY: true, write: text => {printed += text;}};
  const entry = hiddenInput('API key: ', {input, output});
  input.emit('data', Buffer.from('\x1b[200~PRIVATE_KEY\x1b[201~\r'));
  assert.equal(await entry, 'PRIVATE_KEY');
  assert.equal(printed, 'API key: \n');
  assert.equal(input.isRaw, false); assert.equal(input.paused, true);
  const cancelled = hiddenInput('API key: ', {input, output});
  input.emit('data', Buffer.from('OTHER_PRIVATE_KEY\u0003'));
  await assert.rejects(cancelled, /Cancelled/);
  assert.equal(input.isRaw, false); assert.equal(input.paused, true);
  assert.ok(!printed.includes('PRIVATE_KEY'));
});

test('public configure refuses noninteractive key entry and captures secrets only when requested', t => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-configure-'));
  t.after(() => rmSync(root, {recursive: true}));
  const env = {...process.env, DSH_SUBAGENT_CONFIG: root, DSH_SUBAGENT_STATE: join(root, 'state'), DEEPSEEK_API_KEY: 'CAPTURE_ONLY_FIXTURE'};
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const blocked = spawnSync(process.execPath, [cli, 'configure'], {env, encoding: 'utf8', input: ''});
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /interactive terminal/);
  const output = execFileSync(process.execPath, [cli, 'configure', '--capture-key'], {env, encoding: 'utf8'});
  assert.ok(!output.includes('CAPTURE_ONLY_FIXTURE'));
  assert.equal(JSON.parse(readFileSync(join(root, 'provider.json'), 'utf8')).DEEPSEEK_API_KEY, 'CAPTURE_ONLY_FIXTURE');
  if (process.platform !== 'win32') assert.equal(statSync(join(root, 'provider.json')).mode & 0o777, 0o600);
});
