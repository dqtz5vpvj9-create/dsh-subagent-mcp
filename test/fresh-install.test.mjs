import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {temporaryDirectory} from '../src/platform.mjs';
import {codexHttpAcceptance} from './e2e/codex-http.mjs';

test('fresh setup installs real dependencies, registers Codex, and runs real DSH presets',
  {skip: process.env.DSH_FRESH_INSTALL_TEST !== '1', timeout: 1200000}, async () => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-fresh-'));
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const env = {...process.env, DSH_SUBAGENT_DATA: join(root, 'data'), DSH_SUBAGENT_CONFIG: join(root, 'config'),
    DSH_SUBAGENT_STATE: join(root, 'state'), DSH_HOME: join(root, 'dsh-home'), CODEX_HOME: join(root, 'codex-home'),
    DEEPSEEK_API_KEY: 'unused-runtime-fixture-key'};
  for (const key of ['DSH_CLI', 'DSH_CODEX_CLI', 'CODEX_THREAD_ID', 'DSH_CODEX_REMOTE', 'DSH_CODEX_TOKEN', 'DSH_CODEX_CONNECTION', 'NODE_TEST_CONTEXT']) delete env[key];
  const run = (file, args, overrides = {}, options = {}) => {
    const result = spawnSync(file, args, {env: {...env, ...overrides}, encoding: 'utf8', timeout: 360000, ...options});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  let installed;
  try {
    // A cold Windows runner installs hundreds of real dependency packages.
    // Give that download its own budget; tool calls keep their shorter limits.
    run(process.execPath, [cli, 'setup', '--service', 'background'], {}, {stdio: 'inherit', timeout: 900000});
    const record = JSON.parse(readFileSync(join(env.DSH_SUBAGENT_CONFIG, 'installation.json'), 'utf8'));
    installed = join(record.root, 'src/cli.mjs');
    console.log('Checking the installed commands and Codex registration…');
    assert.ok(existsSync(record.dsh));
    assert.equal(JSON.parse(run(process.execPath, [installed, 'doctor', '--json'])).ok, true);
    assert.match(run(process.execPath, [installed, 'dsh', '--version']), /0\.1\./);
    const [codex, ...prefix] = record.codex;
    const registration = JSON.parse(run(codex, [...prefix, 'mcp', 'get', 'dsh_subagent', '--json']));
    assert.equal(registration.transport.type,'streamable_http');
    assert.match(registration.transport.url,/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.ok(registration.transport.http_headers.Authorization.startsWith('Bearer '));
    await codexHttpAcceptance(record,env,root);
    const schemas = join(root, 'schemas');
    console.log('Checking the installed Codex callback protocol…');
    run(codex, [...prefix, 'app-server', 'generate-json-schema', '--experimental', '--out', schemas]);
    const protocol = JSON.parse(readFileSync(join(schemas, 'v2/TurnStartParams.json'), 'utf8'));
    assert.ok(protocol.properties.toolOutput, 'Installed Codex must support native completion callbacks');
    console.log('Checking real DSH presets and persistence…');
    const runtime = run(process.execPath, ['--test', '--test-reporter=tap', fileURLToPath(new URL('./runtime.test.mjs', import.meta.url))], {DSH_RUNTIME_TEST: '1', DSH_CLI: record.dsh});
    assert.match(runtime, /# pass 2/);
    console.log(runtime);
    console.log('Fresh installation verified on', process.platform, 'with', run(codex, [...prefix, '--version']).trim());
    run(process.execPath, [installed, 'uninstall']);
    assert.ok(!existsSync(join(env.DSH_SUBAGENT_CONFIG, 'installation.json')));
    // Uninstall can also remove the managed Codex executable.
    assert.ok(!/^\[mcp_servers\.(?:dsh_subagent|"dsh_subagent")\]/m.test(readFileSync(join(env.CODEX_HOME,'config.toml'),'utf8')));
  } catch (error) {
    const log = join(env.DSH_SUBAGENT_STATE, 'daemon.log');
    if (existsSync(log)) console.error(readFileSync(log, 'utf8'));
    throw error;
  } finally {
    if (installed && existsSync(installed)) spawnSync(process.execPath, [installed, 'stop', '--force'], {env, timeout: 40000});
    rmSync(root, {recursive: true, force: true});
  }
});
