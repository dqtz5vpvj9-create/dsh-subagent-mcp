import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {parseArgs, parseEnv} from 'node:util';
import {locations, installation, privateDirectory, providerEnvironment, readJson, writeJson} from './platform.mjs';
import {resolveDshCli} from './config.mjs';
import {commandSpec, runCommand} from './commands.mjs';

export const installCommand = 'npx -y dsh-subagent-mcp@latest';
const configured = source => ({status: 'configured', detail: `${source}; a task has not verified account access.`});

export function codexAccount(spec = installation()?.codex) {
  try {
    spec ||= commandSpec('codex');
    const [file, ...prefix] = spec;
    const result = spawnSync(file, [...prefix, 'login', 'status'], {encoding: 'utf8', windowsHide: true, timeout: 15000});
    // Codex can print a masked API key here. Never forward command output.
    if (!result.error && result.status === 0) return configured('Codex reports an existing login');
    if (/not logged in|not authenticated/i.test((result.stdout || '') + (result.stderr || '')))
      return {status: 'missing', detail: `Sign in with: ${installCommand} login`};
    return {status: 'unknown', detail: `Could not check login. Run: ${installCommand} login`};
  } catch {return {status: 'unknown', detail: `Codex login is not available yet. Run: ${installCommand} login`};}
}

export function deepseekAccount({cli, env = process.env, config = locations().config, home = env.DSH_HOME || join(homedir(), '.dsh')} = {}) {
  try {
    const saved = providerEnvironment(config);
    cli ||= resolveDshCli();
    const result = spawnSync(process.execPath, [cli, '--profile', 'codex-subagent', '--dump-config'],
      {encoding: 'utf8', windowsHide: true, timeout: 15000, env});
    if (result.error || result.status !== 0) throw new Error('profile unavailable');
    const yaml = createRequire(cli)('yaml');
    // --dump-config may contain Cordis !!js expressions. Inspect literal
    // credential references only; do not evaluate code or print YAML warnings.
    const rows = yaml.parse(result.stdout, {logLevel: 'silent', customTags: [{tag: 'tag:yaml.org,2002:js', resolve: () => ({computed: true})}]});
    if (!Array.isArray(rows)) throw new Error('custom profile');
    const provider = rows.find(row => !row.disabled && row.name === '@deepseek-ai/dsh-llm-deepseek');
    if (!provider) throw new Error('custom provider');
    const ref = provider.config?.apiKeyEnv || 'DEEPSEEK_API_KEY';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error('computed credential reference');
    if (saved[ref]) return configured('DeepSeek key saved for background tasks');
    const store = rows.find(row => !row.disabled && row.name === '@deepseek-ai/dsh-credentials-local');
    if (!store) throw new Error('custom credentials');
    if (store.config?.path !== undefined && typeof store.config.path !== 'string') throw new Error('computed credential path');
    if (store.config?.dshHome !== undefined && typeof store.config.dshHome !== 'string') throw new Error('computed DSH home');
    const storeHome = store.config?.dshHome || home;
    const path = resolve(store.config?.path || join(storeHome, '.credentials.yaml'));
    if (existsSync(path) && yaml.parse(readFileSync(path, 'utf8'), {logLevel: 'silent'})?.refs?.[ref]) return configured('Existing DSH credential reused');
    const homeEnv = join(storeHome, '.env');
    if (existsSync(homeEnv) && parseEnv(readFileSync(homeEnv, 'utf8'))[ref]) return configured('Existing DSH home provider configuration reused');
    const projectEnv = join(process.cwd(), '.env');
    if (existsSync(projectEnv) && parseEnv(readFileSync(projectEnv, 'utf8'))[ref])
      return {status: 'project-only', detail: 'A DeepSeek key exists in this project. Other projects need their own provider configuration.'};
    if (env[ref]) return {status: 'terminal-only', detail: `A key exists in this terminal. Save it for background tasks: ${installCommand} configure --capture-key`};
    return {status: 'missing', detail: `Configure DeepSeek with: ${installCommand} configure`};
  } catch {
    if (env.DEEPSEEK_API_KEY) return {status: 'terminal-only', detail: `A key exists in this terminal. Save it for background tasks: ${installCommand} configure --capture-key`};
    return {status: 'unknown', detail: 'Existing DSH provider configuration could not be checked; it has been preserved.'};
  }
}

export function accountStatus(options = {}) {
  return {codex: codexAccount(options.codex), deepseek: deepseekAccount(options)};
}

export function printAccounts(accounts) {
  console.log(`Codex account: ${accounts.codex.status}. ${accounts.codex.detail}`);
  console.log(`DeepSeek account: ${accounts.deepseek.status}. ${accounts.deepseek.detail}`);
}

export function saveProvider(values) {
  const config = privateDirectory(locations().config), path = join(config, 'provider.json');
  writeJson(path, {...readJson(path, {}), ...values});
  console.log('DeepSeek settings saved privately.');
}

export function captureProvider() {
  const values = Object.fromEntries(['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  if (!Object.keys(values).length) throw new Error('--capture-key requires DEEPSEEK_API_KEY or DEEPSEEK_BASE_URL in this terminal.');
  saveProvider(values);
}

// The key is never echoed, even when pasted. No shell arguments or readline
// history contain it. Raw mode is restored on success, cancellation and EOF.
export function hiddenInput(prompt, {input = process.stdin, output = process.stdout} = {}) {
  if (!input.isTTY || !output.isTTY) throw new Error('Use an interactive terminal to enter a key, or configure --capture-key with DEEPSEEK_API_KEY set.');
  return new Promise((resolveInput, reject) => {
    const wasRaw = input.isRaw, wasPaused = input.isPaused();
    let value = '';
    const finish = (error, result) => {
      input.removeListener('data', data); input.removeListener('end', end); input.removeListener('error', fail);
      input.setRawMode(wasRaw); if (wasPaused) input.pause();
      output.write('\n'); error ? reject(error) : resolveInput(result);
    };
    const end = () => finish(new Error('Input closed; no settings were changed.'));
    const fail = () => finish(new Error('Could not read input; no settings were changed.'));
    const data = chunk => {
      for (const char of String(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')) {
        if (char === '\u0003' || char === '\u0004') return finish(new Error('Cancelled; no settings were changed.'));
        if (char === '\r' || char === '\n') return finish(null, value.trim());
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else if (char >= ' ') value += char;
      }
    };
    output.write(prompt); input.setRawMode(true); input.on('data', data); input.once('end', end); input.once('error', fail); input.resume();
  });
}

export async function guideDeepseek(cli) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const state = deepseekAccount({cli});
  if (state.status === 'terminal-only' && process.env.DEEPSEEK_API_KEY) {
    const answer = await hiddenInput('Save the DeepSeek key from this terminal for background tasks? [Y/n] ');
    if (!answer || /^y(es)?$/i.test(answer)) captureProvider();
  } else if (state.status === 'missing') {
    console.log('DeepSeek needs an API key. Get one from https://platform.deepseek.com/api_keys');
    const key = await hiddenInput('DeepSeek API key (hidden; press Enter to configure later): ');
    if (key) saveProvider({DEEPSEEK_API_KEY: key});
  }
}

export async function configure(argv) {
  const {values: args} = parseArgs({args: argv, options: {'capture-key': {type: 'boolean'}}});
  if (args['capture-key']) captureProvider();
  else {
    console.log('Configure the DeepSeek key used by background tasks. Existing DSH settings are preserved.');
    const key = await hiddenInput('DeepSeek API key (hidden; press Enter to cancel): ');
    if (!key) {console.log('No settings changed.'); return;}
    saveProvider({DEEPSEEK_API_KEY: key});
  }
  console.log('New DSH agents use these settings. Running agents continue with their existing settings.');
}

export function login(argv) {
  parseArgs({args: argv, options: {}});
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(`Sign in from an interactive terminal: ${installCommand} login`);
  console.log('Opening Codex account sign-in. This does not start a coding session.');
  runCommand(installation()?.codex || commandSpec('codex'), ['login']);
}
