#!/usr/bin/env node
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {projectRoot,resolveDshCli} from '../src/config.mjs';
const requireDsh=createRequire(resolveDshCli());
const yaml=requireDsh('js-yaml');
const patch=join(process.env.DSH_HOME??join(homedir(),'.dsh'),'profiles/web/cordis.patch.yml');
if(!existsSync(patch))throw new Error('Initialize the DSH web profile before installing the Web relay.');
const content=readFileSync(patch,'utf8');
// DSH patches contain !!js expressions; inspect just the literal entry ID.
if(/^\s*- id: dsh-subagent-web\s*$/m.test(content)){
 console.log('DSH Web relay entry is already installed.');
}else{
 const row=[{insert:[{id:'dsh-subagent-web',name:join(projectRoot,'src/web-plugin.mjs'),...(process.env.DSH_SUBAGENT_STATE?{config:{socketDirectory:join(process.env.DSH_SUBAGENT_STATE,'web')}}:{})}]}];
 appendFileSync(patch,'\n# Live history from SDK subagents; no execution ownership in the Web process.\n'+yaml.dump(row));
 console.log('Installed DSH Web relay. Live-reload Web profiles pick up the entry automatically.');
}
