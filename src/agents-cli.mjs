import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {bridgeClient} from './bridge-client.mjs';
import {statusService} from './service.mjs';

const help=`Manage DSH subagents:
  agents list [--status STATE] [--cwd DIR] [--match TEXT] [--limit N] [--json]
  agents show ID [--json]
  agents result ID [--json]
  agents events ID [--progress] [--json]
  agents start --task TEXT [--cwd DIR] [--name NAME] [--permission PRESET]
  agents followup ID --task TEXT
  agents wait ID [--json]          Wait once until the task settles
  agents interrupt ID            Stop work, preserving the conversation
  agents close ID                Permanently close the bridge agent
  agents release ID              Free idle runtime; allow later followups
  agents gc                      Free all idle bridge runtimes
  agents ps [--json]             Show resident runtimes and process IDs

IDs may be unique prefixes. Finished tasks release their runtime automatically.
History and results remain available; followup restores the same DSH session.`;

export async function agentsCli(argv) {
  const [action='list',...args]=argv;
  if(['help','--help','-h'].includes(action)){console.log(help);return;}
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{
    json:{type:'boolean'},status:{type:'string'},cwd:{type:'string'},match:{type:'string'},
    limit:{type:'string'},task:{type:'string'},name:{type:'string'},permission:{type:'string'},progress:{type:'boolean'},
  }});
  if(action==='ps') {
    const state=await statusService();
    if(!state.running)throw new Error('DSH service is stopped. Run dsh-subagent-mcp start.');
    const rows=state.runtimes??[];
    console.log(values.json?JSON.stringify({service_pid:state.pid,runtimes:rows}):
      [`Service PID: ${state.pid}`, ...rows.map(row=>`${row.pid}\t${row.status}\t${row.id}`),!rows.length?'No resident agent runtimes.':''].filter(Boolean).join('\n'));
    return;
  }
  const allowed=['list','show','result','events','start','followup','wait','interrupt','close','release','gc'];
  if(!allowed.includes(action))throw new Error('Unknown agents command. Run dsh-subagent-mcp agents --help.');
  const client=await bridgeClient();
  const call=async(name,args)=>{
    const reply=await client.request('tools/call',{name,arguments:args});
    const text=reply.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n');
    if(reply.isError)throw new Error(text);
    return JSON.parse(text);
  };
  try {
    let result;
    if(action==='list') {
      if(positionals.length)throw new Error('Use --match to search by name or ID.');
      result=await call('dsh_list',{limit:values.limit===undefined?20:Number(values.limit),
        ...(values.status?{status:values.status}:{}),...(values.cwd?{cwd:resolve(values.cwd)}:{}),
        ...(values.match?{match:values.match}:{})});
      if(!values.json){console.log(result.items.map(a=>`${a.agent_id}\t${a.status}\t${a.name??''}\t${a.cwd}`).join('\n')||'No matching agents.');if(result.omitted)console.log(result.omitted);return;}
    } else if(action==='gc') {
      const state=await statusService();
      result={released:0,skipped:0};
      for(const row of state.runtimes??[]) {
        const value=await call('dsh_release',{agent_id:row.id});
        result[value.released?'released':'skipped']++;
      }
      if(!values.json){console.log(`Released ${result.released} idle runtime(s); left ${result.skipped} active runtime(s) running.`);return;}
    } else if(action==='start') {
      if(!values.task?.trim())throw new Error('Provide --task TEXT.');
      result=await call('dsh_start',{cwd:resolve(values.cwd??process.cwd()),task:values.task,
        ...(values.name?{name:values.name}:{}),permission:values.permission??'workspace-write'});
    } else {
      if(positionals.length!==1)throw new Error('Provide one agent ID or unique ID prefix.');
      const input=positionals[0];
      let id=input;
      if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(input)) {
        const found=await call('dsh_list',{match:input,limit:200,max_chars:100000});
        const matches=found.items.filter(a=>a.agent_id.startsWith(input));
        if(matches.length!==1)throw new Error(matches.length?'Ambiguous agent ID prefix. Use the full ID.':'No agent has that ID prefix.');
        id=matches[0].agent_id;
      }
      if(action==='followup'&&!values.task?.trim())throw new Error('Provide --task TEXT.');
      const tool={show:'dsh_status',result:'dsh_status',events:'dsh_events',followup:'dsh_followup',wait:'dsh_wait',interrupt:'dsh_interrupt',close:'dsh_close',release:'dsh_release'}[action];
      result=await call(tool,{agent_id:id,...(action==='result'?{legacy:true}:{}),
        ...(action==='followup'?{task:values.task}:{}),...(action==='events'?{include_progress:values.progress??false}:{})});
      if(!values.json&&['result','wait'].includes(action)) {
        console.log(result.answer||result.error||`Agent is ${result.status}; no result is available.`);
        if(['error','context_exhausted','interrupted','closed'].includes(result.status))process.exitCode=1;
        return;
      }
    }
    console.log(JSON.stringify(result,null,values.json?undefined:2));
  } finally {client.close();}
}
