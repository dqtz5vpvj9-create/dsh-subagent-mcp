import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {runtimeConfig, resolveDshCli} from './config.mjs';
import {temporaryDirectory, providerEnvironment} from './platform.mjs';
import {Runtime} from './runtime.mjs';

// Initialize the actual SDK/plugin composition without creating a conversation
// or making a model request. CLI version and --dump-config cannot prove this.
export async function probeRuntime(cli=resolveDshCli()) {
  const root=mkdtempSync(join(temporaryDirectory(),'dsh-runtime-check-'));
  let runtime, initialized=false;
  try {
    const config={...runtimeConfig(root,cli),env:providerEnvironment()};
    runtime=new Runtime({cwd:process.cwd(),preset:'standard'},config);
    runtime.on('exit',()=>{});
    await runtime.request('initialize',{cwd:process.cwd(),provider:'deepseek-official',model:'deepseek-flash',
      permission:'read-only',preset:'standard',resume:false});
    initialized=true;
  } finally {
    try {
      if(initialized)await runtime.close();
      else if(runtime?.child.pid&&!runtime.exited){runtime.child.kill();await runtime.exitPromise;}
    } finally {rmSync(root,{recursive:true,force:true});}
  }
}
