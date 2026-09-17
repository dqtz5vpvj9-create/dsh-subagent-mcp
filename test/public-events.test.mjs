import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Manager} from '../src/manager.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-events-test-'));
  const manager = new Manager({database: join(dir, 'state.sqlite')});
  manager.save({id: 'fixture', status: 'completed', answer: '', partial_text: ''});
  t.after(async () => { await manager.shutdown(); rmSync(dir, {recursive: true}); });
  return manager;
}

function readAll(manager, options = {}, budget = 500) {
  let cursor = 0;
  const events = [];
  for (let n = 0; n < 1000; n++) {
    const page = manager.publicEvents('fixture', cursor, 2, {...options, maxChars: budget});
    assert.ok(JSON.stringify(page).length <= budget, `page exceeds ${budget} characters: ${JSON.stringify(page).length}`);
    events.push(...page.events);
    if (!page.has_more) return events;
    assert.notEqual(page.next_cursor, cursor, 'continuation must advance');
    cursor = page.next_cursor;
  }
  assert.fail('pagination did not terminate');
}

test('public events read native stored text and skip empty messages and tool tails', t => {
  const m = fixture(t);
  m.event('fixture', 'assistant/message', {text: ''});
  m.event('fixture', 'assistant/message', {text: 'visible'});
  m.event('fixture', 'tool/result', {output: 'not default output'});
  const events = readAll(m);
  assert.deepEqual(events.map(e => e.text), ['visible']);
});

test('bounded pages preserve all escaped assistant text across multiple events', t => {
  const m = fixture(t);
  const messages = ['"\\\n中😀'.repeat(170), 'second'.repeat(130), 'last'];
  for (const text of messages) m.event('fixture', 'assistant/message', {text});
  const parts = readAll(m, {}, 256);
  const joined = new Map();
  for (const part of parts) joined.set(part.event_id, (joined.get(part.event_id) ?? '') + part.text);
  assert.deepEqual([...joined.values()], messages);
});

test('budget exhaustion must advertise remaining short events', t => {
  const m = fixture(t);
  for (let n = 0; n < 8; n++) m.event('fixture', 'assistant/message', {text: `message-${n}-` + 'x'.repeat(110)});
  const events = readAll(m, {}, 350);
  const unique = new Set(events.map(e => e.event_id));
  assert.equal(unique.size, 8);
});

test('targeted large tool payload can be reconstructed exactly', t => {
  const m = fixture(t);
  const payload = {name: 'shell', arguments: {prompt: 'user input', analysis: 'business field'}, output: '"\\\n😀'.repeat(250)};
  m.event('fixture', 'tool/result', payload);
  const id = m.events('fixture').events[0].seq;
  const parts = readAll(m, {includeToolEvents: true, eventId: id}, 300);
  const restored = parts.length === 1 && parts[0].data !== undefined
    ? parts[0].data : JSON.parse(parts.map(e => e.data_chunk ?? '').join(''));
  assert.deepEqual(restored, payload);
});

test('descendant visible text excludes reasoning content blocks', t => {
  const m = fixture(t);
  m.event('fixture', 'descendant/session.event', {sessionId: 'child', event: {
    type: 'assistant/message', data: {message: {content: [
      {type: 'reasoning', text: 'hidden'}, {type: 'thinking', thinking: 'hidden too'}, {type: 'text', text: 'visible child'},
    ]}},
  }});
  assert.deepEqual(readAll(m).map(e => e.text), ['visible child']);
});

test('historical truncated records remain explicitly truncated', t => {
  const m = fixture(t);
  m.event('fixture', 'tool/result', {preview: 'old preview', truncated: true, session_seq: 7});
  const id = m.events('fixture').events[0].seq;
  const page = m.publicEvents('fixture', 0, 30, {includeToolEvents: true, eventId: id, maxChars: 1000});
  assert.equal(page.events[0].data.truncated, true);
  assert.equal(page.events[0].data.preview, 'old preview');
});

test('filtered scan batches advance to later assistant messages', t => {
  const m = fixture(t);
  m.db.exec('BEGIN');
  for (let n = 0; n < 10005; n++) m.event('fixture', 'tool/result', {output: 'skip'});
  m.event('fixture', 'assistant/message', {text: 'after tool batch'});
  m.db.exec('COMMIT');
  assert.deepEqual(readAll(m).map(e => e.text), ['after tool batch']);
});

test('native and descendant tool result summaries exclude message bodies', t => {
  const m = fixture(t);
  const body = 'large tool output '.repeat(1000);
  const data = {turn: 1, step: 2, message: {source: {callId: 'call-1'}, role: 'tool', id: 'result-1', content: [{type: 'text', text: body}]}};
  m.event('fixture', 'tool/result', data);
  m.event('fixture', 'descendant/session.event', {sessionId: 'child', event: {type: 'tool/result', data}});
  const events = readAll(m, {includeToolEvents: true}, 1000);
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.ok(event.summary, 'tool event should remain a summary');
    assert.equal(event.data_chunk, undefined);
    assert.ok(!JSON.stringify(event).includes('large tool output'));
    assert.ok(Object.values(event.summary).every(value => value === null || typeof value !== 'object'));
  }
});
