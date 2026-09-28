import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {temporaryDirectory} from '../src/platform.mjs';

test('fresh setup installs real dependencies, registers Codex, and runs real DSH presets',
  {skip: process.env.DSH_FRESH_INSTALL_TEST !== '1', timeout: 480000}, () => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-fresh-'));
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const env = {...process.env, DSH_SUBAGENT_DATA: join(root, 'data'), DSH_SUBAGENT_CONFIG: join(root, 'config'),
    DSH_SUBAGENT_STATE: join(root, 'state'), DSH_HOME: join(root, 'dsh-home'), CODEX_HOME: join(root, 'codex-home'),
    DEEPSEEK_API_KEY: 'unused-runtime-fixture-key'};
  for (const key of ['DSH_CLI', 'DSH_CODEX_CLI', 'CODEX_THREAD_ID', 'DSH_CODEX_REMOTE', 'DSH_CODEX_TOKEN', 'DSH_CODEX_CONNECTION', 'NODE_TEST_CONTEXT']) delete env[key];
  const run = (file, args, overrides = {}) => {
    const result = spawnSync(file, args, {env: {...env, ...overrides}, encoding: 'utf8', timeout: 360000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  let installed;
  try {
    const output = run(process.execPath, [cli, 'setup', '--service', 'background']);
    assert.match(output, /Installation complete/);
    const record = JSON.parse(readFileSync(join(env.DSH_SUBAGENT_CONFIG, 'installation.json'), 'utf8'));
    installed = join(record.root, 'src/cli.mjs');
    assert.ok(existsSync(record.dsh));
    assert.equal(JSON.parse(run(process.execPath, [installed, 'doctor', '--json'])).ok, true);
    assert.match(run(process.execPath, [installed, 'dsh', '--version']), /0\.1\./);
    const [codex, ...prefix] = record.codex;
    const registration = JSON.parse(run(codex, [...prefix, 'mcp', 'get', 'dsh_subagent', '--json']));
    assert.ok(registration.transport.args.includes(installed));
    const schemas = join(root, 'schemas');
    run(codex, [...prefix, 'app-server', 'generate-json-schema', '--experimental', '--out', schemas]);
    const protocol = JSON.parse(readFileSync(join(schemas, 'v2/TurnStartParams.json'), 'utf8'));
    assert.ok(protocol.properties.toolOutput, 'Installed Codex must support native completion callbacks');
    const runtime = run(process.execPath, ['--test', '--test-reporter=tap', fileURLToPath(new URL('./runtime.test.mjs', import.meta.url))], {DSH_RUNTIME_TEST: '1', DSH_CLI: record.dsh});
    assert.match(runtime, /# pass 2/);
    console.log(runtime);
    console.log('Fresh installation verified on', process.platform, 'with', run(codex, [...prefix, '--version']).trim());
    run(process.execPath, [installed, 'uninstall']);
    assert.ok(!existsSync(join(env.DSH_SUBAGENT_CONFIG, 'installation.json')));
  } catch (error) {
    const log = join(env.DSH_SUBAGENT_STATE, 'daemon.log');
    if (existsSync(log)) console.error(readFileSync(log, 'utf8'));
    throw error;
  } finally {
    if (installed && existsSync(installed)) spawnSync(process.execPath, [installed, 'stop', '--force'], {env, timeout: 40000});
    rmSync(root, {recursive: true, force: true});
  }
});
