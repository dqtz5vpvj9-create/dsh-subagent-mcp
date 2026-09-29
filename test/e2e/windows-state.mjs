// Read-only observations accompany public user commands on the acceptance host.
// Credential files and callback bearer tokens are never included in reports.
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const [action,run,phase='first',argument] = process.argv.slice(2);
assert.match(run,/^[a-zA-Z0-9-]+$/);
const root=join(homedir(),'dsh-release-acceptance',run);
const workspace=join(root,'Project space 雪');
const callbacks=join(root,'callbacks');
const config=join(process.env.LOCALAPPDATA,'dsh-subagent-mcp/config/installation.json');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const record=()=>read(config);
const cli=(...args)=>execFileSync(process.execPath,[join(record().root,'src/cli.mjs'),...args],{encoding:'utf8',timeout:120000,cwd:workspace});
const marker=`DSH_E2E_${run}_${phase}`;
const write=(name,value)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2));
function sessionFile(directory,id) {
  if(!existsSync(directory))return;
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory()){const found=sessionFile(path,id);if(found)return found;}
    else if(entry.name.endsWith(id+'.jsonl'))return path;
  }
}
function rollout(id) {
  const path=sessionFile(join(homedir(),'.codex/sessions'),id);
  if(!path)return [];
  // An actively written final line is not yet an event.
  const lines=readFileSync(path,'utf8').split(/\r?\n/);lines.pop();
  return lines.filter(Boolean).map(JSON.parse);
}
function recentThread(since) {
  const search=directory=>{
    if(!existsSync(directory))return;
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name);
      if(entry.isDirectory()){const found=search(path);if(found)return found;}
      else if(entry.name.endsWith('.jsonl')&&statSync(path).mtimeMs>=since) {
        const first=readFileSync(path,'utf8').split('\n',1)[0];
        if(!first)continue;
        const meta=JSON.parse(first);
        if(meta.type==='session_meta'&&meta.payload.cwd===workspace&&Date.parse(meta.timestamp)>=since)return meta.payload.id;
      }
    }
  };
  return search(join(homedir(),'.codex/sessions'));
}
function receipts() {
  const directory=existsSync(config)?join(record().state,'callbacks'):callbacks;
  if(!existsSync(directory))return [];
  return readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory())
    .map(entry=>join(directory,entry.name,'callback.json')).filter(existsSync)
    .map(file=>({...read(file),file}));
}
function calls(items,name) {
  return items.filter(x=>x.type==='response_item'&&['function_call','custom_tool_call'].includes(x.payload?.type)&&
    (new RegExp(name+'$').test(x.payload.name)||new RegExp('[A-Za-z_]*'+name+'\\s*\\(').test(x.payload.input??x.payload.arguments??'')));
}
async function ownedTasks() {
  const {bridgeClient}=await import(pathToFileURL(join(record().root,'src/bridge-client.mjs')));
  const {locations}=await import(pathToFileURL(join(record().root,'src/platform.mjs')));
  const client=await bridgeClient(locations().state);
  try {
    const reply=await client.request('tools/call',{name:'dsh_list',arguments:{cwd:workspace,legacy:true}});
    assert.ok(!reply.isError);
    return JSON.parse(reply.content.find(x=>x.type==='text').text).items.filter(task=>task.cwd===workspace);
  } finally {client.close();}
}
if(action==='prepare') {
  mkdirSync(workspace,{recursive:true});mkdirSync(callbacks,{recursive:true});
  if(existsSync(config)) {
    const state=JSON.parse(cli('status','--json'));
    assert.equal(state.active.length,0,'An existing task is active; acceptance must not interrupt it.');
    cli('uninstall');
  }
  write('started',{started:Date.now(),run});
  console.log(JSON.stringify({root,workspace,platform:process.platform,node:process.version}));
} else if(action==='configure-before'||action==='configure-after') {
  const provider=join(process.env.LOCALAPPDATA,'dsh-subagent-mcp/config/provider.json');
  const metadata=existsSync(provider)?{size:statSync(provider).size,modified:statSync(provider).mtimeMs}:null;
  if(action==='configure-before')write('configure-provider-before',metadata);
  else assert.deepEqual(metadata,read(join(root,'configure-provider-before.json')),'Cancelling configure must preserve the existing provider settings');
  console.log(JSON.stringify({ok:true,providerSettingsUntouched:action==='configure-after'}));
} else if(action==='begin') {
  const thread=argument||undefined;
  write(phase+'-observation',{started:Date.now(),deadline:Date.now()+720000,callbacks:receipts().map(item=>item.file),
    threadId:thread,lineStart:thread?rollout(thread).length:0,taskIds:(await ownedTasks()).map(task=>task.agent_id??task.id)});
  console.log(JSON.stringify({ok:true,phase}));
} else if(['pending','accepted','denied'].includes(action)) {
  const observed=read(join(root,phase+'-observation.json'));
  while(Date.now()<observed.deadline) {
    if(action==='denied') {
      const tasks=await ownedTasks();
      assert.equal(tasks.filter(task=>!observed.taskIds.includes(task.agent_id??task.id)).length,0,'Rejecting authorization must not start a DSH task');
      const thread=observed.threadId||recentThread(observed.started);
      if(!thread){await delay(1000);continue;}
      const items=rollout(thread).slice(observed.lineStart);
      const denial=items.findIndex(item=>item.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(item.payload?.type)&&/reject|denied|declined|cancelled|canceled/i.test(JSON.stringify(item.payload.output)));
      const finished=items.slice(denial+1).some(item=>item.type==='event_msg'&&item.payload?.type==='task_complete'&&item.payload.last_agent_message?.trim());
      if(denial>=0&&finished) {
        assert.ok(!existsSync(join(workspace,'denied-child.txt')));
        const report={ok:true,phase,threadId:thread,permissionRejected:true,noChildStarted:true,parentResponseCompleted:true};
        write(phase,report);console.log(JSON.stringify(report));process.exit(0);
      }
      await delay(1000);continue;
    }
    const ownedIds=new Set((await ownedTasks()).map(task=>task.agent_id??task.id));
    const selected=receipts().filter(receipt=>!observed.callbacks.includes(receipt.file)&&ownedIds.has(receipt.agent_id));
    for(const receipt of selected) {
      if(observed.threadId)assert.equal(receipt.thread_id,observed.threadId,'A follow-up must stay in the existing Codex conversation');
      if(['setup_failed','delivery_failed'].includes(receipt.status))throw new Error(`Native callback ${receipt.status}: ${receipt.error}`);
      const allItems=rollout(receipt.thread_id),items=allItems.slice(observed.lineStart);
      const delivery=items.findIndex(item=>item.type==='response_item'&&item.payload?.name==='dsh_completion');
      const idle=items.findIndex(item=>item.type==='event_msg'&&item.payload?.type==='task_complete');
      if(action==='pending'&&receipt.status==='watching'&&idle>=0&&delivery<0) {
        assert.equal(calls(items,'dsh_watch').length,1);
        // This is a behavioral assertion, not a token billing measurement.
        const report={ok:true,phase,agentId:receipt.agent_id,threadId:receipt.thread_id,
          pendingObserved:true,parentTurnEndedBeforeCompletion:true,version:record().version};
        observed.threadId=receipt.thread_id;write(phase+'-observation',observed);
        write(phase+'-pending',report);console.log(JSON.stringify(report));process.exit(0);
      }
      if(!receipt.result_path||!existsSync(receipt.result_path))continue;
      const result=read(receipt.result_path);
      assert.equal(result.status,'completed',result.error||'The real DSH task failed.');
      if(action!=='accepted'||delivery<0)continue;
      const after=items.slice(delivery+1);
      const readCall=after.some(item=>item.type==='response_item'&&['function_call','custom_tool_call'].includes(item.payload?.type)&&JSON.stringify(item.payload).includes(phase+'-child.txt'));
      const readOutput=after.some(item=>item.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(item.payload?.type)&&JSON.stringify(item.payload.output).includes(marker));
      const accepted=after.some(item=>item.type==='event_msg'&&item.payload?.type==='task_complete'&&item.payload.last_agent_message?.includes(marker));
      if(!accepted||!readCall||!readOutput)continue;
      assert.equal(readFileSync(join(workspace,phase+'-child.txt'),'utf8'),marker);
      assert.ok(idle>=0&&idle<delivery,'The parent must end its first turn before receiving completion');
      const delivered=items.filter(item=>item.type==='response_item'&&item.payload?.name==='dsh_completion');
      assert.equal(delivered.length,1,'One native callback is required for this delegated task');
      assert.equal(calls(items,'dsh_watch').length,1,'One callback registration is required');
      assert.equal(calls(items,'dsh_start').length+calls(items,'dsh_followup').length,1,'The same task must not be delegated twice');
      const between=items.slice(idle+1,delivery);
      assert.equal(between.filter(item=>item.type==='event_msg'&&item.payload?.type==='task_started').length,0,'The idle parent must not start another turn before completion arrives');
      const report={ok:true,phase,host:process.env.COMPUTERNAME,node:process.version,version:record().version,
        agentId:receipt.agent_id,threadId:receipt.thread_id,callback:receipt.status,nativeCallbackItems:delivered.length,
        delegatedOnce:true,childArtifactVerified:true,parentReadArtifact:true,parentReadOutputVerified:true,parentCompleted:true};
      write(phase,report);console.log(JSON.stringify(report));process.exit(0);
    }
    await delay(1000);
  }
  throw new Error(`User journey ${phase}/${action} did not meet its acceptance boundary before the deadline.`);
} else if(action==='upgrade-baseline') {
  const installed=record();
  assert.equal(JSON.parse(cli('status','--json')).active.length,0);
  const {commandSpec}=await import(pathToFileURL(join(installed.root,'src/commands.mjs')));
  const [npm,...prefix]=commandSpec('npm');
  execFileSync(npm,[...prefix,'exec','--yes','--package=dsh-subagent-mcp@0.6.2','--','dsh-subagent-mcp','setup'],
    {encoding:'utf8',timeout:300000,env:{...process.env,DSH_CLI:installed.dsh,DSH_CODEX_CLI:installed.codex.at(-1)}});
  assert.equal(record().version,'0.6.2');
  console.log(JSON.stringify({ok:true,upgradeFrom:'0.6.2',publicReleaseFixture:true}));
} else if(action==='restart') {
  const before=JSON.parse(cli('status','--json'));assert.equal(before.active.length,0);
  cli('restart');
  const after=JSON.parse(cli('status','--json'));assert.equal(after.running,true);
  assert.notEqual(after.pid,before.pid);
  assert.equal(JSON.parse(cli('doctor','--json')).ok,true);
  console.log(JSON.stringify({ok:true,restarted:true,pidChanged:true}));
} else if(action==='cleanup') {
  const tasks=existsSync(config)?await ownedTasks():[];
  const ownedIds=new Set(tasks.map(task=>task.agent_id??task.id));
  for(const receipt of receipts())if(ownedIds.has(receipt.agent_id))writeFileSync(join(receipt.file,'..','cancel'),'');
  const interrupted=[];
  if(existsSync(config)) {
    const {bridgeClient}=await import(pathToFileURL(join(record().root,'src/bridge-client.mjs')));
    const {locations}=await import(pathToFileURL(join(record().root,'src/platform.mjs')));
    const client=await bridgeClient(locations().state);
    try {
      for(const task of tasks)if(['starting','running','interrupting'].includes(task.status)) {
        const id=task.agent_id??task.id;
        const result=await client.request('tools/call',{name:'dsh_interrupt',arguments:{agent_id:id}});
        assert.ok(!result.isError);interrupted.push(id);
      }
    } finally {client.close();}
  }
  console.log(JSON.stringify({ok:true,interrupted}));
} else if(action==='diagnose') {
  const out={installed:existsSync(config),artifacts:existsSync(workspace)?readdirSync(workspace):[]};
  if(out.installed){out.version=record().version;try{out.service=JSON.parse(cli('status','--json'));}catch{out.service={running:false};}}
  console.log(JSON.stringify(out));
} else throw new Error('Unknown acceptance action');
