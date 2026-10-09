import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {temporaryDirectory} from '../../src/platform.mjs';
import {control} from '../../src/ipc.mjs';

test('shared MCP survives 100 reconnects and releases disconnected waiters and stdio clients', {timeout:90000},async()=>{
  const state=mkdtempSync(join(temporaryDirectory(),'dsh-lifecycle-'));
  const cli=fileURLToPath(new URL('../../src/cli.mjs',import.meta.url));
  const env={...process.env,DSH_SUBAGENT_STATE:state,DSH_CLI:process.execPath};
  let daemon,exited;
  const clients=[];
  const boot=async()=>{
    daemon=spawn(process.execPath,[cli,'--daemon'],{env,stdio:'pipe'});
    let stderr='';daemon.stderr.on('data',d=>stderr+=d);exited=once(daemon,'exit');
    for(let n=0;n<500;n++) {
      if(daemon.exitCode!==null)throw new Error(stderr);
      if(existsSync(join(state,'http.json'))) {
        try{if((await control('status',{state})).http)return;}catch{}
      }
      await delay(20);
    }
    throw new Error('Daemon did not become ready.');
  };
  const stop=async()=>{await control('stop',{state,force:true});await exited;};
  const settled=async predicate=>{
    for(let n=0;n<100;n++){if(await predicate())return;await delay(30);}
    throw new Error('Resources did not return to baseline within three seconds.');
  };
  try {
    await boot();
    const endpoint=JSON.parse(readFileSync(join(state,'http.json'),'utf8'));
    const url=`http://127.0.0.1:${endpoint.port}/mcp`;
    const headers={Authorization:'Bearer '+endpoint.token};
    assert.equal((await fetch(url,{method:'POST'})).status,401);
    assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);
    for(let round=0;round<5;round++) {
      const group=await Promise.all(Array.from({length:20},async()=>{
        const client=new Client({name:'lifecycle-e2e',version:'1'});clients.push(client);
        await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers}}));
        assert.ok((await client.listTools()).tools.some(tool=>tool.name==='dsh_watch'));
        const list=await client.callTool({name:'dsh_list',arguments:{}});
        assert.equal(JSON.parse(list.content[0].text).count,0);
        return client;
      }));
      // Holding 20 initialized clients retains no per-chat MCP server.
      await settled(async()=>{const s=await control('status',{state});return s.http.requests===0&&s.connections===0;});
      assert.equal((await control('status',{state})).runtimes.length,0);
      await Promise.all(group.map(client=>client.close()));
    }
    const db=new DatabaseSync(join(state,'state.sqlite'));
    db.prepare('INSERT INTO agents VALUES (?,?)').run('pending-fixture',JSON.stringify({id:'pending-fixture',status:'running'}));db.close();
    const abort=new AbortController();
    const waiting=fetch(url,{method:'POST',signal:abort.signal,headers:{...headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'dsh_wait',arguments:{agent_id:'pending-fixture'}}})}).catch(error=>error);
    await settled(async()=>{const s=await control('status',{state});return s.observers===1&&s.http.requests===1;});
    abort.abort();await waiting;
    await settled(async()=>{const s=await control('status',{state});return s.observers===0&&s.http.requests===0;});
    assert.equal((await control('status',{state})).active.length,1,'Disconnect must not cancel background work');
    const proxy=spawn(process.execPath,[cli,'mcp'],{env,stdio:'pipe'});proxy.stderr.resume();proxy.stdout.resume();
    const proxyExit=once(proxy,'exit');
    proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'EOF-test',version:'1'}}})+'\n');
    await settled(async()=>(await control('status',{state})).connections===1);
    proxy.stdin.end();
    await Promise.race([proxyExit,delay(5000).then(()=>{proxy.kill();throw new Error('Stdio child retained after EOF');})]);
    await settled(async()=>(await control('status',{state})).connections===0);
    await stop();await boot();
    assert.deepEqual(JSON.parse(readFileSync(join(state,'http.json'),'utf8')),endpoint,'HTTP URL and credentials survive service restart');
    const client=new Client({name:'after-restart',version:'1'});clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers}}));
    assert.ok((await client.listTools()).tools.length);
    await client.close();
    console.log('100 connections, 20 idle clients, aborted wait, EOF and restart: resources returned to baseline.');
  } finally {
    await Promise.allSettled(clients.map(client=>client.close()));
    await control('stop',{state,force:true}).catch(()=>daemon?.kill());
    if(exited)await exited;
    rmSync(state,{recursive:true,force:true});
  }
});
