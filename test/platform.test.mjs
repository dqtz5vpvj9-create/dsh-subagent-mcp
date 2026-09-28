import test from 'node:test';
import assert from 'node:assert/strict';
import {locations} from '../src/platform.mjs';
import {serviceDefinition, windowsQuote} from '../src/service.mjs';

test('platform locations respect native conventions and explicit overrides', () => {
  assert.equal(locations({platform: 'linux', home: '/users/me', env: {XDG_STATE_HOME: '/private/state'}}).state, '/private/state/dsh-subagent-mcp');
  assert.equal(locations({platform: 'darwin', home: '/Users/me', env: {}}).data, '/Users/me/Library/Application Support/dsh-subagent-mcp');
  assert.equal(locations({platform: 'win32', home: 'C:\\Users\\me', env: {LOCALAPPDATA: 'D:\\User Data'}}).state, 'D:\\User Data\\dsh-subagent-mcp\\state');
  assert.equal(locations({platform: 'win32', home: 'C:\\Users\\me', env: {DSH_SUBAGENT_STATE: 'E:\\bridge'}}).state, 'E:\\bridge');
});

test('service files quote user paths and run without elevated permissions', () => {
  const record = {root: '/Users/名字 & 50%/bridge', node: '/Node runtime/node'};
  const systemd = serviceDefinition({...record, backend: 'systemd'}, {config: '/config/50% install.json'}).text;
  assert.match(systemd, /50%%/);
  assert.match(systemd, /ExecStart="\/Node runtime\/node"/);
  const plist = serviceDefinition({...record, backend: 'launchd'}).text;
  assert.match(plist, /名字 &amp; 50%/);
  assert.match(plist, /SuccessfulExit/);
  const task = serviceDefinition({...record, backend: 'task-scheduler'}, {user: 'DOMAIN\\user & name'}).text;
  assert.match(task, /LeastPrivilege/);
  assert.match(task, /InteractiveToken/);
  assert.match(task, /user &amp; name/);
  assert.match(task, /PT0S/);
  assert.equal(windowsQuote('C:\\path with spaces\\'), '"C:\\path with spaces\\\\"');
});
