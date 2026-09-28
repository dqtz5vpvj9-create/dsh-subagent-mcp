import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {codexCallback} from '../src/codex-callback.mjs';

async function fixture(t,reply){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{for(const socket of server.clients)socket.terminate();return new Promise(resolve=>server.close(resolve));});
  const calls=[];
  server.on('connection',socket=>socket.on('message',data=>{
    const request=JSON.parse(data.toString());calls.push(request);
    if(request.method==='initialize')socket.send(JSON.stringify({id:request.id,result:{userAgent:'fixture'}}));
    else if(request.id)reply(socket,request);
  }));
  return {calls,endpoint:`ws://127.0.0.1:${server.address().port}`};
}

test('native callback delivers tool data with empty user input and preserves the answer',async t=>{
  const f=await fixture(t,(socket,request)=>{
    socket.send(JSON.stringify({method:'unrelated/notification',params:{}}));
    socket.send(JSON.stringify({id:request.id,result:{turn:{id:'turn-1',status:'inProgress'}}}));
  });
  const output={agent_id:'child',status:'completed',answer:'verified result'};
  const receipt=await codexCallback({threadId:'parent',output,endpoint:f.endpoint});
  assert.deepEqual(receipt,{turn_id:'turn-1',status:'inProgress'});
  assert.deepEqual(f.calls.map(x=>x.method),['initialize','initialized','turn/start']);
  assert.deepEqual(f.calls[2].params,{threadId:'parent',input:[],toolOutput:{
    name:'dsh_completion',namespace:null,output:JSON.stringify(output),
  }});
});

test('preflight reads the exact parent without starting model generation',async t=>{
  const f=await fixture(t,(socket,request)=>socket.send(JSON.stringify({id:request.id,result:{thread:{id:'parent',status:{type:'idle'}}}})));
  await codexCallback({threadId:'parent',check:true,endpoint:f.endpoint});
  assert.equal(f.calls.at(-1).method,'thread/read');
  assert.deepEqual(f.calls.at(-1).params,{threadId:'parent',includeTurns:false});
});

test('RPC rejection is reported without another delivery',async t=>{
  const f=await fixture(t,(socket,request)=>socket.send(JSON.stringify({id:request.id,error:{code:-32602,message:'Unsupported toolOutput'}})));
  await assert.rejects(codexCallback({threadId:'parent',output:{},endpoint:f.endpoint}),/Unsupported toolOutput/);
  assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);
});

test('lost delivery acknowledgement does not cause a retry',async t=>{
  const f=await fixture(t,()=>{});
  await assert.rejects(codexCallback({threadId:'parent',output:{},endpoint:f.endpoint},{timeoutMs:100}),/delivery may have occurred/);
  assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);
});
