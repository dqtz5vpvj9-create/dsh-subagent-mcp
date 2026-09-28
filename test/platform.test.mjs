import test from 'node:test';
import assert from 'node:assert/strict';
import {locations, temporaryDirectory} from '../src/platform.mjs';
import {serviceDefinition, windowsQuote, serviceBelongsTo, nativeServiceConflict} from '../src/service.mjs';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';

test('platform locations respect native conventions and explicit overrides', () => {
  assert.equal(locations({platform: 'linux', home: '/users/me', env: {XDG_STATE_HOME: '/private/state'}}).state, '/private/state/dsh-subagent-mcp');
  assert.equal(locations({platform: 'darwin', home: '/Users/me', env: {}}).data, '/Users/me/Library/Application Support/dsh-subagent-mcp');
  assert.equal(locations({platform: 'win32', home: 'C:\\Users\\me', env: {LOCALAPPDATA: 'D:\\User Data'}}).state, 'D:\\User Data\\dsh-subagent-mcp\\state');
  assert.equal(locations({platform: 'win32', home: 'C:\\Users\\me', env: {DSH_SUBAGENT_STATE: 'E:\\bridge'}}).state, 'E:\\bridge');
});

test('separate configurations recognize a foreign login service without modifying it', () => {
  const home = mkdtempSync(join(temporaryDirectory(), 'dsh-service-owner-'));
  const record = {backend: 'systemd', root: '/managed/package', node: '/runtime/node'};
  const owner = join(home, 'original 雪 & config/installation.json');
  const other = join(home, 'isolated config/installation.json');
  try {
    const definition = serviceDefinition(record, {home, config: owner});
    mkdirSync(dirname(definition.path), {recursive: true});
    writeFileSync(definition.path, definition.text);
    assert.equal(nativeServiceConflict(record, {home, config: owner}), false);
    assert.equal(nativeServiceConflict(record, {home, config: other}), true);
    assert.equal(readFileSync(definition.path, 'utf8'), definition.text);
    for (const backend of ['systemd', 'launchd', 'task-scheduler']) {
      const text = serviceDefinition({...record, backend}, {home, config: owner}).text;
      assert.equal(serviceBelongsTo(text, backend, owner), true);
      assert.equal(serviceBelongsTo(text, backend, other), false);
      assert.equal(serviceBelongsTo(text, backend, owner + '.different'), false);
    }
  } finally {rmSync(home, {recursive: true, force: true});}
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
