import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {projectRoot} from '../src/config.mjs';

test('packed CLI installs service and skill outside its disposable source and removes the obsolete Web relay', {skip:process.env.DSH_PACKAGE_TEST!=='1'},()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-npm-test-'));
 try {
  const [pack]=JSON.parse(execFileSync('npm',['pack',projectRoot,'--pack-destination',root,'--json','--ignore-scripts'],{encoding:'utf8'}));
  const cache=join(root,'cache');mkdirSync(cache);
  execFileSync('tar',['-xzf',join(root,pack.filename),'-C',cache]);
  const home=join(root,'home'),bin=join(root,'bin'),data=join(root,'data');mkdirSync(bin);mkdirSync(home);
  const calls=join(root,'calls.jsonl');
  for(const name of ['codex','systemctl'])writeFileSync(join(bin,name),`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(calls)},JSON.stringify([${JSON.stringify(name)},...process.argv.slice(2)])+'\\n');`,{mode:0o755});
  const dsh=join(root,'dsh.mjs');writeFileSync(dsh,'// DSH profile initialization boundary\n');
  const patch=join(home,'.dsh/profiles/web/cordis.patch.yml');mkdirSync(join(home,'.dsh/profiles/web'),{recursive:true});writeFileSync(patch,'- insert:\n    - id: dsh-subagent-web\n      name: /previous-install/web-plugin.mjs\n');
  const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),XDG_DATA_HOME:data,DSH_HOME:join(home,'.dsh'),DSH_CLI:dsh,PATH:bin+':'+process.env.PATH};
  const entry=join(cache,'package/src/cli.mjs');
  execFileSync(process.execPath,[entry,'setup','--skill'],{env,stdio:'pipe'});
  const installed=join(data,'dsh-subagent-mcp/node_modules/dsh-subagent-mcp');
  const unit=readFileSync(join(home,'.config/systemd/user/dsh-subagent-mcp.service'),'utf8');
  assert.ok(unit.includes(join(installed,'src/server.mjs')));
  assert.equal(realpathSync(join(home,'.codex/skills/dsh-subagent')),join(installed,'skills/dsh-subagent'));
  const commands=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(commands.some(row=>row[0]==='codex'&&row.includes(join(installed,'src/server.mjs'))));
  assert.ok(!readFileSync(patch,'utf8').includes('dsh-subagent-web'),'setup removes an earlier Web relay entry');
  rmSync(cache,{recursive:true});
  const version=execFileSync(process.execPath,[join(installed,'src/cli.mjs'),'--version'],{env,encoding:'utf8'}).trim();
  assert.match(version,/^\d+\.\d+\.\d+$/);
  assert.match(readFileSync(join(home,'.codex/skills/dsh-subagent/SKILL.md'),'utf8'),/dsh_start/);
  assert.match(execFileSync(process.execPath,['--input-type=module','-e',"await import("+JSON.stringify(join(installed,'src/runtime.mjs'))+"); console.log('loaded')"],{env,encoding:'utf8'}),/loaded/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
