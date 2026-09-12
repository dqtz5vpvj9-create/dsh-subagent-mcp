import {mkdtempSync, mkdirSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

// Services and Web plugins must outlive the npx cache that launched setup.
export function installPackage(source, prefix) {
  const target=join(prefix,'node_modules/dsh-subagent-mcp');
  try {if(realpathSync(source)===realpathSync(target))return target;} catch(e) {if(e.code!=='ENOENT')throw e;}
  mkdirSync(prefix,{recursive:true});
  const scratch=mkdtempSync(join(tmpdir(),'dsh-package-'));
  try {
    const [pack]=JSON.parse(execFileSync('npm',['pack',source,'--pack-destination',scratch,'--ignore-scripts','--json'],{encoding:'utf8'}));
    execFileSync('npm',['install','--prefix',prefix,'--no-save','--package-lock=false','--ignore-scripts','--omit=dev','--no-audit','--no-fund',join(scratch,pack.filename)],{stdio:'inherit'});
    return target;
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
