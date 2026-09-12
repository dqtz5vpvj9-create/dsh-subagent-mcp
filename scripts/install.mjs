#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync,lstatSync,realpathSync,symlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {projectRoot,resolveDshCli} from '../src/config.mjs';

function run(command,args,options={}) {
  const result=spawnSync(command,args,{stdio:'inherit',...options});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} failed (${result.status})`);
}
// systemd expands percent specifiers even in quoted strings.
const quote=value=>'"'+value.replaceAll('%','%%').replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
if(process.platform!=='linux')throw new Error('The installer currently supports Linux with systemd user services.');
const cli=resolveDshCli();
const config=join(homedir(),'.config/dsh-subagent-mcp');
mkdirSync(config,{recursive:true,mode:0o700});
const environment=join(config,'environment');
if(process.argv.includes('--capture-key') && !existsSync(environment)) {
  const lines=[];
  for(const key of ['DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL']) {
    if(process.env[key]){
      const value=process.env[key];
      if(/[\r\n]/.test(value))throw new Error('Unexpected newline in '+key);
      lines.push(key+'="'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"');
    }
  }
  if(!lines.length)throw new Error('--capture-key requires DEEPSEEK_API_KEY or DEEPSEEK_BASE_URL in the environment.');
  writeFileSync(environment,lines.join('\n')+'\n',{mode:0o600,flag:'wx'});
  console.log('Saved provider environment in a private service file; values are not printed.');
}
const profileManifest=join(process.env.DSH_HOME ?? join(homedir(),'.dsh'),'profiles/codex-subagent/package.json');
const profileArgs=existsSync(profileManifest)?[]:['--from-default-profile','sdk'];
run(process.execPath,[cli,'--profile','codex-subagent',...profileArgs,'--dump-config'],{stdio:['ignore','ignore','inherit']});
const unitDir=join(homedir(),'.config/systemd/user');mkdirSync(unitDir,{recursive:true});
const envLines=[`Environment=${quote('PATH='+process.env.PATH)}`,`Environment=${quote('DSH_CLI='+cli)}`];
for(const key of ['DSH_HOME','DSH_SUBAGENT_STATE','TMPDIR'])if(process.env[key])envLines.push(`Environment=${quote(key+'='+process.env[key])}`);
writeFileSync(join(unitDir,'dsh-subagent-mcp.service'),`[Unit]
Description=Persistent DSH subagents for Codex MCP

[Service]
Type=simple
WorkingDirectory=${projectRoot.replaceAll('%','%%')}
ExecStart=${quote(process.execPath)} ${quote(join(projectRoot,'src/server.mjs'))} --daemon
${envLines.join('\n')}
EnvironmentFile=-${environment.replaceAll('%','%%')}
UMask=0077
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
KillMode=control-group

[Install]
WantedBy=default.target
`);
run('systemctl',['--user','daemon-reload']);
run('systemctl',['--user','enable','--now','dsh-subagent-mcp.service']);
run('systemctl',['--user','restart','dsh-subagent-mcp.service']);
const envArgs=process.env.DSH_SUBAGENT_STATE?['--env','DSH_SUBAGENT_STATE='+process.env.DSH_SUBAGENT_STATE]:[];
run('codex',['mcp','add','dsh_subagent',...envArgs,'--',process.execPath,join(projectRoot,'src/server.mjs')]);
if(process.argv.includes('--skill')) {
  const skills=join(process.env.CODEX_HOME ?? join(homedir(),'.codex'),'skills');mkdirSync(skills,{recursive:true});
  const source=join(projectRoot,'skills/dsh-subagent'),target=join(skills,'dsh-subagent');
  let present=false;try{lstatSync(target);present=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(present && realpathSync(target)!==realpathSync(source))throw new Error('Another skill already exists at '+target);
  if(!present)symlinkSync(source,target,'dir');
  console.log('Installed skill: '+target);
}
console.log('Installed. Open a new Codex session and check /mcp for dsh_subagent.');
