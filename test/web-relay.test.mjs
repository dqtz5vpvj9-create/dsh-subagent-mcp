import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveHistory,readHistory} from '../src/web-relay.mjs';
import {apply} from '../src/web-plugin.mjs';
const id='00000000-0000-4000-8000-000000000001';
test('Web routes external history and pagination to owner, preserving ordinary history',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-relay-'));
 const stop=await serveHistory(join(dir,id+'.sock'),id,{
  async *follow(request){assert.equal(request.maxMessages,7);yield{type:'snapshot',cursor:3};yield{type:'event',event:{seq:4,data:'new output'}};},
  async page(request){assert.equal(request.beforeSeq,3);return{records:['earlier output'],hasMore:false};}
 },{async *control(){yield{type:'queue',sessionId:id,items:[]};}});
 let dispose;
 const history={async *follow(){yield{ordinary:true};},async page(){return{ordinary:true};}};
 const original=history.follow;
 apply({sessionController:{history,controlState:{broadcast(){}}},logger:{warn(message){throw new Error(message);}},effect(fn){dispose=fn();}},{socketDirectory:dir});
 t.after(async()=>{dispose();await stop();rmSync(dir,{recursive:true});});
 assert.equal(statSync(join(dir,id+'.sock')).mode&0o777,0o600);
 const request={address:{kind:'session',sessionId:id},maxMessages:7};
 const frames=[];for await(const frame of history.follow(request,new AbortController().signal))frames.push(frame);
 assert.deepEqual(frames,[{type:'snapshot',cursor:3},{type:'event',event:{seq:4,data:'new output'}}]);
 assert.deepEqual(await history.page({...request,beforeSeq:3}),{records:['earlier output'],hasMore:false});
 assert.deepEqual(await history.follow({address:{kind:'session',sessionId:'ordinary'}}).next(),{value:{ordinary:true},done:false});
 dispose();assert.equal(history.follow,original);
});
test('relay rejects another session and execution commands',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-relay-'));
 const stop=await serveHistory(join(dir,id+'.sock'),id,{});
 t.after(async()=>{await stop();rmSync(dir,{recursive:true});});
 await assert.rejects(readHistory(join(dir,id+'.sock'),'follow',{address:{kind:'session',sessionId:'someone-else'}}).next(),/own session/);
 await assert.rejects(readHistory(join(dir,id+'.sock'),'prompt',{address:{kind:'session',sessionId:id}}).next(),/Unsupported read operation/);
});
