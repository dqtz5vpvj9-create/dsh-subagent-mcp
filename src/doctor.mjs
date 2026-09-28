import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {locations, installation} from './platform.mjs';
import {resolveDshCli} from './config.mjs';
import {commandSpec, runCommand} from './commands.mjs';
import {statusService} from './service.mjs';
import {bridgeClient} from './bridge-client.mjs';
import {codexCallback} from './codex-callback.mjs';

export async function doctor({json = false, runtimeChecked = false} = {}) {
  const checks = [], record = installation();
  const add = (name, status, detail) => checks.push({name, status, detail});
  add('Node.js', Number(process.versions.node.split('.')[0]) >= 24 ? 'ok' : 'error', process.version);
  try {add('DSH', 'ok', resolveDshCli());} catch (error) {add('DSH', 'error', error.message);}
  try {
    if (!runtimeChecked) await (await import('./probe-runtime.mjs')).probeRuntime();
    add('DSH runtime','ok','SDK and agent presets initialized');
  } catch(error) {add('DSH runtime','error',error.message);}
  try {
    const spec = record?.codex || commandSpec('codex');
    add('Codex', 'ok', runCommand(spec, ['--version'], {stdio: 'pipe', encoding: 'utf8', timeout: 15000}).trim());
  } catch (error) {add('Codex', 'error', error.message);}
  const status = await statusService();
  add('Service', status.running ? 'ok' : 'error', status.running ? `${record?.backend || 'legacy'}; ${status.active.length} active task(s)` : 'Not running. Run dsh-subagent-mcp start.');
  if (status.running) {
    let client;
    try {client = await bridgeClient(); const tools = await client.request('tools/list', {}); if (!tools.tools.some(tool => tool.name === 'dsh_start')) throw new Error('dsh_start is missing'); add('MCP', 'ok', 'Connected and discovered DSH tools');}
    catch (error) {add('MCP', 'error', error.message);} finally {client?.close();}
  }
  const skill = join(locations().codex, 'skills/dsh-subagent/SKILL.md');
  add('Skill', existsSync(skill) ? 'ok' : 'warning', existsSync(skill) ? skill : 'Use setup to install the companion skill.');
  if (process.env.CODEX_THREAD_ID) {
    try {await codexCallback({threadId: process.env.CODEX_THREAD_ID, check: true}); add('Callback', 'ok', 'Parent thread is reachable');}
    catch (error) {add('Callback', 'warning', error.message);}
  } else add('Callback', 'warning', 'Run doctor inside Codex to check the parent. On Windows, use dsh-subagent-mcp codex.');
  const report = {ok: !checks.some(check => check.status === 'error'), platform: process.platform, checks};
  if (json) console.log(JSON.stringify(report, null, 2));
  else for (const check of checks) console.log(`${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.detail}`);
  if (!report.ok) process.exitCode = 1;
  return report;
}
