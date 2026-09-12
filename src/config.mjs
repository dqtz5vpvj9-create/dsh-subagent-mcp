import {existsSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {delimiter,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';

export const projectRoot=dirname(dirname(fileURLToPath(import.meta.url)));
export const stateDirectory=()=>process.env.DSH_SUBAGENT_STATE ?? join(homedir(),'.local/state/dsh-subagent-mcp');
export function resolveDshCli() {
  const candidate=process.env.DSH_CLI ?? (process.env.PATH ?? '').split(delimiter).map(dir=>join(dir,'dsh')).find(existsSync);
  if(!candidate)throw new Error('DSH was not found. Install @deepseek-ai/dsh or set DSH_CLI to its JavaScript CLI entrypoint.');
  return realpathSync(candidate);
}
export function runtimeConfig(state=stateDirectory()) {
  mkdirSync(state,{recursive:true,mode:0o700});
  const patch=join(state,'bridge.patch.yml');
  writeFileSync(patch,`- id: sdk-jsonrpc-server\n  disabled: true\n- insert:\n    - id: codex-subagent-rpc\n      name: ${JSON.stringify(join(projectRoot,'src/dsh-plugin.mjs'))}\n`,{mode:0o600});
  return {database:join(state,'state.sqlite'),cli:resolveDshCli(),patch};
}
