import {existsSync, readFileSync, writeFileSync, lstatSync, realpathSync, symlinkSync, unlinkSync, rmSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {projectRoot, resolveDshCli} from './config.mjs';
import {locations, installation, installationFile, privateDirectory, writeJson, readJson} from './platform.mjs';
import {commandSpec, packageEntry, runCommand} from './commands.mjs';
import {installPackage} from './install-package.mjs';
import {backendDefault, installService, startService, stopService, statusService, removeService, systemdQuote, nativeServiceConflict} from './service.mjs';
import {bridgeClient} from './bridge-client.mjs';

export const TESTED_DSH = '0.1.5-rc.1';
export const TESTED_CODEX = '0.158.0';
const version = () => JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;

function skillTarget() {return join(locations().codex, 'skills/dsh-subagent');}
function existingSkill() {try {return lstatSync(skillTarget());} catch (error) {if (error.code !== 'ENOENT') throw error; return null;}}
function ownsSkill() {
  if (!existingSkill()?.isSymbolicLink()) return false;
  try {return JSON.parse(readFileSync(join(realpathSync(skillTarget()), '../..', 'package.json'), 'utf8')).name === 'dsh-subagent-mcp';}
  catch {return false;}
}

function compatibleCodex(spec) {
  const [file, ...prefix] = spec;
  const result = spawnSync(file, [...prefix, '--version'], {encoding: 'utf8', windowsHide: true});
  const found = result.stdout?.match(/codex(?:-cli)? (\d+)\.(\d+)\.(\d+)/);
  if (result.status !== 0 || !found) return false;
  const actual = found.slice(1).map(Number), required = TESTED_CODEX.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (actual[i] !== required[i]) return actual[i] > required[i];
  return true;
}

function ensureDependencies(installMissing) {
  const prefix = join(locations().data, 'dependencies');
  let dsh, codex;
  try {dsh = resolveDshCli();} catch (error) {if (process.env.DSH_CLI) throw error;}
  try {codex = commandSpec('codex', {prefix, explicit: process.env.DSH_CODEX_CLI});} catch (error) {if (process.env.DSH_CODEX_CLI) throw error;}
  if (codex && !compatibleCodex(codex)) {
    if (process.env.DSH_CODEX_CLI) throw new Error(`DSH_CODEX_CLI requires Codex ${TESTED_CODEX} or newer for authenticated completion callbacks.`);
    console.log(`Preparing Codex ${TESTED_CODEX} for completion callbacks; your existing Codex installation is unchanged.`);
    codex = null;
    const managed = packageEntry(prefix, '@openai/codex', 'codex');
    if (managed && compatibleCodex([process.execPath, managed])) codex = [process.execPath, managed];
  }
  const missing = [...(!dsh ? [`@deepseek-ai/dsh@${TESTED_DSH}`] : []), ...(!codex ? [`@openai/codex@${TESTED_CODEX}`] : [])];
  if (missing.length) {
    if (!installMissing) throw new Error('Missing dependencies: ' + missing.join(', ') + '. Rerun setup without --no-install-deps.');
    console.log('Installing missing dependencies for this user: ' + missing.join(', '));
    // A private package.json lets subsequent installs retain both dependencies.
    privateDirectory(prefix);
    if (!existsSync(join(prefix, 'package.json'))) writeJson(join(prefix, 'package.json'), {name: 'dsh-subagent-dependencies', private: true});
    process.stdout.write(runCommand('npm', ['install', '--prefix', prefix, '--save-exact', '--no-audit', '--no-fund', ...missing], {stdio: 'pipe', encoding: 'utf8'}));
    dsh ||= packageEntry(prefix, '@deepseek-ai/dsh', 'dsh');
    codex ||= [process.execPath, packageEntry(prefix, '@openai/codex', 'codex')];
  }
  return {dsh, codex};
}

export function registerCodex(record) {
  const env = ['DSH_SUBAGENT_STATE=' + record.state, 'DSH_SUBAGENT_CONFIG=' + locations().config];
  runCommand(record.codex, ['mcp', 'add', 'dsh_subagent', ...env.flatMap(value => ['--env', value]), '--', record.node, join(record.root, 'src/cli.mjs'), 'mcp']);
}

function codexRegistration(codex) {
  return JSON.parse(runCommand(codex, ['mcp', 'list', '--json'], {stdio: 'pipe', encoding: 'utf8'}))
    .find(server => server.name === 'dsh_subagent');
}

export async function setup(argv, {source = false, launching = false} = {}) {
  const {values: args} = parseArgs({args: argv, options: {
    skill: {type: 'boolean'}, 'no-skill': {type: 'boolean'}, 'capture-key': {type: 'boolean'},
    'no-install-deps': {type: 'boolean'}, service: {type: 'string'}, yes: {type: 'boolean'},
  }});
  if (!['linux', 'darwin', 'win32'].includes(process.platform)) throw new Error('Supported systems: Windows, Linux and macOS.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required. Install it from https://nodejs.org/ and rerun setup.');
  const allowed = {linux: ['systemd', 'background'], darwin: ['launchd', 'background'], win32: ['task-scheduler', 'background']}[process.platform];
  const previous = installation();
  let backend = args.service === 'auto' ? backendDefault() : args.service || previous?.backend || backendDefault();
  if (!allowed.includes(backend)) throw new Error('Supported service choices on this system: ' + allowed.join(', '));
  if (!args['no-skill'] && existingSkill() && !ownsSkill()) throw new Error('A custom skill exists at ' + skillTarget() + '. It was preserved. Use --no-skill to keep managing it yourself.');
  const status = await statusService();
  if (status.running && status.active.length) throw new Error('Active DSH tasks are running. Finish or interrupt them before setup or upgrade.');
  const paths = locations();
  const legacyUnitPath = join(homedir(), '.config/systemd/user/dsh-subagent-mcp.service');
  const candidateUnit = !previous && process.platform === 'linux' && existsSync(legacyUnitPath) ? readFileSync(legacyUnitPath) : null;
  const legacyUnit = candidateUnit && candidateUnit.includes('/server.mjs') && !candidateUnit.includes('--config') && (candidateUnit.includes(systemdQuote('DSH_SUBAGENT_STATE=' + paths.state)) ||
    (!candidateUnit.includes('DSH_SUBAGENT_STATE=') && paths.state === join(homedir(), '.local/state/dsh-subagent-mcp'))) ? candidateUnit : null;
  const legacyRunning = !previous && process.platform === 'linux' && existsSync(join(paths.state, 'server.sock'));
  const legacyEnabled = legacyUnit && spawnSync('systemctl', ['--user', 'is-enabled', 'dsh-subagent-mcp.service'], {stdio: 'ignore'}).status === 0;
  let conflict = false;
  if (!legacyUnit) {
    try {conflict = nativeServiceConflict({backend});}
    catch (error) {
      if (args.service && args.service !== 'auto') throw error;
      console.warn(error.message + '\nUsing a separate background process.');
      backend = 'background';
    }
  }
  if (conflict) {
    if (args.service && args.service !== 'auto') throw new Error('Another installation owns the login service. Use --service background for this configuration.');
    console.warn('Another installation owns the login service. Using a separate background process.');
    backend = 'background';
  }
  if (legacyRunning) {
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
  mkdirSync(paths.codex, {recursive: true, mode: 0o700});
  console.log(`DSH Subagent MCP ${version()} · ${process.platform}\nPreparing installation…`);
  const dependencies = ensureDependencies(!args['no-install-deps']);
  const oldRegistration = codexRegistration(dependencies.codex);
  if (oldRegistration?.transport?.url) throw new Error('Codex already has a remote MCP server named dsh_subagent. Rename it before installing this local bridge.');
  const oldSkill = ownsSkill() ? realpathSync(skillTarget()) : null;
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
  if (legacyRunning) runCommand(['systemctl'], ['--user', 'stop', 'dsh-subagent-mcp.service']);
  await stopService();
  let registered = false, skillChanged = false;
  try {
    if (previous && previous.backend !== backend) await removeService(previous);
    writeJson(installationFile(), record);
    try {installService(record, {allowLegacy: Boolean(legacyUnit)});}
    catch (error) {
      if (args.service && args.service !== 'auto') throw error;
      console.warn('Login startup could not be registered: ' + error.message + '\nUsing a background process that starts when Codex connects.');
      await removeService(record).catch(() => {});
      record.backend = 'background'; writeJson(installationFile(), record);
    }
    await startService(record);
    registerCodex(record);
    registered = true;
    if (record.skill) {
      mkdirSync(join(paths.codex, 'skills'), {recursive: true});
      if (existingSkill()) unlinkSync(skillTarget());
      skillChanged = true;
      symlinkSync(join(root, 'skills/dsh-subagent'), skillTarget(), process.platform === 'win32' ? 'junction' : 'dir');
    }
    runCommand([process.execPath, join(root, 'scripts/uninstall-web.mjs')]);
  } catch (error) {
    await removeService(record).catch(cleanup => console.error('Service cleanup: ' + cleanup.message));
    if (previous) {
      writeJson(installationFile(), previous);
      installService(previous); await startService(previous);
      console.error('The previous installation was restored.');
    } else {
      if (existsSync(installationFile())) unlinkSync(installationFile());
      if (legacyUnit) {
        writeFileSync(legacyUnitPath, legacyUnit);
        runCommand(['systemctl'], ['--user', 'daemon-reload']);
        if (legacyEnabled) runCommand(['systemctl'], ['--user', 'enable', 'dsh-subagent-mcp.service']);
        if (legacyRunning) runCommand(['systemctl'], ['--user', 'start', 'dsh-subagent-mcp.service']);
      }
    }
    if (registered) {
      if (oldRegistration) {
        const {command, args = [], env = {}} = oldRegistration.transport;
        runCommand(dependencies.codex, ['mcp', 'add', 'dsh_subagent', ...Object.entries(env).flatMap(([key, value]) => ['--env', key + '=' + value]), '--', command, ...args]);
      } else runCommand(dependencies.codex, ['mcp', 'remove', 'dsh_subagent']);
    }
    if (skillChanged) {
      if (existingSkill()) unlinkSync(skillTarget());
      if (oldSkill) symlinkSync(oldSkill, skillTarget(), process.platform === 'win32' ? 'junction' : 'dir');
    }
    throw error;
  }
  console.log('\nInstallation complete.');
  const {doctor} = await import('./doctor.mjs');
  await doctor({json: false});
  if (!launching) console.log('\nOpen Codex with: npx -y dsh-subagent-mcp@latest');
  if (!existsSync(providerPath)) console.log('Use your existing DSH provider login, or set DEEPSEEK_API_KEY and rerun setup --capture-key.');
}

export async function uninstall({purge = false} = {}) {
  const record = installation();
  if (!record) {console.log('No managed installation found.'); return;}
  const registered = codexRegistration(record.codex);
  await removeService(record);
  if (registered?.transport?.args?.some(arg => arg === join(record.root, 'src/cli.mjs'))) runCommand(record.codex, ['mcp', 'remove', 'dsh_subagent']);
  if (ownsSkill()) unlinkSync(skillTarget());
  unlinkSync(installationFile());
  for (const name of ['versions', 'dependencies']) rmSync(join(locations().data, name), {recursive: true, force: true});
  if (purge) {
    rmSync(locations().state, {recursive: true, force: true});
    for (const name of ['provider.json', 'environment']) rmSync(join(locations().config, name), {force: true});
  }
  console.log(purge ? 'Uninstalled and removed bridge history and captured provider settings. DSH sessions are retained.' : 'Uninstalled. Bridge history, provider settings and DSH sessions were retained.');
}
