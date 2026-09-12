// Real DSH + MCP acceptance: a completed child triggers dependent parent work.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Manager} from '../src/manager.mjs';
import {runtimeConfig} from '../src/config.mjs';
import {makeServer} from '../src/server.mjs';
const dir=mkdtempSync(join(tmpdir(),'dsh-completion-'));
const previous=process.env.DSH_HOME;process.env.DSH_HOME=join(dir,'home');
const profile=join(process.env.DSH_HOME,'profiles/codex-subagent');mkdirSync(profile,{recursive:true});
writeFileSync(join(profile,'package.json'),JSON.stringify({name:'completion-test',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-sdk-app'],patchReload:'startup'}}}));
writeFileSync(join(profile,'cordis.yml'),'[]\n');writeFileSync(join(profile,'cordis.patch.yml'),'[]\n');
const manager=new Manager(runtimeConfig(join(dir,'state'))),server=makeServer(manager);
const client=new Client({name:'completion-parent',version:'1'});
const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(r.content[0].text);return JSON.parse(r.content[0].text);};
const wait=async id=>{
 for(let i=0;i<8;i++){
  const done=await call('dsh_wait',{agent_id:id,seconds:25});
  if(done.wait_outcome==='settled'){assert.equal(done.status,'completed',done.error??done.answer);return done;}
  assert.equal(done.next_action,'continue_waiting');console.log('Observation window elapsed; parent continues waiting.');
 }
 throw new Error('Acceptance test deadline exceeded');
};
try {
 const agent=await call('dsh_start',{cwd:dir,permission:'workspace-write',effort:'high',task:'Use bash to write exactly 21 into child.txt in the current directory, then reply CHILD_READY. Do nothing else.'});
 const done=await wait(agent.id);assert.equal(done.next_action,'review_and_continue');assert.equal(readFileSync(join(dir,'child.txt'),'utf8').trim(),'21');
 writeFileSync(join(dir,'parent.txt'),String(Number(readFileSync(join(dir,'child.txt'),'utf8'))*2));
 assert.equal(readFileSync(join(dir,'parent.txt'),'utf8'),'42');
 console.log('PASS: real child completion delivered via MCP; parent checked its artifact and produced the dependent result.');
 await call('dsh_followup',{agent_id:agent.id,task:'Read parent.txt using bash. Reply only the value you read.'});
 const followup=await wait(agent.id);assert.equal(followup.answer.trim(),'42');
 console.log('PASS: same child verified the parent result in a follow-up, without user prompting.');
} finally {await client.close();await server.close();await manager.shutdown();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;rmSync(dir,{recursive:true});}
