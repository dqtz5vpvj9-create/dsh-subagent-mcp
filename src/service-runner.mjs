import {readFileSync, createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {privateDirectory, providerEnvironment} from './platform.mjs';

const config = process.argv[process.argv.indexOf('--config') + 1];
try {
  const record = JSON.parse(readFileSync(config, 'utf8'));
  Object.assign(process.env, record.env, {DSH_CLI: record.dsh, DSH_SUBAGENT_STATE: record.state});
  privateDirectory(record.state);
  const log = createWriteStream(join(record.state, 'daemon.log'), {flags: 'a', mode: 0o600});
  process.stderr.write = log.write.bind(log);
  Object.assign(process.env, providerEnvironment(join(config, '..')));
  await (await import('./server.mjs')).main();
} catch (error) {console.error(error); process.exitCode = 1;}
