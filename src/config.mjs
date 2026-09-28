import {existsSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {delimiter,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {locations, installation} from './platform.mjs';
import {commandSpec} from './commands.mjs';

// DeepSeek rejects a request when prompt plus reserved completion exceeds its
// window. DSH compacts at a fraction of the window without that reservation, so
// its 256k default completion budget let prompts fail below the threshold.
export const CONTEXT_WINDOW_TOKENS=1048576;
export const MAX_OUTPUT_TOKENS=128000;
export const contextLimitTokens=provider=>provider==='deepseek-official'?CONTEXT_WINDOW_TOKENS-MAX_OUTPUT_TOKENS:undefined;
export const projectRoot=dirname(dirname(fileURLToPath(import.meta.url)));
export const stateDirectory=()=>locations().state;
export function resolveDshCli() {
  const explicit = process.env.DSH_CLI || installation()?.dsh;
  if (explicit) return realpathSync(explicit);
  const spec = commandSpec('dsh', {prefix: join(locations().data, 'dependencies')});
  return realpathSync(spec.at(-1));
}
export function runtimeConfig(state=stateDirectory()) {
  mkdirSync(state,{recursive:true,mode:0o700});
  const patch=join(state,'bridge.patch.yml');
  const legacyPatch=join(state,'bridge-legacy.patch.yml');
  const shared=`- id: sdk-jsonrpc-server
  disabled: true
- id: llm-deepseek
  config:
    maxTokens: ${MAX_OUTPUT_TOKENS}
- insert:
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config:
        default: standard
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
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
