import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, mkdirSync, readFileSync, realpathSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {projectRoot} from '../src/config.mjs';
import {runCommand} from '../src/commands.mjs';
import {temporaryDirectory} from '../src/platform.mjs';

for (const service of process.env.DSH_NATIVE_SERVICE_TEST === '1' ? ['background', 'auto'] : ['background'])
test(`packed ${service} installation survives cache removal, rolls back failed upgrade, and uninstalls without losing history`, {skip: process.env.DSH_PACKAGE_TEST !== '1', timeout: 180000}, () => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-package-'));
  const folder = join(root, 'User space 雪 & data'); mkdirSync(folder);
  const config = join(folder, 'config'), state = join(folder, 'state');
  const codexState = join(folder, 'codex-mcp.json'), failOnce = join(folder, 'fail-once');
  const dsh = join(folder, 'dsh.mjs'), codex = join(folder, 'codex.mjs');
  writeFileSync(dsh, '// Profile initialization fixture. Runtime lifecycle is tested separately.\n');
  writeFileSync(codex, `import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
const a=process.argv.slice(2), path=${JSON.stringify(codexState)}, fail=${JSON.stringify(failOnce)};
if(a[0]==='--version')console.log('codex fixture');
else if(a[0]==='mcp'&&a[1]==='add'){
 if(existsSync(fail)){unlinkSync(fail);console.error('registration fixture failure');process.exit(2);}
 const i=a.indexOf('--');writeFileSync(path,JSON.stringify({transport:{command:a[i+1],args:a.slice(i+2)}}));
}else if(a[0]==='mcp'&&a[1]==='get')console.log(readFileSync(path,'utf8'));
else if(a[0]==='mcp'&&a[1]==='remove')unlinkSync(path);
else process.exit(3);
`);
  const env = {...process.env, DSH_SUBAGENT_DATA: join(folder, 'data'), DSH_SUBAGENT_CONFIG: config, DSH_SUBAGENT_STATE: state,
    DSH_HOME: join(folder, 'dsh-home'), CODEX_HOME: join(folder, 'codex-home'), DSH_CLI: dsh, DSH_CODEX_CLI: codex, DEEPSEEK_API_KEY: 'fixture-private-key'};
  for (const key of ['CODEX_THREAD_ID', 'DSH_CODEX_REMOTE', 'DSH_CODEX_TOKEN', 'DSH_CODEX_CONNECTION']) delete env[key];
  const run = (entry, ...args) => execFileSync(process.execPath, [entry, ...args], {env, encoding: 'utf8', stdio: 'pipe', timeout: 120000});
  let installed;
  try {
    const [pack] = JSON.parse(runCommand('npm', ['pack', projectRoot, '--pack-destination', root, '--json', '--ignore-scripts'], {stdio: 'pipe', encoding: 'utf8'}));
    const cache = join(folder, 'npx cache'); mkdirSync(cache);
    runCommand('npm', ['install', '--prefix', cache, '--ignore-scripts', '--no-audit', '--no-fund', join(root, pack.filename)], {stdio: 'pipe'});
    const entry = join(cache, 'node_modules/dsh-subagent-mcp/src/cli.mjs');
    const output = run(entry, 'setup', '--service', service, '--capture-key', '--no-install-deps');
    assert.match(output, /Installation complete/); assert.ok(!output.includes('fixture-private-key'));
    const record = JSON.parse(readFileSync(join(config, 'installation.json'), 'utf8'));
    installed = join(record.root, 'src/cli.mjs');
    if (service === 'background') assert.equal(record.backend, 'background');
    console.log('Validated service backend:', record.backend, 'on', process.platform);
    assert.ok(record.root.startsWith(join(env.DSH_SUBAGENT_DATA, 'versions')));
    assert.equal(realpathSync(join(env.CODEX_HOME, 'skills/dsh-subagent')), realpathSync(join(record.root, 'skills/dsh-subagent')));
    assert.ok(!readFileSync(join(config, 'installation.json'), 'utf8').includes('fixture-private-key'));
    assert.equal(JSON.parse(readFileSync(join(config, 'provider.json'), 'utf8')).DEEPSEEK_API_KEY, 'fixture-private-key');
    assert.equal(JSON.parse(run(installed, 'doctor', '--json')).ok, true);
    writeFileSync(failOnce, '');
    assert.throws(() => run(entry, 'setup', '--service', service, '--no-install-deps'), /registration fixture failure/);
    assert.deepEqual(JSON.parse(readFileSync(join(config, 'installation.json'), 'utf8')), record);
    assert.equal(JSON.parse(run(installed, 'status', '--json')).running, true);
    rmSync(cache, {recursive: true});
    run(installed, 'stop'); run(installed, 'start');
    assert.equal(JSON.parse(run(installed, 'doctor', '--json')).ok, true);
    writeFileSync(join(state, 'retained-evidence.txt'), 'keep');
    run(installed, 'uninstall');
    assert.ok(!existsSync(join(config, 'installation.json')));
    assert.ok(!existsSync(join(env.CODEX_HOME, 'skills/dsh-subagent')));
    assert.ok(!existsSync(codexState));
    assert.equal(readFileSync(join(state, 'retained-evidence.txt'), 'utf8'), 'keep');
    assert.ok(existsSync(join(config, 'provider.json')));
    assert.ok(!existsSync(join(state, 'daemon.lock')));
  } catch(error) {
    const log=join(state,'daemon.log');
    if(existsSync(log))console.error('Service diagnostic:',readFileSync(log,'utf8'));
    throw error;
  } finally {
    if (installed && existsSync(installed)) {try {run(installed, 'stop', '--force');} catch {}}
    rmSync(root, {recursive: true, force: true});
  }
});
