import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {existsSync,statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {Runtime} from './runtime.mjs';
import {ExternalSessions} from './external-sessions.mjs';
import {events as projectEvents} from './projection.mjs';
import {contextLimitTokens} from './config.mjs';

const ACTIVE=['starting','running','interrupting'];
// The session DSH Web shows in place of the individual bridge agents.
export const PARENT_TITLE='Claude Code / Codex 子代理';
// A turn that overflowed the model window cannot succeed on the same
// conversation; report it apart from ordinary errors so the parent hands off.
export function settledStatus(reason) {
  if(reason?.kind==='completed')return 'completed';
  if(['cancelled','interrupted'].includes(reason?.kind))return 'interrupted';
  if(reason?.error?.code==='CONTEXT_WINDOW_EXCEEDED')return 'context_exhausted';
  return 'error';
}
export function titleFromTask(task) {
  const line=String(task).split('\n').map(x=>x.replace(/\s+/g,' ').trim()).find(Boolean)??'';
  return [...line].length>60?[...line].slice(0,59).join('')+'…':line;
}

export class Manager extends EventEmitter {
  constructor(config, RuntimeClass = Runtime) {
    super();
    this.config = config; this.RuntimeClass = RuntimeClass; this.live = new Map(); this.locks = new Map();
    this.db = new DatabaseSync(config.database);
    this.external = new ExternalSessions(this);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS parents(cwd TEXT PRIMARY KEY, session_id TEXT NOT NULL, seeded INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, time TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_agent_seq ON events(agent,seq);`);
    if(!this.db.prepare("SELECT * FROM pragma_table_info('parents') WHERE name='seeded'").get())
      this.db.exec('ALTER TABLE parents ADD COLUMN seeded INTEGER NOT NULL DEFAULT 0');
    for (const a of this.list()) {
      if (!a.external && ACTIVE.includes(a.status)) {
        a.status = 'interrupted'; a.error = 'Service restarted; work was not automatically replayed.'; this.save(a);
      } else if (a.status==='error' && settledStatus(a.finish_reason)==='context_exhausted') {
        a.status = 'context_exhausted'; this.save(a);
      }
    }
  }
  save(a) {a.updated_at = new Date().toISOString(); this.db.prepare('INSERT OR REPLACE INTO agents VALUES (?,?)').run(a.id,JSON.stringify(a)); this.emit('state:'+a.id,a);}
  get(id) {const r = this.db.prepare('SELECT data FROM agents WHERE id=?').get(id); if (!r) throw new Error('Unknown agent: '+id); return JSON.parse(r.data);}
  list() {return this.db.prepare('SELECT data FROM agents ORDER BY rowid DESC').all().map(r=>JSON.parse(r.data));}
  // One virtual parent session per workspace. Its children are hidden from the
  // DSH Web session list and reviewed through its subagent catalog, so the
  // user's own sessions stay unmixed. The id is minted here, where a single
  // process decides it, and the DSH side seeds the session on first use.
  parentFor(cwd) {
    const existing=this.db.prepare('SELECT session_id FROM parents WHERE cwd=?').get(cwd);
    if(existing)return existing.session_id;
    const id='session-'+randomUUID();
    this.db.prepare('INSERT INTO parents(cwd,session_id) VALUES (?,?)').run(cwd,id);
    return id;
  }
  // The mount point is created by a runtime that exits immediately afterwards.
  // A DSH process persists a session only while it owns it, and an owner that
  // stays alive holds the write lease that DSH Web needs to open the session
  // the user reviews from. Boot order is already serialized by runtime().
  async ensureParent(a) {
    const parent=this.parentFor(a.cwd);
    if(this.db.prepare('SELECT seeded FROM parents WHERE cwd=?').get(a.cwd).seeded)return parent;
    const rt=new this.RuntimeClass({id:parent,cwd:a.cwd,preset:a.preset},this.config);
    try {
      await rt.request('initialize',{cwd:a.cwd,provider:a.provider,model:a.model,reasoningEffort:a.effort,permission:a.permission,preset:a.preset,resume:false});
      await rt.request('parent/seed',{cwd:a.cwd,parent,parentTitle:PARENT_TITLE},120000);
      this.db.prepare('UPDATE parents SET seeded=1 WHERE cwd=?').run(a.cwd);
    } finally {await rt.close().catch(()=>{});}
    return parent;
  }
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
    const onlyFinals=!options.includeProgress && !options.includeToolEvents;
    const rows=eventId === undefined
      ? this.db.prepare(`SELECT * FROM events WHERE agent=? AND seq${typeof after==='string' ? '>=' : '>'}? ${onlyFinals ? "AND type='turn/end'" : ''} ORDER BY seq`).all(id,afterSeq)
      : this.db.prepare('SELECT * FROM events WHERE agent=? AND seq=?').all(id,eventId);
    const candidate=this.db.prepare("SELECT type,data FROM events WHERE agent=? AND seq<? AND type IN ('assistant/message','turn/start','turn/end') ORDER BY seq DESC LIMIT 1");
    for(const row of rows) {
      if(row.type!=='turn/end' || JSON.parse(row.data).reason?.kind!=='completed')continue;
      const previous=candidate.get(id,row.seq);
      if(previous?.type!=='assistant/message')continue;
      const data=JSON.parse(previous.data);
      if(!data.interrupted)row.finalText=data.text;
    }
    const projected=rows.map(row=>projectEvents([row],{...options,eventId,maxChars:budget})[0]).filter(item=>item && !(item.type==='assistant/message' && !item.text));
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
    const tail=eventId ?? Math.max(afterSeq,this.db.prepare('SELECT MAX(seq) AS seq FROM events WHERE agent=?').get(id).seq ?? 0);
    const next=continuation ?? (consumed ? tail : (visible.at(-1)?.event_id ?? afterSeq));
    return {events:visible,next_cursor:next,has_more:Boolean(continuation)||!consumed};
  }
  wait(id,seconds,signal) {
    const active=a=>['starting','running','interrupting'].includes(a.status);
    const result=(a,outcome)=>({...a,wait_outcome:outcome,next_action:active(a)?'continue_waiting':a.status==='completed'?'review_and_continue':a.status==='context_exhausted'?'start_new_agent':a.status==='error'?'handle_error':'respect_stop'});
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
    const parent=await this.ensureParent(a);
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
      await rt.request('initialize',{cwd:a.cwd,provider:a.provider,model:a.model,reasoningEffort:a.effort,permission:a.permission,preset:a.preset,title:a.name||undefined,resume:a.persisted===true,parent,parentTitle:PARENT_TITLE});
      const identity=await rt.request('session/prepare',{sessionId:a.id});
      // DSH composes permission defaults from user settings; refuse to run a
      // session under a different preset than the parent requested.
      if(a.permission&&identity.permission!==a.permission)
        throw new Error(`DSH applied permission ${identity.permission} instead of requested ${a.permission}; runtime stopped`);
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
      if(e.type==='turn/start') {
        a.status='running';a.answer='';a.partial_text='';a.finish_reason=null;
        this.event(id,e.type,{...e.data,session_seq:e.seq});
      } else if(e.type==='assistant/message') {
        const blocks=e.data.message.content;
        a.answer=blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
        this.event(id,e.type,{seq:e.seq,text:a.answer,usage:e.data.usage,interrupted:e.data.interrupted});
        if(e.data.usage?.totalTokens)a.context_tokens=e.data.usage.totalTokens;
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
      else a.status=settledStatus(a.finish_reason);
      if(a.status==='completed')a.last_completed_answer=a.answer;
      this.save(a); this.event(id,method,p);
      if(p.status==='idle') this.release(id).catch(e=>this.event(id,'runtime/release-error',{message:e.message}));
    }
  }
  async start({task,cwd,name,model='deepseek-flash',provider='deepseek-official',effort='max',permission='workspace-write',preset='standard'}) {
    if(!isAbsolute(cwd)||!statSync(cwd).isDirectory())throw new Error('cwd must be an existing absolute directory');
    const a={id:randomUUID(),name:name?.trim()||titleFromTask(task),cwd,model,provider,effort,permission,preset,status:'starting',created_at:new Date().toISOString(),answer:'',partial_text:'',persisted:false};
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
    catch(e){a=this.get(id);a.status='error';a.error=e.message;this.save(a);try{await rt.close();}finally{this.live.delete(id);}throw e;}
    a=this.get(id);a.persisted=true;a.message_id=receipt.messageId;this.save(a);
    this.event(id,'bridge/prompt',{message_id:receipt.messageId,task});
    return a;
  }
  followup(id,task) {return this.serial(id,async()=>{
    const a=this.get(id);
    if(a.external)return this.external.send(id,task,'queue',true);
    if(a.status==='closed')throw new Error('Agent is closed');
    if(['running','starting','interrupting'].includes(a.status))throw new Error('Agent is busy; interrupt it before redirecting, or wait until idle.');
    if(a.status==='context_exhausted')throw new Error('Agent exhausted its model context; start a new agent with a self-contained handoff (last_completed_answer is in dsh_wait/dsh_status legacy output).');
    const limit=contextLimitTokens(a.provider);
    if(a.preset==='minimal'&&limit&&a.context_tokens>=limit*.75)
      throw new Error(`Agent context is ${a.context_tokens} of ${limit} tokens and the minimal preset does not compact; start a new agent for this task.`);
    return this.submit(id,task);
  });}
  rename(id,name) {return this.serial(id,async()=>{
    const title=name.trim();
    if(!title)throw new Error('name must not be blank');
    const a=this.get(id);
    if(a.external)return this.external.rename(id,title);
    a.name=title;this.save(a);
    if(!a.persisted)return a;
    let rt=this.live.get(id);
    if(rt)await rt.request('session/rename',{sessionId:id,title});
    else if(existsSync(a.cwd)) {
      // Booting applies the stored name; release a runtime nobody was using.
      rt=await this.runtime(a);
      if(!ACTIVE.includes(this.get(id).status)){await rt.close();this.live.delete(id);}
    } else throw new Error('Stored name updated, but the session cwd no longer exists so DSH was not renamed');
    return this.get(id);
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
  release(id) {return this.serial(id,async()=>{
    const a=this.get(id);
    if(a.external)throw new Error('External Web sessions own their runtimes; use close to detach the observer.');
    if(ACTIVE.includes(a.status))return {agent_id:id,released:false,status:a.status};
    const rt=this.live.get(id);
    if(rt) {
      try {await rt.request('session/checkpoint',{sessionId:id},1000);}
      finally {
        try {await rt.close();}
        finally {this.live.delete(id);}
      }
      this.event(id,'runtime/released',{});
    }
    return {agent_id:id,released:Boolean(rt),status:this.get(id).status};
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
