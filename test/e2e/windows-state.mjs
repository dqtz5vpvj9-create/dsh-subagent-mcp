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
const isCall=item=>item.type==='response_item'&&['function_call','custom_tool_call'].includes(item.payload?.type);
const isOutput=item=>item.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(item.payload?.type);
const active=task=>['starting','running','interrupting'].includes(task.status);
const taskId=task=>task.agent_id??task.id;
const taskIds=tasks=>tasks.map(taskId).sort();
const taskSnapshot=tasks=>tasks.map(task=>({id:taskId(task),status:task.status,updated_at:task.updated_at})).sort((a,b)=>a.id.localeCompare(b.id));
function calls(items,name) {
  return items.flatMap(item=>{
    if(!isCall(item))return [];
    if(new RegExp(name+'$').test(item.payload.name))return [item];
    // Code Mode can put several tool calls into one outer functions.exec call.
    const count=[...(item.payload.input??item.payload.arguments??'').matchAll(new RegExp('[A-Za-z_]*'+name+'\\s*\\(','g'))].length;
    return Array(count).fill(item);
  });
}
function outputFor(items,call) {
  const id=call.payload.call_id;
  return id?items.find(item=>isOutput(item)&&item.payload.call_id===id):undefined;
}
function artifactRead(item,filename) {
  if(!isCall(item)||!JSON.stringify(item.payload).includes(filename))return false;
  const body=item.payload.input??item.payload.arguments??'';
  return /read[_-]?(?:file|text)/i.test(item.payload.name??'') ||
    /Get-Content|ReadAll(?:Text|Bytes)|readFile(?:Sync)?|\.read_(?:text|bytes)\s*\(|\bread\s*\(|\b(?:cat|type|gc)\s/i.test(body);
}
async function ownedTasks() {
  const {bridgeClient}=await import(pathToFileURL(join(record().root,'src/bridge-client.mjs')));
  const {locations}=await import(pathToFileURL(join(record().root,'src/platform.mjs')));
  const client=await bridgeClient(locations().state);
  try {
    const reply=await client.request('tools/call',{name:'dsh_list',arguments:{cwd:workspace,limit:200,max_chars:100000}});
    assert.ok(!reply.isError);
    const listed=JSON.parse(reply.content.find(x=>x.type==='text').text);
    assert.equal(listed.omitted,undefined,'Acceptance requires the complete filtered agent set');
    return listed.items.filter(task=>task.cwd===workspace);
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
  const tasks=await ownedTasks();
  assert.ok(!tasks.some(active),'Begin each user journey with the previous task settled');
  write(phase+'-observation',{started:Date.now(),deadline:Date.now()+720000,callbacks:receipts().map(item=>item.file),
    threadId:thread,lineStart:thread?rollout(thread).length:0,taskIds:taskIds(tasks),tasks:taskSnapshot(tasks)});
  console.log(JSON.stringify({ok:true,phase}));
} else if(['pending','accepted','denied'].includes(action)) {
  const observed=read(join(root,phase+'-observation.json'));
  while(Date.now()<observed.deadline) {
    if(action==='denied') {
      const tasks=await ownedTasks();
      assert.deepEqual(taskSnapshot(tasks),observed.tasks,'Rejecting authorization must not start a new task or continue an existing one');
      const thread=observed.threadId||recentThread(observed.started);
      if(!thread){await delay(1000);continue;}
      const items=rollout(thread).slice(observed.lineStart);
      const starts=calls(items,'dsh_start');
      const refused=starts.map(call=>({call,output:outputFor(items,call)})).find(pair=>pair.output&&/reject|denied|declined|cancelled|canceled/i.test(JSON.stringify(pair.output.payload.output)));
      const denial=refused?items.indexOf(refused.output):-1;
      const finished=items.slice(denial+1).some(item=>item.type==='event_msg'&&item.payload?.type==='task_complete'&&item.payload.last_agent_message?.trim());
      if(refused&&finished) {
        assert.equal(starts.length,1,'After refusal, the parent must not retry the same execution');
        assert.equal(calls(items,'dsh_followup').length+calls(items,'dsh_send').length,0,'A refused start must not be replaced by executing an existing agent');
        assert.ok(!existsSync(join(workspace,'denied-child.txt')));
        const report={ok:true,phase,threadId:thread,permissionRejected:true,rejectedCallId:refused.call.payload.call_id,
          noChildStarted:true,existingAgentsUnchanged:true,noExecutionAfterRefusal:true,parentResponseCompleted:true};
        write(phase,report);console.log(JSON.stringify(report));process.exit(0);
      }
      await delay(1000);continue;
    }
    const tasks=await ownedTasks(),ids=taskIds(tasks);
    const newIds=ids.filter(id=>!observed.taskIds.includes(id));
    if(phase==='first')assert.ok(newIds.length<=1,'A single requested task must not create extra agents');
    else assert.deepEqual(ids,observed.taskIds,'A follow-up must not create or remove agents');
    const ownedIds=new Set(ids);
    const selected=receipts().filter(receipt=>!observed.callbacks.includes(receipt.file)&&ownedIds.has(receipt.agent_id));
    for(const receipt of selected) {
      if(observed.threadId)assert.equal(receipt.thread_id,observed.threadId,'A follow-up must stay in the existing Codex conversation');
      if(['setup_failed','delivery_failed'].includes(receipt.status))throw new Error(`Native callback ${receipt.status}: ${receipt.error}`);
      const allItems=rollout(receipt.thread_id),items=allItems.slice(observed.lineStart);
      const delivery=items.findIndex(item=>item.type==='response_item'&&item.payload?.name==='dsh_completion');
      const idle=items.findIndex(item=>item.type==='event_msg'&&item.payload?.type==='task_complete');
      if(delivery>=0)assert.ok(idle>=0&&idle<delivery,
        'DSH completion arrived before the parent ended its delegation turn; the callback stayed in an active turn instead of waking an idle parent');
      if(action==='pending'&&receipt.status==='watching'&&idle>=0&&delivery<0) {
        if(phase==='first')assert.deepEqual(newIds,[receipt.agent_id],'The requested task must create exactly one actual agent');
        assert.equal(calls(items,'dsh_watch').length,1);
        const pendingAt=Date.now();
        assert.ok(!existsSync(join(workspace,phase+'-child.txt')),'The delayed artifact must not already exist while the parent yields');
        observed.pendingAt=pendingAt;
        const resident=JSON.parse(cli('agents','ps','--json')).runtimes.find(row=>row.id===receipt.agent_id);
        assert.ok(resident?.pid,'The delegated runtime must have an observable process ID');
        observed.runtimePid=resident.pid;
        // This is a behavioral assertion, not a token billing measurement.
        const report={ok:true,phase,agentId:receipt.agent_id,threadId:receipt.thread_id,
          pendingObserved:true,parentTurnEndedBeforeCompletion:true,version:record().version};
        observed.threadId=receipt.thread_id;write(phase+'-observation',observed);
        write(phase+'-pending',report);console.log(JSON.stringify(report));process.exit(0);
      }
      if(!receipt.result_path||!existsSync(receipt.result_path))continue;
      const result=read(receipt.result_path);
      assert.equal(result.status,'completed',result.error||'The real DSH task failed.');
      const artifact=join(workspace,phase+'-child.txt');
      assert.ok(existsSync(artifact),'The child artifact must exist when its completion result is delivered');
      assert.equal(readFileSync(artifact,'utf8'),marker);
      const artifactMtime=statSync(artifact).mtimeMs,resultMtime=statSync(receipt.result_path).mtimeMs;
      assert.ok(artifactMtime<=resultMtime,'The parent must not create or repair the artifact after the DSH completion result');
      // The callback may already be visible while Windows retries committing
      // its delivered receipt. Validate the acknowledged turn after that commit.
      if(action!=='accepted'||delivery<0||receipt.status!=='delivered')continue;
      const after=items.slice(delivery+1);
      const readPair=after.filter(item=>artifactRead(item,phase+'-child.txt'))
        .map(call=>({call,output:outputFor(after,call)}))
        .find(pair=>pair.output&&JSON.stringify(pair.output.payload.output).includes(marker));
      const accepted=after.some(item=>item.type==='event_msg'&&item.payload?.type==='task_complete'&&item.payload.last_agent_message?.includes(marker));
      if(!accepted||!readPair)continue;
      assert.ok(Number.isFinite(observed.pendingAt),'The test must observe the pending task before accepting completion');
      if(phase==='first')assert.deepEqual(newIds,[receipt.agent_id],'Only the requested agent may have been created');
      assert.ok(!tasks.some(active),'Acceptance must not leave another task running');
      const runtimeState=JSON.parse(cli('agents','ps','--json'));
      if(runtimeState.runtimes.some(row=>row.id===receipt.agent_id))continue;
      let runtimeAlive=true;
      try {process.kill(observed.runtimePid,0);} catch(error) {if(error.code==='ESRCH')runtimeAlive=false;else throw error;}
      if(runtimeAlive)continue;
      assert.equal(JSON.parse(cli('agents','show',receipt.agent_id,'--json')).status,'completed');
      assert.equal(JSON.parse(cli('agents','result',receipt.agent_id,'--json')).answer,result.answer);
      assert.ok(idle>=0&&idle<delivery,'The parent must end its first turn before receiving completion');
      const delivered=items.filter(item=>item.type==='response_item'&&item.payload?.name==='dsh_completion');
      assert.equal(delivered.length,1,'One native callback is required for this delegated task');
      assert.equal(calls(items,'dsh_watch').length,1,'One callback registration is required');
      assert.equal(calls(items,'dsh_start').length+calls(items,'dsh_followup').length,1,'The same task must not be delegated twice');
      const between=items.slice(idle+1,delivery);
      const callbackTurn=receipt.delivery_receipt?.turn_id;
      assert.equal(typeof callbackTurn,'string','The native callback must acknowledge the turn it starts');
      const wakeups=between.filter(item=>item.type==='event_msg'&&item.payload?.type==='task_started');
      // Native turn/start records task_started before its dsh_completion input.
      // Only that acknowledged callback turn may wake the idle parent.
      assert.deepEqual(wakeups.map(item=>item.payload.turn_id),[callbackTurn],'Only the acknowledged completion callback may start a turn while the parent is idle');
      assert.ok(resultMtime<=Date.parse(wakeups[0].timestamp),'The callback turn must not start before the DSH result exists');
      const deliveryContext=items.slice(0,delivery).findLast(item=>item.type==='turn_context');
      assert.equal(deliveryContext?.payload.turn_id,callbackTurn,'Completion must arrive in the acknowledged callback turn');
      const modelActivity=between.filter(item=>isCall(item)||
        item.type==='response_item'&&(item.payload?.type==='reasoning'||item.payload?.role==='assistant')||
        item.type==='event_msg'&&['token_count','agent_message','agent_reasoning'].includes(item.payload?.type));
      assert.equal(modelActivity.length,0,'The parent must not produce model output or tool calls before completion arrives');
      const acceptanceTurn=after.find(item=>item.type==='event_msg'&&item.payload?.type==='task_complete'&&item.payload.last_agent_message?.includes(marker));
      assert.equal(acceptanceTurn.payload.turn_id,callbackTurn,'Artifact acceptance must finish in the acknowledged callback turn');
      const report={ok:true,phase,host:process.env.COMPUTERNAME,node:process.version,version:record().version,
        agentId:receipt.agent_id,threadId:receipt.thread_id,callback:receipt.status,callbackTurnId:callbackTurn,nativeCallbackItems:delivered.length,
        delegatedOnce:true,actualAgentIds:ids,childArtifactVerified:true,artifactPresentByDelivery:true,artifactMtime,resultMtime,
        parentReadArtifact:true,parentReadOutputVerified:true,readCallId:readPair.call.payload.call_id,parentCompleted:true,
        runtimeExited:true,conversationRetained:true,cliManagementVerified:true};
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
} else if(action==='cleanup-success') {
  const tasks=await ownedTasks();
  assert.ok(!tasks.some(active),'A successful run must not require interrupting leftover tasks');
  const accepted=read(join(root,'first.json'));
  assert.deepEqual(taskIds(tasks),accepted.actualAgentIds,'A successful run must not leave extra agents to be hidden by cleanup');
  console.log(JSON.stringify({ok:true,noActiveTasks:true,noExtraAgents:true,interrupted:[]}));
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
