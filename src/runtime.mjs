import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';

export class Runtime extends EventEmitter {
  constructor(agent, config) {
    super();
    this.pending = new Map();
    this.seq = 0;
    this.stderr = '';
    this.child = spawn(process.execPath, [config.cli, '--profile', 'codex-subagent', '--patch', config.patch], {
      cwd: agent.cwd, env: {...process.env, DSH_CLI: config.cli}, stdio: ['pipe','pipe','pipe'],
    });
    this.child.stderr.on('data', d => {this.stderr = (this.stderr + d).slice(-8000);});
    createInterface({input:this.child.stdout}).on('line', line => {
      let msg;
      try {msg = JSON.parse(line);} catch {this.emit('diagnostic', 'Invalid SDK JSON: ' + line.slice(0,200)); return;}
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id); clearTimeout(p.timer);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else this.emit('notification', msg.method, msg.params);
    });
    this.child.on('error', e => this.fail(e));
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      const error = new Error(`DSH exited (${code ?? signal}): ${this.stderr}`);
      this.fail(error); this.emit('exit', error);
    });
    this.child.stdin.on('error', e => this.fail(e));
    this.exitPromise = new Promise(resolve => this.child.once('exit', resolve));
  }
  fail(error) {
    for (const p of this.pending.values()) {clearTimeout(p.timer); p.reject(error);}
    this.pending.clear();
  }
  request(method, params, timeout = 30000) {
    if (this.exited) return Promise.reject(new Error('DSH runtime has exited'));
    return new Promise((resolve,reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`${method} timed out: ${this.stderr}`));}, timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
  }
  async close() {
    if (this.exited) return;
    try {await this.request('shutdown', undefined, 10000);} finally {
      this.child.stdin.end();
      const timer=setTimeout(()=>this.child.kill('SIGKILL'),10000);
      await this.exitPromise;clearTimeout(timer);
    }
  }
}
