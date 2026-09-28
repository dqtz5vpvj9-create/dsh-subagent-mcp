import {spawn, execFile} from 'node:child_process';
import {openSync, closeSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {connectBridge} from './ipc.mjs';
const hosted = new Map();

export function stopProcessTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}, () => {});
  else child.kill('SIGTERM');
}

// Windows OpenSSH starts commands in Session 0. Codex's sandbox runner needs
// the logged-in user's session, which already owns our scheduled background
// service. The authenticated bridge connection owns this App Server's lifetime.
export async function hostCodex(socket, request, record) {
  if (process.platform !== 'win32' || record?.backend !== 'task-scheduler') throw new Error('SSH Codex hosting requires the Windows login service.');
  const directory = resolve(request.directory);
  if (dirname(directory) !== join(record.state, 'codex')) throw new Error('Invalid Codex session directory.');
  const connection = JSON.parse(readFileSync(join(directory, 'connection.json'), 'utf8'));
  const url = new URL(connection.endpoint);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1') throw new Error('Codex must listen on authenticated loopback.');
  const [file, ...prefix] = record.codex;
  const log = openSync(join(directory, 'app-server.log'), 'a', 0o600);
  const child = spawn(file, [...prefix, 'app-server', '--config', 'mcp_servers.dsh_subagent.env_vars=["DSH_CODEX_CONNECTION"]', '--listen', connection.endpoint,
    '--ws-auth', 'capability-token', '--ws-token-file', join(directory, 'token')],
    {cwd: request.cwd, env: request.env, windowsHide: true, stdio: ['ignore', log, log]});
  closeSync(log);
  const exited = new Promise(resolve => {child.once('exit', resolve); child.once('error', resolve);});
  hosted.set(child, exited);
  exited.then(() => hosted.delete(child));
  const stop = () => stopProcessTree(child);
  socket.once('close', stop);
  await new Promise((resolve, reject) => {child.once('spawn', resolve); child.once('error', reject);});
  if (socket.destroyed) stop();
  else socket.write(JSON.stringify({pid: child.pid}) + '\n');
  child.once('exit', code => {
    socket.removeListener('close', stop);
    for (const name of ['token', 'connection.json']) rmSync(join(directory, name), {force: true});
    socket.end(JSON.stringify({exited: code}) + '\n');
  });
}

export async function stopHostedCodex() {
  const exits = [...hosted.values()];
  for (const child of hosted.keys()) stopProcessTree(child);
  await Promise.all(exits);
}

export async function connectHostedCodex(options) {
  const socket = await connectBridge();
  let running = true, finish;
  const done = new Promise(resolve => {finish = resolve;});
  socket.once('close', () => {running = false; finish();});
  socket.on('error', () => socket.destroy());
  await new Promise((resolve, reject) => {
    let buffer = '';
    const onError = error => reject(error);
    const onClose = () => reject(new Error('Windows Codex host closed before starting.'));
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.setTimeout(30000, () => socket.destroy(new Error('Windows Codex host did not answer.')));
    socket.on('data', chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      socket.setTimeout(0); socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      try {
        const reply = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        if (reply.error) reject(new Error(reply.error)); else resolve(reply);
      } catch (error) {reject(error);}
    });
    socket.write(JSON.stringify({bridge_control: 'codex-session', ...options}) + '\n');
  }).catch(error => {socket.destroy(); throw error;});
  return {done, running: () => running, stop: () => socket.destroy()};
}
