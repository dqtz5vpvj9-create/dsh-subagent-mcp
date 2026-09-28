import {readFileSync, existsSync, createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {privateDirectory} from './platform.mjs';

const config = process.argv[process.argv.indexOf('--config') + 1];
try {
  const record = JSON.parse(readFileSync(config, 'utf8'));
  Object.assign(process.env, record.env, {DSH_CLI: record.dsh, DSH_SUBAGENT_STATE: record.state});
  privateDirectory(record.state);
  const log = createWriteStream(join(record.state, 'daemon.log'), {flags: 'a', mode: 0o600});
  process.stderr.write = log.write.bind(log);
  const credentials = join(config, '..', 'provider.json');
  if (existsSync(credentials)) Object.assign(process.env, JSON.parse(readFileSync(credentials, 'utf8')));
  // Preserve keys captured by the previous Linux-only installer.
  const legacy = join(config, '..', 'environment');
  if (existsSync(legacy)) for (const line of readFileSync(legacy, 'utf8').split('\n')) {
    const match = /^(DEEPSEEK_API_KEY|DEEPSEEK_BASE_URL)="(.*)"$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/\\([\\"])/g, '$1');
  }
  await (await import('./server.mjs')).main();
} catch (error) {console.error(error); process.exitCode = 1;}
