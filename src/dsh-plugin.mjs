// Extend the installed SDK presentation layer; all execution stays in DSH.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const requireDsh = createRequire(process.env.DSH_CLI);
const pkg = name => import(pathToFileURL(requireDsh.resolve(name)).href);
const { HarnessSdkJsonRpcServer } = await pkg('@deepseek-ai/dsh-sdk-jsonrpc-server');
const { JsonRpcLineTransport } = await pkg('@deepseek-ai/dsh-sdk-protocol');
export const name = 'codex-subagent-rpc';
export const inject = ['agents', 'sessions', 'permissionPresets', 'sdkAppStartup', 'loader', 'workspaceRegistry', 'agentPresets', 'sessionQuery', 'sessionProjections', 'sessionTitle'];

export function apply(ctx) {
  // Bridge sessions hang under one virtual parent per workspace instead of
  // sitting beside the user's own sessions: DSH Web hides a session whose
  // header says origin 'subagent' and lists it under its parent's catalog.
  const parentNote='这个会话是 Claude Code / Codex 通过 dsh-subagent-mcp 委派的子代理的挂载点。子代理不在左侧会话列表里，点上方的「N 个子代理」查看和审查它们。这里不执行任务。';
  const seedParent=async(parent,title,cwd,agentOptions)=>{
    const known=await ctx.sessionQuery.listSessions();
    if(!known.some(record=>(record.header?.id??record.id)===parent)) {
      // Created as an agent, not a bare session: the JSONL backend persists a
      // session only while an agent owns it, and a mount point that never
      // reaches disk cannot be listed or opened. Nothing ever prompts it.
      const {agent}=await ctx.agents.create({sessionId:parent,agentOptions,meta:{cwd}});
      if(title)ctx.sessionTitle.rename(agent.session,title);
      // A session with no turn counts as blank and DSH Web hides it, which
      // would leave its children unreachable. One recorded turn makes the
      // mount point visible and lets it explain itself. Message-producing
      // events must declare how they enter the surface.
      agent.session.append('turn/start',{turn:1});
      agent.session.append('user/message',{content:[{type:'text',text:parentNote}]},{surfaceOp:'append'});
      agent.session.append('turn/end',{turn:1,reason:{kind:'completed'}});
      await ctx.sessions.flush(agent.session);
    }
    // Reasserted whenever the mount point is seeded: the workspace record is
    // republished whole by whichever process writes it, so a membership it was
    // not holding when it loaded is otherwise lost for good.
    const workspace=await ctx.workspaceRegistry.create(cwd);
    await workspace.attachSession(parent);
  };
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  class Bridge extends HarnessSdkJsonRpcServer {
    async createSession(id) {
      const agentOptions = {
        provider: this.provider, model: this.model, reasoningEffort: this.reasoningEffort,
      };
      const setup = async (agentCtx, agent) => {
        if (agent.session.header.cwd !== this.cwd) throw new Error('Stored session cwd differs from requested cwd');
        if ((agent.session.header.agentPreset ?? null) !== (this.preset ?? null)) throw new Error('Stored session preset differs from requested preset');
        if (this.preset) await ctx.agentPresets.mount(agentCtx, this.preset);
      };
      let handle;
      if (this.resume) {
        handle = await ctx.agents.resume({resumeSessionId: id, agentOptions, setup});
      } else {
        // Resolve before storing a session so invalid presets create no history.
        if (this.preset) await ctx.agentPresets.resolveMountable(this.preset);
        handle = await ctx.agents.create({sessionId: id, agentOptions,
          meta: {cwd: this.cwd, ...(this.preset ? {agentPreset: this.preset} : {}),
            ...(this.parent ? {origin: 'subagent', parentSession: this.parent, delegationDepth: 1} : {})},
          setup: async (agentCtx, agent) => {
            await setup(agentCtx, agent);
            // Enumeration reads identity from the child's own log. Without this
            // event a running child is dropped from the catalog outright and a
            // settled one degrades to a corrupt row, so it goes in before the
            // first turn. One-shot, because driving the child is the bridge's
            // job: DSH Web cannot prompt an agent living in another process.
            if (this.parent) agent.session.append('subagent/descriptor',
              {version: 3, mode: 'one-shot', provider: 'dsh-subagent-mcp', ...(this.title ? {label: this.title} : {})});
          }});
      }
      // Apply after creation, as DSH's own session factories do. Inside setup a
      // fresh session has no permission facts yet, so a request equal to the
      // inferred default appends nothing and DSH later pins the user's default.
      ctx.permissionPresets.set(handle.agent.session, this.permission);
      if (this.title && ctx.sessionTitle.get(handle.agent.session)?.title !== this.title)
        ctx.sessionTitle.rename(handle.agent.session, this.title);
      const rec = {handle};
      this.sessions.set(id, rec);
      await ctx.sessions.flush(handle.agent.session);
      // Only the mount point joins the workspace; children reach it through
      // their lineage. Reasserted on every start because any live DSH process
      // republishes the whole workspace record from whatever it loaded at
      // boot, so a membership added while it was running is otherwise lost.
      const workspace = await ctx.workspaceRegistry.create(this.cwd);
      await workspace.attachSession(this.parent ?? id);
      return rec;
    }
  }
  const bridge = new Bridge(ctx, transport);
  const streamOff = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    // Expose visible text progress, not private reasoning deltas.
    if (frame.type === 'chunk' && frame.chunk.type === 'text-delta')
      transport.notify('session.text', {sessionId: String(agent.session.id), chunk: frame.chunk});
  });
  transport.onRequest(async (method, params) => {
    if (method === 'initialize') {
      await ctx.get('loader')?.await();
      bridge.resume = params.resume === true;
      bridge.preset = params.preset;
      bridge.permission = params.permission ?? 'workspace-write';
      bridge.title = params.title;
      bridge.parent = params.parent;
      bridge.parentTitle = params.parentTitle;
    }
    if (method === 'parent/seed') {
      // Adoption needs the mount point to exist before it rewrites headers
      // that name it; seeding is otherwise a side effect of the first child.
      await seedParent(params.parent, params.parentTitle, params.cwd,
        {provider: bridge.provider, model: bridge.model, reasoningEffort: bridge.reasoningEffort});
      return {parent: params.parent};
    }
    if (method === 'session/prepare') {
      const rec = await bridge.getOrCreateSession(params.sessionId);
      const workspace = await ctx.workspaceRegistry.resolveByPath(rec.handle.agent.session.header.cwd);
      return {cwd: rec.handle.agent.session.header.cwd, preset: rec.handle.agent.session.header.agentPreset ?? null, permission: ctx.permissionPresets.current(rec.handle.agent.session), title: ctx.sessionTitle.get(rec.handle.agent.session)?.title ?? null, workspace_id: workspace.id, session_ids: [...workspace.sessionIds]};
    }
    if (method === 'session/cancel') {
      const rec = bridge.sessions.get(params.sessionId);
      if (!rec) throw new Error('Session is not loaded');
      rec.handle.agent.cancel({kind: 'user'});
      await rec.handle.agent.whenIdle();
      await ctx.sessions.flush(rec.handle.agent.session);
      return {status: 'idle'};
    }
    if (method === 'session/rename') {
      const rec = bridge.sessions.get(params.sessionId);
      if (!rec) throw new Error('Session is not loaded');
      ctx.sessionTitle.rename(rec.handle.agent.session, params.title);
      await ctx.sessions.flush(rec.handle.agent.session);
      return {title: ctx.sessionTitle.get(rec.handle.agent.session)?.title ?? params.title};
    }
    if (method === 'session/checkpoint') {
      const rec = bridge.sessions.get(params.sessionId);
      if (!rec) throw new Error('Session is not loaded');
      await ctx.sessions.flush(rec.handle.agent.session);
      return {};
    }
    const result = await bridge.handleRequest(method, params);
    if (method === 'shutdown') setImmediate(async () => {
      await transport.flush();
      await ctx.root.fiber.dispose();
      process.exit(0);
    });
    return result;
  });
  ctx.effect(() => {
    transport.start();
    return async () => { streamOff(); await bridge.shutdown(); transport.close(); };
  }, 'codex-subagent-rpc');
}
