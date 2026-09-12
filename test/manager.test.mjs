import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Manager} from '../src/manager.mjs';
class Fake extends EventEmitter {
  static all=[];
  constructor(a){super();this.id=a.id;this.agent=a;this.calls=[];Fake.all.push(this);}
  async request(method,p){this.calls.push([method,p]);if(method==='session/prepare')return{cwd:this.agent.cwd,preset:this.agent.preset??null,workspace_id:'workspace-fixture'};if(method==='session/prompt'){this.emit('notification','session.status',{sessionId:this.id,status:'running'});return{messageId:'receipt'};}if(method==='session/cancel'){this.emit('notification','session.status',{sessionId:this.id,status:'idle'});}return{};}
  async close(){}
  finish(text,kind='completed'){
    this.emit('notification','session.event',{sessionId:this.id,event:{type:'assistant/message',data:{message:{content:[{type:'text',text}]}}}});
    this.emit('notification','session.event',{sessionId:this.id,event:{type:'turn/end',data:{reason:{kind}}}});
    this.emit('notification','session.status',{sessionId:this.id,status:'idle'});
  }
}
const tick=()=>new Promise(r=>setImmediate(r));
function setup(t){const dir=mkdtempSync(join(tmpdir(),'dsh-manager-test-'));const config={database:dir+'/db'};const m=new Manager(config,Fake);t.after(async()=>{await m.shutdown();rmSync(dir,{recursive:true});});return{m,dir,config};}
test('independent answers, progress cursors, and busy followups',async t=>{
  const{m,dir}=setup(t);const a=await m.start({cwd:dir,task:'A'}),b=await m.start({cwd:dir,task:'B'});await tick();
  await assert.rejects(m.followup(a.id,'conflicting'),/busy/);
  m.live.get(a.id).finish('A answer');m.live.get(b.id).finish('B answer');
  assert.equal(m.get(a.id).answer,'A answer');assert.equal(m.get(b.id).answer,'B answer');
  const page=m.events(a.id,0,1);assert.equal(page.events.length,1);assert.ok(m.events(a.id,page.next_cursor).events.every(e=>e.seq>page.next_cursor));
  await m.followup(a.id,'continue');assert.equal(m.live.get(a.id).calls.filter(c=>c[0]==='initialize').length,1);
});
test('interrupt preserves session and clears prior completion before followup',async t=>{
  const{m,dir}=setup(t);const a=await m.start({cwd:dir,task:'A'});await tick();const rt=m.live.get(a.id);
  await m.interrupt(a.id);assert.equal(m.get(a.id).status,'interrupted');
  await m.followup(a.id,'B');assert.equal(m.live.get(a.id),rt);assert.equal(m.get(a.id).answer,'');rt.finish('B');assert.equal(m.get(a.id).status,'completed');
});
test('max-token termination is not reported as completed',async t=>{
  const{m,dir}=setup(t);const a=await m.start({cwd:dir,task:'A'});await tick();m.live.get(a.id).finish('partial','max-tokens');assert.equal(m.get(a.id).status,'error');assert.equal(m.get(a.id).finish_reason.kind,'max-tokens');
});
test('child completion never overwrites root result',async t=>{
  const{m,dir}=setup(t);const a=await m.start({cwd:dir,task:'A'});await tick();
  m.live.get(a.id).emit('notification','session.status',{sessionId:'child',status:'idle'});assert.equal(m.get(a.id).status,'running');
});
test('service restart preserves unfinished agents without replaying prompts',async t=>{
  const{m,dir,config}=setup(t);const a=await m.start({cwd:dir,task:'A'});await tick();await m.shutdown();
  const restored=new Manager(config,Fake);
  try{
    assert.equal(restored.get(a.id).status,'interrupted');assert.equal(restored.live.size,0);
    await restored.followup(a.id,'explicit continuation');
    const rt=restored.live.get(a.id);assert.equal(rt.calls[0][1].resume,true);
    assert.equal(rt.calls.filter(c=>c[0]==='session/prompt').length,1);
  }finally{await restored.shutdown();}
});

test('new agents use minimal and keep explicit presets across runtime restart',async t=>{
  const{m,dir,config}=setup(t);
  const a=await m.start({cwd:dir,task:'default'});
  const b=await m.start({cwd:dir,task:'explicit',preset:'standard'});
  await tick();
  assert.equal(m.live.get(a.id).calls[0][1].preset,'minimal');
  assert.equal(m.live.get(b.id).calls[0][1].preset,'standard');
  assert.equal(m.get(a.id).preset,'minimal');
  assert.equal(m.get(a.id).workspace_id,'workspace-fixture');
  await m.shutdown();
  const restored=new Manager(config,Fake);
  try {
    await restored.followup(b.id,'continue');
    assert.equal(restored.live.get(b.id).calls[0][1].preset,'standard');
    assert.equal(restored.live.get(b.id).calls[0][1].resume,true);
  } finally {await restored.shutdown();}
});

test('legacy conversations retain their original composition on resume',async t=>{
  const{m,dir}=setup(t);
  const legacy={id:'legacy-session',cwd:dir,status:'interrupted',persisted:true,answer:'',partial_text:''};
  m.save(legacy);
  await m.followup(legacy.id,'continue');
  assert.equal(m.live.get(legacy.id).calls[0][1].preset,undefined);
  assert.equal(m.get(legacy.id).preset,null);
  assert.equal(m.get(legacy.id).workspace_id,'workspace-fixture');
});

test('completion releases the waiting parent, which continues in the same session',async t=>{
 const {m,dir}=setup(t);
 const a=await m.start({cwd:dir,task:'first'});await tick();
 const parent=m.wait(a.id,25).then(async result=>{
  assert.equal(result.status,'completed');assert.equal(result.wait_outcome,'settled');
  assert.equal(result.next_action,'review_and_continue');assert.equal(result.answer,'first result');
  return m.followup(a.id,'verify first result');
 });
 m.live.get(a.id).finish('first result');
 const resumed=await parent;
 assert.equal(resumed.id,a.id);assert.equal(resumed.status,'running');
 assert.equal(m.live.get(a.id).calls.filter(([method])=>method==='session/prompt').length,2);
 assert.equal(m.listenerCount('state:'+a.id),0);
});
test('timeout remains pending work and completion between waits is not lost',async t=>{
 const {m,dir}=setup(t);const a=await m.start({cwd:dir,task:'A'});await tick();
 const timed=await m.wait(a.id,0);
 assert.equal(timed.wait_outcome,'timeout');assert.equal(timed.next_action,'continue_waiting');
 m.live.get(a.id).finish('finished between calls');
 const done=await m.wait(a.id,25);
 assert.equal(done.wait_outcome,'settled');assert.equal(done.answer,'finished between calls');
});
test('text and descendant completion do not settle the root waiter; error does',async t=>{
 const {m,dir}=setup(t);const a=await m.start({cwd:dir,task:'A'});await tick();
 let returned=false;const waiting=m.wait(a.id,25).then(x=>{returned=true;return x;});
 const rt=m.live.get(a.id);
 rt.emit('notification','session.text',{sessionId:a.id,chunk:{text:'not final'}});
 rt.emit('notification','session.status',{sessionId:'descendant',status:'idle'});
 await tick();assert.equal(returned,false);
 rt.emit('exit',new Error('runtime failure'));
 const done=await waiting;assert.equal(done.status,'error');assert.equal(done.next_action,'handle_error');
});
test('cancelling a wait detaches the observer without cancelling the child',async t=>{
 const {m,dir}=setup(t);const a=await m.start({cwd:dir,task:'A'});await tick();
 const controller=new AbortController();const waiting=m.wait(a.id,25,controller.signal);
 controller.abort(new Error('parent wait cancelled'));
 await assert.rejects(waiting,/parent wait cancelled/);
 assert.equal(m.get(a.id).status,'running');assert.equal(m.listenerCount('state:'+a.id),0);
 const next=m.wait(a.id,25);await m.interrupt(a.id);
 assert.equal((await next).next_action,'respect_stop');
});

test('MCP wait response delivers completion and permits a dependent parent call',async t=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
 const {makeServer}=await import('../src/server.mjs');
 const {m,dir}=setup(t);const server=makeServer(m),client=new Client({name:'parent',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 t.after(async()=>{await client.close();await server.close();});
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.equal(r.isError,undefined);return JSON.parse(r.content[0].text);};
 const agent=await call('dsh_start',{cwd:dir,task:'produce evidence'});await tick();
 const pending=call('dsh_wait',{agent_id:agent.id,seconds:25});await tick();
 m.live.get(agent.id).finish('evidence ready');
 const done=await pending;assert.equal(done.answer,'evidence ready');assert.equal(done.next_action,'review_and_continue');
 const next=await call('dsh_followup',{agent_id:agent.id,task:'check evidence'});
 assert.equal(next.status,'running');assert.equal(next.id,agent.id);
});
