import {mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {authenticateWeb,WebClient} from './web-client.mjs';
import {settledStatus} from './manager.mjs';

const active=a=>['starting','running','interrupting'].includes(a.status);
const textOf=message=>(message?.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');

export class ExternalSessions {
  constructor(manager) {this.manager=manager;this.live=new Map();this.opening=new Map();}
  credentialPath(id) {return join(dirname(this.manager.config.database),'web-auth',id+'.json');}
  async attach({session_id,web_url}) {
    const credentials=await authenticateWeb(web_url);
    const client=new WebClient(credentials);
    const row=(await client.rpc('session/list',{_request:{}})).items.find(x=>x.sessionId===session_id);
    if(!row)throw new Error('Session not found in this DSH Web server: '+session_id);
    if(row.origin==='subagent')throw new Error('This is a DSH-owned child; use its parent session for delivery');
    const existing=this.manager.list().find(a=>a.id===session_id);
    if(existing&&(!existing.external||existing.web_origin!==credentials.origin))
      throw new Error('This session ID already belongs to another bridge runtime or Web server');
    const authId=existing?.web_auth_id??randomUUID();
    const path=this.credentialPath(authId);
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    writeFileSync(path,JSON.stringify(credentials),{mode:0o600});
    this.live.get(session_id)?.client.close();this.live.delete(session_id);
    const a={...existing,id:session_id,session_id,external:true,web_origin:credentials.origin,web_auth_id:authId,
      cwd:row.cwd,name:row.projections?.values?.title??'',status:'starting',answer:existing?.answer??'',partial_text:'',
      created_at:existing?.created_at??new Date().toISOString()};
    this.manager.save(a);
    await this.ensure(a.id);
    return this.manager.get(a.id);
  }
  ensure(id) {
    if(this.opening.has(id))return this.opening.get(id);
    if(this.live.has(id))return Promise.resolve(this.live.get(id));
    const opening=this.open(id).finally(()=>this.opening.delete(id));
    this.opening.set(id,opening);return opening;
  }
  async open(id) {
    const a=this.manager.get(id);
    if(a.status==='closed')throw new Error('Agent is closed; attach again to reconnect to the external session');
    const client=new WebClient(JSON.parse(readFileSync(this.credentialPath(a.web_auth_id),'utf8')));
    const runtime={client,ready:false,pending:[],queue:[],requests:new Set(a.pending_requests??[]),running:undefined};
    this.live.set(id,runtime);
    const fail=error=>{
      if(this.live.get(id)!==runtime)return;
      this.live.delete(id);client.close();
      const current=this.manager.get(id);current.status='error';current.error=error.message;this.manager.save(current);
    };
    const receive=fn=>value=>{if(runtime.ready)fn(value);else runtime.pending.push(()=>fn(value));};
    try {
      await client.connect(fail);
      await client.subscribe('$events',{},receive(frame=>{
        if(frame.type==='waterfall') {
          // Observers never answer approvals or questions on the user's behalf.
          client.rpc('$events/result',{clientId:runtime.clientId,eventId:frame.eventId,outcome:{kind:'next'}}).catch(fail);
        } else if(frame.type==='ready')runtime.clientId=frame.clientId;
        else if(frame.type==='emit'&&frame.args[0]===id) {
          if(frame.event==='api-session/status') {runtime.running=frame.args[1];this.settle(id,runtime);}
          // A session error ends the current turn inside DSH Web; the Web
          // connection and session remain usable, so keep observing.
          else if(frame.event==='api-session/error')this.sessionError(id,runtime,String(frame.args[1]));
        }
      }));
      const snapshot=await client.subscribe('session/follow',{request:{address:{kind:'session',sessionId:id},maxMessages:2,assistantStream:true}},receive(frame=>this.history(id,runtime,frame)));
      const controls=await client.subscribe('session/control',{},receive(frame=>{
        if(frame.type==='queue'&&frame.sessionId===id){runtime.queue=frame.items;this.settle(id,runtime);}
      }));
      runtime.queue=controls.value.queues[id]??[];
      // Recover events missed while detached using DSH's own history cursor.
      let more=snapshot.hasMore;
      while(a.web_cursor!==undefined&&more&&snapshot.records[0]?.event.seq>a.web_cursor+1) {
        const page=await client.rpc('session/page',{request:{address:{kind:'session',sessionId:id},throughSeq:snapshot.cursor,beforeSeq:snapshot.records[0].event.seq,maxMessages:50}});
        snapshot.records.unshift(...page.records);more=page.hasMore;
      }
      for(const {event} of snapshot.records)if(event.type==='user/message')runtime.requests.delete(event.data.source?.rpcId);
      this.snapshot(id,snapshot,runtime);
      const row=(await client.rpc('session/list',{_request:{}})).items.find(x=>x.sessionId===id);
      if(this.live.get(id)!==runtime)throw new Error('DSH Web observer detached');
      if(!row)throw new Error('External session no longer exists');
      runtime.running=row.running;
      if(!row.running&&!this.manager.get(id).finish_reason){const current=this.manager.get(id);current.status='idle';this.manager.save(current);}
      runtime.ready=true;
      for(const pending of runtime.pending)pending();runtime.pending=[];
      this.settle(id,runtime);
      return runtime;
    } catch(error) {fail(error);throw error;}
  }
  snapshot(id,frame,runtime) {
    const a=this.manager.get(id),values=frame.projections.values;
    const selection=values.modelSelection?.next??values.modelSelection?.lastUsed;
    a.cwd=frame.header.cwd;a.preset=values.agentPreset??frame.header.agentPreset??null;
    a.permission=values.permissions?.currentValue??null;
    a.model=selection?.model;a.provider=selection?.provider;a.effort=selection?.reasoningEffort;
    a.name=values.title??a.name;a.error=null;a.finish_reason=null;a.answer='';
    a.pending_requests=[...runtime.requests];
    for(const {event} of frame.records) {
      if(event.type==='turn/start') {a.finish_reason=null;a.answer='';}
      if(event.type==='assistant/message')a.answer=textOf(event.data.message);
      if(event.type==='turn/end')a.finish_reason=event.data.reason;
    }
    this.manager.save(a);
    for(const {event} of frame.records)this.record(id,event);
  }
  record(id,event) {
    const a=this.manager.get(id);
    if(event.seq<=(a.web_cursor??-1))return;
    a.web_cursor=event.seq;this.manager.save(a);
    if(event.type==='assistant/message')this.manager.event(id,event.type,{seq:event.seq,text:textOf(event.data.message)});
    else if(/^(tool\/|turn\/|step\/|permission\/|sandbox\/|approval\/)/.test(event.type)) {
      this.manager.event(id,event.type,{...event.data,session_seq:event.seq});
    }
  }
  history(id,runtime,frame) {
    if(frame.type==='snapshot')return;
    const a=this.manager.get(id);
    if(frame.type==='assistant-stream') {
      const chunk=frame.frame.chunk;
      if(chunk?.type==='text-delta') {a.partial_text=(a.partial_text+(chunk.text??chunk.delta??'')).slice(-16000);this.manager.save(a);}
      return;
    }
    const e=frame.event;
    if(e.type==='user/message') {
      runtime.requests.delete(e.data.source?.rpcId);
      a.pending_requests=[...runtime.requests];
    }
    if(e.type==='turn/start'){a.status='running';a.finish_reason=null;a.answer='';a.partial_text='';}
    if(e.type==='assistant/message')a.answer=textOf(e.data.message);
    if(e.type==='turn/end')a.finish_reason=e.data.reason;
    a.last_event=e.type;this.manager.save(a);this.record(id,e);
    this.settle(id,runtime);
  }
  settle(id,runtime) {
    const a=this.manager.get(id);
    // Closing detaches the observer for good; a bridge failure without a turn
    // result stays an error until new work starts.
    if(a.status==='closed')return;
    if(runtime.requests.size||runtime.queue.length)a.status=runtime.running?'running':'starting';
    else if(runtime.running) a.status='running';
    else if(a.finish_reason) a.status=settledStatus(a.finish_reason);
    else if(!active(a)&&a.status!=='error')a.status='idle';
    else return;
    a.error=a.status==='error'?a.error??a.finish_reason?.error?.message??null:null;
    this.manager.save(a);
  }
  sessionError(id,runtime,message) {
    const a=this.manager.get(id);
    a.finish_reason={kind:'error',error:{message}};a.error=message;this.manager.save(a);
    this.manager.event(id,'error',{message});
    this.settle(id,runtime);
  }
  async rename(id,title) {
    const runtime=await this.ensure(id);
    const value=await runtime.client.rpc('session/rename',{request:{sessionId:id,title}});
    const a=this.manager.get(id);a.name=value?.title??title;this.manager.save(a);return a;
  }
  async status(id) {
    const a=this.manager.get(id);if(a.status==='closed')return a;
    const runtime=await this.ensure(id);
    const row=(await runtime.client.rpc('session/list',{_request:{}})).items.find(x=>x.sessionId===id);
    if(this.manager.get(id).status==='closed')return this.manager.get(id);
    if(!row)throw new Error('External session no longer exists');
    runtime.running=row.running;
    // A blank, idle session has no turn/end to settle it.
    if(!row.running&&row.blank){const current=this.manager.get(id);current.status='idle';this.manager.save(current);}
    this.settle(id,runtime);return this.manager.get(id);
  }
  async send(id,task,mode='queue',idleOnly=false) {
    const a=await this.status(id);
    if(a.status==='closed')throw new Error('Agent is closed');
    if(idleOnly&&active(a))throw new Error('Agent is busy; use dsh_send to queue a message, or wait until idle');
    const runtime=await this.ensure(id),requestId=randomUUID();
    runtime.requests.add(requestId);
    const submitted=this.manager.get(id);submitted.pending_requests=[...runtime.requests];
    if(!active(a)){submitted.status='starting';submitted.finish_reason=null;submitted.answer='';submitted.partial_text='';}
    this.manager.save(submitted);
    try {await runtime.client.rpc('session/prompt',{request:{sessionId:id,requestId,mode,content:[{type:'text',text:task}]}});}
    catch(error) {
      // A lost HTTP receipt may still have admitted the request. Keep its identity observable.
      const current=this.manager.get(id);
      if(error.remoteRejected){runtime.requests.delete(requestId);current.pending_requests=[...runtime.requests];current.status=a.status;current.finish_reason=a.finish_reason;current.answer=a.answer;}
      else current.status='error';
      current.error=error.message;this.manager.save(current);throw error;
    }
    this.manager.event(id,'bridge/prompt',{request_id:requestId,task,mode});
    const current=this.manager.get(id);
    current.request_id=requestId;this.manager.save(current);
    return {...current,delivery:{accepted:true,mode,request_id:requestId}};
  }
  async interrupt(id) {
    await this.status(id);const runtime=await this.ensure(id);
    // Native Web cancellation keeps the inbox; remove observed queued messages explicitly.
    for(const item of [...runtime.queue]) {
      await runtime.client.rpc('session/updateQueue',{request:{sessionId:id,itemId:item.id,action:{kind:'remove'}}});
      runtime.requests.delete(item.rpcId);
    }
    const current=this.manager.get(id);current.pending_requests=[...runtime.requests];this.manager.save(current);
    if(!active(this.manager.get(id)))return this.manager.get(id);
    await runtime.client.rpc('session/cancel',{request:{sessionId:id}});
    const result=await this.manager.wait(id,30);
    if(result.wait_outcome==='timeout')throw new Error('DSH Web interruption is not yet confirmed; check status before redirecting');
    return result;
  }
  close(id) {
    if(this.manager.get(id).status==='closed')return this.manager.get(id);
    this.live.get(id)?.client.close();this.live.delete(id);
    const a=this.manager.get(id);a.status='closed';this.manager.save(a);
    unlinkSync(this.credentialPath(a.web_auth_id));return a;
  }
  async shutdown() {
    await Promise.allSettled(this.opening.values());
    for(const {client} of this.live.values())client.close();this.live.clear();
  }
}
