import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../src/platform.mjs';

for (const scenario of ['client exit', 'terminal default', 'server exit', 'missing executable'])
test(`Codex launcher authenticates its connection and removes credentials after ${scenario}`, {timeout: 30000}, () => {
  const root = mkdtempSync(join(temporaryDirectory(), 'dsh-launch-'));
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const fake = join(root, 'codex fixture.mjs'), report = join(root, 'report.json');
  const ws = import.meta.resolve('ws');
  writeFileSync(fake, `
import WebSocket, {WebSocketServer} from ${JSON.stringify(ws)};
import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2);
if(args[0]==='app-server') {
  if(process.env.LAUNCH_SCENARIO==='server exit')process.exit(4);
  const token=readFileSync(args[args.indexOf('--ws-token-file')+1],'utf8').trim();
  const endpoint=new URL(args[args.indexOf('--listen')+1]);
  const server=new WebSocketServer({host:endpoint.hostname,port:Number(endpoint.port),verifyClient:info=>info.req.headers.authorization==='Bearer '+token});
  server.on('connection',socket=>socket.on('message',data=>socket.send(data)));
} else {
  const connection=JSON.parse(readFileSync(process.env.DSH_CODEX_CONNECTION,'utf8'));
  const socket=new WebSocket(connection.endpoint,{headers:{Authorization:'Bearer '+process.env.DSH_CODEX_TOKEN}});
  socket.on('open',()=>socket.send('authenticated'));
  socket.on('message',data=>{
    writeFileSync(process.env.LAUNCH_REPORT,JSON.stringify({args,reply:String(data),matchingToken:connection.token===process.env.DSH_CODEX_TOKEN}));
    socket.close();process.exit(7);
  });
}
`);
  const env = {...process.env, DSH_SUBAGENT_CONFIG: join(root, 'config'), DSH_SUBAGENT_STATE: join(root, 'state'),
    DSH_CODEX_CLI: scenario === 'missing executable' ? join(root, 'absent.exe') : fake, LAUNCH_SCENARIO: scenario, LAUNCH_REPORT: report};
  mkdirSync(env.DSH_SUBAGENT_CONFIG);
  writeFileSync(join(env.DSH_SUBAGENT_CONFIG, 'installation.json'), JSON.stringify({codex: scenario === 'missing executable' ? [env.DSH_CODEX_CLI] : [process.execPath, fake]}));
  const terminal = join(root, 'terminal.mjs');
  writeFileSync(terminal, "Object.defineProperty(process.stdin, 'isTTY', {value: true});\n");
  const normalExit = ['client exit', 'terminal default'].includes(scenario);
  try {
    const command = scenario === 'terminal default' ? ['--import', terminal, cli] : [cli, 'codex', '--cd', 'A folder 雪', '--model', 'test-model'];
    const result = spawnSync(process.execPath, command, {env, encoding: 'utf8', timeout: 25000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, normalExit ? 7 : 1, result.stderr);
    const sessions = join(root, 'state/codex');
    for (const directory of readdirSync(sessions)) {
      assert.ok(!existsSync(join(sessions, directory, 'token')));
      assert.ok(!existsSync(join(sessions, directory, 'connection.json')));
      assert.ok(existsSync(join(sessions, directory, 'app-server.log')));
    }
    if (normalExit) {
      const captured = JSON.parse(readFileSync(report, 'utf8'));
      assert.equal(captured.matchingToken, true); assert.equal(captured.reply, 'authenticated');
      assert.match(captured.args[1], /^ws:\/\/127\.0\.0\.1:/);
      assert.deepEqual(captured.args.slice(2), ['--remote-auth-token-env', 'DSH_CODEX_TOKEN', ...(scenario === 'terminal default' ? [] : ['--cd', 'A folder 雪', '--model', 'test-model'])]);
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});
