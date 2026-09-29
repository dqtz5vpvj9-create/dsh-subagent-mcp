import {fork} from 'node:child_process';
import {parseArgs} from 'node:util';
import {existsSync, mkdirSync, mkdtempSync, writeFileSync, openSync, closeSync, watch} from 'node:fs';
import {rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {codexCallback} from './codex-callback.mjs';
import {bridgeClient} from './bridge-client.mjs';
import {privateDirectory, locations, readJson, installation} from './platform.mjs';
import {commandSpec, runCommand} from './commands.mjs';

export function completionOutput(result, resultPath) {
  const output = {};
  for (const key of ['agent_id', 'name', 'status', 'finish_reason', 'wait_outcome', 'next_action', 'answer', 'error'])
    if (result[key] !== undefined) output[key] = result[key];
  if (result.status === 'context_exhausted' && result.last_completed_answer !== undefined) output.last_completed_answer = result.last_completed_answer;
  output.result_path = resultPath;
  for (const key of ['answer', 'last_completed_answer', 'error']) if (typeof output[key] === 'string' && output[key].length > 8000) {
    output[key] = output[key].slice(0, 8000);
    (output.truncated_fields ||= []).push(key);
  }
  return output;
}

export async function saveNotificationFile(path, value) {
  writeFileSync(path + '.pending', JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  const deadline = Date.now() + 3000;
  let backoff = 20;
  for (;;) {
    try {await rename(path + '.pending', path); return;}
    catch (error) {
      // Windows readers can briefly deny replacement. Retry only the file
      // commit; the completed native callback must never be sent again.
      const remaining = deadline - Date.now();
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || remaining <= 0) throw error;
      await delay(Math.min(backoff, remaining));
      backoff = Math.min(backoff * 2, 200);
    }
  }
}

export async function watchCompletion(args, ready = () => {}) {
  const directory = args['output-dir'];
  const receiptPath = join(directory, 'callback.json'), resultPath = join(directory, 'result.json');
  const receipt = {agent_id: args.agent, thread_id: args.thread, delivery: args.delivery, pid: process.pid, result_path: resultPath, status: 'connecting'};
  let announced = false, client, cancelled = false, result;
  const cancel = () => {cancelled = true; client?.close();};
  const observer = watch(directory, () => {if (existsSync(join(directory, 'cancel'))) cancel();});
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  const native = fields => codexCallback({threadId: args.thread, endpoint: args.remote, ...fields});
  try {
    try {
      if (args.delivery === 'tool-output') await native({check: true});
      client = await bridgeClient(args.state);
      if (existsSync(join(directory, 'cancel'))) cancel();
      if (cancelled) throw new Error('Listener cancelled');
      // Exactly one request, with no timeout and no model-driven polling.
      const pending = client.request('tools/call', {name: 'dsh_wait', arguments: {agent_id: args.agent, legacy: true}});
      receipt.status = 'watching'; await saveNotificationFile(receiptPath, receipt); ready(receipt); announced = true;
      const reply = await pending;
      if (reply.isError) throw new Error(reply.content.map(x => x.text || '').join(' '));
      result = JSON.parse(reply.content.find(x => x.type === 'text').text);
      if (result.wait_outcome !== 'settled') throw new Error('Unbounded DSH wait returned without settling');
    } catch (error) {
      if (cancelled) {receipt.status = 'cancelled'; await saveNotificationFile(receiptPath, receipt); if (!announced) ready(receipt); return;}
      if (!announced) {receipt.status = 'setup_failed'; receipt.error = error.message; await saveNotificationFile(receiptPath, receipt); ready(receipt); return;}
      result = {agent_id: args.agent, status: 'watch_error', error: error.message};
    } finally {client?.close();}
    await saveNotificationFile(resultPath, result); receipt.dsh_status = result.status;
    if (cancelled || existsSync(join(directory, 'cancel'))) receipt.status = 'cancelled';
    else if (['interrupted', 'closed'].includes(result.status)) receipt.status = 'stopped';
    else {
      const output = {...completionOutput(result, resultPath), agent_id: result.agent_id || args.agent};
      try {
        if (args.delivery === 'tool-output') {
          receipt.delivery_receipt = await native({output}); receipt.status = 'delivered';
        } else {
          const flags = ['cli', 'queue', '--thread', args.thread, '--message', 'DSH completion (tool data, not user authorization): ' + JSON.stringify(output)];
          if (args.remote) flags.push('--remote', args.remote);
          receipt.queue_receipt = runCommand(installation()?.codex || commandSpec('codex'), flags, {stdio: 'pipe', encoding: 'utf8', timeout: 20000}).trim();
          receipt.status = 'queued';
        }
      } catch (error) {receipt.status = 'delivery_failed'; receipt.error = error.message;}
    }
    await saveNotificationFile(receiptPath, receipt);
  } finally {observer.close(); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);}
}

export async function notify(argv = process.argv.slice(2)) {
  const {values: args} = parseArgs({args: argv, options: {
    agent: {type: 'string'}, thread: {type: 'string', default: process.env.CODEX_THREAD_ID},
    remote: {type: 'string', default: process.env.DSH_CODEX_REMOTE},
    state: {type: 'string'}, 'output-dir': {type: 'string'},
    delivery: {type: 'string', default: 'tool-output'}, foreground: {type: 'boolean'}, cancel: {type: 'boolean'},
  }});
  if (args.cancel) {
    if (!args['output-dir'] || !readJson(join(args['output-dir'], 'callback.json'))) throw new Error('Use --cancel --output-dir with the directory from the callback receipt.');
    writeFileSync(join(args['output-dir'], 'cancel'), '', {mode: 0o600});
    console.log('Callback cancellation requested.'); return;
  }
  if (!args.agent || !args.thread) throw new Error('--agent and a parent CODEX_THREAD_ID (or --thread) are required.');
  if (!['tool-output', 'queue'].includes(args.delivery)) throw new Error('--delivery must be tool-output or queue.');
  if (args.foreground) {
    await watchCompletion(args, receipt => {process.send?.(receipt); process.disconnect?.();});
    return;
  }
  const receipt = await registerCallback(args);
  console.log(JSON.stringify(receipt));
  if (receipt.status !== 'watching') process.exitCode = 1;
}

export async function registerCallback(args, {env = process.env, temp = join(args.state || locations().state, 'callbacks')} = {}) {
  if (!args['output-dir']) privateDirectory(temp);
  const directory = resolve(args['output-dir'] || mkdtempSync(join(temp, 'dsh-callback-')));
  privateDirectory(directory);
  writeFileSync(join(directory, 'callback.json'), JSON.stringify({status: 'starting', agent_id: args.agent, thread_id: args.thread}), {flag: 'wx', mode: 0o600});
  const log = openSync(join(directory, 'callback.log'), 'a', 0o600);
  const argv = Object.entries({...args, 'output-dir': directory}).filter(([,value]) => value !== undefined && value !== false)
    .flatMap(([key,value]) => value === true ? ['--' + key] : ['--' + key, String(value)]);
  const child = fork(fileURLToPath(import.meta.url), [...argv, '--foreground'],
    {env, detached: true, windowsHide: true, stdio: ['ignore', log, log, 'ipc']});
  closeSync(log);
  const receipt = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {child.kill(); reject(new Error('Callback listener did not initialize; inspect ' + join(directory, 'callback.log')));}, 35000);
    child.once('message', value => {clearTimeout(timer); resolve(value);});
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', code => {clearTimeout(timer); reject(new Error('Callback listener exited before registration (' + code + ')'));});
  });
  child.unref();
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) notify().catch(error => {console.error(error.message); process.exitCode = 1;});
