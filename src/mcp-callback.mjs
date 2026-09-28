import {dirname, join, resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {locations, readJson} from './platform.mjs';
import {registerCallback} from './notify.mjs';

function parent(extra) {
  const thread = extra._meta?.threadId;
  const file = extra._meta?.dshConnection;
  if (!thread || !file) throw new Error('This MCP connection has no Codex parent. Open Codex with dsh-subagent-mcp, or use the companion callback script in the parent environment.');
  if (dirname(dirname(resolve(file))) !== join(locations().state, 'codex')) throw new Error('Invalid parent connection path.');
  return {thread, file, connection: readJson(file)};
}

export async function watchFromMcp(agent, extra) {
  const {thread, file, connection} = parent(extra);
  const env = {...process.env, DSH_CODEX_CONNECTION: file};
  delete env.DSH_CODEX_TOKEN; delete env.DSH_CODEX_REMOTE;
  return registerCallback({agent, thread, delivery: 'tool-output', state: locations().state}, {env, temp: connection.temporaryDirectory});
}

export function unwatchFromMcp(agent, directory, extra) {
  const {thread, connection} = parent(extra);
  if (dirname(resolve(directory)) !== resolve(connection.temporaryDirectory)) throw new Error('Invalid callback directory.');
  const receipt = readJson(join(directory, 'callback.json'));
  if (receipt?.thread_id !== thread || receipt.agent_id !== agent) throw new Error('The callback belongs to a different parent or agent.');
  writeFileSync(join(directory, 'cancel'), '', {mode: 0o600});
  return {agent_id: agent, thread_id: thread, status: 'cancellation_requested'};
}
