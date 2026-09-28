// Runs on the real acceptance machine. It never reads or exports credentials.
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const [action,run,phase='first',agentId] = process.argv.slice(2);
assert.match(run,/^[a-zA-Z0-9-]+$/);
const root=join(homedir(),'dsh-release-acceptance',run);
const workspace=join(root,'Project space 雪');
const config=join(process.env.LOCALAPPDATA,'dsh-subagent-mcp/config/installation.json');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const record=()=>read(config);
const cli=(...args)=>execFileSync(process.execPath,[join(record().root,'src/cli.mjs'),...args],{encoding:'utf8',timeout:120000});
const marker=`DSH_E2E_${run}_${phase}`;
function sessionFile(directory,id) {
  if(!existsSync(directory))return;
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory()){const found=sessionFile(path,id);if(found)return found;}
    else if(entry.name.endsWith(id+'.jsonl'))return path;
  }
}
if(action==='prepare') {
  mkdirSync(workspace,{recursive:true});mkdirSync(join(root,'callbacks'),{recursive:true});
  if(existsSync(config)) {
    const state=JSON.parse(cli('status','--json'));
    assert.equal(state.active.length,0,'An existing task is active; acceptance must not interrupt it.');
    cli('uninstall');
  }
  writeFileSync(join(root,'started.json'),JSON.stringify({started:Date.now(),run}));
  console.log(JSON.stringify({root,workspace,platform:process.platform,node:process.version}));
} else if(action==='wait') {
  const callbacks=join(root,'callbacks');
  const observationPath=join(root,phase+'-observation.json');
  const observation=existsSync(observationPath)?read(observationPath):{deadline:Date.now()+600000,watching:false};
  writeFileSync(observationPath,JSON.stringify(observation));
  const deadline=observation.deadline;
  let watching=observation.watching;
  while(Date.now()<deadline) {
    const receipts=[];
    for(const entry of readdirSync(callbacks,{withFileTypes:true})) {
      const file=join(callbacks,entry.name,'callback.json');
      if(!entry.isDirectory()||!existsSync(file))continue;
      const receipt=read(file);
      if(phase==='reopen'&&receipt.agent_id!==agentId)continue;
      if(phase==='reopen'&&existsSync(join(root,'first.json'))&&receipt.thread_id===read(join(root,'first.json')).threadId)continue;
      if(receipt.status==='watching'&&!watching){watching=true;observation.watching=true;writeFileSync(observationPath,JSON.stringify(observation));}
      if(['setup_failed','delivery_failed'].includes(receipt.status))throw new Error(`Native callback ${receipt.status}: ${receipt.error}`);
      if(receipt.status==='delivered')receipts.push(receipt);
    }
    const child=join(workspace,phase+'-child.txt'),parent=join(workspace,phase+'-verified.txt');
    if(receipts.length&&existsSync(child)&&existsSync(parent)) {
      const receipt=receipts.at(-1),result=read(receipt.result_path);
      assert.equal(readFileSync(child,'utf8'),marker);
      assert.equal(readFileSync(parent,'utf8'),marker+'_VERIFIED');
      assert.equal(receipt.delivery,'tool-output');assert.equal(result.status,'completed');
      const path=sessionFile(join(homedir(),'.codex/sessions'),receipt.thread_id);
      if(!path){await delay(1000);continue;}
      const items=readFileSync(path,'utf8').trim().split(/\r?\n/).map(JSON.parse);
      const calls=items.filter(x=>x.type==='response_item'&&['function_call','custom_tool_call'].includes(x.payload?.type));
      const delegated=calls.some(x=>JSON.stringify(x.payload).includes(phase==='first'?'dsh_start':'dsh_followup'));
      const delivered=items.filter(x=>x.type==='response_item'&&x.payload?.type==='function_call_output'&&x.payload.name==='dsh_completion');
      const accepted=items.some(x=>x.type==='event_msg'&&x.payload?.type==='task_complete'&&x.payload.last_agent_message?.includes('ACCEPTED'));
      if(!accepted){await delay(1000);continue;}
      const waiting=items.findIndex(x=>x.type==='event_msg'&&x.payload?.type==='task_complete'&&x.payload.last_agent_message?.includes('WAITING'));
      const completion=items.findIndex(x=>x.type==='response_item'&&x.payload?.name==='dsh_completion');
      assert.ok(waiting>=0&&waiting<completion,'The parent must finish its waiting turn before native completion arrives.');
      assert.ok(delegated,'The real Codex parent must delegate through MCP.');
      assert.ok(delivered.length,'The real Codex rollout must contain native completion tool output.');
      assert.ok(watching,'The test must observe a registered pending callback.');
      const report={ok:true,phase,host:process.env.COMPUTERNAME,node:process.version,version:record().version,backend:record().backend,
        agentId:receipt.agent_id,threadId:receipt.thread_id,callback:receipt.status,nativeCallbackItems:delivered.length,
        delegated,childArtifactVerified:true,parentArtifactVerified:true,observedPendingCallback:watching,parentIdleBeforeCallback:true,parentTurnCompleted:accepted};
      writeFileSync(join(root,phase+'.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify(report));process.exit(0);
    }
    await delay(1000);
  }
  throw new Error('Real Codex/DSH completion and artifact acceptance did not finish within the test deadline.');
} else if(action==='restart') {
  const before=JSON.parse(cli('status','--json'));assert.equal(before.active.length,0);
  cli('restart');
  const after=JSON.parse(cli('status','--json'));assert.equal(after.running,true);
  assert.notEqual(after.pid,before.pid);
  assert.equal(JSON.parse(cli('doctor','--json')).ok,true);
  console.log(JSON.stringify({ok:true,restarted:true,pidChanged:true}));
} else if(action==='cleanup') {
  // Only this run's listeners and exact workspace belong to this test.
  const callbacks=join(root,'callbacks');
  if(existsSync(callbacks))for(const entry of readdirSync(callbacks,{withFileTypes:true})) {
    const file=join(callbacks,entry.name,'callback.json');
    if(entry.isDirectory()&&existsSync(file))writeFileSync(join(callbacks,entry.name,'cancel'),'');
  }
  const interrupted=[];
  if(existsSync(config)) {
    const {bridgeClient}=await import(pathToFileURL(join(record().root,'src/bridge-client.mjs')));
    const {locations}=await import(pathToFileURL(join(record().root,'src/platform.mjs')));
    const client=await bridgeClient(locations().state);
    try {
      const reply=await client.request('tools/call',{name:'dsh_list',arguments:{cwd:workspace,legacy:true}});
      assert.ok(!reply.isError);
      const rows=JSON.parse(reply.content.find(x=>x.type==='text').text);
      for(const task of rows.items)if(task.cwd===workspace&&['starting','running','interrupting'].includes(task.status)) {
        const result=await client.request('tools/call',{name:'dsh_interrupt',arguments:{agent_id:task.agent_id??task.id}});
        assert.ok(!result.isError);interrupted.push(task.agent_id??task.id);
      }
    } finally {client.close();}
  }
  console.log(JSON.stringify({ok:true,interrupted}));
} else if(action==='diagnose') {
  const out={installed:existsSync(config),artifacts:existsSync(workspace)?readdirSync(workspace):[]};
  if(out.installed){out.version=record().version;try{out.service=JSON.parse(cli('status','--json'));}catch{out.service={running:false};}}
  console.log(JSON.stringify(out));
} else throw new Error('Unknown acceptance action');
