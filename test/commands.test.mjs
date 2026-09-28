import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {commandSpec} from '../src/commands.mjs';
import {temporaryDirectory} from '../src/platform.mjs';

for (const layout of ['local', 'global']) for (const command of ['dsh', 'codex'])
test(`Windows ${layout} npm ${command} shims resolve to executable JavaScript`, () => {
  const root=mkdtempSync(join(temporaryDirectory(),'dsh-command-'));
  try {
    const prefix=join(root,'User space 雪 & data');
    const bin=layout==='local'?join(prefix,'node_modules/.bin'):prefix;
    const name=command==='dsh'?'@deepseek-ai/dsh':'@openai/codex';
    const pkg=join(prefix,'node_modules',name);
    mkdirSync(bin,{recursive:true});mkdirSync(join(pkg,'lib'),{recursive:true});
    writeFileSync(join(pkg,'package.json'),JSON.stringify({bin:{[command]:'lib/bin.js'}}));
    const entry=join(pkg,'lib/bin.js');
    writeFileSync(entry,'console.log("REAL_JS_ENTRY");\n');
    for(const suffix of ['', '.cmd', '.ps1'])writeFileSync(join(bin,command+suffix),'#!/bin/sh\nbasedir=$(dirname "$0")\n');
    const spec=commandSpec(command,{platform:'win32',env:{PATH:bin}});
    assert.deepEqual(spec,[process.execPath,realpathSync(entry)]);
    assert.equal(execFileSync(spec[0],spec.slice(1),{encoding:'utf8'}).trim(),'REAL_JS_ENTRY');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('an unresolved DSH shell shim does not shadow a usable managed installation', () => {
  const root=mkdtempSync(join(temporaryDirectory(),'dsh-command-'));
  try {
    const bad=join(root,'broken'),prefix=join(root,'managed'),pkg=join(prefix,'node_modules/@deepseek-ai/dsh');
    mkdirSync(bad);mkdirSync(pkg,{recursive:true});
    writeFileSync(join(bad,'dsh'),'#!/bin/sh\nexit 1\n');
    writeFileSync(join(bad,'dsh.cmd'),'@echo off\n');
    writeFileSync(join(pkg,'package.json'),JSON.stringify({bin:{dsh:'bin.js'}}));
    writeFileSync(join(pkg,'bin.js'),'console.log("managed");');
    const spec=commandSpec('dsh',{prefix,platform:'win32',env:{PATH:bad}});
    assert.deepEqual(spec,[process.execPath,join(pkg,'bin.js')]);
  } finally {rmSync(root,{recursive:true,force:true});}
});
