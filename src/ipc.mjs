import net from 'node:net';
import {join} from 'node:path';
import {readJson, locations} from './platform.mjs';

export async function connectBridge(state = locations().state) {
  const endpoint = readJson(join(state, 'endpoint.json'));
  if (process.platform === 'win32' && !endpoint) throw new Error('DSH service is not running. Run dsh-subagent-mcp start.');
  const socket = net.connect(endpoint?.port ? {host: '127.0.0.1', port: endpoint.port} : endpoint?.socket || join(state, 'server.sock'));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('DSH service connection timed out')));
  });
  socket.setTimeout(0);
  if (endpoint?.token) socket.write(JSON.stringify({authenticate: endpoint.token}) + '\n');
  return socket;
}

export async function control(action, {state = locations().state, ...params} = {}) {
  const socket = await connectBridge(state);
  try {
    return await new Promise((resolve, reject) => {
      let buffer = '';
      socket.setTimeout(30000, () => socket.destroy(new Error('DSH service did not answer ' + action)));
      socket.on('error', reject);
      socket.on('end', () => reject(new Error('DSH service closed before answering ' + action)));
      socket.on('data', chunk => {
        buffer += chunk;
        if (!buffer.includes('\n')) return;
        try {
          const result = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
          result.error ? reject(new Error(result.error)) : resolve(result);
        } catch (error) { reject(error); }
      });
      socket.write(JSON.stringify({bridge_control: action, ...params}) + '\n');
    });
  } finally { socket.destroy(); }
}
