"""Real terminal -> npm package -> Codex -> DSH -> native callback -> artifact.

Runs on the trusted SSH controller. Neither model is mocked. Credentials stay on
the acceptance hosts. Public artifacts contain only assertion results and IDs.
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import pexpect

ROOT = Path(__file__).resolve().parents[2]
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR',
       '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']

def remote(host, *args, timeout=180):
    command = subprocess.list2cmdline(list(args))
    return subprocess.run([*SSH, host, command], check=True, text=True,
                          capture_output=True, timeout=timeout).stdout.strip()

def upload(host, source, target):
    subprocess.run(['scp', '-q', str(source), f'{host}:{target}'], check=True, timeout=120)

def observe(host, run, phase, agent):
    # Reconnect the read-only observer after a transport failure. Never replay
    # the Codex prompt or the DSH task. The host retains the original deadline
    # and pending-callback observation across observer connections.
    for attempt in range(3):
        try:
            return remote(host,'node','dsh-e2e-state.mjs','wait',run,phase,
                          *([agent] if agent else []),timeout=630)
        except subprocess.CalledProcessError as error:
            if error.returncode != 255 or attempt == 2:
                raise RuntimeError(f'{host} observer failed: {error.stderr.strip()}') from error
            print(f'{host}: reconnecting the read-only SSH observer',flush=True)

def acceptance(host, package, output, run):
    report = {'host': host, 'run': run, 'ok': False, 'phases': []}
    terminal = None
    try:
        upload(host, package, f'dsh-e2e-candidate-{run}.tgz')
        upload(host, ROOT/'test/e2e/windows-state.mjs', 'dsh-e2e-state.mjs')
        upload(host, ROOT/'test/e2e/windows-launch.ps1', 'dsh-e2e-launch.ps1')
        paths = json.loads(remote(host, 'node', 'dsh-e2e-state.mjs', 'prepare', run))
        agent = None
        for phase in ['first', 'reopen']:
            command = subprocess.list2cmdline(['pwsh.exe','-NoLogo','-NoProfile','-File',
                'dsh-e2e-launch.ps1','-Run',run])
            terminal = pexpect.spawn(SSH[0], [*SSH[1:], '-tt', host, command],
                env={**os.environ,'TERM':'xterm-256color'}, encoding='utf-8', codec_errors='replace',
                timeout=30, dimensions=(40,140))
            private_logs=Path('/mnt/cache/data-cache')/'dsh-release-e2e'/run
            private_logs.mkdir(parents=True,exist_ok=True,mode=0o700)
            private_log = private_logs/f'{host}-{phase}.terminal.log'
            with private_log.open('w', encoding='utf-8') as log:
                terminal.logfile_read = log
                ready = False
                deadline = time.monotonic()+600
                while time.monotonic()<deadline:
                    found=terminal.expect([r'Ask Codex to do anything',r'Yes, I trust',r'Continue anyway\?',
                        '\x1b\\[6n',pexpect.EOF,pexpect.TIMEOUT], timeout=2)
                    if found==0:
                        # Wait for the remote thread to load; its initial composer
                        # is visible before the model/session footer is ready.
                        terminal.expect(r'GPT-6-Astra',timeout=120)
                        # Windows can show the composer before thread settings
                        # finish loading. Drain that startup animation first.
                        until=time.monotonic()+5
                        while time.monotonic()<until:
                            event=terminal.expect(['\x1b\\[6n',pexpect.EOF,pexpect.TIMEOUT],timeout=1)
                            if event==0:terminal.send('\x1b[1;1R')
                            elif event==1:raise RuntimeError('Codex exited during thread initialization.')
                        ready=True;break
                    if found==1: terminal.send('1\r')
                    elif found==2: terminal.send('y\r')
                    elif found==3: terminal.send('\x1b[1;1R')
                    elif found==4: raise RuntimeError('The public CLI exited before opening Codex.')
                if not ready: raise RuntimeError('The public CLI did not open Codex within the deadline.')
                marker=f'DSH_E2E_{run}_{phase}'
                delegation = ('Start one new DSH subagent' if phase=='first' else f'Use dsh_followup on existing agent {agent}')
                prompt=(f'Release acceptance {run}. Work only in the current directory. Read the installed $dsh-subagent skill. '
                    f'{delegation}, with task: use the shell tool to wait 40 seconds, then write exactly {marker} into '
                    f'{phase}-child.txt, and report completion. Use workspace-write permission. '
                    'Call dsh_watch once to register the native completion callback, then end your turn with WAITING. '
                    'Do not poll or perform foreground waiting. When dsh_completion arrives automatically, '
                    f'read {phase}-child.txt, verify its exact content, and write exactly {marker}_VERIFIED into '
                    f'{phase}-verified.txt. Then reply ACCEPTED. Do not write the child file yourself. '
                    'Do not read credentials, change installation settings, or contact other sessions.')
                terminal.send('\x1b[200~'+prompt+'\x1b[201~')
                # Separate paste and Enter so Codex's paste-burst handling does
                # not absorb the submission key into the pasted message.
                time.sleep(1)
                terminal.send('\r')
                # Some Windows terminals consume the first Enter while ending
                # bracketed paste. Confirm the task starts before observing it.
                started=terminal.expect([r'Working',r'esc to interrupt',r'Calling',pexpect.EOF,pexpect.TIMEOUT],timeout=10)
                if started==4:
                    terminal.send('\r')
                    started=terminal.expect([r'Working',r'esc to interrupt',r'Calling',pexpect.EOF],timeout=60)
                if started==3:raise RuntimeError('Codex exited before accepting the task.')
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    future=pool.submit(observe,host,run,phase,agent)
                    while not future.done():
                        found=terminal.expect(['\x1b\\[6n',pexpect.EOF,pexpect.TIMEOUT,
                            r'Allow the dsh_subagent MCP server to run tool "(dsh_start|dsh_followup|dsh_watch)"'],timeout=2)
                        if found==0:terminal.send('\x1b[1;1R')
                        elif found==1:raise RuntimeError('Codex exited before completing the delegated task.')
                        elif found==3:
                            # Click the one-time approval for this explicitly
                            # requested test operation. Keep the user's policy;
                            # never select session-wide or permanent approval.
                            name=terminal.match.group(1)
                            terminal.expect(r'enter to submit',timeout=30)
                            terminal.send('\r')
                            report.setdefault('oneTimeApprovals',[]).append({'phase':phase,'tool':name})
                    phase_report=json.loads(future.result())
                report['phases'].append(phase_report)
                agent=phase_report['agentId']
                terminal.sendcontrol('c');time.sleep(.5);terminal.sendcontrol('c')
                terminal.expect(pexpect.EOF,timeout=30)
                terminal.close();terminal=None
            print(f'{host}: {phase} real delegation, callback and parent artifact accepted',flush=True)
            report['phases'].append(json.loads(remote(host,'node','dsh-e2e-state.mjs','restart',run)))
            if phase=='first':
                report['phases'].append(json.loads(remote(host,'node','dsh-e2e-state.mjs','upgrade-baseline',run,timeout=270)))
        report['ok']=True
    except Exception as error:
        report['error']=str(error)
        try: report['diagnostic']=json.loads(remote(host,'node','dsh-e2e-state.mjs','diagnose',run))
        except Exception: pass
    finally:
        if terminal is not None and terminal.isalive():
            terminal.sendcontrol('c');time.sleep(.5);terminal.sendcontrol('c');terminal.close(force=True)
        if not report['ok']:
            try: report['cleanup']=json.loads(remote(host,'node','dsh-e2e-state.mjs','cleanup',run))
            except Exception as error: report['cleanupError']=str(error)
        (output/f'{host}.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--package',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--hosts',nargs='+',default=['win','dorm'])
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True,mode=0o700)
    run='ci-'+uuid.uuid4().hex[:12]
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(args.hosts)) as pool:
        reports=list(pool.map(lambda host:acceptance(host,args.package,args.output,run),args.hosts))
    summary={'ok':all(report['ok'] for report in reports),'hosts':reports}
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps(summary,indent=2),flush=True)
    raise SystemExit(0 if summary['ok'] else 1)
