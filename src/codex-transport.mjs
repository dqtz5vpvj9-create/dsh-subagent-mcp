import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import WebSocket from 'ws';
import {installation} from './platform.mjs';
import {commandSpec} from './commands.mjs';

// Windows exposes the existing Codex daemon through the official proxy.
// The proxy carries raw WebSocket bytes; it does not own the daemon.
export function openNativeCodexSocket({env = process.env, spec = installation()?.codex || commandSpec('codex')} = {}) {
  const [file, ...prefix] = spec;
  const child = spawn(file, [...prefix, 'app-server', 'proxy'], {env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
  const tunnel = Duplex.from({readable: child.stdout, writable: child.stdin});
  const socket = new WebSocket('ws://localhost/', {createConnection: () => tunnel, handshakeTimeout: 10000});
  child.once('error', error => tunnel.destroy(error));
  socket.once('close', () => {tunnel.destroy(); child.kill();});
  return socket;
}
