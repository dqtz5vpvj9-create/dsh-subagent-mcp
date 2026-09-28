#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {projectRoot, resolveDshCli} from './config.mjs';
import {installPackage} from './install-package.mjs';

const [command,...args]=process.argv.slice(2);
const version=JSON.parse(readFileSync(join(projectRoot,'package.json'),'utf8')).version;
try {
  if(command==='--version')console.log(version);
  else if(command==='--help'||command==='help')console.log(`DSH Subagent MCP ${version}

Usage:
  dsh-subagent-mcp setup [--skill] [--capture-key]
  dsh-subagent-mcp adopt
  dsh-subagent-mcp [--daemon]

setup  Install a persistent service and register it with Codex.
adopt  Move sessions created before this version under their workspace's
       subagent mount point, so DSH Web lists them there instead of beside
       your own sessions. Stop the service first.

Requires Node.js 24+, Linux/systemd, Codex CLI, and configured DSH.
Finish or interrupt running bridge tasks before rerunning setup.`);
  else if(command==='setup') {
    if(process.platform!=='linux')throw new Error('Setup requires Linux with systemd user services.');
    const allowed=new Set(['--skill','--capture-key']);
    for(const arg of args)if(!allowed.has(arg))throw new Error('Unknown option: '+arg);
    resolveDshCli();
    const prefix=join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'dsh-subagent-mcp');
    let root=join(prefix,'node_modules/dsh-subagent-mcp');
    root=installPackage(projectRoot,prefix);
    const run=(file,flags=[])=>{
      const result=spawnSync(process.execPath,[join(root,'scripts',file),...flags],{stdio:'inherit'});
      if(result.error)throw result.error;
      if(result.status!==0)throw new Error(file+' failed ('+result.status+')');
    };
    run('install.mjs',args);
    // Older installs left a plugin loaded in the DSH Web process.
    run('uninstall-web.mjs');
  } else if(command==='adopt') {
    if(args.length)throw new Error('Unknown option: '+args[0]);
    await (await import('./adopt.mjs')).adopt();
  } else if(command===undefined||command==='--daemon')await (await import('./server.mjs')).main();
  else throw new Error('Unknown command: '+command+'. Run dsh-subagent-mcp --help.');
} catch(error) {console.error(error.message);process.exitCode=1;}
