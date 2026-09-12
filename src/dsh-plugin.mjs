// Extend the installed SDK presentation layer; all execution stays in DSH.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireDsh = createRequire(process.env.DSH_CLI);
const pkg = name => import(pathToFileURL(requireDsh.resolve(name)).href);
const { HarnessSdkJsonRpcServer } = await pkg('@deepseek-ai/dsh-sdk-jsonrpc-server');
const { JsonRpcLineTransport } = await pkg('@deepseek-ai/dsh-sdk-protocol');
export const name = 'codex-subagent-rpc';
export const inject = ['agents', 'sessions', 'permissionPresets', 'sdkAppStartup', 'loader'];

export function apply(ctx) {
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  class Bridge extends HarnessSdkJsonRpcServer {
    async createSession(id) {
      let rec;
      if (this.resume) {
        rec = { handle: await ctx.agents.resume({ resumeSessionId: id, agentOptions: {
          provider: this.provider, model: this.model, reasoningEffort: this.reasoningEffort,
        } }) };
        this.sessions.set(id, rec);
      } else rec = await super.createSession(id);
      ctx.permissionPresets.set(rec.handle.agent.session, this.permission);
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
      bridge.permission = params.permission ?? 'workspace-write';
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
