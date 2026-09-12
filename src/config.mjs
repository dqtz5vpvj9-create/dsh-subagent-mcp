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
  const legacyPatch=join(state,'bridge-legacy.patch.yml');
  const shared=`- id: sdk-jsonrpc-server
  disabled: true
- insert:
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config:
        default: minimal
    - id: codex-subagent-rpc
      name: ${JSON.stringify(join(projectRoot,'src/dsh-plugin.mjs'))}
`;
  // As in DSH's Web composition, presets own the agent tools and prompt
  // contributions. Keeping the base tools would make minimal non-minimal.
  const agentRows=['tool-bash','tool-pwsh','tool-jobs','tool-fs','tool-fs-search',
    'skill-filesystem','tool-skill','command-goal','tool-goal','plan-mode',
    'compaction-basic','command-compact','tool-result-pruner','tool-subagent-control',
    'tool-subagent-list-agents','tool-subagent','tool-subagent-fork','workflow-worker-thread',
    'tool-workflow','tool-ralph','agent-instructions','tool-todo','tool-web'];
  writeFileSync(patch,agentRows.map(id=>`- id: ${id}\n  disabled: true\n`).join('')+shared,{mode:0o600});
  // Existing conversations keep the tool composition under which they ran.
  writeFileSync(legacyPatch,shared,{mode:0o600});
  return {database:join(state,'state.sqlite'),cli:resolveDshCli(),patch,legacyPatch};
}
