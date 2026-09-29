import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {commandSpec} from './commands.mjs';
import {installation} from './platform.mjs';

// An optional entrypoint for the privately installed CLI. Codex owns its
// sessions, terminal and daemon, exactly as when launched from PATH.
export async function launchCodex(args) {
  const record = installation();
  const spec = record?.codex || commandSpec('codex', {explicit: process.env.DSH_CODEX_CLI});
  const informational = ['login', 'logout', 'doctor', '--version', '-V', '--help', '-h'].includes(args[0]);
  if (process.platform === 'win32' && process.env.SSH_CONNECTION && !informational) {
    await (await import('./service.mjs')).startService();
    await (await import('./codex-host.mjs')).startWindowsCodexDaemon();
  }
  const [file, ...prefix] = spec;
  const child = spawn(file, [...prefix, ...args], {env: process.env, stdio: 'inherit'});
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const [code, signal] = await once(child, 'exit');
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
}
