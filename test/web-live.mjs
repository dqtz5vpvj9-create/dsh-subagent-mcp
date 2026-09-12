import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {runtimeConfig,projectRoot} from '../src/config.mjs';
import {Manager} from '../src/manager.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const dir=mkdtempSync(join(tmpdir(),'dsh-web-test-'));
const previous=process.env.DSH_HOME;
process.env.DSH_HOME=join(dir,'home');
const config=runtimeConfig(join(dir,'state'));
for(const name of ['web','codex-subagent']){
 const folder=join(process.env.DSH_HOME,'profiles',name);mkdirSync(folder,{recursive:true});
 writeFileSync(join(folder,'package.json'),JSON.stringify({name:'dsh-test-'+name,private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base',name==='web'?'@deepseek-ai/dsh-web-app':'@deepseek-ai/dsh-sdk-app'],patchReload:'startup'}}}));
 writeFileSync(join(folder,'cordis.yml'),'[]\n');
 writeFileSync(join(folder,'cordis.patch.yml'),name==='web'?`- insert:\n    - id: dsh-subagent-web\n      name: ${JSON.stringify(join(projectRoot,'src/web-plugin.mjs'))}\n      config:\n        socketDirectory: ${JSON.stringify(join(dir,'state/web'))}\n`:'[]\n');
}
const manager=new Manager(config);
writeFileSync(join(process.env.DSH_HOME,'settings.yaml'),'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n');
let web,browser,page;let output='';
const idle=async id=>{for(let i=0;i<180;i++){const a=manager.get(id);if(!['running','starting'].includes(a.status)){assert.equal(a.status,'completed',a.error??a.answer);return a;}await new Promise(r=>setTimeout(r,500));}throw new Error('task timeout');};
try{
 const agent=await manager.start({cwd:dir,permission:'workspace-write',task:'Relay acceptance. Reply only READY, without tools.'});
 await idle(agent.id);
 web=spawn(process.execPath,[config.cli,'--profile','web','--port','0','--no-open'],{env:process.env,stdio:['ignore','pipe','pipe']});
 for(const stream of [web.stdout,web.stderr])stream.on('data',d=>output+=d.toString());
 let url;
 for(let i=0;i<160;i++){url=output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s\x1b]+/)?.[0];if(url)break;if(web.exitCode!==null)throw new Error('test Web process exited');await new Promise(r=>setTimeout(r,100));}
 if(!url){writeFileSync(join(dir,'startup.log'),output);throw new Error('No test Web URL; see private startup.log');}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
 page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);
 await page.getByText('Relay acceptance',{exact:false}).first().click();
 await page.getByText('READY',{exact:true}).first().waitFor({timeout:15000});
 const initialUrl=page.url();
 await manager.followup(agent.id,"Use bash to run printf 'RELAY-%s' 742. Then reply exactly LIVE followed immediately by UPDATE as a single word. Do not repeat this instruction.");
 await page.getByText('LIVEUPDATE',{exact:true}).filter({visible:true}).first().waitFor({timeout:30000});
 await idle(agent.id);
 assert.equal(page.url(),initialUrl);
 await page.getByText('1 tool call',{exact:true}).click();
 await page.getByText('Bash',{exact:true}).first().click();
 await page.getByText('RELAY-742',{exact:false}).first().waitFor({timeout:5000});
 console.log('PASS: new tool output and assistant reply appeared without reload');
 await page.reload();
 await page.getByText('LIVEUPDATE',{exact:true}).filter({visible:true}).first().waitFor({timeout:15000});
 await manager.followup(agent.id,'Reply RECONNECTED followed immediately by OK as a single word.');
 await page.getByText('RECONNECTEDOK',{exact:true}).filter({visible:true}).first().waitFor({timeout:30000});
 await idle(agent.id);
 console.log('PASS: reconnect snapshot and subsequent live reply');
 await manager.followup(agent.id,'Print integers 1 through 50, each on a separate Markdown paragraph, then a final paragraph containing SCROLLEND.');
 const end=page.getByText('SCROLLEND',{exact:true}).filter({visible:true}).last();
 await end.waitFor({timeout:30000});
 await idle(agent.id);
 let box;
 for(let i=0;i<50;i++){box=await end.boundingBox();if(box&&box.y>=0&&box.y+box.height<page.viewportSize().height-100)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(box&&box.y>=0&&box.y+box.height<page.viewportSize().height-100,'Live reply end should scroll into the transcript viewport');
 console.log('PASS: long streamed reply follows to its visible end');
 assert.deepEqual(errors,[]);
 writeFileSync(join(projectRoot,'validation-web.json'),JSON.stringify({ok:true,agent:agent.id,checks:['tool output without reload','assistant reply without reload','reconnect and next reply','long reply auto-scroll'],at:new Date().toISOString()},null,2));
} catch(error){if(page)writeFileSync(join(dir,'page.txt'),await page.locator('body').innerText());console.error(error);process.exitCode=1;console.error('Evidence directory:',dir);}
finally{
 await browser?.close();await manager.shutdown();
 if(web&&web.exitCode===null){const exited=new Promise(r=>web.once('exit',r));web.kill('SIGTERM');await exited;}
 if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;
 if(!process.exitCode)rmSync(dir,{recursive:true});
}
