// Extend the installed SDK presentation layer; all execution stays in DSH.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireDsh = createRequire(process.env.DSH_CLI);
const pkg = name => import(pathToFileURL(requireDsh.resolve(name)).href);
const { HarnessSdkJsonRpcServer } = await pkg('@deepseek-ai/dsh-sdk-jsonrpc-server');
const { JsonRpcLineTransport } = await pkg('@deepseek-ai/dsh-sdk-protocol');
export const name = 'codex-subagent-rpc';
export const inject = ['agents', 'sessions', 'permissionPresets', 'sdkAppStartup', 'loader', 'workspaceRegistry', 'agentPresets'];

export function apply(ctx) {
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
        ctx.permissionPresets.set(agent.session, this.permission);
      };
      let handle;
      if (this.resume) {
        handle = await ctx.agents.resume({resumeSessionId: id, agentOptions, setup});
      } else {
        // Resolve before storing a session so invalid presets create no history.
        if (this.preset) await ctx.agentPresets.resolveMountable(this.preset);
        handle = await ctx.agents.create({sessionId: id, agentOptions,
          meta: {cwd: this.cwd, ...(this.preset ? {agentPreset: this.preset} : {})}, setup});
      }
      const rec = {handle};
      this.sessions.set(id, rec);
      await ctx.sessions.flush(handle.agent.session);
      const workspace = await ctx.workspaceRegistry.create(this.cwd);
      await workspace.attachSession(id);
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
    }
    if (method === 'session/prepare') {
      const rec = await bridge.getOrCreateSession(params.sessionId);
      const workspace = await ctx.workspaceRegistry.resolveByPath(rec.handle.agent.session.header.cwd);
      return {cwd: rec.handle.agent.session.header.cwd, preset: rec.handle.agent.session.header.agentPreset ?? null, workspace_id: workspace.id, session_ids: [...workspace.sessionIds]};
    }
    if (method === 'session/cancel') {
      const rec = bridge.sessions.get(params.sessionId);
      if (!rec) throw new Error('Session is not loaded');
      rec.handle.agent.cancel({kind: 'user'});
      await rec.handle.agent.whenIdle();
      await ctx.sessions.flush(rec.handle.agent.session);
      return {status: 'idle'};
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
