import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import WebSocket from 'ws';

export function callbackEndpoint(endpoint) {
  const local=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'app-server-control','app-server-control.sock');
  if(!endpoint||endpoint==='unix://')return `ws+unix://${local}:/`;
  if(endpoint.startsWith('unix://'))return `ws+unix://${endpoint.slice(7)}:/`;
  return endpoint;
}

// One connection and one delivery attempt. A lost acknowledgement may follow
// successful delivery, so the caller must not retry through another transport.
export async function codexCallback({threadId,output,endpoint,check=false},{timeoutMs=15000}={}) {
  const socket=new WebSocket(callbackEndpoint(endpoint));
  let timer;
  try {
    return await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Codex callback acknowledgement timed out; delivery may have occurred')),timeoutMs);
      const send=(method,params,id)=>socket.send(JSON.stringify({method,params,...(id===undefined?{}:{id})}));
      socket.on('error',reject);
      socket.on('close',()=>reject(new Error('Codex connection closed before acknowledgement; delivery may have occurred')));
      socket.on('open',()=>send('initialize',{
        clientInfo:{name:'dsh_subagent_callback',version:'1'},capabilities:{},
      },1));
      socket.on('message',data=>{
        try {
          const message=JSON.parse(data.toString());
          if(message.id!==1&&message.id!==2)return;
          if(message.error)throw new Error(JSON.stringify(message.error));
          if(message.id===1){
            send('initialized',{});
            if(check)send('thread/read',{threadId,includeTurns:false},2);
            else send('turn/start',{threadId,input:[],toolOutput:{
              name:'dsh_completion',namespace:null,output:JSON.stringify(output),
            }},2);
          } else {
            if(check){
              if(message.result?.thread?.id!==threadId)throw new Error('Codex returned a different parent thread');
              resolve({thread_id:threadId,status:message.result.thread.status});
            } else {
              if(!message.result?.turn?.id)throw new Error('Codex returned no turn acknowledgement; delivery may have occurred');
              resolve({turn_id:message.result.turn.id,status:message.result.turn.status});
            }
          }
        } catch(error){reject(error);}
      });
    });
  } finally {
    clearTimeout(timer);
    socket.terminate();
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  try {
    let input='';
    for await(const chunk of process.stdin)input+=chunk;
    process.stdout.write(JSON.stringify(await codexCallback(JSON.parse(input)))+'\n');
  } catch(error){console.error(error.message);process.exitCode=1;}
}
