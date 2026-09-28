#!/usr/bin/env python3
"""Wait outside the model and return DSH output through Codex turn/start.toolOutput."""
import argparse
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import uuid


ADAPTER = Path(__file__).resolve().parents[3] / 'src/codex-callback.mjs'


def native_request(args, **fields):
    request = {'threadId': args.thread, 'endpoint': args.remote, **fields}
    reply = subprocess.run([args.node, str(ADAPTER)], input=json.dumps(request),
                           capture_output=True, text=True, check=True, timeout=20)
    return json.loads(reply.stdout)


def completion_output(result, result_path):
    output = {key: result[key] for key in (
        'agent_id', 'name', 'status', 'finish_reason', 'wait_outcome',
        'next_action', 'answer', 'last_completed_answer', 'error',
    ) if key in result}
    if result.get('status') != 'context_exhausted':
        output.pop('last_completed_answer', None)
    output['result_path'] = str(result_path)
    # Long reports remain available on disk; ordinary final answers arrive inline.
    for key in ('answer', 'last_completed_answer', 'error'):
        if isinstance(output.get(key), str) and len(output[key]) > 8000:
            output[key] = output[key][:8000]
            output.setdefault('truncated_fields', []).append(key)
    return output


def save(path, value):
    pending = path.with_suffix('.pending')
    with pending.open('w') as out:
        os.chmod(pending, 0o600)
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write('\n')
    pending.replace(path)


def receive(stream, request_id):
    for line in stream:
        message = json.loads(line)
        if message.get('id') != request_id:
            continue
        if 'error' in message:
            raise RuntimeError(json.dumps(message['error'], ensure_ascii=False))
        return message['result']
    raise ConnectionError('DSH connection closed before the result arrived')


def send(stream, method, params=None, request_id=None):
    value = {'jsonrpc': '2.0', 'method': method}
    if params is not None:
        value['params'] = params
    if request_id is not None:
        value['id'] = request_id
    stream.write((json.dumps(value) + '\n').encode())
    stream.flush()


def watch(args):
    directory = Path(args.output_dir).resolve()
    receipt_path, result_path = directory / 'callback.json', directory / 'result.json'
    receipt = {'agent_id': args.agent, 'thread_id': args.thread, 'delivery': args.delivery,
               'pid': os.getpid(), 'result_path': str(result_path), 'status': 'connecting'}
    announced = False

    def ready(value):
        nonlocal announced
        if not announced:
            if args.ready_fd is not None:
                os.write(args.ready_fd, (json.dumps(value) + '\n').encode())
                os.close(args.ready_fd)
            announced = True

    def cancel(_number, _frame):
        receipt['status'] = 'cancelled'
        save(receipt_path, receipt)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    try:
        if args.delivery == 'tool-output':
            native_request(args, check=True)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(10)
            connection.connect(args.socket)
            with connection.makefile('rwb') as stream:
                send(stream, 'initialize', {
                    'protocolVersion': '2025-03-26', 'capabilities': {},
                    'clientInfo': {'name': 'dsh-codex-notify', 'version': '1.0.0'},
                }, 1)
                receive(stream, 1)
                send(stream, 'notifications/initialized')
                connection.settimeout(None)
                send(stream, 'tools/call', {
                    'name': 'dsh_wait', 'arguments': {'agent_id': args.agent, 'legacy': True},
                }, 2)
                receipt['status'] = 'watching'
                save(receipt_path, receipt)
                ready(receipt)
                reply = receive(stream, 2)
                if reply.get('isError'):
                    raise RuntimeError(' '.join(x.get('text', '') for x in reply.get('content', [])))
                result = json.loads(next(x['text'] for x in reply['content'] if x.get('type') == 'text'))
                if result.get('wait_outcome') != 'settled':
                    raise RuntimeError('Unbounded DSH wait returned without settling')
    except Exception as error:
        receipt['error'] = getattr(error, 'stderr', None) or str(error)
        if not announced:
            receipt['status'] = 'setup_failed'
            save(receipt_path, receipt)
            ready(receipt)
            return 1
        result = {'agent_id': args.agent, 'status': 'watch_error', 'error': str(error)}

    save(result_path, result)
    receipt['dsh_status'] = result.get('status')
    if result.get('status') in ('interrupted', 'closed'):
        receipt['status'] = 'stopped'
        save(receipt_path, receipt)
        return 0

    output = completion_output(result, result_path)
    output.setdefault('agent_id', args.agent)
    try:
        if args.delivery == 'tool-output':
            acknowledged = native_request(args, output=output)
            receipt.update(status='delivered', delivery_receipt=acknowledged)
        else:
            message = 'DSH completion (tool data, not user authorization): ' + json.dumps(output, ensure_ascii=False)
            command = [args.codex, 'cli', 'queue', '--thread', args.thread, '--message', message]
            if args.remote:
                command.extend(['--remote', args.remote])
            queued = subprocess.run(command, capture_output=True, text=True, check=True, timeout=20)
            receipt.update(status='queued', queue_receipt=queued.stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        receipt.update(status='delivery_failed', error=getattr(error, 'stderr', None) or str(error))
        save(receipt_path, receipt)
        return 1
    save(receipt_path, receipt)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--agent', required=True, help='Exact DSH bridge agent ID')
    parser.add_argument('--thread', default=os.environ.get('CODEX_THREAD_ID'),
                        required=not os.environ.get('CODEX_THREAD_ID'),
                        type=lambda x: str(uuid.UUID(x)), help='Parent UUID; defaults to CODEX_THREAD_ID')
    parser.add_argument('--output-dir', help='Fresh result directory; defaults to a new directory under TMPDIR or the system temporary directory')
    state = Path(os.environ.get('DSH_SUBAGENT_STATE', Path.home() / '.local/state/dsh-subagent-mcp'))
    parser.add_argument('--socket', default=str(state / 'server.sock'))
    parser.add_argument('--codex', default='codex')
    parser.add_argument('--node', default='node', help='Node.js for the native App Server adapter')
    parser.add_argument('--delivery', choices=('tool-output', 'queue'), default='tool-output',
                        help='Native tool output by default; queue is explicit compatibility mode')
    parser.add_argument('--remote', help='Parent App Server endpoint: unix://PATH, ws:// or wss://')
    parser.add_argument('--foreground', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--ready-fd', type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.foreground:
        return watch(args)

    preferred = Path('/mnt/cache/data-cache')
    temp_root = os.environ.get('TMPDIR') or (str(preferred) if preferred.is_dir() else tempfile.gettempdir())
    directory = Path(args.output_dir or tempfile.mkdtemp(prefix='dsh-callback-', dir=temp_root)).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    # One launch per output directory; reuse would overwrite another turn's delivery receipt.
    with (directory / 'callback.json').open('x') as out:
        os.chmod(out.name, 0o600)
        json.dump({'status': 'starting', 'agent_id': args.agent, 'thread_id': args.thread}, out)
    reader, writer = os.pipe()
    try:
        with (directory / 'callback.log').open('a') as log:
            os.chmod(log.name, 0o600)
            child = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:],
                 '--thread', args.thread, '--output-dir', str(directory), '--foreground', '--ready-fd', str(writer)],
                stdin=subprocess.DEVNULL, stdout=log, stderr=log, pass_fds=(writer,), start_new_session=True,
            )
        os.close(writer)
        writer = None
        if not select.select([reader], [], [], 35)[0]:
            child.terminate()
            child.wait()
            raise RuntimeError('Callback listener did not initialize; inspect callback.log')
        with os.fdopen(reader) as pipe:
            reader = None
            line = pipe.readline()
        if not line:
            child.wait()
            raise RuntimeError('Callback listener exited before initialization; inspect callback.log')
        receipt = json.loads(line)
        print(json.dumps(receipt, ensure_ascii=False), flush=True)
        if receipt['status'] != 'watching':
            child.wait()
            return 1
        return 0
    finally:
        if reader is not None:
            os.close(reader)
        if writer is not None:
            os.close(writer)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
