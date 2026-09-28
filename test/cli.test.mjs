import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {control} from '../src/ipc.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('public CLI starts the daemon and serves MCP over its stdio entrypoint',async()=>{
 const state=mkdtempSync(join(tmpdir(),'dsh-cli-test-'));
 const env={...process.env,DSH_SUBAGENT_STATE:state,DSH_CLI:process.execPath};
 const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
 const daemon=spawn(process.execPath,[cli,'--daemon'],{env,stdio:['ignore','ignore','pipe']});
 const exited=once(daemon,'exit');let diagnostic='';daemon.stderr.on('data',d=>{diagnostic+=d;});
 const client=new Client({name:'cli-test',version:'1'});
 try {
  const endpoint=join(state,process.platform==='win32'?'endpoint.json':'server.sock');
  for(let i=0;i<250&&!existsSync(endpoint)&&daemon.exitCode===null;i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(existsSync(endpoint),diagnostic||'daemon exited before opening its socket');
  await client.connect(new StdioClientTransport({command:process.execPath,args:[cli],env}));
  const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='dsh_wait'));
  const response=await client.callTool({name:'dsh_list',arguments:{}});
  assert.deepEqual(JSON.parse(response.content[0].text),{len:'49 chars',count:0,total:0,items:[]});
 } finally {await client.close();await control('stop',{state,force:true}).catch(()=>daemon.kill());await exited;rmSync(state,{recursive:true});}
});
