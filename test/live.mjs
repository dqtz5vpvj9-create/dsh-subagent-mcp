import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeConfig} from '../src/config.mjs';
import {Manager} from '../src/manager.mjs';
const cwd=mkdtempSync(join(tmpdir(),'dsh-live-'));
const config=runtimeConfig(join(cwd,'state'));
let m=new Manager(config);
const report={started:new Date().toISOString(),checks:[]};
const check=(name,data)=>{report.checks.push({name,...data});console.log(name,JSON.stringify(data));};
async function idle(id){for(let i=0;i<120;i++){const a=m.get(id);if(!['starting','running','interrupting'].includes(a.status))return a;await new Promise(r=>setTimeout(r,500));}throw new Error('Agent never became idle');}
try {
  const a=await m.start({cwd,permission:'read-only',effort:'high',task:'Remember the token ORCHID-742. Reply only STORED. Do not use tools.'});
  let s=await idle(a.id);assert.equal(s.status,'completed');assert.match(s.answer,/STORED/);check('initial',{id:a.id,status:s.status,answer:s.answer});
  await m.followup(a.id,'What token did I ask you to remember? Reply only with the token. Do not use tools.');
  s=await idle(a.id);assert.match(s.answer,/ORCHID-742/);check('followup',{answer:s.answer});
  await m.shutdown();m=new Manager(config);
  await m.followup(a.id,'Repeat the remembered token again. Reply only with the token. Do not use tools.');
  s=await idle(a.id);assert.equal(s.status,'completed');assert.match(s.answer,/ORCHID-742/);check('resume_after_restart',{answer:s.answer});
  const b=await m.start({cwd,permission:'workspace-write',effort:'high',task:'This is a cancellation test. Use the bash tool to run exactly: sleep 45; printf finished > cancel-should-not-exist.txt . Do not run anything else. After the command exits reply FINISHED.'});
  let toolStarted=false;
  for(let i=0;i<120;i++) {const ev=m.events(b.id,0,100).events;if(ev.some(e=>e.type==='tool/call')){toolStarted=true;break;}if(m.get(b.id).status==='error')break;await new Promise(r=>setTimeout(r,250));}
  assert.ok(toolStarted,JSON.stringify(m.get(b.id)));
  const before=m.events(b.id,0,100);check('progress',{id:b.id,types:before.events.map(e=>e.type)});
  s=await m.interrupt(b.id);assert.equal(s.status,'interrupted');assert.equal(existsSync(cwd+'/cancel-should-not-exist.txt'),false);check('interrupt',{status:s.status,finish_reason:s.finish_reason});
  await m.followup(b.id,'The sleep task is cancelled. Do not run it again. Reply only CONTINUED, without using tools.');
  s=await idle(b.id);assert.equal(s.status,'completed');assert.match(s.answer,/CONTINUED/);check('followup_after_interrupt',{answer:s.answer});
  await m.close(a.id);await m.close(b.id);
  report.ok=true;
}catch(e){report.ok=false;report.error=e.stack;console.error(e);process.exitCode=1;}
finally{await m.shutdown();report.finished=new Date().toISOString();writeFileSync(new URL('../validation-live.json',import.meta.url),JSON.stringify(report,null,2)+'\n');if(report.ok)rmSync(cwd,{recursive:true});}
