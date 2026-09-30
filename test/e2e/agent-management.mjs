// Real CLI -> live daemon -> DSH model -> persistence -> process reclamation.
// Run against a configured installation; no report is uploaded.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';

const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../../src/cli.mjs',import.meta.url));
const run=async(...args)=>JSON.parse((await exec(process.execPath,[cli,'agents',...args,'--json'],{timeout:180000})).stdout);
const service=async()=>JSON.parse((await exec(process.execPath,[cli,'status','--json'])).stdout);
const gone=pid=>{try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}};
async function released(id,pid) {
  for(let n=0;n<400;n++) {
    const state=await run('ps');
    if(!state.runtimes.some(row=>row.id===id)&&gone(pid))return;
    await delay(50);
  }
  throw new Error('Completed runtime was not reclaimed.');
}
const marker='MEMORY-'+randomUUID();
let id;
try {
  const first=await run('start','--cwd',process.cwd(),'--name','CLI runtime reclamation acceptance',
    '--permission','read-only','--task',`Remember ${marker}. Do not use tools. Reply only STORED.`);
  id=first.agent_id;
  for(let turn=0;turn<3;turn++) {
    if(turn)await run('followup',id.slice(0,12),'--task','Reply only with the token I asked you to remember. Do not use tools.');
    let pid;
    for(let n=0;n<400;n++) {
      pid=(await run('ps')).runtimes.find(row=>row.id===id)?.pid;
      if(pid)break;
      await delay(50);
    }
    assert.ok(pid,'Runtime PID must be observable.');
    const result=await run('wait',id);
    assert.equal(result.status,'completed');
    assert.match(result.answer,turn?new RegExp(marker):/STORED/);
    await released(id,pid);
    assert.equal((await run('show',id)).status,'completed');
    const saved=await run('result',id);
    assert.equal(saved.answer,result.answer);
    console.log(`Turn ${turn+1}: result saved, process exited, conversation remains resumable.`);
    if(turn===1) {
      const state=await service();assert.equal(state.active.length,0,'Do not restart unrelated active work.');
      await exec(process.execPath,[cli,'restart'],{timeout:30000});
    }
  }
  assert.ok((await run('list','--match',id)).items.some(row=>row.agent_id===id));
  assert.ok((await run('events',id)).events.length);
  const gc=await run('gc');assert.equal(gc.released,0);
  await run('followup',id,'--task','This is a cancellation test. Use the bash tool to run sleep 60. Do not write files. Reply DONE after the sleep.');
  const activePid=(await run('ps')).runtimes.find(row=>row.id===id)?.pid;
  assert.ok(activePid);
  assert.ok((await run('gc')).skipped>=1,'GC must leave active work running.');
  await run('interrupt',id);
  await released(id,activePid);
  assert.equal((await run('show',id)).status,'interrupted');
  console.log('Cancellation: active work survived GC; interruption reclaimed its process.');
  await run('close',id);assert.equal((await run('show',id)).status,'closed');
  console.log('CLI acceptance passed: restored memory, service restart, active-task protection, cancellation, zero retained task processes.');
} finally {
  if(id)await run('close',id).catch(()=>{});
}
