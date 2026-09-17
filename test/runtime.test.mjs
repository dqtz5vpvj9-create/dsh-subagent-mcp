import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,appendFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runtimeConfig} from '../src/config.mjs';
import {Runtime} from '../src/runtime.mjs';
import {readHistory} from '../src/web-relay.mjs';

test('real DSH persists workspace membership and mounts minimal before execution and resume',
  {skip:process.env.DSH_RUNTIME_TEST!=='1',timeout:60000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'dsh-runtime-test-'));
  const previous=process.env.DSH_HOME;
  process.env.DSH_HOME=join(dir,'home');
  const profile=join(process.env.DSH_HOME,'profiles/codex-subagent');
  mkdirSync(profile,{recursive:true});
  writeFileSync(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-test',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-sdk-app'],patchReload:'startup'}}}));
  writeFileSync(join(profile,'cordis.yml'),'[]\n');
  writeFileSync(join(profile,'cordis.patch.yml'),'[]\n');
  const config=runtimeConfig(join(dir,'state'));
  const snapshot=join(dir,'snapshot.json');
  const hook=join(dir,'inspect.mjs');
  writeFileSync(hook,`
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {writeFileSync,existsSync,unlinkSync} from 'node:fs';
const req=createRequire(process.env.DSH_CLI);
const {renderPrompt}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-system-prompt')));
export const name='inspect-preset';
export const inject=['agents','systemPrompt'];
export function apply(ctx){
  ctx.on('agent/created',async ({agent})=>{
    const timer=setInterval(()=>{
      if(existsSync(${JSON.stringify(join(dir,'append-title'))})){
        unlinkSync(${JSON.stringify(join(dir,'append-title'))});
        agent.session.append('session/title',{title:'Live relay update',messageSeqs:[],source:{kind:'user'}});
      }
    },20);
    ctx.effect(()=>()=>clearInterval(timer),'test-title-trigger');
    try {
      const assembly=await agent.ctx.systemPrompt.assemble({scope:agent});
      writeFileSync(${JSON.stringify(snapshot)},JSON.stringify({prompt:renderPrompt(assembly),tools:assembly.tools.map(t=>t.name),contexts:assembly.contexts}));
    } catch(e){writeFileSync(${JSON.stringify(snapshot)},JSON.stringify({error:e.stack}));}
  });
}
`);
  appendFileSync(config.patch,`- insert:\n    - id: inspect-preset\n      name: ${JSON.stringify(hook)}\n`);
  const agent={id:randomUUID(),cwd:dir,preset:'minimal'};
  let rt;
  t.after(async()=>{await rt?.close();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;rmSync(dir,{recursive:true});});
  const initialize=async resume=>{
    rt=new Runtime(agent,config);
    rt.on('exit',()=>{});
    await rt.request('initialize',{cwd:dir,provider:'deepseek-official',model:'deepseek-v4-flash',permission:'read-only',preset:'minimal',resume});
    return rt.request('session/prepare',{sessionId:agent.id});
  };
  const first=await initialize(false);
  assert.equal(first.cwd,dir);assert.equal(first.preset,'minimal');assert.deepEqual(first.session_ids,[agent.id]);assert.ok(first.workspace_id);
  for(let i=0;i<500&&!existsSync(snapshot);i++)await new Promise(r=>setTimeout(r,20));
  const actual=JSON.parse(readFileSync(snapshot,'utf8'));
  assert.equal(actual.prompt,'You are a helpful software engineer assistant.');
  assert.deepEqual(actual.tools,[process.platform==='win32'?'pwsh':'bash']);
  assert.deepEqual(actual.contexts,[]);
  const request={address:{kind:'session',sessionId:agent.id},assistantStream:true};
  const abort=new AbortController();
  const stream=readHistory(join(dir,'state/web',agent.id+'.sock'),'follow',request,abort.signal);
  const opening=await stream.next();
  assert.equal(opening.value.type,'snapshot');
  writeFileSync(join(dir,'append-title'),'');
  const update=await stream.next();
  assert.equal(update.value.event.type,'session/title');
  assert.equal(update.value.event.data.title,'Live relay update');
  assert.equal(update.value.event.seq,opening.value.cursor+1);
  abort.abort();await stream.return();
  await rt.close();
  const resumed=await initialize(true);
  assert.deepEqual(resumed,first);
  const reopened=readHistory(join(dir,'state/web',agent.id+'.sock'),'follow',request,new AbortController().signal);
  const reconnect=await reopened.next();
  assert.ok(reconnect.value.records.some(r=>r.event?.data?.title==='Live relay update'));
  await reopened.return();
  assert.deepEqual(JSON.parse(readFileSync(snapshot,'utf8')),actual);
});

test('real DSH standard preset prepares in an isolated state',
  {skip:process.env.DSH_RUNTIME_TEST!=='1',timeout:60000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'dsh-standard-test-'));
  const previous=process.env.DSH_HOME;
  process.env.DSH_HOME=join(dir,'home');
  const profile=join(process.env.DSH_HOME,'profiles/codex-subagent');
  mkdirSync(profile,{recursive:true});
  writeFileSync(join(profile,'package.json'),JSON.stringify({name:'dsh-standard-test',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-sdk-app'],patchReload:'startup'}}}));
  writeFileSync(join(profile,'cordis.yml'),'[]\n'); writeFileSync(join(profile,'cordis.patch.yml'),'[]\n');
  const config=runtimeConfig(join(dir,'state'));
  assert.match(readFileSync(config.patch,'utf8'),/dsh-tool-subagent\/model-selection-settings/);
  assert.match(readFileSync(config.patch,'utf8'),/- id: compaction-basic\n  disabled: true/);
  const hook=join(dir,'inspect-standard.mjs'),snapshot=join(dir,'standard-snapshot.json');
  writeFileSync(hook,`import {writeFileSync} from 'node:fs'; export const name='inspect-standard'; export const inject=['agents','systemPrompt','agentPresets']; export function apply(ctx){ctx.on('agent/created',async ({agent})=>{try {const assembly=await agent.ctx.systemPrompt.assemble({scope:agent});writeFileSync(${JSON.stringify(snapshot)},JSON.stringify({hasCompaction:Boolean(ctx.agentPresets.serviceFor(agent,'compaction')),autoCompaction:ctx.agentPresets.serviceFor(agent,'compaction')?.config.auto,hasPruner:Boolean(ctx.agentPresets.serviceFor(agent,'toolResultPruner')),tools:assembly.tools.map(t=>t.name)}));}catch(e){writeFileSync(${JSON.stringify(snapshot)},JSON.stringify({error:e.message}));}});}`);
  appendFileSync(config.patch,`- insert:\n    - id: inspect-standard\n      name: ${JSON.stringify(hook)}\n`);
  const agent={id:randomUUID(),cwd:dir,preset:'standard'}; let rt;
  t.after(async()=>{await rt?.close();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;rmSync(dir,{recursive:true});});
  rt=new Runtime(agent,config); rt.on('exit',()=>{});
  await rt.request('initialize',{cwd:dir,provider:'deepseek-official',model:'deepseek-v4-flash',permission:'read-only',preset:'standard',resume:false});
  const prepared=await rt.request('session/prepare',{sessionId:agent.id});
  assert.equal(prepared.cwd,dir); assert.equal(prepared.preset,'standard'); assert.deepEqual(prepared.session_ids,[agent.id]); assert.ok(prepared.workspace_id);
  for(let i=0;i<250&&!existsSync(snapshot);i++)await new Promise(r=>setTimeout(r,20));
  const inspected=JSON.parse(readFileSync(snapshot,'utf8'));
  assert.equal(inspected.hasCompaction,true);
  assert.equal(inspected.autoCompaction,true);
  assert.equal(inspected.hasPruner,true);
  assert.equal(new Set(inspected.tools).size,inspected.tools.length);
});
