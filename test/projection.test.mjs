import test from 'node:test';
import assert from 'node:assert/strict';
import {eventProjection, sanitize, wait} from '../src/projection.mjs';

test('public event projection keeps visible text and removes reasoning', () => {
  const row={seq:7,type:'descendant/session.event',data:{event:{type:'assistant/message'},text:'visible',reasoning:'hidden'}};
  assert.deepEqual(eventProjection(row),{event_id:7,seq:7,type:'assistant/message',text:'visible'});
  assert.equal(sanitize({argument:'kept',reasoning:'removed'}).argument,'kept');
  assert.equal(sanitize({argument:'kept',analysis:'business field'}).analysis,'business field');
});

test('wait projection never promotes progress to a final answer', () => {
  const base={id:'a',status:'running',partial_text:'progress',answer:'stale'};
  assert.equal(wait({...base,wait_outcome:'timeout'}).answer,undefined);
  assert.equal(wait({...base,status:'error',wait_outcome:'settled'}).answer,undefined);
  assert.equal(wait({...base,status:'completed',answer:'final',wait_outcome:'settled'}).answer,'final');
});
