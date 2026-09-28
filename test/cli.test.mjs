import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {control} from '../src/ipc.mjs';
import {DatabaseSync} from 'node:sqlite';
import net from 'node:net';
import {readFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

for (const longPath of [false,true])
test(`public CLI serves MCP and protects active tasks (${longPath?'long Unicode':'ordinary'} state path)`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-cli-test-'));
 const state=longPath?join(root,'long user directory 雪 '.repeat(5).trimEnd()):root;
 mkdirSync(state,{recursive:true});
 const env={...process.env,DSH_SUBAGENT_STATE:state,DSH_CLI:process.execPath};
 const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
 const daemon=spawn(process.execPath,[cli,'--daemon'],{env,stdio:['ignore','ignore','pipe']});
 const exited=once(daemon,'exit');let diagnostic='';daemon.stderr.on('data',d=>{diagnostic+=d;});
 const client=new Client({name:'cli-test',version:'1'});
 try {
  const endpoint=join(state,process.platform==='win32'||Buffer.byteLength(join(state,'server.sock'))>96?'endpoint.json':'server.sock');
  for(let i=0;i<500&&!existsSync(endpoint)&&daemon.exitCode===null;i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(existsSync(endpoint),diagnostic||'daemon exited before opening its socket');
  if(process.platform==='win32') {
    const {port}=JSON.parse(readFileSync(endpoint,'utf8'));
    const rejected=net.connect({host:'127.0.0.1',port});let data='';
    rejected.on('data',chunk=>{data+=chunk;});rejected.on('error',()=>{});
    rejected.write('{"authenticate":"wrong-token"}\n{"bridge_control":"status"}\n');
    await once(rejected,'close');assert.equal(data,'','unauthenticated callers must not receive service data');
  }
  await client.connect(new StdioClientTransport({command:process.execPath,args:[cli],env}));
  const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='dsh_wait'));
  const response=await client.callTool({name:'dsh_list',arguments:{}});
  assert.deepEqual(JSON.parse(response.content[0].text),{len:'49 chars',count:0,total:0,items:[]});
  const db=new DatabaseSync(join(state,'state.sqlite'));
  db.prepare('INSERT INTO agents(id,data) VALUES (?,?)').run('active-fixture',JSON.stringify({id:'active-fixture',status:'running',name:'active task'}));db.close();
  await assert.rejects(control('stop',{state}),/Active DSH tasks/);
  assert.equal((await control('status',{state})).active.length,1);
 } finally {await client.close();await control('stop',{state,force:true}).catch(()=>daemon.kill());await exited;rmSync(root,{recursive:true});}
});
