import {mkdtempSync, mkdirSync, rmSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {runCommand} from './commands.mjs';
import {temporaryDirectory} from './platform.mjs';

// Services and Web plugins must outlive the npx cache that launched setup.
export function installPackage(source, prefix) {
  const target=join(prefix,'node_modules/dsh-subagent-mcp');
  try {if(realpathSync(source)===realpathSync(target))return target;} catch(e) {if(e.code!=='ENOENT')throw e;}
  mkdirSync(prefix,{recursive:true});
  const scratch=mkdtempSync(join(temporaryDirectory(),'dsh-package-'));
  try {
    const [pack]=JSON.parse(runCommand('npm',['pack',source,'--pack-destination',scratch,'--ignore-scripts','--json'],{encoding:'utf8',stdio:'pipe'}));
    runCommand('npm',['install','--prefix',prefix,'--no-save','--package-lock=false','--ignore-scripts','--omit=dev','--no-audit','--no-fund',join(scratch,pack.filename)]);
    return target;
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
