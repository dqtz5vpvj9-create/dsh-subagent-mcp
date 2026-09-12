import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {readHistory} from './web-relay.mjs';
export const name='dsh-subagent-web';
export const inject=['sessionController'];
export function apply(ctx,config={}) {
  const directory=config.socketDirectory??join(process.env.DSH_SUBAGENT_STATE??join(homedir(),'.local/state/dsh-subagent-mcp'),'web');
  const history=ctx.sessionController.history;
  const follow=history.follow;
  const page=history.page;
  const pathFor=request=>{
    const id=request?.address?.sessionId;
    if(request?.address?.kind!=='session'||!(/^[0-9a-f-]{36}$/i.test(id??'')))return;
    const path=join(directory,id+'.sock');
    return existsSync(path)?path:undefined;
  };
  history.follow=async function*(request,signal){
    const path=pathFor(request);
    if(!path){yield* follow.call(this,request,signal);return;}
    const abort=new AbortController();
    const cancel=()=>abort.abort();
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    const controls=(async()=>{
      for await(const frame of readHistory(path,'control',request,abort.signal)){
        const publish=value=>ctx.sessionController.controlState.broadcast(value);
        if(frame.type==='baseline'){
          for(const [sessionId,block] of Object.entries(frame.value.projections))
            for(const [key,value] of Object.entries(block.values))
              publish({type:'projection',sessionId,key,value,seq:block.asOfSeq});
          for(const [sessionId,items] of Object.entries(frame.value.queues))publish({type:'queue',sessionId,items});
          for(const [sessionId,jobs] of Object.entries(frame.value.jobs))publish({type:'jobs',sessionId,jobs});
        }else publish(frame);
      }
    })().catch(error=>{if(!abort.signal.aborted)ctx.logger.warn('Subagent control relay: '+error.message);});
    try{yield* readHistory(path,'follow',request,abort.signal);}
    finally{cancel();signal?.removeEventListener('abort',cancel);await controls;}
  };
  history.page=async function(request,signal){
    const path=pathFor(request);
    if(!path)return page.call(this,request,signal);
    for await(const frame of readHistory(path,'page',request,signal))return frame;
    throw new Error('Session relay closed before returning its history page');
  };
  ctx.effect(()=>()=>{history.follow=follow;history.page=page;},'dsh-subagent-web');
}
