import {dirname, join, resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {locations, readJson} from './platform.mjs';
import {registerCallback} from './notify.mjs';

function parent(extra) {
  const thread = extra._meta?.threadId;
  const file = extra._meta?.dshConnection;
  if (!thread) throw new Error('This client does not identify the parent Codex thread. Keep one dsh_wait pending to receive the result, or use the companion callback helper from the parent session.');
  if (!file) {
    return {thread, directory: join(locations().state, 'callbacks')};
  }
  if (dirname(dirname(resolve(file))) !== join(locations().state, 'codex')) throw new Error('Invalid parent connection path.');
  const connection = readJson(file);
  if (!connection) throw new Error('The explicitly configured Codex connection is no longer available; the DSH task remains available.');
  return {thread, file, connection, directory: join(locations().state, 'callbacks')};
}

export async function watchFromMcp(agent, extra) {
  const {thread, file, directory} = parent(extra);
  const env = {...process.env};
  delete env.DSH_CODEX_TOKEN; delete env.DSH_CODEX_REMOTE; delete env.DSH_CODEX_CONNECTION;
  if (file) {
    env.DSH_CODEX_CONNECTION = file;
  }
  const receipt = await registerCallback({agent, thread, delivery: 'tool-output', state: locations().state}, {env, temp: directory});
  if (receipt.status === 'watching') {
    receipt.next_action = 'do_independent_work_or_end_response';
    receipt.instructions = 'When only this result remains pending, end your current response in the final channel now. The callback will wake you for result acceptance. Do not keep the turn open with sleep, wait tools, or polling.';
  }
  return receipt;
}

export function unwatchFromMcp(agent, directory, extra) {
  const {thread, directory: expected} = parent(extra);
  if (dirname(resolve(directory)) !== resolve(expected)) throw new Error('Invalid callback directory.');
  const receipt = readJson(join(directory, 'callback.json'));
  if (receipt?.thread_id !== thread || receipt.agent_id !== agent) throw new Error('The callback belongs to a different parent or agent.');
  writeFileSync(join(directory, 'cancel'), '', {mode: 0o600});
  return {agent_id: agent, thread_id: thread, status: 'cancellation_requested'};
}
