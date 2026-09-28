import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {mkdtempSync, writeFileSync, openSync, closeSync, rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {commandSpec, runCommand} from './commands.mjs';
import {installation, locations, privateDirectory, writeJson} from './platform.mjs';

export async function launchCodex(args) {
  const passthrough = ['login', 'logout', 'doctor', '--version', '-V', '--help', '-h'].includes(args[0]);
  let record = installation();
  if (!record && !passthrough) {
    console.log('First run: setting up DSH for Codex…');
    await (await import('./setup.mjs')).setup([], {launching: true});
    if (process.exitCode) return;
    record = installation();
  }
  const spec = record?.codex || commandSpec('codex', {explicit: process.env.DSH_CODEX_CLI});
  if (passthrough) {
    runCommand(spec, args); return;
  }
  const probe = net.createServer();
  await new Promise((resolve, reject) => {probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve);});
  const endpoint = 'ws://127.0.0.1:' + probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const root = privateDirectory(join(locations().state, 'codex'));
  const directory = privateDirectory(mkdtempSync(join(root, 'session-')));
  const token = randomBytes(32).toString('hex'), tokenFile = join(directory, 'token');
  writeFileSync(tokenFile, token + '\n', {mode: 0o600});
  const connectionFile = join(directory, 'connection.json');
  writeJson(connectionFile, {endpoint, token});
  const env = {...process.env, DSH_CODEX_REMOTE: endpoint, DSH_CODEX_TOKEN: token, DSH_CODEX_CONNECTION: connectionFile};
  const log = openSync(join(directory, 'app-server.log'), 'a', 0o600);
  const [file, ...prefix] = spec;
  const server = spawn(file, [...prefix, 'app-server', '--listen', endpoint, '--ws-auth', 'capability-token', '--ws-token-file', tokenFile],
    {env, windowsHide: true, stdio: ['ignore', log, log]});
  closeSync(log);
  const serverExit = new Promise(resolve => {server.once('exit', resolve); server.once('error', resolve);});
  let client;
  const stop = () => {client?.kill('SIGTERM'); server.kill('SIGTERM');};
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await new Promise((resolve, reject) => {server.once('spawn', resolve); server.once('error', reject);});
    let ready = false;
    for (let i = 0; i < 100 && server.exitCode === null; i++) {
      ready = await new Promise(resolve => {
        const socket = new WebSocket(endpoint, {headers: {Authorization: 'Bearer ' + token}, handshakeTimeout: 1000});
        socket.once('open', () => {socket.close(); resolve(true);});
        socket.once('error', () => resolve(false));
      });
      if (ready) break;
      await delay(150);
    }
    if (!ready) throw new Error('Codex App Server did not start. Inspect ' + join(directory, 'app-server.log') + '. Update Codex if it does not support authenticated WebSockets.');
    client = spawn(file, [...prefix, '--remote', endpoint, '--remote-auth-token-env', 'DSH_CODEX_TOKEN', ...args], {env, stdio: 'inherit'});
    const [code] = await once(client, 'exit');
    process.exitCode = code || 0;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (server.exitCode === null) {server.kill('SIGTERM'); await serverExit;}
    // Keep diagnostic logs, remove the connection's bearer credentials.
    rmSync(tokenFile, {force: true}); rmSync(connectionFile, {force: true});
  }
}
