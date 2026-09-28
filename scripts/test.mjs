import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const files = readdirSync('test').filter(name => name.endsWith('.test.mjs')).map(name => 'test/' + name);
const tests = spawnSync(process.execPath, ['--test', ...files], {stdio: 'inherit'});
if (tests.status !== 0) process.exit(tests.status || 1);
// The Python helper is retained only for existing POSIX integrations.
if (process.platform !== 'win32') {
  const python = spawnSync('python3', ['test/codex_notify_test.py'], {stdio: 'inherit'});
  if (python.error?.code === 'ENOENT') console.log('Python is absent; legacy helper tests skipped. Node callback tests ran above.');
  else if (python.status !== 0) process.exit(python.status || 1);
}
