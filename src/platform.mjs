import {homedir, tmpdir} from 'node:os';
import {join, win32, posix} from 'node:path';
import {mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

export function locations({platform = process.platform, home = homedir(), env = process.env} = {}) {
  const path = platform === 'win32' ? win32 : posix;
  const base = platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'dsh-subagent-mcp')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'dsh-subagent-mcp') : null;
  return {
    data: env.DSH_SUBAGENT_DATA || base || path.join(env.XDG_DATA_HOME || path.join(home, '.local/share'), 'dsh-subagent-mcp'),
    config: env.DSH_SUBAGENT_CONFIG || (base ? path.join(base, 'config') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'dsh-subagent-mcp')),
    state: env.DSH_SUBAGENT_STATE || (base ? path.join(base, 'state') : path.join(env.XDG_STATE_HOME || path.join(home, '.local/state'), 'dsh-subagent-mcp')),
    codex: env.CODEX_HOME || path.join(home, '.codex'),
  };
}

// Windows mode bits do not restrict other users. Protect the directory ACL
// before writing provider credentials or local IPC authentication tokens.
export function privateDirectory(path) {
  mkdirSync(path, {recursive: true, mode: 0o700});
  if (process.platform === 'win32') {
    const user = execFileSync('whoami.exe', [], {encoding: 'utf8', windowsHide: true}).trim();
    execFileSync('icacls.exe', [path, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], {stdio: 'pipe', windowsHide: true});
  } else if (process.platform !== 'win32') chmodSync(path, 0o700);
  return path;
}

// Installed npm code is public. Sandbox accounts need read/execute access to
// its skill and runtime; credentials, history and IPC tokens stay private.
export function readableProgramDirectory(path) {
  if (process.platform === 'win32') execFileSync('icacls.exe', [path, '/grant:r', '*S-1-5-32-545:(OI)(CI)RX'], {stdio: 'pipe', windowsHide: true});
  return path;
}

export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
}
export const installationFile = () => join(locations().config, 'installation.json');
export const installation = () => readJson(installationFile());
export const temporaryDirectory = () => process.env.TMPDIR || (existsSync('/mnt/cache/data-cache') ? '/mnt/cache/data-cache' : tmpdir());

export function providerEnvironment(config = locations().config) {
  const provider = readJson(join(config, 'provider.json'), {});
  const legacy = join(config, 'environment');
  if (existsSync(legacy)) for (const line of readFileSync(legacy, 'utf8').split('\n')) {
    const match = /^(DEEPSEEK_API_KEY|DEEPSEEK_BASE_URL)="(.*)"$/.exec(line);
    if (match && !provider[match[1]] && !process.env[match[1]]) provider[match[1]] = match[2].replace(/\\([\\"])/g, '$1');
  }
  return provider;
}
