#!/usr/bin/env node
import net from 'node:net';
import {mkdirSync,chmodSync,existsSync,unlinkSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {Manager} from './manager.mjs';
import {runtimeConfig} from './config.mjs';
import {receipt,status,list,wait as projectWait} from './projection.mjs';

const state=process.env.DSH_SUBAGENT_STATE ?? join(homedir(),'.local/state/dsh-subagent-mcp');
const socketPath=join(state,'server.sock');
const instructions='Completion handoff: retain every delegated agent ID and keep the parent task active until its required children settle and their results are processed. When no independent work remains, call dsh_wait without seconds to await completion; an explicitly requested timeout means continue waiting, never task completion. A settled result is delivered through the pending tool call. This bridge does not wake an ended parent turn. On completed, verify artifacts and immediately continue the already authorized parent work; on error diagnose, and on interruption respect the stop. Delegate bounded tasks with dsh_start, give each a short descriptive name, and retain agent_id. Start a new agent for each unrelated task; reuse an agent only for follow-ups on the same work, because context accumulates. On context_exhausted, start a new agent with a self-contained handoff. Prefer dsh_wait over status polling when no independent work remains; use dsh_events only for an explicit progress or failure question. dsh_wait has no timeout by default; seconds optionally bounds a single wait. After idle, dsh_followup continues the SAME DSH session. To redirect active work, dsh_interrupt first, then dsh_followup. Interrupt confirms DSH reached idle; it does not roll back files. Check finish_reason and real artifacts before accepting results. DSH permissions are explicit and do not inherit Codex permissions. Never grant broader access than the parent task authorizes.';

export function makeServer(manager) {
  const server=new McpServer({name:'dsh-subagent-mcp',version:JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version},{instructions});
  const id={agent_id:z.string().min(1)};
  const observe=async id=>manager.get(id).external?manager.external.status(id):manager.get(id);
  const register=(name,description,schema,fn,readOnlyHint=false)=>server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint,destructiveHint:!readOnlyHint,openWorldHint:true}},async (args,extra)=>{
    try {return {content:[{type:'text',text:JSON.stringify(await fn(args,extra))}]};}
    catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
  });
  register('dsh_start','Start an independent DSH agent asynchronously. Returns an agent ID immediately. Set cwd explicitly; sessions are grouped under that workspace. Default preset standard, including automatic context compaction. Default workspace-write; read-only enforces a sandbox. danger-full-access needs explicit task authorization. name is the session title shown in DSH Web; give a short descriptive name (defaults to the first line of task).',{
    task:z.string().min(1),cwd:z.string(),name:z.string().optional(),
    model:z.string().optional(),provider:z.string().optional(),effort:z.string().optional(),preset:z.string().min(1).optional(),
    permission:z.enum(['read-only','workspace-write','danger-full-access']).optional(),legacy:z.boolean().default(false),
  },a=>manager.start(a).then(value=>a.legacy?value:receipt(value,'start')));
  register('dsh_attach','Connect to an existing ordinary DSH Web session without creating or restarting it. Keeps its preset and permissions. Supply the exact session ID and authenticated Web launch URL. Credentials are stored privately and omitted from results.',{
    session_id:z.string().min(1),web_url:z.string().url(),
  },a=>manager.serial(a.session_id,()=>manager.external.attach(a)).then(value=>status(value)));
  register('dsh_send','Send to an attached external Web session, including while busy. Queue waits for the next turn; steer delivers at the next step. Preserves the current task and session permissions.',{
    ...id,task:z.string().min(1),mode:z.enum(['queue','steer']).default('queue'),
  },a=>manager.serial(a.agent_id,()=>{
    if(!manager.get(a.agent_id).external)throw new Error('dsh_send requires an attached external Web session; use dsh_followup for bridge agents');
    return manager.external.send(a.agent_id,a.task,a.mode).then(value=>receipt(value,'send'));
  }));
  register('dsh_status','Read compact lifecycle status. Use legacy:true only when the complete historical state is required.',{...id,legacy:z.boolean().default(false)},async a=>status(await observe(a.agent_id),{full:a.legacy}),true);
  register('dsh_list','List persistent DSH agents in compact form. Use legacy:true for complete historical state.',{legacy:z.boolean().default(false)},async a=>list(manager.list(),{full:a.legacy}),true);
  register('dsh_events','Read new assistant-visible text after a cursor. Tool events are summaries only when include_tool_events:true; pass event_id to read one tool event in full. max_chars is a response budget. If a large event is split, pass continuation_cursor as after to resume without loss or duplication.',{...id,after:z.union([z.number().int().nonnegative(),z.string().min(1)]).default(0),limit:z.number().int().min(1).max(100).default(30),max_chars:z.number().int().min(256).max(100000).default(12000),include_tool_events:z.boolean().default(false),event_id:z.number().int().positive().optional()},async a=>{await observe(a.agent_id);return manager.publicEvents(a.agent_id,a.after,a.limit,{maxChars:a.max_chars,includeToolEvents:a.include_tool_events,eventId:a.event_id});},true);
  register('dsh_rename','Set the name of an agent and its DSH session title, as shown in DSH Web.',{...id,name:z.string().min(1).max(120)},a=>manager.rename(a.agent_id,a.name).then(value=>status(value)));
  register('dsh_followup','Continue an idle DSH agent with its original conversation, for more work on the same task. Context accumulates across follow-ups; start a new agent for unrelated work. Busy agents must be interrupted first. Also resumes persisted sessions after service restart.',{...id,task:z.string().min(1),legacy:z.boolean().default(false)},a=>manager.followup(a.agent_id,a.task).then(value=>a.legacy?value:receipt(value,'followup')));
  register('dsh_interrupt','Cancel current execution and queued input; return only after DSH reaches idle. Keeps conversation and any files already changed.',{...id,legacy:z.boolean().default(false)},a=>manager.interrupt(a.agent_id).then(value=>a.legacy?value:status(value)));
  register('dsh_close','Release an agent runtime and mark it closed. For external Web sessions, only detach the bridge observer; the Web session keeps running. Retains history and files.',{...id,legacy:z.boolean().default(false)},a=>manager.close(a.agent_id).then(value=>a.legacy?value:status(value)));
  register('dsh_wait','Await completion with no timeout by default. The settled response contains the final answer once and no streaming partial text. Use legacy:true for the old complete state payload.',{...id,seconds:z.number().min(0).max(2147483.647).optional(),legacy:z.boolean().default(false)},async(a,extra)=>{await observe(a.agent_id);return manager.wait(a.agent_id,a.seconds,extra.signal).then(value=>projectWait(value,{full:a.legacy}));},true);
  return server;
}

export async function main(){
  if(!process.argv.includes('--daemon')) {
    const socket=net.connect(socketPath);
    socket.on('error',e=>{console.error('DSH subagent service unavailable: '+e.message);process.exitCode=1;process.stdin.destroy();});
    process.stdin.pipe(socket);socket.pipe(process.stdout);
    socket.on('close',()=>process.stdin.destroy());
    return;
  }
  mkdirSync(state,{recursive:true,mode:0o700});chmodSync(state,0o700);
  // A live socket belongs to another daemon; never unlink it.
  if(existsSync(socketPath)) {
    const live=await new Promise(resolve=>{const s=net.connect(socketPath);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',e=>{if(e.code==='ECONNREFUSED'||e.code==='ENOENT')resolve(false);else{console.error(e);resolve(true);}});});
    if(live)throw new Error('DSH subagent daemon already running');
    unlinkSync(socketPath);
  }
  const manager=new Manager(runtimeConfig(state));
  const connections=new Set();
  const listener=net.createServer(socket=>{
    const server=makeServer(manager);connections.add(server);
    socket.on('close',()=>{connections.delete(server);server.close().catch(()=>{});});
    server.connect(new StdioServerTransport(socket,socket)).catch(e=>{console.error(e);socket.destroy();});
  });
  listener.listen(socketPath,()=>{chmodSync(socketPath,0o600);console.error('DSH subagent daemon ready');});
  let stopping=false;
  async function stop(){if(stopping)return;stopping=true;listener.close();await Promise.allSettled([...connections].map(s=>s.close()));await manager.shutdown();if(existsSync(socketPath))unlinkSync(socketPath);process.exit(0);}
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
