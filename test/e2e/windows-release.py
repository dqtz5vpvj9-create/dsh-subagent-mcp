"""Real terminal -> npm package -> Codex -> DSH -> native callback -> artifact.

Runs on the trusted SSH controller. Neither model is mocked. Credentials stay on
the acceptance hosts. Public artifacts contain only assertion results and IDs.
"""
import argparse
import concurrent.futures
import json
import os
import signal
from pathlib import Path
import subprocess
import tarfile
import time
import threading
import uuid
import pexpect

ROOT = Path(__file__).resolve().parents[2]
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR',
       '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']
STOPPING=threading.Event()
PROCESSES=set()
TRANSPORTS={}
TERMINAL_SPACE=r'(?:\s|\x1b\[[0-?]*[ -/]*[@-~])*'
APPROVAL=TERMINAL_SPACE.join(['Allow','the','dsh_subagent','MCP','server','to','run','tool'])+TERMINAL_SPACE+r'"(dsh_start|dsh_followup|dsh_watch|dsh_unwatch|dsh_interrupt)"'

def cancel_run(_signal, _frame):
    STOPPING.set()
    for process in list(PROCESSES):
        if process.poll() is None:process.terminate()

def remote(host, *args, timeout=180, cancel=None):
    command = subprocess.list2cmdline(list(args))
    process=subprocess.Popen([*SSH,*TRANSPORTS.get(host,[]),host,command],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    PROCESSES.add(process)
    try:
        deadline=time.monotonic()+timeout
        while True:
            if cancel is not None and (cancel.is_set() or STOPPING.is_set()):
                process.terminate();process.communicate(timeout=10)
                raise RuntimeError('Acceptance observation cancelled.')
            remaining=deadline-time.monotonic()
            if remaining<=0:raise subprocess.TimeoutExpired(process.args,timeout)
            try:
                stdout,stderr=process.communicate(timeout=min(1,remaining));break
            except subprocess.TimeoutExpired:continue
        if process.returncode:raise subprocess.CalledProcessError(process.returncode,process.args,stdout,stderr)
        return stdout.strip()
    except subprocess.TimeoutExpired:
        process.kill();process.communicate();raise
    finally:PROCESSES.discard(process)

def upload(host, source, target):
    subprocess.run(['scp','-q','-o','ConnectTimeout=20',*TRANSPORTS.get(host,[]),str(source),f'{host}:{target}'],check=True,timeout=120)

def connect_host(host, directory):
    options=['-o','ControlPath='+str(directory/('ssh-'+host))]
    # Only connection setup is retried. A lost response to a mutating command
    # must still fail; the test never replays a model prompt or installation.
    for attempt in range(3):
        result=subprocess.run([*SSH,*options,'-M','-N','-f','-o','ControlPersist=600',host],text=True,capture_output=True,timeout=90)
        if result.returncode==0:
            TRANSPORTS[host]=options
            return
        if attempt==2:raise RuntimeError(f'{host} SSH connection failed: {result.stderr.strip()}')

def observe(host, action, run, phase, thread=None, cancel=None):
    # These are read-only script observations, not model polling. Reconnecting
    # an SSH observer never replays a user prompt or a mutating command.
    for attempt in range(3):
        if STOPPING.is_set():raise RuntimeError('Acceptance cancelled.')
        try:
            return json.loads(remote(host,'node','dsh-e2e-state.mjs',action,run,phase,
                                     *([thread] if thread else []),timeout=750,cancel=cancel))
        except subprocess.CalledProcessError as error:
            if error.returncode != 255 or attempt == 2:
                raise RuntimeError(f'{host} {action} observer failed: {error.stderr.strip()}') from error
            print(f'{host}: reconnecting the read-only SSH observer',flush=True)

def state(host, action, run, phase='first', thread=None, timeout=180):
    return json.loads(remote(host,'node','dsh-e2e-state.mjs',action,run,phase,
                             *([thread] if thread else []),timeout=timeout))

def clean_terminal(text):
    import re
    text=re.sub(r'\x1b\][^\x07]*\x07','',text)
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text)

class Terminal:
    def __init__(self,host,run,action,logfile,report):
        command=subprocess.list2cmdline(['pwsh.exe','-NoLogo','-NoProfile','-File',
            'dsh-e2e-launch.ps1','-Run',run,'-Action',action])
        self.child=pexpect.spawn(SSH[0],[*SSH[1:],*TRANSPORTS[host],'-tt',host,command],
            env={**os.environ,'TERM':'xterm-256color'},encoding='utf-8',codec_errors='replace',
            timeout=30,dimensions=(40,140))
        self.log=logfile.open('w',encoding='utf-8');self.child.logfile_read=self.log
        self.logfile=logfile;self.report=report;self.action=action

    def event(self,timeout=2,deny=False):
        event=self.child.expect(['\x1b\\[6n',pexpect.EOF,pexpect.TIMEOUT,APPROVAL],timeout=timeout)
        if event==0:self.child.send('\x1b[1;1R')
        elif event==3:
            name=self.child.match.group(1)
            self.child.expect(TERMINAL_SPACE.join(['enter','to','submit']),timeout=30)
            if deny:self.child.send('\x1b')
            else:self.child.send('\r')
            self.report.setdefault('permissionPrompts',[]).append({'tool':name,'choice':'cancel' if deny else 'allow once'})
        return event

    def install(self):
        deadline=time.monotonic()+600
        while time.monotonic()<deadline:
            if self.event()==1:
                self.child.close();self.log.close()
                text=clean_terminal(self.logfile.read_text(encoding='utf-8'))
                if self.child.exitstatus!=0:raise RuntimeError('Installation did not return successfully: '+text[-2500:])
                if 'Ask Codex to do anything' in text:raise RuntimeError('Installation unexpectedly opened a work session.')
                if 'npx -y dsh-subagent-mcp@latest codex' not in text:
                    raise RuntimeError('Installation did not show the public work command: '+text[-1500:])
                return {'ok':True,'installationReturnedToShell':True,'noWorkSessionOpened':True,'publicNextStepVisible':True}
        raise RuntimeError('Installation did not return to the shell before the deadline.')

    def configure_cancel(self):
        prompt=TERMINAL_SPACE.join(['DeepSeek','API','key',r'\(hidden;','press','Enter','to',r'cancel\):'])
        skipped=False
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            found=self.child.expect([prompt,r'\x1b\[6n',pexpect.EOF,pexpect.TIMEOUT],timeout=2)
            if found==0:
                if skipped:raise RuntimeError('Configure repeated its key prompt after cancellation.')
                self.child.send('\r');skipped=True
                deadline=min(deadline,time.monotonic()+30)
            elif found==1:self.child.send('\x1b[1;1R')
            elif found==2:
                self.child.close();self.log.close()
                text=clean_terminal(self.logfile.read_text(encoding='utf-8'))
                if not skipped or self.child.exitstatus!=0:
                    raise RuntimeError('Configure did not exit successfully after Enter cancellation: '+text[-1500:])
                import re
                if not re.search(r'No\s*settings\s*changed\.',text):
                    raise RuntimeError('Configure did not confirm that settings were unchanged.')
                return {'ok':True,'journey':'configure then press Enter to cancel',
                        'realTerminal':True,'noKeyEntered':True,'returnedToShellWithoutInterrupt':True}
        raise RuntimeError('Configure kept the terminal open after Enter cancellation.')

    def ready(self):
        deadline=time.monotonic()+180
        while time.monotonic()<deadline:
            found=self.child.expect([r'Ask Codex to do anything',r'Yes, I trust',r'Continue anyway\?',
                '\x1b\\[6n',pexpect.EOF,pexpect.TIMEOUT],timeout=2)
            if found==0:
                # Wait for the actual remote composer, not its startup animation.
                until=time.monotonic()+5
                while time.monotonic()<until:
                    if self.event(1)==1:raise RuntimeError('Codex exited during initialization.')
                return
            if found==1:
                self.child.send('1\r');self.report.setdefault('workspacePrompts',[]).append('Trusted the dedicated acceptance directory')
            elif found==2:
                raise RuntimeError('Codex requested an unexplained Continue anyway confirmation; review the private transcript.')
            elif found==3:self.child.send('\x1b[1;1R')
            elif found==4:raise RuntimeError('The explicit work command exited before opening Codex.')
        raise RuntimeError('The explicit work command did not show a usable composer.')

    def send(self,prompt):
        self.child.send('\x1b[200~'+prompt+'\x1b[201~');time.sleep(1);self.child.send('\r')
        started=self.child.expect([r'Working',r'esc to interrupt',r'Calling',pexpect.EOF,pexpect.TIMEOUT],timeout=10)
        if started==4:
            self.child.send('\r')
            started=self.child.expect([r'Working',r'esc to interrupt',r'Calling',pexpect.EOF],timeout=60)
        if started==3:raise RuntimeError('Codex exited before accepting the user request.')

    def until(self,host,action,run,phase,deny=False):
        cancelled=threading.Event()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(observe,host,action,run,phase,cancel=cancelled)
            try:
                while not future.done():
                    if STOPPING.is_set():raise RuntimeError('Acceptance cancelled.')
                    if self.event(2,deny=deny)==1:raise RuntimeError('Codex exited unexpectedly during the task.')
                return future.result()
            finally:cancelled.set()

    def leave(self):
        # Close only after this phase's task has finished. Resuming ordinary
        # Codex sessions belongs to Codex, not to this integration's installer.
        self.child.sendcontrol('c');time.sleep(.5);self.child.sendcontrol('c')
        self.child.expect(pexpect.EOF,timeout=40);self.child.close();self.log.close()
        text=clean_terminal(self.logfile.read_text(encoding='utf-8'))
        if 'DSH_CODEX_TOKEN' in text or 'resume --remote ws://' in text:
            raise RuntimeError('Exit still exposes an unusable raw remote/token reconnection command.')
        return {'ok':True,'ordinaryExitReturnedToShell':True,'noPrivateRemoteInstruction':True}

    def close(self):
        if self.child.isalive():
            self.child.sendcontrol('c');time.sleep(.5);self.child.sendcontrol('c');self.child.close(force=True)
        self.log.close()

def natural_task(run,phase,seconds):
    marker=f'DSH_E2E_{run}_{phase}'
    return (f'请让 DSH 在后台处理当前项目中的这件事：等待 {seconds} 秒，然后把 '
        f'{marker} 原样写入 {phase}-child.txt。完成后请你读取这个文件，检查内容，并告诉我实际读到了什么。')

def acceptance(host,package,output,run):
    report={'host':host,'run':run,'ok':False,'phases':[],
            'credentials':'existing host accounts; not a first-login model test'}
    terminal=None
    try:
        private_logs=Path('/mnt/cache/data-cache')/'dsh-release-e2e'/run
        private_logs.mkdir(parents=True,exist_ok=True,mode=0o700);connect_host(host,private_logs)
        with tarfile.open(package) as archive:
            expected_version=json.load(archive.extractfile('package/package.json'))['version']
        upload(host,package,f'dsh-e2e-candidate-{run}.tgz')
        upload(host,ROOT/'test/e2e/windows-state.mjs','dsh-e2e-state.mjs')
        upload(host,ROOT/'test/e2e/windows-launch.ps1','dsh-e2e-launch.ps1')
        state(host,'prepare',run)
        terminal=Terminal(host,run,'install',private_logs/f'{host}-install.log',report)
        report['phases'].append(terminal.install());terminal=None
        print(f'{host}: installation returned to the shell with a public next step',flush=True)
        state(host,'configure-before',run)
        terminal=Terminal(host,run,'configure',private_logs/f'{host}-configure-cancel.log',report)
        report['phases'].append(terminal.configure_cancel());terminal=None
        report['phases'].append(state(host,'configure-after',run))
        # Exercise an actual older public package as an idle upgrade fixture.
        report['phases'].append(state(host,'upgrade-baseline',run,timeout=330))
        terminal=Terminal(host,run,'install',private_logs/f'{host}-upgrade.log',report)
        report['phases'].append(terminal.install());terminal=None
        terminal=Terminal(host,run,'codex',private_logs/f'{host}-first-task.log',report)
        terminal.ready();state(host,'begin',run,'first');terminal.send(natural_task(run,'first',40))
        pending=terminal.until(host,'pending',run,'first')
        if pending['version']!=expected_version:raise RuntimeError('The running integration differs from the packed candidate.')
        report['phases'].append(pending);thread=pending['threadId']
        accepted=terminal.until(host,'accepted',run,'first')
        report['phases'].append(accepted)
        print(f'{host}: natural task delegated; native completion delivered; parent read and checked the artifact',flush=True)
        # A normal follow-up retains DSH's existing persistent conversation.
        state(host,'begin',run,'followup',thread)
        terminal.send('继续使用刚才的 DSH 子代理。'+natural_task(run,'followup',30))
        report['phases'].append(terminal.until(host,'pending',run,'followup'))
        followup=terminal.until(host,'accepted',run,'followup')
        if followup['agentId']!=accepted['agentId']:raise RuntimeError('Continuing the task created a different DSH agent.')
        report['phases'].append(followup)
        report['phases'].append(terminal.leave());terminal=None
        # This separate adversarial case tightens one tool's policy only for a
        # new test session. It never grants broad access or changes global config.
        state(host,'begin',run,'denied')
        terminal=Terminal(host,run,'permission-review',private_logs/f'{host}-permission.log',report)
        terminal.ready()
        terminal.send('请让 DSH 把 PERMISSION_REVIEW 写入当前项目的 denied-child.txt 文件。')
        rejected=terminal.until(host,'denied',run,'denied',deny=True)
        if not any(item['tool']=='dsh_start' and item['choice']=='cancel' for item in report.get('permissionPrompts',[])):
            raise RuntimeError('The permission-refusal case did not exercise a real approval prompt.')
        report['phases'].append(rejected)
        report['phases'].append(terminal.leave());terminal=None
        report['phases'].append(state(host,'cleanup-success',run))
        report['phases'].append(state(host,'restart',run))
        report['ok']=True
    except Exception as error:
        report['error']=str(error)
        if isinstance(error,subprocess.CalledProcessError):report['transportError']=error.stderr
        try:report['diagnostic']=state(host,'diagnose',run)
        except Exception:pass
    finally:
        if terminal is not None:terminal.close()
        if not report['ok']:
            try:report['cleanup']=state(host,'cleanup',run)
            except Exception as error:report['cleanupError']=str(error)
        (output/f'{host}.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        if host in TRANSPORTS:
            subprocess.run([*SSH,*TRANSPORTS[host],'-O','exit',host],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
    return report

if __name__=='__main__':
    signal.signal(signal.SIGINT,cancel_run);signal.signal(signal.SIGTERM,cancel_run)
    parser=argparse.ArgumentParser()
    parser.add_argument('--package',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--hosts',nargs='+',default=['win','dorm'])
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True,mode=0o700)
    run='ci-'+uuid.uuid4().hex[:12]
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(args.hosts)) as pool:
        reports=list(pool.map(lambda host:acceptance(host,args.package,args.output,run),args.hosts))
    summary={'ok':all(report['ok'] for report in reports),'hosts':reports}
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps(summary,indent=2),flush=True)
    raise SystemExit(0 if summary['ok'] else 1)
