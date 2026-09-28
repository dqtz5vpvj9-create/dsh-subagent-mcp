import {existsSync, mkdirSync, writeFileSync, unlinkSync, openSync, closeSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {installation, installationFile, locations, privateDirectory} from './platform.mjs';
import {runCommand} from './commands.mjs';
import {control} from './ipc.mjs';

const label = 'com.deepseek.dsh-subagent-mcp';
const unit = 'dsh-subagent-mcp.service';
export const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export const systemdQuote = value => '"' + value.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
export const windowsQuote = value => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';

export function backendDefault() {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'win32') return 'task-scheduler';
  return spawnSync('systemctl', ['--user', 'show-environment'], {stdio: 'ignore'}).status === 0 ? 'systemd' : 'background';
}

export function serviceDefinition(record, {home = homedir(), user = '', config = installationFile()} = {}) {
  const runner = join(record.root, 'src/service-runner.mjs');
  const args = [runner, '--config', config, '--daemon'];
  if (record.backend === 'systemd') return {
    path: join(home, '.config/systemd/user', unit),
    text: `[Unit]\nDescription=DeepSeek subagents for Codex\n\n[Service]\nType=simple\nExecStart=${[record.node, ...args].map(systemdQuote).join(' ')}\nUMask=0077\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=30\nKillMode=control-group\n\n[Install]\nWantedBy=default.target\n`,
  };
  if (record.backend === 'launchd') return {
    path: join(home, 'Library/LaunchAgents', label + '.plist'),
    text: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[record.node, ...args].map(a => '<string>' + xml(a) + '</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>3</integer><key>Umask</key><integer>63</integer></dict></plist>\n`,
  };
  if (record.backend === 'task-scheduler') return {
    path: join(locations().config, 'service.xml'),
    text: `<?xml version="1.0" encoding="UTF-16"?>\n<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>DeepSeek subagents for Codex</Description></RegistrationInfo><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(user)}</UserId></LogonTrigger></Triggers><Principals><Principal id="Author"><UserId>${xml(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings><Actions Context="Author"><Exec><Command>${xml(record.node)}</Command><Arguments>${xml(args.map(windowsQuote).join(' '))}</Arguments><WorkingDirectory>${xml(record.root)}</WorkingDirectory></Exec></Actions></Task>\n`,
  };
  return null;
}

export function installService(record) {
  const user = process.platform === 'win32' ? runCommand(['whoami.exe'], [], {stdio: 'pipe', encoding: 'utf8'}).trim() : '';
  const definition = serviceDefinition(record, {user});
  if (!definition) return;
  mkdirSync(join(definition.path, '..'), {recursive: true});
  writeFileSync(definition.path, record.backend === 'task-scheduler' ? '\uFEFF' + definition.text : definition.text,
    {encoding: record.backend === 'task-scheduler' ? 'utf16le' : 'utf8', mode: 0o600});
  if (record.backend === 'systemd') {
    runCommand(['systemctl'], ['--user', 'daemon-reload']);
    runCommand(['systemctl'], ['--user', 'enable', unit]);
  } else if (record.backend === 'launchd') {
    spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], {stdio: 'ignore'});
    runCommand(['launchctl'], ['bootstrap', `gui/${process.getuid()}`, definition.path]);
  } else runCommand(['schtasks.exe'], ['/Create', '/TN', label, '/XML', definition.path, '/F']);
}

export async function statusService() {
  try { return {running: true, ...await control('status')}; }
  catch (error) { return {running: false, error: error.message}; }
}

export async function startService(record = installation()) {
  if (!record) throw new Error('Not installed. Run dsh-subagent-mcp setup first.');
  if ((await statusService()).running) return;
  if (record.backend === 'systemd') runCommand(['systemctl'], ['--user', 'start', unit]);
  else if (record.backend === 'launchd') runCommand(['launchctl'], ['kickstart', `gui/${process.getuid()}/${label}`]);
  else if (record.backend === 'task-scheduler') runCommand(['schtasks.exe'], ['/Run', '/TN', label]);
  else {
    privateDirectory(locations().state);
    const log = openSync(join(locations().state, 'daemon.log'), 'a', 0o600);
    const child = spawn(record.node, [join(record.root, 'src/service-runner.mjs'), '--config', installationFile(), '--daemon'],
      {detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env});
    closeSync(log);
    await new Promise((resolve, reject) => {child.once('spawn', resolve); child.once('error', reject);});
    child.unref();
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await statusService()).running) return;
    await delay(150);
  }
  throw new Error('The service did not become ready. Run dsh-subagent-mcp logs and doctor.');
}

export async function stopService({force = false} = {}) {
  const status = await statusService();
  if (status.running) {
    await control('stop', {force});
    for (let i = 0; i < 200 && existsSync(join(locations().state, 'daemon.lock')); i++) await delay(150);
    if (existsSync(join(locations().state, 'daemon.lock'))) throw new Error('The service has not finished stopping. Inspect dsh-subagent-mcp logs.');
  }
}

export async function removeService(record = installation()) {
  if (!record) return;
  await stopService();
  if (record.backend === 'systemd') runCommand(['systemctl'], ['--user', 'disable', '--now', unit]);
  else if (record.backend === 'launchd') spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], {stdio: 'ignore'});
  else if (record.backend === 'task-scheduler') runCommand(['schtasks.exe'], ['/Delete', '/TN', label, '/F']);
  const definition = serviceDefinition(record);
  if (definition && existsSync(definition.path)) unlinkSync(definition.path);
  if (record.backend === 'systemd') runCommand(['systemctl'], ['--user', 'daemon-reload']);
}
