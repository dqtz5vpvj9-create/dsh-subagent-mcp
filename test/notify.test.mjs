import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createInterface} from 'node:readline';
import {mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocketServer} from 'ws';
import {privateDirectory, temporaryDirectory, writeJson} from '../src/platform.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../src/notify.mjs', import.meta.url));
const thread = '01a0e5c5-cdae-7101-9d53-228035271cfe';

async function fixture(t) {
  const root = privateDirectory(mkdtempSync(join(temporaryDirectory(), 'dsh-node-notify-')));
  const state = privateDirectory(join(root, 'state'));
  const sockets = new Set(), requests = [], waits = new Map(), directories = [];
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    createInterface({input: socket}).on('line', line => {
      const request = JSON.parse(line);
      if (request.authenticate) {assert.equal(request.authenticate, 'fixture-token'); return;}
      requests.push(request);
      if (request.method === 'initialize') socket.write(JSON.stringify({id: request.id, result: {protocolVersion: '2025-03-26', capabilities: {tools: {}}, serverInfo: {name: 'fixture', version: '1'}}}) + '\n');
      else if (request.method === 'tools/call') waits.set(request.params.arguments.agent_id, {socket, id: request.id});
    });
  });
  await new Promise(resolve => server.listen(process.platform === 'win32' ? {host: '127.0.0.1', port: 0} : join(state, 'server.sock'), resolve));
  if (process.platform === 'win32') writeJson(join(state, 'endpoint.json'), {port: server.address().port, token: 'fixture-token'});
  const ws = new WebSocketServer({host: '127.0.0.1', port: 0});
  await new Promise(resolve => ws.once('listening', resolve));
  const calls = [];
  const flags = {missingParent: false, deliveryFailure: false};
  ws.on('connection', socket => socket.on('message', data => {
    const req = JSON.parse(data); calls.push(req);
    if (req.method === 'initialize') socket.send(JSON.stringify({id: req.id, result: {}}));
    if (req.method === 'thread/read') socket.send(JSON.stringify(flags.missingParent ? {id: req.id, error: {message: 'Unknown parent'}} : {id: req.id, result: {thread: {id: thread, status: {type: 'idle'}}}}));
    if (req.method === 'turn/start') socket.send(JSON.stringify(flags.deliveryFailure ? {id: req.id, error: {message: 'fixture delivery failure'}} : {id: req.id, result: {turn: {id: 'turn-1', status: 'inProgress'}}}));
  }));
  const endpoint = 'ws://127.0.0.1:' + ws.address().port;
  const launch = async (agent, extra = []) => {
    const directory = join(root, agent); directories.push(directory);
    const args = [script, '--agent', agent, '--thread', thread, '--state', state, '--remote', endpoint, '--output-dir', directory, ...extra];
    const result = await exec(process.execPath, args, {timeout: 15000});
    return {directory, args, receipt: JSON.parse(result.stdout)};
  };
  const until = async (directory, status) => {
    for (let i = 0; i < 250; i++) {
      const receipt = JSON.parse(readFileSync(join(directory, 'callback.json'), 'utf8'));
      if (receipt.status === status) return receipt;
      await delay(20);
    }
    assert.fail('Callback did not reach ' + status + ': ' + readFileSync(join(directory, 'callback.json'), 'utf8'));
  };
  const complete = (agent, status = 'completed', fields = {}) => {
    const {socket, id} = waits.get(agent);
    socket.write(JSON.stringify({id, result: {content: [{type: 'text', text: JSON.stringify({agent_id: agent, status, wait_outcome: 'settled', answer: 'evidence', ...fields})}]}}) + '\n');
  };
  t.after(async () => {
    for (const directory of directories) {
      if (!existsSync(join(directory, 'callback.json'))) continue;
      const receipt = JSON.parse(readFileSync(join(directory, 'callback.json'), 'utf8'));
      if (['watching', 'connecting'].includes(receipt.status)) {writeFileSync(join(directory, 'cancel'), ''); await until(directory, 'cancelled');}
    }
    for (const socket of sockets) socket.destroy();
    for (const socket of ws.clients) socket.terminate();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => ws.close(resolve))]);
    // Detached children release their log handles as they exit on Windows.
    await delay(100);
    rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  });
  return {root, state, launch, until, complete, calls, requests, waits, flags};
}

test('Node listener detaches, waits once without timeout, and sends native completion', async t => {
  const f = await fixture(t), run = await f.launch('one');
  assert.equal(run.receipt.status, 'watching');
  await delay(100);
  assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 0);
  assert.deepEqual(f.requests.filter(x => x.method === 'tools/call').map(x => x.params), [{name: 'dsh_wait', arguments: {agent_id: 'one', legacy: true}}]);
  f.complete('one'); await f.until(run.directory, 'delivered');
  const output = JSON.parse(f.calls.find(x => x.method === 'turn/start').params.toolOutput.output);
  assert.equal(output.answer, 'evidence'); assert.equal(output.result_path, join(run.directory, 'result.json'));
});

test('independent listeners allow a fast task to return while another is pending', async t => {
  const f = await fixture(t), slow = await f.launch('slow'), fast = await f.launch('fast');
  f.complete('fast'); await f.until(fast.directory, 'delivered');
  assert.equal(JSON.parse(readFileSync(join(slow.directory, 'callback.json'), 'utf8')).status, 'watching');
});

test('cancel command stops notification without interrupting the DSH task', async t => {
  const f = await fixture(t), run = await f.launch('one');
  await exec(process.execPath, [script, '--cancel', '--output-dir', run.directory]);
  await f.until(run.directory, 'cancelled');
  assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 0);
  assert.equal(f.requests.some(x => x.params?.name === 'dsh_interrupt'), false);
});

test('closed and interrupted tasks do not notify; error and context exhaustion do', async t => {
  const f = await fixture(t);
  for (const status of ['closed', 'interrupted', 'error', 'context_exhausted']) {
    const run = await f.launch(status); f.complete(status, status);
    await f.until(run.directory, ['closed', 'interrupted'].includes(status) ? 'stopped' : 'delivered');
  }
  assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 2);
});

test('delivery failure retains the full result without retrying or using queue', async t => {
  const f = await fixture(t), run = await f.launch('one'); f.flags.deliveryFailure = true;
  f.complete('one'); const receipt = await f.until(run.directory, 'delivery_failed');
  assert.match(receipt.error, /fixture delivery failure/);
  assert.ok(existsSync(join(run.directory, 'result.json')));
  assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 1);
});

test('unknown parent fails preflight before DSH wait registration', async t => {
  const f = await fixture(t); f.flags.missingParent = true;
  await assert.rejects(f.launch('one'));
  assert.equal(f.requests.length, 0);
  await f.until(join(f.root, 'one'), 'setup_failed');
});

test('duplicate registration preserves the original receipt', async t => {
  const f = await fixture(t), run = await f.launch('one');
  const original = readFileSync(join(run.directory, 'callback.json'), 'utf8');
  await assert.rejects(exec(process.execPath, run.args));
  assert.equal(readFileSync(join(run.directory, 'callback.json'), 'utf8'), original);
});

test('long answers are truncated only inline and keep their full saved evidence', async t => {
  const f = await fixture(t), run = await f.launch('one'), answer = 'x'.repeat(12000);
  f.complete('one', 'completed', {answer, last_completed_answer: answer}); await f.until(run.directory, 'delivered');
  const output = JSON.parse(f.calls.find(x => x.method === 'turn/start').params.toolOutput.output);
  assert.equal(output.answer.length, 8000); assert.deepEqual(output.truncated_fields, ['answer']);
  assert.equal(output.last_completed_answer, undefined);
  assert.equal(JSON.parse(readFileSync(join(run.directory, 'result.json'), 'utf8')).answer, answer);
});
