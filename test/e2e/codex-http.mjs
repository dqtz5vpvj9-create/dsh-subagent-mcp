// Actual Codex App Server and installed MCP configuration; no model request.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {control} from '../../src/ipc.mjs';

export async function codexHttpAcceptance(record,env,cwd) {
  const [file,...prefix]=record.codex;
  const child=spawn(file,[...prefix,'app-server'],{env,stdio:'pipe',windowsHide:true});
  const exited=once(child,'exit');
  const pending=new Map();let seq=0;
  child.stderr.resume();
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{return;}
    const request=pending.get(message.id);
    if(!request)return;
    clearTimeout(request.timer);pending.delete(message.id);
    message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);
  });
  child.on('error',error=>{for(const request of pending.values())request.reject(error);});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},60000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  try {
    await rpc('initialize',{clientInfo:{name:'dsh_http_acceptance',version:'1'},capabilities:{experimentalApi:true}});
    child.stdin.write('{"method":"initialized","params":{}}\n');
    for(let i=0;i<20;i++) {
      const {thread}=await rpc('thread/start',{cwd,ephemeral:true,approvalPolicy:'never'});
      const inventory=await rpc('mcpServerStatus/list',{threadId:thread.id});
      const server=inventory.data.find(row=>row.name==='dsh_subagent');
      assert.ok(server?.tools?.dsh_list,'Codex must discover tools over the installed HTTP connection');
      const reply=await rpc('mcpServer/tool/call',{threadId:thread.id,server:'dsh_subagent',tool:'dsh_list',arguments:{}});
      const result=reply.result??reply;
      assert.ok(!result.isError);
      assert.ok(result.content.some(item=>item.type==='text'));
    }
    for(let n=0;n<100;n++) {
      const state=await control('status',{state:record.state});
      if(!state.http.requests&&!state.connections)break;
      await delay(30);
    }
    const state=await control('status',{state:record.state});
    assert.equal(state.connections,0,'20 Codex chats must not start stdio proxies');
    assert.equal(state.http.requests,0,'Idle Codex chats must not retain request handlers');
    assert.equal(state.runtimes.length,0,'Tool discovery must not start DSH execution');
    console.log('20 actual Codex chats: HTTP tools discovered and called, zero proxy connections or DSH runtimes.');
  } finally {
    for(const request of pending.values())clearTimeout(request.timer);
    lines.close();child.stdin.end();child.kill();await exited;
  }
}
