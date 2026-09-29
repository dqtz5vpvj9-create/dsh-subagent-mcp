import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstatSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {connectBridge} from './ipc.mjs';
import {privateDirectory, temporaryDirectory} from './platform.mjs';

const execute = promisify(execFile);
// The official 0.158 installer publishes the release before executing it.
// The CLI's copy-and-run-then-rename order can fail on Windows while the exited
// executable still has an image handle. Keep the upstream installer unmodified.
const installerUrl = 'https://raw.githubusercontent.com/openai/codex/064c6b8c737f5b41d171fdda80bd9ef10ad06eb3/scripts/install/install.ps1';

function hasPath(path) {
  try {lstatSync(path); return true;}
  catch (error) {if (error.code === 'ENOENT') return false; throw error;}
}

export async function prepareWindowsCodexDaemon(spec, env = process.env) {
  if (process.platform !== 'win32') return;
  const [file, ...prefix] = spec;
  try {
    const result = await execute(file, [...prefix, 'app-server', 'daemon', 'version'], {env, windowsHide: true, timeout: 10000, encoding: 'utf8'});
    const status = JSON.parse(result.stdout);
    if (status.status === 'running') return status;
  } catch (error) {if (error.code !== 1) throw error;}
  const home = env.CODEX_HOME || join(env.USERPROFILE || homedir(), '.codex');
  // Preserve existing and damaged selections, and legacy daemon installations.
  // The official start command owns their diagnosis and recovery.
  if (hasPath(join(home, 'packages/app-server-daemon/current'))) return;
  const state = join(home, 'app-server-daemon');
  if (['daemon.pid', 'daemon.stderr.log', 'daemon-updater.pid', 'daemon-updater.stderr.log',
    'app-server.pid', 'app-server.stderr.log', 'app-server-updater.pid', 'app-server-updater.stderr.log']
    .some(name => hasPath(join(state, name)))) return;
  const version = await execute(file, [...prefix, '--version'], {env, windowsHide: true, timeout: 10000, encoding: 'utf8'});
  if (version.stdout.trim() !== 'codex-cli 0.158.0') return;

  const directory = privateDirectory(mkdtempSync(join(temporaryDirectory(), 'dsh-codex-install-')));
  try {
    const response = await fetch(installerUrl, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Could not download the official Codex installer (HTTP ${response.status}).`);
    const script = join(directory, 'install.ps1');
    writeFileSync(script, await response.text());
    const powershell = join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const installerEnv = {...env, CODEX_INSTALL_DAEMON_ONLY: '1', CODEX_NON_INTERACTIVE: '1'};
    // SSH can inherit PowerShell 7's module path. Windows PowerShell must build
    // its own standard path so the official installer's Get-FileHash is present.
    for (const name of Object.keys(installerEnv)) if (name.toLowerCase() === 'psmodulepath') delete installerEnv[name];
    // Scope execution policy to this trusted installer process; no user or
    // machine policy is written, and enforced Group Policy still takes priority.
    await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Release', '0.158.0'], {
      env: installerEnv,
      windowsHide: true, timeout: 300000, encoding: 'utf8',
    });
  } finally {rmSync(directory, {recursive: true, force: true});}
}

// Windows SSH runs with an elevated Session 0 token. The official shared
// daemon deliberately refuses that token. Start it in our existing logged-in
// user service; its own durable lifecycle then belongs entirely to Codex.
export async function bootstrapWindowsCodex(socket, request, record) {
  if (process.platform !== 'win32' || record?.backend !== 'task-scheduler') throw new Error('Windows SSH requires the DSH login service and a logged-in desktop user.');
  const [file, ...prefix] = record.codex;
  const status = await prepareWindowsCodexDaemon(record.codex, request.env);
  if (status?.status === 'running') {socket.end(JSON.stringify(status) + '\n'); return;}
  const result = await execute(file, [...prefix, 'app-server', 'daemon', 'start'], {env: request.env, windowsHide: true, timeout: 60000, encoding: 'utf8'});
  socket.end(JSON.stringify(JSON.parse(result.stdout)) + '\n');
}

export async function startWindowsCodexDaemon() {
  const socket = await connectBridge();
  try {
    return await new Promise((resolve, reject) => {
      let buffer = '';
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('The Windows login service closed before starting Codex.')));
      socket.setTimeout(420000, () => socket.destroy(new Error('The Windows login service did not finish preparing Codex.')));
      socket.on('data', chunk => {
        buffer += chunk;
        if (!buffer.includes('\n')) return;
        try {
          const reply = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
          if (reply.error) reject(new Error(reply.error)); else resolve(reply);
        } catch (error) {reject(error);}
      });
      socket.write(JSON.stringify({bridge_control: 'codex-daemon-start', env: process.env}) + '\n');
    });
  } finally {socket.destroy();}
}
