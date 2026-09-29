import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {connectBridge} from './ipc.mjs';

// Windows SSH runs with an elevated Session 0 token. The official shared
// daemon deliberately refuses that token. Start it in our existing logged-in
// user service; its own durable lifecycle then belongs entirely to Codex.
export async function bootstrapWindowsCodex(socket, request, record) {
  if (process.platform !== 'win32' || record?.backend !== 'task-scheduler') throw new Error('Windows SSH requires the DSH login service and a logged-in desktop user.');
  const [file, ...prefix] = record.codex;
  const result = await promisify(execFile)(file, [...prefix, 'app-server', 'daemon', 'start'], {env: request.env, windowsHide: true, timeout: 60000, encoding: 'utf8'});
  socket.end(JSON.stringify(JSON.parse(result.stdout)) + '\n');
}

export async function startWindowsCodexDaemon() {
  const socket = await connectBridge();
  try {
    return await new Promise((resolve, reject) => {
      let buffer = '';
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('The Windows login service closed before starting Codex.')));
      socket.setTimeout(65000, () => socket.destroy(new Error('The Windows login service did not answer.')));
      socket.on('data', chunk => {
        buffer += chunk;
        if (!buffer.includes('\n')) return;
        try {
          const reply = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
          if (reply.error) reject(new Error(reply.error)); else resolve(reply);
        } catch (error) {reject(error);}
      });
      socket.write(JSON.stringify({bridge_control: 'codex-daemon-start', env: process.env}) + '\n');
    });
  } finally {socket.destroy();}
}
