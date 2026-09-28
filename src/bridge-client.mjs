import {createInterface} from 'node:readline';
import {connectBridge} from './ipc.mjs';

export async function bridgeClient(state) {
  const socket = await connectBridge(state);
  const pending = new Map();
  let sequence = 0;
  const fail = error => {for (const item of pending.values()) item.reject(error); pending.clear();};
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('DSH connection closed before the result arrived')));
  const lines = createInterface({input: socket});
  lines.on('line', line => {
    try {
      const message = JSON.parse(line), item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
    } catch (error) {fail(error); socket.destroy();}
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, {resolve, reject});
    socket.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
  });
  socket.setTimeout(10000, () => socket.destroy(new Error('DSH initialization timed out')));
  try {
    await request('initialize', {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'dsh-bridge-client', version: '1'}});
    socket.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    socket.setTimeout(0);
  } catch (error) {socket.destroy(); throw error;}
  return {request, close: () => {lines.close(); socket.destroy();}};
}
