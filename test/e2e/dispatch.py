"""Dispatch the trusted main-branch workflow on a one-job SSH controller.

Install the official Linux GitHub Actions runner in --runner before calling.
The controller needs SSH aliases win/dorm and Python pexpect. No model or SSH
credentials are uploaded to GitHub. The runner deregisters after its one job.
"""
import argparse
import json
import os
import subprocess
import uuid
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--runner',type=Path,required=True)
parser.add_argument('--publish',action='store_true')
args=parser.parse_args()
repo='dqtz5vpvj9-create/dsh-subagent-mcp'
label='dsh-e2e-'+uuid.uuid4().hex[:12]
token=json.loads(subprocess.check_output(['gh','api','--method','POST',f'repos/{repo}/actions/runners/registration-token'],text=True))['token']
configured=subprocess.run([str(args.runner/'config.sh'),'--unattended','--url',f'https://github.com/{repo}',
    '--token',token,'--name',label,'--labels',label,'--ephemeral','--disableupdate','--work','_work'],
    cwd=args.runner,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
print(configured.stdout.replace(token,'[redacted]'),flush=True)
configured.check_returncode()
subprocess.run(['gh','workflow','run','release-e2e.yml','--repo',repo,'--ref','main','-f','runner_label='+label,
    '-f','publish='+str(args.publish).lower()],check=True)
print('Dispatched real end-to-end CI with '+label,flush=True)
runner_env={**os.environ,'DOTNET_SYSTEM_NET_DISABLEIPV6':'1',
    'DOTNET_SYSTEM_NET_HTTP_SOCKETSHTTPHANDLER_HTTP2SUPPORT':'0'}
raise SystemExit(subprocess.call([str(args.runner/'run.sh')],cwd=args.runner,env=runner_env))
