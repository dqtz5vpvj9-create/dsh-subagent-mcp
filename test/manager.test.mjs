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
