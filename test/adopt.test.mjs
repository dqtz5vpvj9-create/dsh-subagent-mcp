import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {zstdCompressSync, zstdDecompressSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {adoptLog, locate} from '../src/adopt.mjs';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const read = log => {
  const data = readFileSync(log);
  const bounds = [];
  for (let at = data.indexOf(MAGIC); at >= 0; at = data.indexOf(MAGIC, at + 4)) bounds.push(at);
  return bounds.map((start, index) => zstdDecompressSync(data.subarray(start, bounds[index + 1] ?? data.length)).toString('utf8'))
    .join('').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
};

// DSH writes a session as concatenated zstd frames, the header alone in the
// first. The fixture mirrors that layout, including a log split across frames.
function store(t, id, header, events) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-adopt-test-'));
  t.after(() => rmSync(root, {recursive: true}));
  const dir = join(root, '--project--', id);
  mkdirSync(dir, {recursive: true});
  const log = join(dir, 'session.v3.jsonl.zstd');
  const frame = lines => zstdCompressSync(Buffer.from(lines.map(line => JSON.stringify(line) + '\n').join('')));
  writeFileSync(log, Buffer.concat([frame([header]), frame(events.slice(0, 1)), frame(events.slice(1))]));
  return {root, log};
}

test('adoption re-parents a session on disk without disturbing its log', async t => {
  const id = '11111111-2222-3333-4444-555555555555';
  const header = {type: 'session', version: 3, id, createdAt: 1789599052037, cwd: '/work', isSeeded: false, delegationDepth: 0, agentPreset: 'minimal'};
  const events = [
    {type: 'permission/preset', seq: 0, time: 1, data: {preset: 'workspace-write'}},
    {type: 'turn/start', seq: 1, time: 2, data: {turn: 1}},
    {type: 'turn/end', seq: 2, time: 3, data: {turn: 1, reason: {kind: 'completed'}}},
  ];
  const {root, log} = store(t, id, header, events);

  assert.deepEqual(locate(id, root), {log, lock: join(root, '--project--', id, 'session.lock')});
  assert.equal(locate('missing-id', root), undefined);

  assert.equal(adoptLog(log, {parent: 'session-parent', label: '旧式会话'}), 'adopted');
  const lines = read(log);
  assert.deepEqual(lines[0], {...header, parentSession: 'session-parent', origin: 'subagent', delegationDepth: 1});
  // The log behind the header is carried over byte for byte.
  assert.deepEqual(lines.slice(1, 4), events);
  const descriptor = lines.at(-1);
  assert.equal(descriptor.type, 'subagent/descriptor');
  assert.deepEqual(descriptor.data, {version: 3, mode: 'one-shot', provider: 'dsh-subagent-mcp', label: '旧式会话'});
  assert.equal(descriptor.seq, 3, 'the appended event continues the sequence');

  // Running it twice must not stack descriptors or re-stamp the header.
  const before = readFileSync(log);
  assert.equal(adoptLog(log, {parent: 'session-other', label: 'again'}), 'already-adopted');
  assert.deepEqual(readFileSync(log), before);
});

test('adoption keeps a descriptor the session already carries', async t => {
  const id = '99999999-8888-7777-6666-555555555555';
  const header = {type: 'session', version: 3, id, createdAt: 1, cwd: '/work', isSeeded: false, delegationDepth: 0};
  const events = [
    {type: 'subagent/descriptor', seq: 0, time: 1, data: {version: 3, mode: 'one-shot', provider: 'dsh-subagent-mcp', label: 'first'}},
    {type: 'turn/start', seq: 1, time: 2, data: {turn: 1}},
  ];
  const {log} = store(t, id, header, events);
  assert.equal(adoptLog(log, {parent: 'session-parent', label: 'second'}), 'adopted');
  const descriptors = read(log).filter(line => line.type === 'subagent/descriptor');
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].data.label, 'first');
});
