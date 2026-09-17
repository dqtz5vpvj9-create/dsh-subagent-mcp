import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';

export async function authenticateWeb(webUrl) {
  const url=new URL(webUrl);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)
    throw new Error('Use an HTTP(S) DSH Web URL without userinfo');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))
    throw new Error('Remote DSH Web connections require HTTPS');
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  await response.body?.cancel();
  if(response.status!==303||!cookie)throw new Error('DSH Web authentication failed; supply its current launch URL');
  return {origin:url.origin,cookie};
}

// Use the same authenticated RPC and multiplexed streams as the DSH browser.
export class WebClient {
  constructor(credentials) {this.credentials=credentials;this.streams=new Map();}
  async rpc(method,args) {
    const {origin,cookie}=this.credentials;
    const response=await fetch(new URL('/api/'+method,origin),{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{cookie,origin,'content-type':'application/json'},
      body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method,payload:{args}}),
    });
    if(!response.ok){await response.body?.cancel();throw new Error(`DSH Web ${method}: HTTP ${response.status}`);}
    const {result}=await response.json();
    if(!result?.ok) {
      const error=new Error(`DSH Web ${method}: ${result?.error?.code??'invalid response'}: ${result?.error?.message??''}`);
      error.remoteRejected=true;throw error;
    }
    return result.value;
  }
  async connect(onDisconnect) {
    const {origin,cookie}=this.credentials;
    const url=new URL('/api/remote.mux',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=this.socket=new WebSocket(url,{headers:{cookie,origin},handshakeTimeout:30000});
    socket.on('message',data=>{
      try {
        const frame=JSON.parse(data.toString()),stream=this.streams.get(frame.streamId);
        if(!stream)return;
        if(frame.type==='item') {stream.onValue(frame.value);stream.resolve(frame.value);}
        else throw new Error(frame.type==='error'?`DSH Web stream: ${frame.error.code}: ${frame.error.message}`:'DSH Web stream ended');
      } catch(error) {this.fail(error);}
    });
    socket.on('error',error=>this.fail(error));
    socket.on('close',()=>{if(!this.closed){this.fail(new Error('DSH Web connection closed'));onDisconnect(this.error);}});
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  }
  subscribe(endpoint,args,onValue) {
    return new Promise((resolve,reject)=>{
      const streamId=randomUUID();
      const timer=setTimeout(()=>{this.streams.delete(streamId);reject(new Error(`DSH Web ${endpoint} did not open`));},30000);
      this.streams.set(streamId,{onValue,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      this.socket.send(JSON.stringify({type:'open',streamId,endpoint,payload:{args}}));
    });
  }
  fail(error) {
    this.error=error;
    for(const stream of this.streams.values())stream.reject(error);
    this.streams.clear();
    this.socket?.terminate();
  }
  close() {this.closed=true;this.fail(new Error('DSH Web observer detached'));}
}
