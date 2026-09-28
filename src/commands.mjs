import {existsSync, readFileSync, realpathSync} from 'node:fs';
import {delimiter, dirname, join, extname, basename} from 'node:path';
import {spawnSync} from 'node:child_process';

const packages = {dsh: '@deepseek-ai/dsh', codex: '@openai/codex', npm: 'npm'};

export function packageEntry(prefix, name, command) {
  const root = join(prefix, 'node_modules', name);
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return null;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[command];
  return bin && existsSync(join(root, bin)) ? join(root, bin) : null;
}

function npmBinEntry(dir, name) {
  if (!packages[name]) return null;
  // Global npm shims live at the prefix; local/npx shims live in node_modules/.bin.
  const prefix = basename(dir) === '.bin' && basename(dirname(dir)) === 'node_modules'
    ? dirname(dirname(dir)) : dir;
  return packageEntry(prefix, packages[name], name);
}

// Resolve npm shims through package metadata, never execute shell scripts as JS.
// This also avoids shell interpretation of paths containing &, %, or spaces.
export function commandSpec(name, {prefix, explicit, env = process.env, platform = process.platform} = {}) {
  if (explicit) return /\.[cm]?js$/i.test(explicit) ? [process.execPath, realpathSync(explicit)] : [explicit];
  const dirs = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const suffix of platform === 'win32' ? ['.exe', '.cmd', '.ps1', ''] : ['']) {
      const candidate = join(dir, name + suffix);
      if (!existsSync(candidate)) continue;
      const entry = suffix !== '.exe' && npmBinEntry(dir, name);
      if (entry) return [process.execPath, realpathSync(entry)];
      if (suffix === '.cmd' || suffix === '.ps1') continue;
      const file = realpathSync(candidate);
      if (/\.[cm]?js$/i.test(extname(file))) return [process.execPath, file];
      // DSH is loaded by Node with the bridge plugin. An unresolved shell shim
      // or native DSH executable cannot serve as its JavaScript entrypoint.
      if (name !== 'dsh') return [candidate];
    }
  }
  const entry = packages[name] && [prefix, dirname(process.execPath), join(dirname(process.execPath), '..', 'lib')]
    .filter(Boolean).map(dir => packageEntry(dir, packages[name], name)).find(Boolean);
  if (entry) return [process.execPath, entry];
  throw new Error(`${name} was not found. ${name === 'npm' ? 'Install Node.js 24 or newer with npm.' : 'Run dsh-subagent-mcp setup to install missing dependencies.'}`);
}

export function runCommand(spec, args = [], options = {}) {
  const [file, ...prefix] = Array.isArray(spec) ? spec : commandSpec(spec);
  const result = spawnSync(file, [...prefix, ...args], {stdio: 'inherit', windowsHide: true, ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} exited with ${result.status}${result.stderr ? ': ' + String(result.stderr).trim() : ''}`);
  return result.stdout;
}
