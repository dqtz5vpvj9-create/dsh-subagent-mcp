import {existsSync, readFileSync, realpathSync} from 'node:fs';
import {delimiter, dirname, join, extname} from 'node:path';
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

// Resolve npm's Windows .cmd wrappers to their JavaScript entrypoints. Passing
// them to a shell would reinterpret paths and arguments containing &, %, etc.
export function commandSpec(name, {prefix, explicit, env = process.env} = {}) {
  if (explicit) return /\.[cm]?js$/i.test(explicit) ? [process.execPath, realpathSync(explicit)] : [explicit];
  const dirs = (env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      const candidate = join(dir, name + suffix);
      if (!existsSync(candidate)) continue;
      if (suffix === '.cmd') {
        const entry = packageEntry(dir, packages[name], name);
        if (entry) return [process.execPath, entry];
        continue;
      }
      const file = realpathSync(candidate);
      return /\.[cm]?js$/i.test(extname(file)) ? [process.execPath, file] : [candidate];
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
