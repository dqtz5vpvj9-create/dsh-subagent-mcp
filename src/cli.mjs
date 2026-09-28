#!/usr/bin/env node
import {readFileSync, existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {projectRoot, resolveDshCli} from './config.mjs';
import {locations, installation, providerEnvironment} from './platform.mjs';

const [command, ...args] = process.argv.slice(2);
const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const flags = options => parseArgs({args, options}).values;
try {
  if (command === '--version' || command === '-V') console.log(version);
  else if (['--help', '-h', 'help'].includes(command)) console.log(`DSH Subagent MCP ${version}

Usage:
  dsh-subagent-mcp                          Open Codex; install on first use
  dsh-subagent-mcp setup [--capture-key] [--service auto|background]
  dsh-subagent-mcp doctor [--json]
  dsh-subagent-mcp status [--json]
  dsh-subagent-mcp start | stop [--force] | restart
  dsh-subagent-mcp logs
  dsh-subagent-mcp upgrade
  dsh-subagent-mcp uninstall [--purge]
  dsh-subagent-mcp codex [Codex arguments]
  dsh-subagent-mcp dsh [DSH arguments]
  dsh-subagent-mcp notify --agent AGENT_ID
  dsh-subagent-mcp adopt
  dsh-subagent-mcp mcp                      MCP stdio transport

Windows, Linux and macOS. Node.js 24+; no Python required.
Setup installs missing DSH/Codex dependencies, a per-user background service,
Codex MCP registration and the companion skill. No administrator access needed.
Use --no-install-deps to manage dependencies yourself, or --no-skill to keep a
custom skill. --skill remains accepted for older installation commands.
Uninstall preserves history and credentials unless --purge is specified.
Upgrades and ordinary stops refuse to interrupt active tasks.`);
  else if (command === 'setup') await (await import('./setup.mjs')).setup(args);
  else if (command === 'doctor') await (await import('./doctor.mjs')).doctor(flags({json: {type: 'boolean'}}));
  else if (command === 'status') {
    const {json} = flags({json: {type: 'boolean'}});
    const result = await (await import('./service.mjs')).statusService();
    console.log(json ? JSON.stringify(result) : result.running ? `Running; ${result.active.length} active task(s).` : 'Stopped. Run dsh-subagent-mcp start.');
    if (!result.running) process.exitCode = 1;
  } else if (command === 'start' || command === 'restart' || command === 'stop') {
    const options = flags(command === 'stop' ? {force: {type: 'boolean'}} : {});
    const service = await import('./service.mjs');
    if (command !== 'start') await service.stopService(options);
    if (command !== 'stop') await service.startService();
    if (command === 'stop' && installation()) writeFileSync(join(locations().state, 'paused'), '', {mode: 0o600});
    console.log(command === 'stop' ? 'Stopped.' : 'Ready.');
  } else if (command === 'logs') {
    flags({});
    const path = join(locations().state, 'daemon.log');
    console.log(existsSync(path) ? readFileSync(path, 'utf8').split('\n').slice(-100).join('\n') : 'No service log yet.');
  } else if (command === 'upgrade') {
    flags({});
    const status = await (await import('./service.mjs')).statusService();
    if (status.running && status.active.length) throw new Error('Finish or interrupt active DSH tasks before upgrading.');
    (await import('./commands.mjs')).runCommand('npm', ['exec', '--yes', '--package=dsh-subagent-mcp@latest', '--', 'dsh-subagent-mcp', 'setup', ...(installation()?.skill === false ? ['--no-skill'] : [])]);
  } else if (command === 'uninstall') await (await import('./setup.mjs')).uninstall(flags({purge: {type: 'boolean'}}));
  else if (command === 'notify') await (await import('./notify.mjs')).notify(args);
  else if (command === 'codex' || (command === undefined && process.stdin.isTTY)) await (await import('./codex-launch.mjs')).launchCodex(args);
  else if (command === 'dsh') {
    const env = {...process.env, ...installation()?.env, ...providerEnvironment()};
    (await import('./commands.mjs')).runCommand([process.execPath, resolveDshCli()], args, {env});
  }
  else if (command === 'adopt') {
    flags({});
    if (process.platform !== 'linux') throw new Error('Legacy session adoption requires Linux flock. Normal DSH sessions work on all supported platforms.');
    await (await import('./adopt.mjs')).adopt();
  } else if (command === undefined || command === 'mcp' || command === '--daemon') await (await import('./server.mjs')).main();
  else throw new Error('Unknown command: ' + command + '. Run dsh-subagent-mcp --help.');
} catch (error) {console.error(error.message); process.exitCode = 1;}
