import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {Runtime} from './runtime.mjs';
import {ExternalSessions} from './external-sessions.mjs';
import {events as projectEvents} from './projection.mjs';

export class Manager extends EventEmitter {
  constructor(config, RuntimeClass = Runtime) {
    super();
    this.config = config; this.RuntimeClass = RuntimeClass; this.live = new Map(); this.locks = new Map();
    this.db = new DatabaseSync(config.database);
    this.external = new ExternalSessions(this);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, time TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_agent_seq ON events(agent,seq);`);
    for (const a of this.list()) {
      if (!a.external && ['starting','running','interrupting'].includes(a.status)) {
        a.status = 'interrupted'; a.error = 'Service restarted; work was not automatically replayed.'; this.save(a);
      }
    }
  }
  save(a) {a.updated_at = new Date().toISOString(); this.db.prepare('INSERT OR REPLACE INTO agents VALUES (?,?)').run(a.id,JSON.stringify(a)); this.emit('state:'+a.id,a);}
  get(id) {const r = this.db.prepare('SELECT data FROM agents WHERE id=?').get(id); if (!r) throw new Error('Unknown agent: '+id); return JSON.parse(r.data);}
  list() {return this.db.prepare('SELECT data FROM agents ORDER BY rowid DESC').all().map(r=>JSON.parse(r.data));}
  event(id,type,data) {this.db.prepare('INSERT INTO events(agent,time,type,data) VALUES (?,?,?,?)').run(id,new Date().toISOString(),type,JSON.stringify(data));}
  events(id,after=0,limit=50) {
    this.get(id);
    const rows=this.db.prepare('SELECT * FROM events WHERE agent=? AND seq>? ORDER BY seq LIMIT ?').all(id,after,limit);
    return {events:rows.map(r=>({...r,data:JSON.parse(r.data)})),next_cursor:rows.at(-1)?.seq ?? after};
  }
  publicEvents(id, after=0, limit=30, options={}) {
    this.get(id);
    const cursor=typeof after==='string' ? after.split(':').map(Number) : [after,0];
    const afterSeq=cursor[0] || 0;
    const offset=cursor[2] || 0;
    const eventId=options.eventId, budget=options.maxChars ?? 12000;
    const rows=eventId === undefined
      ? this.db.prepare(`SELECT * FROM events WHERE agent=? AND seq${typeof after==='string' ? '>=' : '>'}? ORDER BY seq`).all(id,afterSeq)
      : this.db.prepare('SELECT * FROM events WHERE agent=? AND seq=?').all(id,eventId);
    const projected=rows.map(row=>projectEvents([row],{includeToolEvents:options.includeToolEvents===true,eventId,maxChars:budget})[0]).filter(item=>item && !(item.type==='assistant/message' && !item.text));
    let start=0;
    if (offset && projected[0]) start=0;
    const visible=[]; let continuation;
    const base=()=>({events:visible,next_cursor:continuation ?? (visible.at(-1)?.event_id ?? (eventId ?? afterSeq)),has_more:false});
    for (let i=start;i<projected.length && visible.length<limit;i++) {
      const original=projected[i]; let item=original;
      if (offset && i===0) {
        if (item.text!==undefined) item={...item,text:item.text.slice(offset),__total:item.text.length};
        else if (item.data!==undefined) {const s=JSON.stringify(item.data);item={...item,data_chunk:s.slice(offset),encoding:'json',__total:s.length};}
      }
      const full=JSON.stringify(item);
      if (visible.length && JSON.stringify({...base(),events:[...visible,item],has_more:true}).length>budget) { continuation=visible.at(-1).event_id; break; }
      if (full.length>budget || (JSON.stringify({...base(),events:[...visible,item],has_more:true}).length>budget)) {
        const field=item.text!==undefined?'text':'data_chunk'; const source=field==='text'?String(item.text):String(item.data_chunk ?? JSON.stringify(item.data));
        let n=Math.max(1,source.length); const make=n=>{const {__total,...clean}=item; return field==='text'?{...clean,text:source.slice(0,n)}:{event_id:clean.event_id,seq:clean.seq,type:clean.type,data_chunk:source.slice(0,n),encoding:'json'};};
        while(n>1 && JSON.stringify({...base(),events:[...visible,{...make(n),continuation_cursor:`${item.event_id}:0:${(offset||0)+n}`}],next_cursor:`${item.event_id}:0:${(offset||0)+n}`,has_more:true}).length>budget)n=Math.floor(n*.9);
        const total=item.__total;
        item=make(n);
        if (total === undefined || (offset||0)+n < total) { continuation=`${item.event_id}:0:${(offset||0)+n}`; item.continuation_cursor=continuation; }
        visible.push(item); break;
      }
      visible.push(item);
    }
    const consumed=continuation ? false : visible.length>=projected.length;
    const next=continuation ?? (consumed ? (rows.at(-1)?.seq ?? eventId ?? afterSeq) : (visible.at(-1)?.event_id ?? afterSeq));
    return {events:visible,next_cursor:next,has_more:Boolean(continuation)||!consumed};
  }
  wait(id,seconds,signal) {
    const active=a=>['starting','running','interrupting'].includes(a.status);
    const result=(a,outcome)=>({...a,wait_outcome:outcome,next_action:active(a)?'continue_waiting':a.status==='completed'?'review_and_continue':a.status==='error'?'handle_error':'respect_stop'});
    const initial=this.get(id);
    if(signal?.aborted)return Promise.reject(signal.reason??new Error('Wait cancelled'));
    if(!active(initial))return Promise.resolve(result(initial,'settled'));
    return new Promise((resolve,reject)=>{
      const event='state:'+id;
      const cleanup=()=>{clearTimeout(timer);this.off(event,onState);signal?.removeEventListener('abort',onAbort);};
      const onState=a=>{if(!active(a)){cleanup();resolve(result(a,'settled'));}};
      const onAbort=()=>{cleanup();reject(signal.reason??new Error('Wait cancelled'));};
      const timer=seconds===undefined?undefined:setTimeout(()=>{cleanup();resolve(result(this.get(id),'timeout'));},seconds*1000);
      this.on(event,onState);
      signal?.addEventListener('abort',onAbort,{once:true});
    });
  }
  async serial(id, fn) {
    const previous=this.locks.get(id) ?? Promise.resolve();
    const task=previous.catch(()=>{}).then(fn); this.locks.set(id,task);
    try {return await task;} finally {if(this.locks.get(id)===task)this.locks.delete(id);}
  }
  runtime(a) {
    // DSH's JSON workspace registry caches its state in each process.
    // Boot and attach in order so concurrent starts cannot overwrite membership.
    return this.serial('workspace-registration',()=>this.bootRuntime(a));
  }
  async bootRuntime(a) {
    if(this.live.has(a.id))return this.live.get(a.id);
    const rt=new this.RuntimeClass(a,this.config); this.live.set(a.id,rt);
    rt.on('notification',(method,params)=>this.notification(a.id,method,params));
    rt.on('diagnostic',message=>this.event(a.id,'diagnostic',{message}));
    rt.on('exit',error=>{
      this.live.delete(a.id);
      const current=this.get(a.id);
      if(['running','starting','interrupting'].includes(current.status)){current.status='error';current.error=error.message;this.save(current);}
      this.event(a.id,'runtime/exit',{message:error.message});
    });
    try {
      await rt.request('initialize',{cwd:a.cwd,provider:a.provider,model:a.model,reasoningEffort:a.effort,permission:a.permission,preset:a.preset,resume:a.persisted===true});
      const identity=await rt.request('session/prepare',{sessionId:a.id});
      const current=this.get(a.id);
      current.workspace_id=identity.workspace_id;
      current.preset=identity.preset;
      current.persisted=true;
      this.save(current);
      return rt;
    } catch(e) {await rt.close().catch(()=>{});this.live.delete(a.id);throw e;}
  }
  notification(id,method,p) {
    // Child activity is kept separate from the root answer/state.
    if(p.sessionId && p.sessionId!==id) {this.event(id,'descendant/'+method,p);return;}
    const a=this.get(id);
    if(method==='session.text') {
      const text=p.chunk.text ?? p.chunk.delta ?? '';
      a.partial_text=(a.partial_text+text).slice(-16000);this.save(a);
      return;
    }
    if(method==='session.event') {
      const e=p.event;
      // Durable assistant text is enough for progress; avoid duplicating hidden reasoning streams.
      if(e.type==='assistant/message') {
        const blocks=e.data.message.content;
        a.answer=blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
        this.event(id,e.type,{seq:e.seq,text:a.answer,usage:e.data.usage,interrupted:e.data.interrupted});
      } else if(e.type==='turn/end') {a.finish_reason=e.data.reason;this.event(id,e.type,e.data);}
      else if(/^(tool\/|turn\/|step\/|permission\/|sandbox\/|approval\/)/.test(e.type)) {
        this.event(id,e.type,{...e.data,session_seq:e.seq});
      }
      a.last_event=e.type;
      this.save(a);
    }
    if(method==='session.status') {
      if(p.status==='running') a.status='running';
      else if(a.status==='interrupting' || a.finish_reason?.kind==='cancelled' || a.finish_reason?.kind==='interrupted') a.status='interrupted';
      else a.status=a.finish_reason?.kind==='completed'?'completed':'error';
      this.save(a); this.event(id,method,p);
      if(p.status==='idle') this.live.get(id)?.request('session/checkpoint',{sessionId:id}).catch(e=>this.event(id,'checkpoint/error',{message:e.message}));
    }
  }
  async start({task,cwd,name='',model='deepseek-v4-flash',provider='deepseek-official',effort='max',permission='workspace-write',preset='standard'}) {
    if(!isAbsolute(cwd)||!statSync(cwd).isDirectory())throw new Error('cwd must be an existing absolute directory');
    const a={id:randomUUID(),name,cwd,model,provider,effort,permission,preset,status:'starting',created_at:new Date().toISOString(),answer:'',partial_text:'',persisted:false};
    this.save(a);
    // Return the ID immediately. Boot and prompt errors remain observable by status.
    this.serial(a.id,()=>this.submit(a.id,task)).catch(e=>{const b=this.get(a.id);b.status='error';b.error=e.message;this.save(b);this.event(a.id,'error',{message:e.message});});
    return a;
  }
  async submit(id,task) {
    let a=this.get(id);
    a.status='starting';a.answer='';a.partial_text='';a.finish_reason=null;a.error=null;this.save(a);
    let rt;
    try {rt=await this.runtime(a);} catch(e) {a=this.get(id);a.status='error';a.error=e.message;this.save(a);throw e;}
    a=this.get(id);a.status='running';this.save(a);
    let receipt;
    try {receipt=await rt.request('session/prompt',{sessionId:id,contentBlocks:[{type:'text',text:task}]});}
    catch(e){a=this.get(id);a.status='error';a.error=e.message;this.save(a);throw e;}
    a=this.get(id);a.persisted=true;a.message_id=receipt.messageId;this.save(a);
    this.event(id,'bridge/prompt',{message_id:receipt.messageId,task});
    return a;
  }
  followup(id,task) {return this.serial(id,async()=>{
    const a=this.get(id);
    if(a.external)return this.external.send(id,task,'queue',true);
    if(a.status==='closed')throw new Error('Agent is closed');
    if(['running','starting','interrupting'].includes(a.status))throw new Error('Agent is busy; interrupt it before redirecting, or wait until idle.');
    return this.submit(id,task);
  });}
  interrupt(id) {return this.serial(id,async()=>{
    if(this.get(id).external)return this.external.interrupt(id);
    const a=this.get(id),rt=this.live.get(id);
    if(!rt || !['running','starting','interrupting'].includes(a.status))return a;
    a.status='interrupting';this.save(a);
    await rt.request('session/cancel',{sessionId:id});
    const b=this.get(id);b.status='interrupted';this.save(b);return b;
  });}
  close(id) {return this.serial(id,async()=>{
    if(this.get(id).external)return this.external.close(id);
    const rt=this.live.get(id);if(rt)await rt.close();
    this.live.delete(id);const a=this.get(id);a.status='closed';this.save(a);return a;
  });}
  async shutdown() {
    if(this.shutdownTask)return this.shutdownTask;
    this.shutdownTask=(async()=>{
      await Promise.allSettled([...this.locks.values()]);
      await this.external.shutdown();
      for(const id of this.live.keys()) {
        const a=this.get(id);
        if(['running','starting','interrupting'].includes(a.status)){a.status='interrupted';a.error='Service stopped; follow up explicitly to resume.';this.save(a);}
      }
      await Promise.allSettled([...this.live.values()].map(rt=>rt.close()));this.live.clear();this.db.close();
    })();
    return this.shutdownTask;
  }
}
