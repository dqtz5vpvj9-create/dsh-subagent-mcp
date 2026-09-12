#!/usr/bin/env node
import net from 'node:net';
import {mkdirSync,chmodSync,existsSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {Manager} from './manager.mjs';
import {runtimeConfig} from './config.mjs';

const state=process.env.DSH_SUBAGENT_STATE ?? join(homedir(),'.local/state/dsh-subagent-mcp');
const socketPath=join(state,'server.sock');
const instructions='Delegate bounded tasks with dsh_start and retain agent_id. Poll dsh_status/dsh_events for progress; dsh_wait waits at most 25 seconds. After idle, dsh_followup continues the SAME DSH session. To redirect active work, dsh_interrupt first, then dsh_followup. Interrupt confirms DSH reached idle; it does not roll back files. Check finish_reason and real artifacts before accepting results. DSH permissions are explicit and do not inherit Codex permissions. Never grant broader access than the parent task authorizes.';

export function makeServer(manager) {
  const server=new McpServer({name:'dsh-subagent-mcp',version:'0.1.0'},{instructions});
  const id={agent_id:z.string().uuid()};
  const register=(name,description,schema,fn,readOnlyHint=false)=>server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint,destructiveHint:!readOnlyHint,openWorldHint:true}},async args=>{
    try {return {content:[{type:'text',text:JSON.stringify(await fn(args))}]};}
    catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
  });
  register('dsh_start','Start an independent DSH agent asynchronously. Returns an agent ID immediately. Set cwd explicitly. Default workspace-write; read-only enforces a sandbox. danger-full-access needs explicit task authorization.',{
    task:z.string().min(1),cwd:z.string(),name:z.string().optional(),
    model:z.string().optional(),provider:z.string().optional(),effort:z.string().optional(),
    permission:z.enum(['read-only','workspace-write','danger-full-access']).optional(),
  },a=>manager.start(a));
  register('dsh_status','Read status, partial visible output, final answer and finish reason.',id,a=>manager.get(a.agent_id),true);
  register('dsh_list','List persistent DSH agents, including those started by earlier Codex sessions.',{},()=>manager.list(),true);
  register('dsh_events','Read chronological progress/tool events after a cursor. next_cursor supports incremental polling.',{...id,after:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30)},a=>manager.events(a.agent_id,a.after,a.limit),true);
  register('dsh_followup','Continue an idle DSH agent with its original conversation. Busy agents must be interrupted first. Also resumes persisted sessions after service restart.',{...id,task:z.string().min(1)},a=>manager.followup(a.agent_id,a.task));
  register('dsh_interrupt','Cancel current execution and queued input; return only after DSH reaches idle. Keeps conversation and any files already changed.',id,a=>manager.interrupt(a.agent_id));
  register('dsh_close','Release an agent runtime and mark it closed. Retains its history and files.',id,a=>manager.close(a.agent_id));
  register('dsh_wait','Wait for idle, error or interruption for up to 25 seconds; returns current state on timeout.',{...id,seconds:z.number().min(0).max(25).default(20)},async a=>{
    const end=Date.now()+a.seconds*1000;
    while(Date.now()<end && ['starting','running','interrupting'].includes(manager.get(a.agent_id).status))await new Promise(r=>setTimeout(r,250));
    return manager.get(a.agent_id);
  },true);
  return server;
}

async function main(){
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
