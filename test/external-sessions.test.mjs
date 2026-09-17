import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {Manager} from '../src/manager.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from '../src/server.mjs';

async function setup(t,{running=false,fast=false,rejectPrompt=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'dsh-external-test-'));
  const id='session-a340bf6c-215c-4578-a518-ec9d3eed4afb';
  const records=[],calls=[],streams=new Set();let seq=0,queue=[];
  const values={title:'Existing session',agentPreset:'standard',permissions:{currentValue:'read-only'},modelSelection:{next:{provider:'test',model:'test-model',reasoningEffort:'high'}}};
  const push=(endpoint,value)=>{for(const s of streams)if(s.endpoint===endpoint&&s.socket.readyState===1)s.socket.send(JSON.stringify({type:'item',streamId:s.streamId,value}));};
  const event=(type,data)=>{const frame={type:'event',event:{seq:seq++,type,data,time:Date.now()}};records.push(frame);push('session/follow',frame);};
  const status=value=>{running=value;push('$events',{type:'emit',event:'api-session/status',args:[id,value]});};
  const finish=(answer,kind='completed')=>{event('assistant/message',{message:{content:[{type:'text',text:answer}]}});event('turn/end',{reason:{kind}});status(false);};
  const begin=request=>{
    queue=queue.filter(item=>item.rpcId!==request.requestId);push('session/control',{type:'queue',sessionId:id,items:queue});
    status(true);event('turn/start',{});event('user/message',{source:{rpcId:request.requestId},content:request.content});
  };
  if(running)event('turn/start',{});else finish('Prior answer');
  const server=createServer(async(req,res)=>{
    if(req.url==='/?token=test-secret'){res.writeHead(303,{'set-cookie':'dsh-auth=test-cookie; HttpOnly','location':'/'});res.end();return;}
    if(req.headers.cookie!=='dsh-auth=test-cookie'){res.writeHead(401);res.end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const {method,payload}=JSON.parse(raw),args=payload.args;calls.push({method,args});let value;
    if(method==='session/list')value={items:[{sessionId:id,running,blank:false,cwd:dir,projections:{values}}]};
    else if(method==='session/prompt'){
      if(rejectPrompt){res.setHeader('content-type','application/json');res.end(JSON.stringify({result:{ok:false,error:{code:'session/model-unavailable',message:'No model'}}}));return;}
      assert.equal(args.request.sessionId,id);
      const request=args.request;
      if(running){queue.push({id:request.requestId,rpcId:request.requestId});push('session/control',{type:'queue',sessionId:id,items:queue});}
      else {begin(request);if(fast)finish('Fast reply');}
      value={accepted:true};
    } else if(method==='session/page'){value={records:records.filter(x=>x.event.seq<args.request.beforeSeq&&x.event.seq<=args.request.throughSeq),hasMore:false};}
    else if(method==='session/cancel'){event('turn/end',{reason:{kind:'cancelled'}});status(false);value={accepted:true};}
    else if(method==='session/updateQueue'){queue=queue.filter(x=>x.id!==args.request.itemId);push('session/control',{type:'queue',sessionId:id,items:queue});value={accepted:true};}
    else if(method==='$events/result')value=undefined;
    else throw new Error('Unexpected mutation: '+method);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({result:{ok:true,value}}));
  });
  const wss=new WebSocketServer({noServer:true});
  server.on('upgrade',(req,socket,head)=>{
    if(req.headers.cookie!=='dsh-auth=test-cookie'){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',socket=>socket.on('message',raw=>{
    const request=JSON.parse(raw);if(request.type!=='open')return;
    const s={...request,socket};streams.add(s);socket.on('close',()=>streams.delete(s));let value;
    if(s.endpoint==='$events')value={type:'ready',clientId:'test-client'};
    else if(s.endpoint==='session/follow')value={type:'snapshot',header:{id,cwd:dir},records:records.slice(-2),cursor:seq-1,hasMore:records.length>2,projections:{values}};
    else if(s.endpoint==='session/control')value={type:'baseline',value:{queues:{[id]:queue},projections:{},jobs:{}}};
    socket.send(JSON.stringify({type:'item',streamId:s.streamId,value}));
  }));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const config={database:join(dir,'state.sqlite')};let manager=new Manager(config);
  const mcp=makeServer(manager),client=new Client({name:'external-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(a);await client.connect(b);
  const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});if(result.isError)throw new Error(result.content[0].text);return JSON.parse(result.content[0].text);};
  t.after(async()=>{await client.close();await mcp.close();await manager.shutdown();for(const socket of wss.clients)socket.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));rmSync(dir,{recursive:true});});
  const web_url=`http://127.0.0.1:${server.address().port}/?token=test-secret`;
  return {id,dir,calls,call,begin,finish,event,status,push,web_url,get manager(){return manager;},async restart(){await manager.shutdown();manager=new Manager(config);return manager;}};
}

test('MCP attaches the exact external ID, retains permissions, and stores only a private cookie',async t=>{
  const f=await setup(t),a=await f.call('dsh_attach',{session_id:f.id,web_url:f.web_url});
  assert.equal(a.id,f.id);assert.equal(a.status,'completed');assert.equal(a.answer,undefined);assert.equal(a.partial_text,undefined);
  const legacy=await f.call('dsh_status',{agent_id:f.id,legacy:true});assert.equal(legacy.answer,'Prior answer');
  assert.equal(a.preset,undefined);assert.equal(a.permission,undefined);assert.equal(a.model,undefined);
  assert.ok(!JSON.stringify(a).includes('test-cookie'));assert.ok(!JSON.stringify(a).includes('test-secret'));
  const path=f.manager.external.credentialPath(legacy.web_auth_id);
  assert.equal(statSync(path).mode&0o777,0o600);assert.ok(!readFileSync(path,'utf8').includes('test-secret'));
  assert.deepEqual(f.calls.map(x=>x.method),['session/list','session/list','session/list']);
  const follow=await f.call('dsh_followup',{agent_id:f.id,task:'A question'});
  assert.ok(['starting','running'].includes(follow.status));
  const wait=f.call('dsh_wait',{agent_id:f.id});f.finish('New answer');
  const done=await wait;assert.equal(done.status,'completed');assert.equal(done.answer,'New answer');
  const events=await f.call('dsh_events',{agent_id:f.id});assert.ok(events.events.some(x=>x.text==='New answer'));
});

test('busy external sessions reject followup but allow queue delivery without cancelling',async t=>{
  const f=await setup(t,{running:true});await f.call('dsh_attach',{session_id:f.id,web_url:f.web_url});
  await assert.rejects(f.call('dsh_followup',{agent_id:f.id,task:'conflict'}),/busy/);
  const receipt=await f.call('dsh_send',{agent_id:f.id,task:'queued question',mode:'queue'});
  assert.equal(receipt.delivery.accepted,true);assert.equal(receipt.id,f.id);
  assert.ok(!f.calls.some(x=>x.method==='session/cancel'));
  f.finish('Original task');
  const pending=await f.call('dsh_wait',{agent_id:f.id,seconds:0});assert.equal(pending.wait_outcome,'timeout');
  f.begin(f.calls.find(x=>x.method==='session/prompt').args.request);f.finish('Queue answer');
  const done=await f.call('dsh_wait',{agent_id:f.id});assert.equal(done.answer,'Queue answer');assert.equal(done.status,'completed');
});

test('a reply before the prompt receipt is not overwritten by starting state',async t=>{
  const f=await setup(t,{fast:true});await f.call('dsh_attach',{session_id:f.id,web_url:f.web_url});
  await f.call('dsh_followup',{agent_id:f.id,task:'fast reply'});
  const done=await f.call('dsh_wait',{agent_id:f.id});assert.equal(done.answer,'Fast reply');assert.equal(done.status,'completed');
});

test('restart reattaches without replay and close leaves external work running',async t=>{
  const f=await setup(t,{running:true});const a=await f.call('dsh_attach',{session_id:f.id,web_url:f.web_url});
  await f.restart();assert.equal(f.manager.get(f.id).status,'running');
  await f.manager.external.status(f.id);f.finish('After restart');
  const result=await f.manager.wait(f.id,2);assert.equal(result.answer,'After restart');
  f.status(true);await f.manager.external.status(f.id);
  await f.manager.close(f.id);assert.equal(f.manager.get(f.id).status,'closed');
  assert.ok(!f.calls.some(x=>['session/prompt','session/cancel'].includes(x.method)));
  assert.throws(()=>readFileSync(f.manager.external.credentialPath(a.web_auth_id)),/ENOENT/);
});

test('interrupt clears the queue and confirms external cancellation',async t=>{
  const f=await setup(t,{running:true});await f.call('dsh_attach',{session_id:f.id,web_url:f.web_url});
  await f.call('dsh_send',{agent_id:f.id,task:'queued'});
  const stopped=await f.call('dsh_interrupt',{agent_id:f.id});assert.equal(stopped.status,'interrupted');
  assert.ok(f.calls.some(x=>x.method==='session/updateQueue'));assert.ok(f.calls.some(x=>x.method==='session/cancel'));
});

test('failed authentication and unknown sessions never create bridge agents',async t=>{
  const f=await setup(t);
  await assert.rejects(f.call('dsh_attach',{session_id:f.id,web_url:f.web_url.replace('test-secret','wrong')}),/authentication/);
  await assert.rejects(f.call('dsh_attach',{session_id:'missing',web_url:f.web_url}),/not found/);
  assert.equal(f.manager.list().length,0);
});

test('reconnect recovers a queued reply completed while the bridge was offline',async t=>{
  const f=await setup(t,{running:true});await f.call('dsh_attach',{session_id:f.id,web_url:f.web_url});
  await f.call('dsh_send',{agent_id:f.id,task:'offline reply'});
  await f.manager.shutdown();
  f.finish('Original');f.begin(f.calls.find(x=>x.method==='session/prompt').args.request);
  f.event('tool/start',{name:'test'});f.finish('Offline result');
  await f.restart();
  const a=await f.manager.external.status(f.id);
  assert.equal(a.status,'completed');assert.equal(a.answer,'Offline result');assert.deepEqual(a.pending_requests,[]);
  assert.ok(f.calls.some(x=>x.method==='session/page'));
  assert.equal(f.calls.filter(x=>x.method==='session/prompt').length,1);
});

test('a rejected prompt does not leave a phantom queued request',async t=>{
  const f=await setup(t,{rejectPrompt:true});await f.call('dsh_attach',{session_id:f.id,web_url:f.web_url});
  await assert.rejects(f.call('dsh_followup',{agent_id:f.id,task:'rejected'}),/model-unavailable/);
  const a=await f.call('dsh_status',{agent_id:f.id});assert.equal(a.status,'completed');assert.equal(a.answer,undefined);assert.equal(a.partial_text,undefined);
  const legacy=await f.call('dsh_status',{agent_id:f.id,legacy:true});assert.equal(legacy.answer,'Prior answer');assert.deepEqual(legacy.pending_requests,[]);
});

test('external max-token termination is an error, and streamed text remains visible',async t=>{
  const f=await setup(t,{running:true});await f.call('dsh_attach',{session_id:f.id,web_url:f.web_url});
  f.push('session/follow',{type:'assistant-stream',frame:{type:'chunk',chunk:{type:'text-delta',text:'Visible progress'}}});
  const a=await f.call('dsh_status',{agent_id:f.id});assert.equal(a.partial_text,undefined);assert.equal(a.answer,undefined);
  const progress=await f.call('dsh_events',{agent_id:f.id});assert.equal(progress.events.some(x=>x.text==='Visible progress'),false);
  const legacyProgress=await f.call('dsh_status',{agent_id:f.id,legacy:true});assert.equal(legacyProgress.partial_text,'Visible progress');
  const waiting=f.call('dsh_wait',{agent_id:f.id});f.finish('Partial result','max-tokens');
  const result=await waiting;assert.equal(result.status,'error');assert.equal(result.finish_reason.kind,'max-tokens');
});
