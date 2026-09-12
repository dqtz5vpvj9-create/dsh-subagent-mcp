import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,appendFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runtimeConfig} from '../src/config.mjs';
import {Runtime} from '../src/runtime.mjs';

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
import {writeFileSync} from 'node:fs';
const req=createRequire(process.env.DSH_CLI);
const {renderPrompt}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-system-prompt')));
export const name='inspect-preset';
export const inject=['agents','systemPrompt'];
export function apply(ctx){
  ctx.on('agent/created',async ({agent})=>{
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
  for(let i=0;i<100&&!existsSync(snapshot);i++)await new Promise(r=>setTimeout(r,20));
  const actual=JSON.parse(readFileSync(snapshot,'utf8'));
  assert.equal(actual.prompt,'You are a helpful software engineer assistant.');
  assert.deepEqual(actual.tools,[process.platform==='win32'?'pwsh':'bash']);
  assert.deepEqual(actual.contexts,[]);
  await rt.close();
  const resumed=await initialize(true);
  assert.deepEqual(resumed,first);
});
