#!/usr/bin/env node
// Earlier versions injected a plugin into the DSH Web process so a bridge
// session could stream its live history there. Bridge sessions are subagents
// now: DSH Web addresses them through their parent and reads them from
// persistence, so the injected entry can never match again. Remove it rather
// than leave a dead plugin loaded in the user's browser process.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

const patch = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles/web/cordis.patch.yml');
if (!existsSync(patch)) {
  console.log('No DSH Web profile to clean.');
} else {
  const content = readFileSync(patch, 'utf8');
  // DSH patches carry !!js expressions, so edit the literal block by text
  // rather than round-tripping the document through a YAML parser.
  const entry = /^[ \t]*- insert:\n(?:[ \t]*- id: dsh-subagent-web\n(?:[ \t]{6,}[^\n]*\n)*)+/m;
  const single = /^[ \t]*- id: dsh-subagent-web\n(?:[ \t]{6,}[^\n]*\n)*/m;
  const cleaned = (entry.test(content) ? content.replace(entry, '') : content.replace(single, ''))
    .replace(/^# Live history from SDK subagents[^\n]*\n/m, '');
  if (cleaned === content) console.log('DSH Web profile carries no relay entry.');
  else {writeFileSync(patch, cleaned); console.log('Removed the DSH Web relay entry. Live-reload Web profiles drop it automatically.');}
}
