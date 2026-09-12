import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,unlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const report={started:new Date().toISOString(),checks:[]};
const cwd=mkdtempSync(join(tmpdir(),'dsh-mcp-live-'));
let client;
async function connect(){client=new Client({name:'dsh-acceptance',version:'1.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[new URL('../src/server.mjs',import.meta.url).pathname]}));}
async function call(name,args={}){const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r));return JSON.parse(r.content[0].text);}
async function idle(id){for(let i=0;i<6;i++){const r=await call('dsh_wait',{agent_id:id,seconds:20});if(!['starting','running','interrupting'].includes(r.status))return r;}throw new Error('timeout');}
const check=(name,data)=>{report.checks.push({name,...data});console.log(name,JSON.stringify(data));};
try{
  await connect();const tools=await client.listTools();assert.equal(tools.tools.length,8);check('mcp_tools',{names:tools.tools.map(t=>t.name)});
  const a=await call('dsh_start',{cwd,effort:'high',permission:'workspace-write',task:'Write exactly MCP-OK into the file mcp-created.txt in your current working directory using the write tool, then reply WROTE. Do not do anything else.'});
  await client.close();await connect();let s=await idle(a.id);assert.equal(s.status,'completed');assert.equal(readFileSync(cwd+'/mcp-created.txt','utf8').trim(),'MCP-OK');check('client_reconnect_and_write',{id:a.id,status:s.status});
  await call('dsh_followup',{agent_id:a.id,task:'What exact text did you write in the previous turn? Reply only that text, without tools.'});s=await idle(a.id);assert.match(s.answer,/MCP-OK/);check('mcp_followup',{answer:s.answer});
  const b=await call('dsh_start',{cwd,effort:'high',permission:'read-only',task:`Sandbox verification: call write exactly once with file_path="${cwd}/read-only-must-not-exist.txt" and content="TEST". Use this exact filename, not the directory. Do not request escalation or use another tool. Report the actual result.`});s=await idle(b.id);
  assert.equal(existsSync(cwd+'/read-only-must-not-exist.txt'),false);
  const events=await call('dsh_events',{agent_id:b.id,limit:100});assert.ok(events.events.some(e=>e.type==='tool/result'));check('read_only_enforced',{id:b.id,status:s.status,answer:s.answer});
  const c=await call('dsh_start',{cwd,effort:'high',permission:'workspace-write',task:'Cancellation test: run exactly sleep 45 in the bash tool, then reply FINISHED. Do not use background execution.'});
  let running=false;
  for(let i=0;i<100;i++){const e=await call('dsh_events',{agent_id:c.id,limit:100});if(e.events.some(x=>x.type==='tool/call')){running=true;break;}await new Promise(r=>setTimeout(r,250));}
  assert.ok(running);s=await call('dsh_interrupt',{agent_id:c.id});assert.equal(s.status,'interrupted');check('mcp_interrupt',{id:c.id,status:s.status,finish_reason:s.finish_reason});
  await call('dsh_followup',{agent_id:c.id,task:'The sleep task is cancelled. Reply only MCP-RESUMED without running any tools.'});s=await idle(c.id);assert.match(s.answer,/MCP-RESUMED/);check('mcp_followup_after_interrupt',{answer:s.answer});
  await call('dsh_close',{agent_id:a.id});await call('dsh_close',{agent_id:b.id});await call('dsh_close',{agent_id:c.id});unlinkSync(cwd+'/mcp-created.txt');report.ok=true;
}catch(e){report.ok=false;report.error=e.stack;console.error(e);process.exitCode=1;}
finally{await client?.close();report.finished=new Date().toISOString();writeFileSync(new URL('../validation-mcp.json',import.meta.url),JSON.stringify(report,null,2)+'\n');if(report.ok)rmSync(cwd,{recursive:true});}
