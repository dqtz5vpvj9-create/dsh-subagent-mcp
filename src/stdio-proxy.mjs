import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {locations,installation} from './platform.mjs';
import {connectBridge} from './ipc.mjs';

export async function stdioProxy() {
  const state=locations().state;
    let socket;
    try {socket=await connectBridge(state);}
    catch(error) {
      const {installation}=await import('./platform.mjs');
      if(!installation())throw error;
      if(existsSync(join(state,'paused')))throw new Error('DSH was stopped explicitly. Run dsh-subagent-mcp start to resume the service.');
      await (await import('./service.mjs')).startService();
      socket=await connectBridge(state);
    }
    socket.on('error',e=>{console.error('DSH subagent service unavailable: '+e.message);process.exitCode=1;process.stdin.destroy();});
    if(process.env.DSH_CODEX_CONNECTION) {
      const input=createInterface({input:process.stdin});
      input.on('line',line=>{
        try {
          const message=JSON.parse(line);
          if(message.method==='tools/call')message.params._meta={...message.params._meta,dshConnection:process.env.DSH_CODEX_CONNECTION};
          socket.write(JSON.stringify(message)+'\n');
        } catch {socket.destroy(new Error('Invalid MCP input'));}
      });
      input.once('close',()=>socket.end());
      socket.once('close',()=>input.close());
    } else process.stdin.pipe(socket);
    socket.pipe(process.stdout);
    socket.on('close',()=>process.stdin.destroy());
}
