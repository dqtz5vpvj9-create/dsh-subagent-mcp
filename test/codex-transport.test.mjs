import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocketServer} from 'ws';
import {openNativeCodexSocket} from '../src/codex-transport.mjs';
import {temporaryDirectory} from '../src/platform.mjs';

test('closing the native connection closes its proxy while leaving the daemon available', {timeout: 10000}, async () => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-proxy-'));
  const fake = join(root, 'proxy.mjs'), pidFile = join(root, 'proxy.pid');
  writeFileSync(fake, `
import net from 'node:net';
import {writeFileSync} from 'node:fs';
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['app-server','proxy']))process.exit(9);
writeFileSync(process.env.PROXY_PID,String(process.pid));
const socket=net.connect(Number(process.env.PROXY_PORT),'127.0.0.1');
process.stdin.pipe(socket);socket.pipe(process.stdout);
const finish=()=>{socket.destroy();process.exit(0);};
socket.on('close',finish);process.once('SIGTERM',finish);
`);
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  await once(server, 'listening');
  server.on('connection', socket => socket.on('message', bytes => socket.send(bytes)));
  const env = {...process.env, PROXY_PORT: String(server.address().port), PROXY_PID: pidFile};
  let socket;
  try {
    socket = openNativeCodexSocket({env, spec: [process.execPath, fake]});
    await once(socket, 'open');
    const reply = once(socket, 'message');
    socket.send('connection works');
    assert.equal(String((await reply)[0]), 'connection works');
    const disconnected = once(socket, 'close'); socket.close(); await disconnected;
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const running = () => {try {process.kill(pid, 0); return true;} catch (error) {if (error.code === 'ESRCH') return false; throw error;}};
    for (let i = 0; i < 100 && running(); i++) await delay(20);
    assert.equal(running(), false);
    // The transport owns its short-lived proxy, never the server behind it.
    assert.ok(server.address());
  } finally {
    socket?.terminate();
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  }
});
