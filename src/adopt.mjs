// Retrofit sessions created before bridge agents became subagents of a virtual
// parent. A session header is immutable through the API and there is no
// re-parent operation, so adoption edits the durable record: DSH stores a
// session as concatenated zstd frames whose first frame is exactly the header
// line, which lets the header be replaced without touching the log behind it.
import {readFileSync, writeFileSync, renameSync, existsSync, readdirSync} from 'node:fs';
import {zstdCompressSync, zstdDecompressSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {Runtime} from './runtime.mjs';
import {runtimeConfig, stateDirectory} from './config.mjs';
import {PARENT_TITLE} from './manager.mjs';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const sessionsRoot = () => join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions');

function frames(data) {
  const bounds = [];
  for (let at = data.indexOf(MAGIC); at >= 0; at = data.indexOf(MAGIC, at + 4)) bounds.push(at);
  return bounds.map((start, index) => [start, bounds[index + 1] ?? data.length]);
}

function decode(data, from = 0) {
  return frames(data).slice(from).map(([start, end]) => zstdDecompressSync(data.subarray(start, end)).toString('utf8')).join('');
}

export function locate(id, root = sessionsRoot()) {
  if (!existsSync(root)) return undefined;
  for (const project of readdirSync(root)) {
    const log = join(root, project, id, 'session.v3.jsonl.zstd');
    if (existsSync(log)) return {log, lock: join(root, project, id, 'session.lock')};
  }
  return undefined;
}

// A live DSH process holds the session's write lease. Editing the log under it
// would be overwritten by whatever that process flushes next.
const busy = lock => existsSync(lock) && spawnSync('flock', ['-n', lock, 'true']).status !== 0;

export function adoptLog(log, {parent, label}) {
  const data = readFileSync(log);
  const [[headerStart, headerEnd]] = frames(data);
  const header = JSON.parse(zstdDecompressSync(data.subarray(headerStart, headerEnd)).toString('utf8'));
  if (header.origin === 'subagent') return 'already-adopted';
  const adopted = {...header, parentSession: parent, isSeeded: header.isSeeded ?? false, origin: 'subagent', delegationDepth: 1};
  const body = data.subarray(headerEnd);
  const tail = decode(data, 1);
  const events = tail.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  // Enumeration reads a child's identity from its own log, and a child without
  // this event is listed as a corrupt row. Appended at the end because the log
  // is immutable: identity folds last-wins, so position does not change it.
  const descriptor = events.some(event => event.type === 'subagent/descriptor') ? Buffer.alloc(0)
    : zstdCompressSync(Buffer.from(JSON.stringify({
        type: 'subagent/descriptor',
        seq: (events.at(-1)?.seq ?? -1) + 1,
        time: Date.now(),
        data: {version: 3, mode: 'one-shot', provider: 'dsh-subagent-mcp', ...(label ? {label} : {})},
      }) + '\n'));
  const temp = log + '.adopting';
  writeFileSync(temp, Buffer.concat([zstdCompressSync(Buffer.from(JSON.stringify(adopted) + '\n')), body, descriptor]), {mode: 0o600});
  renameSync(temp, log);
  return 'adopted';
}

export function parentsFor(db, cwds) {
  db.exec('CREATE TABLE IF NOT EXISTS parents(cwd TEXT PRIMARY KEY, session_id TEXT NOT NULL, seeded INTEGER NOT NULL DEFAULT 0)');
  if (!db.prepare("SELECT * FROM pragma_table_info('parents') WHERE name='seeded'").get())
    db.exec('ALTER TABLE parents ADD COLUMN seeded INTEGER NOT NULL DEFAULT 0');
  const parents = new Map();
  for (const cwd of cwds) {
    const existing = db.prepare('SELECT session_id FROM parents WHERE cwd=?').get(cwd);
    if (existing) {parents.set(cwd, existing.session_id); continue;}
    const id = 'session-' + randomUUID();
    db.prepare('INSERT INTO parents(cwd,session_id) VALUES (?,?)').run(cwd, id);
    parents.set(cwd, id);
  }
  return parents;
}

async function seed(cwd, parent, config, report, sample) {
  const runtime = new Runtime({id: parent, cwd, preset: sample.preset ?? 'standard'}, config);
  try {
    // The mount point runs nothing, but the runtime still boots a provider.
    await runtime.request('initialize', {cwd, preset: sample.preset ?? 'standard', permission: 'workspace-write', resume: false,
      provider: sample.provider ?? 'deepseek-official', model: sample.model ?? 'deepseek-flash', reasoningEffort: sample.effort ?? 'max'});
    await runtime.request('parent/seed', {cwd, parent, parentTitle: PARENT_TITLE}, 120000);
    report(`  mount point ready for ${cwd}`);
  } finally {await runtime.close().catch(() => {});}
}

export async function adopt({state = stateDirectory(), report = console.log} = {}) {
  if (existsSync(join(state, 'server.sock')) && !busy(join(state, 'server.sock')))
    report('Note: the service socket is present. Stop dsh-subagent-mcp before adopting, or live sessions are skipped.');
  const config = runtimeConfig(state);
  const db = new DatabaseSync(config.database);
  const agents = db.prepare('SELECT data FROM agents').all().map(row => JSON.parse(row.data)).filter(agent => agent.cwd && !agent.external);
  const located = agents.map(agent => ({agent, found: locate(agent.id)})).filter(entry => entry.found);
  const parents = parentsFor(db, [...new Set(located.map(entry => entry.agent.cwd))]);
  report(`${located.length} of ${agents.length} recorded agents have a session on disk, across ${parents.size} workspaces.`);

  const counts = {adopted: 0, 'already-adopted': 0, busy: 0, unmounted: 0};
  for (const [cwd, parent] of parents) {
    const pending = located.filter(entry => entry.agent.cwd === cwd && !busy(entry.found.lock));
    if (!pending.length) continue;
    // A mount point is a session in that directory, so a workspace whose
    // directory is gone cannot get one. Its sessions are still adopted: they
    // leave the session list, which is what a vanished scratch directory's
    // history should do, and they simply have nowhere to be reviewed from.
    let mounted = existsSync(cwd);
    if (mounted) {
      try {
        await seed(cwd, parent, config, report, pending[0].agent);
        db.prepare('UPDATE parents SET seeded=1 WHERE cwd=?').run(cwd);
      }
      catch (error) {mounted = false; report(`  mount point failed for ${cwd}: ${error.message.split('\n')[0].slice(0, 160)}`);}
    } else report(`  ${cwd} no longer exists; adopting its ${pending.length} sessions without a mount point`);
    if (!mounted) counts.unmounted += pending.length;
    for (const {agent, found} of pending) {
      const outcome = adoptLog(found.log, {parent, label: agent.name});
      counts[outcome]++;
    }
  }
  for (const {found} of located) if (busy(found.lock)) counts.busy++;
  report(`Adopted ${counts.adopted}, already adopted ${counts['already-adopted']}, skipped ${counts.busy} held by a live process, ${counts.unmounted} without a mount point.`);
  db.close();
  return counts;
}
