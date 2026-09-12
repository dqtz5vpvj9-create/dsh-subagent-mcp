import net from 'node:net';
import {createInterface} from 'node:readline';
import {mkdirSync,chmodSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';

// Private, read-only transport. DSH remains the owner of event encoding,
// cursor replay, pagination, and assistant-stream semantics.
export async function serveHistory(path,sessionId,history,control) {
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const clients=new Set();
  const server=net.createServer(socket=>{
    clients.add(socket);
    const abort=new AbortController();
    socket.on('error',()=>{});
    socket.on('close',()=>{abort.abort();clients.delete(socket);});
    const lines=createInterface({input:socket});
    lines.once('line',async line=>{
      try {
        const {method,request}=JSON.parse(line);
        if(request?.address?.kind!=='session'||request.address.sessionId!==sessionId)
          throw new Error('This relay only serves its own session');
        if(method==='follow'||method==='control') {
          const stream=method==='follow'?history.follow(request,abort.signal):control.control(abort.signal);
          for await(const frame of stream) {
            if(!socket.write(JSON.stringify({frame})+'\n'))
              await new Promise(resolve=>{const done=()=>{socket.off('drain',done);socket.off('close',done);resolve();};socket.once('drain',done);socket.once('close',done);});
            if(abort.signal.aborted)break;
          }
        } else if(method==='page') {
          socket.write(JSON.stringify({frame:await history.page(request,abort.signal)})+'\n');
        } else throw new Error('Unsupported read operation');
        socket.end();
      } catch(error) {
        if(!socket.destroyed)socket.end(JSON.stringify({error:error.message})+'\n');
      }
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
  chmodSync(path,0o600);
  return async()=>{
    for(const client of clients)client.destroy();
    await new Promise(resolve=>server.close(resolve));
    try{unlinkSync(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  };
}

export async function* readHistory(path,method,request,signal) {
  const socket=net.connect(path);
  const abort=()=>socket.destroy();
  signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted)return;
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    const lines=createInterface({input:socket});
    socket.write(JSON.stringify({method,request})+'\n');
    for await(const line of lines) {
      const message=JSON.parse(line);
      if(message.error)throw new Error(message.error);
      yield message.frame;
    }
  } finally {signal?.removeEventListener('abort',abort);socket.destroy();}
}
