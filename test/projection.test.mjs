import test from 'node:test';
import assert from 'node:assert/strict';
import {eventProjection, sanitize, wait, present, list} from '../src/projection.mjs';

test('public event projection keeps visible text and removes reasoning', () => {
  const row={seq:7,type:'descendant/session.event',data:{event:{type:'assistant/message'},text:'visible',reasoning:'hidden'}};
  assert.equal(eventProjection(row),null);
  assert.equal(eventProjection(row,{includeProgress:true}),null);
  assert.deepEqual(eventProjection(row,{includeProgress:true,includeDescendants:true}),{event_id:7,seq:7,type:'assistant/message',text:'visible',scope:'descendant'});
  assert.equal(sanitize({argument:'kept',reasoning:'removed'}).argument,'kept');
  assert.equal(sanitize({argument:'kept',analysis:'business field'}).analysis,'business field');
});

test('wait projection never promotes progress to a final answer', () => {
  const base={id:'a',status:'running',partial_text:'progress',answer:'stale'};
  assert.equal(wait({...base,wait_outcome:'timeout'}).answer,undefined);
  assert.equal(wait({...base,status:'error',wait_outcome:'settled'}).answer,undefined);
  assert.equal(wait({...base,status:'completed',answer:'final',wait_outcome:'settled'}).answer,'final');
});

test('presentation leads with an exact size and pushes identifiers to the end',()=>{
  const out=present({agent_id:'a',id:'a',status:'completed',name:'T2 binding',answer:'done'});
  const text=JSON.stringify(out);
  assert.equal(Object.keys(out)[0],'len');
  assert.equal(out.len,`${text.length} chars`);
  assert.deepEqual(Object.keys(out),['len','status','name','answer','agent_id','id']);
  const events=present({events:[{event_id:4,seq:4,type:'assistant/final',text:'hi'}],next_cursor:4,has_more:false});
  assert.deepEqual(Object.keys(events),['len','events','has_more','next_cursor']);
  assert.deepEqual(Object.keys(events.events[0]),['type','text','event_id','seq']);
  const listed=present([{id:'a',status:'running'}]);
  assert.deepEqual(Object.keys(listed),['len','count','items']);
  assert.equal(listed.count,1);
});

test('listings are bounded by rows and characters, and say what they dropped',()=>{
  const agents=Array.from({length:50},(_,i)=>({id:`id-${i}`,status:i<3?'running':'completed',name:`agent ${i}`,cwd:i<10?'/repo/a':'/repo/b',
    last_event:'tool/call',updated_at:'2026-09-20T10:00:00.000Z',finish_reason:i<3?undefined:{kind:'completed'},workspace_id:'w-'+i,context_tokens:1000+i}));

  const bounded=list(agents);
  assert.equal(bounded.count,20);
  // A long-silent running agent must not be pushed off the page by finished ones.
  const buried=list([...agents.slice(3),{id:'quiet',status:'running',name:'silent tool call',cwd:'/repo/a'}]);
  assert.equal(buried.items[0].agent_id,'quiet');
  assert.equal(bounded.total,50);
  assert.equal(bounded.matched,undefined,'an unfiltered listing has nothing to disambiguate');
  assert.match(bounded.omitted,/^30 more rows not shown \(row limit\)/);
  // A filter that finds nothing must not read as an empty store.
  const miss=list(agents,{match:'no such agent'});
  assert.deepEqual([miss.count,miss.matched,miss.total],[0,0,50]);
  assert.equal(bounded.items[0].agent_id,'id-0');
  // A completed turn says nothing status has not already said, and the row
  // carries its identifier once.
  assert.equal(bounded.items[3].finish_reason,undefined);
  assert.equal(bounded.items[3].id,undefined);
  assert.equal(bounded.items[3].workspace_id,undefined);
  assert.equal(bounded.items[0].progress,'tool/call');
  assert.equal(bounded.items[3].progress,undefined);

  const budgeted=list(agents,{maxChars:600});
  assert.ok(budgeted.count<20 && budgeted.count>0);
  assert.match(budgeted.omitted,/size budget/);
  assert.ok(JSON.stringify(budgeted).length<=600,'the budget covers the envelope, not just the rows');

  assert.equal(list(agents,{state:'running'}).matched,3);
  assert.equal(list(agents,{cwd:'/repo/a'}).matched,10);
  assert.equal(list(agents,{cwd:'/repo/a/'}).matched,10,'a trailing slash still matches the directory itself');
  assert.equal(list(agents,{match:'AGENT 44'}).matched,1,'name match ignores case');
  assert.equal(list(agents,{match:'agent 4'}).matched,11,'a name substring matches every agent 4x');
  assert.equal(list(agents,{match:'id-44'}).matched,1,'an id prefix finds one agent');
  assert.equal(list(agents,{match:'/repo/a'}).matched,10,'match also reaches the workspace');
  assert.equal(list(agents,{state:'running'}).total,50,'total always counts the whole store');
  // Ordering comes from the timestamp, not from the order the manager handed rows over.
  const shuffled=list([{id:'old',status:'completed',updated_at:'2026-01-01T00:00:00.000Z'},{id:'new',status:'completed',updated_at:'2026-09-01T00:00:00.000Z'}]);
  assert.deepEqual(shuffled.items.map(i=>i.agent_id),['new','old']);
  assert.equal(list(agents,{limit:50}).omitted,undefined);

  const failed=list([{id:'x',status:'error',name:'boom',finish_reason:{kind:'error',error:{message:'stack '.repeat(200)}},error:'detail '.repeat(200)}]);
  assert.ok(failed.items[0].finish_reason.length<140,'failure reason is clipped');
  assert.match(failed.items[0].error,/…\(\+1200\)$/,'a clipped error says how much it dropped');

  // legacy keeps the whole per-agent record, under the same bounds.
  const legacy=list(agents,{full:true,limit:2});
  assert.equal(legacy.count,2);
  assert.equal(legacy.items[0].workspace_id,'w-0');
  assert.match(legacy.omitted,/48 more rows/);
});
