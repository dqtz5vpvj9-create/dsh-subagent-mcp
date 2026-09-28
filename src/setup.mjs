import {existsSync, readFileSync, lstatSync, realpathSync, symlinkSync, unlinkSync, rmSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {projectRoot, resolveDshCli} from './config.mjs';
import {locations, installation, installationFile, privateDirectory, writeJson, readJson} from './platform.mjs';
import {commandSpec, packageEntry, runCommand} from './commands.mjs';
import {installPackage} from './install-package.mjs';
import {backendDefault, installService, startService, stopService, statusService, removeService} from './service.mjs';
import {bridgeClient} from './bridge-client.mjs';

export const TESTED_DSH = '0.1.5-rc.1';
const version = () => JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;

function skillTarget() {return join(locations().codex, 'skills/dsh-subagent');}
function existingSkill() {try {return lstatSync(skillTarget());} catch (error) {if (error.code !== 'ENOENT') throw error; return null;}}
function ownsSkill() {
  if (!existingSkill()?.isSymbolicLink()) return false;
  try {return JSON.parse(readFileSync(join(realpathSync(skillTarget()), '../..', 'package.json'), 'utf8')).name === 'dsh-subagent-mcp';}
  catch {return false;}
}

function ensureDependencies(installMissing) {
  const prefix = join(locations().data, 'dependencies');
  let dsh, codex;
  try {dsh = resolveDshCli();} catch (error) {if (process.env.DSH_CLI) throw error;}
  try {codex = commandSpec('codex', {prefix, explicit: process.env.DSH_CODEX_CLI});} catch (error) {if (process.env.DSH_CODEX_CLI) throw error;}
  const missing = [...(!dsh ? [`@deepseek-ai/dsh@${TESTED_DSH}`] : []), ...(!codex ? ['@openai/codex'] : [])];
  if (missing.length) {
    if (!installMissing) throw new Error('Missing dependencies: ' + missing.join(', ') + '. Rerun setup without --no-install-deps.');
    console.log('Installing missing dependencies for this user: ' + missing.join(', '));
    // A private package.json lets subsequent installs retain both dependencies.
    privateDirectory(prefix);
    if (!existsSync(join(prefix, 'package.json'))) writeJson(join(prefix, 'package.json'), {name: 'dsh-subagent-dependencies', private: true});
    runCommand('npm', ['install', '--prefix', prefix, '--save-exact', '--no-audit', '--no-fund', ...missing]);
    dsh ||= packageEntry(prefix, '@deepseek-ai/dsh', 'dsh');
    codex ||= commandSpec('codex', {prefix});
  }
  return {dsh, codex};
}

export function registerCodex(record) {
  const env = ['DSH_SUBAGENT_STATE=' + record.state, 'DSH_SUBAGENT_CONFIG=' + locations().config];
  runCommand(record.codex, ['mcp', 'add', 'dsh_subagent', ...env.flatMap(value => ['--env', value]), '--', record.node, join(record.root, 'src/cli.mjs')]);
}

export async function setup(argv, {source = false} = {}) {
  const {values: args} = parseArgs({args: argv, options: {
    skill: {type: 'boolean'}, 'no-skill': {type: 'boolean'}, 'capture-key': {type: 'boolean'},
    'no-install-deps': {type: 'boolean'}, service: {type: 'string'}, yes: {type: 'boolean'},
  }});
  if (!['linux', 'darwin', 'win32'].includes(process.platform)) throw new Error('Supported systems: Windows, Linux and macOS.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required. Install it from https://nodejs.org/ and rerun setup.');
  const allowed = {linux: ['systemd', 'background'], darwin: ['launchd', 'background'], win32: ['task-scheduler', 'background']}[process.platform];
  const previous = installation();
  const backend = args.service === 'auto' ? backendDefault() : args.service || previous?.backend || backendDefault();
  if (!allowed.includes(backend)) throw new Error('Supported service choices on this system: ' + allowed.join(', '));
  if (!args['no-skill'] && existingSkill() && !ownsSkill()) throw new Error('A custom skill exists at ' + skillTarget() + '. It was preserved. Use --no-skill to keep managing it yourself.');
  const status = await statusService();
  if (status.running && status.active.length) throw new Error('Active DSH tasks are running. Finish or interrupt them before setup or upgrade.');
  const paths = locations();
  const legacy = !previous && process.platform === 'linux' && existsSync(join(paths.state, 'server.sock'));
  if (legacy) {
    let client;
    try {
      client = await bridgeClient();
      for (const status of ['starting', 'running', 'interrupting']) {
        const reply = await client.request('tools/call', {name: 'dsh_list', arguments: {status, limit: 1}});
        if (reply.isError) throw new Error('Cannot inspect the old service safely. Stop it before upgrading.');
        const result = JSON.parse(reply.content[0].text);
        if (result.count || result.items?.length) throw new Error('Active DSH tasks are running in the previous service. Finish them before upgrading.');
      }
    } finally {client?.close();}
  }
  privateDirectory(paths.config); privateDirectory(paths.state); privateDirectory(paths.data);
  console.log(`DSH Subagent MCP ${version()} · ${process.platform}\nPreparing installation…`);
  const dependencies = ensureDependencies(!args['no-install-deps']);
  const providerPath = join(paths.config, 'provider.json');
  if (args['capture-key']) {
    const provider = Object.fromEntries(['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    if (!Object.keys(provider).length) throw new Error('--capture-key requires DEEPSEEK_API_KEY or DEEPSEEK_BASE_URL in this terminal.');
    writeJson(providerPath, {...readJson(providerPath, {}), ...provider});
    console.log('Provider settings saved privately; values are not printed.');
  }
  const profile = join(process.env.DSH_HOME || join((await import('node:os')).homedir(), '.dsh'), 'profiles/codex-subagent/package.json');
  console.log('Preparing the DSH profile…');
  runCommand([process.execPath, dependencies.dsh], ['--profile', 'codex-subagent', ...(existsSync(profile) ? [] : ['--from-default-profile', 'sdk']), '--dump-config'], {stdio: ['ignore', 'ignore', 'pipe']});
  const root = source ? projectRoot : installPackage(projectRoot, join(paths.data, 'versions', version() + '-' + randomUUID().slice(0, 8)));
  const env = Object.fromEntries(['PATH', 'DSH_HOME', 'TMPDIR', 'CODEX_HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'DSH_SUBAGENT_CONFIG', 'DSH_SUBAGENT_DATA'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const record = {version: version(), root, node: process.execPath, ...dependencies, backend, state: paths.state, env, skill: !args['no-skill']};
  console.log('Connecting the background service and Codex…');
  if (legacy) runCommand(['systemctl'], ['--user', 'stop', 'dsh-subagent-mcp.service']);
  await stopService();
  try {
    if (previous && previous.backend !== backend) await removeService(previous);
    writeJson(installationFile(), record);
    try {installService(record);}
    catch (error) {
      if (args.service && args.service !== 'auto') throw error;
      console.warn('Login startup could not be registered: ' + error.message + '\nUsing a background process that starts when Codex connects.');
      record.backend = 'background'; writeJson(installationFile(), record);
    }
    await startService(record);
    registerCodex(record);
    if (record.skill) {
      mkdirSync(join(paths.codex, 'skills'), {recursive: true});
      if (existingSkill()) unlinkSync(skillTarget());
      symlinkSync(join(root, 'skills/dsh-subagent'), skillTarget(), process.platform === 'win32' ? 'junction' : 'dir');
    }
    runCommand([process.execPath, join(root, 'scripts/uninstall-web.mjs')]);
  } catch (error) {
    await removeService(record).catch(cleanup => console.error('Service cleanup: ' + cleanup.message));
    if (previous) {
      writeJson(installationFile(), previous);
      installService(previous); await startService(previous); registerCodex(previous);
      if (previous.skill && !existingSkill()) symlinkSync(join(previous.root, 'skills/dsh-subagent'), skillTarget(), process.platform === 'win32' ? 'junction' : 'dir');
      console.error('The previous installation was restored.');
    } else if (existsSync(installationFile())) unlinkSync(installationFile());
    throw error;
  }
  console.log('\nInstallation complete.');
  const {doctor} = await import('./doctor.mjs');
  await doctor({json: false});
  console.log('\nOpen a new Codex session and ask: Use $dsh-subagent to investigate this repository.');
  if (process.platform === 'win32') console.log('For automatic completion callbacks, start Codex with: npx -y dsh-subagent-mcp codex');
  if (!existsSync(providerPath)) console.log('Use your existing DSH provider login, or set DEEPSEEK_API_KEY and rerun setup --capture-key.');
}

export async function uninstall({purge = false} = {}) {
  const record = installation();
  if (!record) {console.log('No managed installation found.'); return;}
  await removeService(record);
  const registered = JSON.parse(runCommand(record.codex, ['mcp', 'get', 'dsh_subagent', '--json'], {stdio: 'pipe', encoding: 'utf8'}));
  if (registered.transport?.args?.some(arg => arg === join(record.root, 'src/cli.mjs'))) runCommand(record.codex, ['mcp', 'remove', 'dsh_subagent']);
  if (ownsSkill()) unlinkSync(skillTarget());
  unlinkSync(installationFile());
  for (const name of ['versions', 'dependencies']) rmSync(join(locations().data, name), {recursive: true, force: true});
  if (purge) {
    rmSync(locations().state, {recursive: true, force: true});
    for (const name of ['provider.json', 'environment']) rmSync(join(locations().config, name), {force: true});
  }
  console.log(purge ? 'Uninstalled and removed bridge history and captured provider settings. DSH sessions are retained.' : 'Uninstalled. Bridge history, provider settings and DSH sessions were retained.');
}
