import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/dsh-subagent/scripts/codex_notify.py'
THREAD = '01a0e5c5-cdae-7101-9d53-228035271cfe'


class CallbackTest(unittest.TestCase):
    def setUp(self):
        preferred = Path('/mnt/cache/data-cache')
        temp_root = os.environ.get('TMPDIR') or (str(preferred) if preferred.is_dir() else None)
        self.temp = tempfile.TemporaryDirectory(prefix='dsh-callback-test-', dir=temp_root)
        self.root = Path(self.temp.name)
        self.capture = self.root / 'queue.jsonl'
        self.binary = self.root / 'codex'
        self.binary.write_text(
            f'#!{sys.executable}\nimport json,sys\n'
            f'with open({str(self.capture)!r}, "a") as f: f.write(json.dumps(sys.argv[1:])+"\\n")\n'
            'print("Queued fixture message")\n'
        )
        self.binary.chmod(0o700)
        self.node = self.root / 'node'
        self.node.write_text(
            f'#!{sys.executable}\nimport json,sys\nrequest=json.load(sys.stdin)\n'
            'if request.get("check"):\n print(json.dumps({"thread_id": request["threadId"]}))\n'
            'else:\n'
            f' with open({str(self.capture)!r}, "a") as f: f.write(json.dumps(request)+"\\n")\n'
            ' print(json.dumps({"turn_id":"parent-turn","status":"inProgress"}))\n'
        )
        self.node.chmod(0o700)
        self.socket_path = str(self.root / 'server.sock')
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(self.socket_path)
        self.server.listen()
        self.server.settimeout(0.1)
        self.stopped = threading.Event()
        self.events, self.results, self.requests, self.directories = {}, {}, [], []
        self.acceptor = threading.Thread(target=self.accept, daemon=True)
        self.acceptor.start()

    def accept(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.server.accept()
            except (socket.timeout, OSError):
                continue
            threading.Thread(target=self.serve, args=(connection,), daemon=True).start()

    def serve(self, connection):
        try:
            with connection, connection.makefile('rwb') as stream:
                for line in stream:
                    request = json.loads(line)
                    self.requests.append(request)
                    if request['method'] == 'initialize':
                        result = {'protocolVersion': '2025-03-26', 'capabilities': {'tools': {}},
                                  'serverInfo': {'name': 'fixture', 'version': '1'}}
                    elif request['method'] == 'notifications/initialized':
                        continue
                    else:
                        agent = request['params']['arguments']['agent_id']
                        self.events[agent].wait()
                        result = self.results[agent]
                    stream.write((json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}) + '\n').encode())
                    stream.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def launch(self, agent='agent-one', status='completed', delivery='tool-output', default_output=False):
        self.events[agent] = threading.Event()
        self.results[agent] = {'content': [{'type': 'text', 'text': json.dumps({
            'agent_id': agent, 'status': status, 'wait_outcome': 'settled', 'answer': 'evidence on disk',
        })}]}
        directory = self.root / agent
        command = [sys.executable, str(SCRIPT), '--agent', agent, '--thread', THREAD,
                   '--socket', self.socket_path, '--codex', str(self.binary), '--node', str(self.node),
                   '--delivery', delivery]
        if not default_output:
            command.extend(['--output-dir', str(directory)])
        start = subprocess.run(command, capture_output=True, text=True, timeout=5,
                               env={**os.environ, 'TMPDIR': str(self.root)})
        self.assertEqual(start.returncode, 0, start.stderr)
        receipt = json.loads(start.stdout)
        self.assertEqual(receipt['status'], 'watching')
        directory = Path(receipt['result_path']).parent
        self.directories.append(directory)
        return directory, command

    def test_default_result_directory_uses_configured_tmpdir(self):
        directory, _ = self.launch(default_output=True)
        self.assertEqual(directory.parent, self.root)
        self.events['agent-one'].set()
        self.until(directory, 'delivered')
        self.assertTrue((directory / 'result.json').exists())

    def until(self, directory, *states):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            receipt = json.loads((directory / 'callback.json').read_text())
            if receipt['status'] in states:
                return receipt
            time.sleep(0.02)
        self.fail(f'Callback did not reach {states}: {receipt}')

    def tearDown(self):
        for directory in self.directories:
            path = directory / 'callback.json'
            if path.exists():
                receipt = json.loads(path.read_text())
                if receipt['status'] in ('watching', 'connecting'):
                    os.kill(receipt['pid'], signal.SIGTERM)
                    self.until(directory, 'cancelled')
        self.stopped.set()
        for event in self.events.values():
            event.set()
        self.server.close()
        self.acceptor.join(timeout=1)
        self.temp.cleanup()

    def test_detached_single_wait_then_native_output_and_saved_result(self):
        directory, _ = self.launch()
        time.sleep(0.15)
        self.assertFalse(self.capture.exists(), 'No parent delivery while waiting')
        wait_calls = [r for r in self.requests if r['method'] == 'tools/call']
        self.assertEqual(len(wait_calls), 1)
        self.assertEqual(wait_calls[0]['params'], {'name': 'dsh_wait', 'arguments': {'agent_id': 'agent-one', 'legacy': True}})
        self.events['agent-one'].set()
        receipt = self.until(directory, 'delivered')
        calls = [json.loads(line) for line in self.capture.read_text().splitlines()]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['threadId'], THREAD)
        self.assertEqual(calls[0]['output']['answer'], 'evidence on disk')
        self.assertEqual(calls[0]['output']['result_path'], str(directory / 'result.json'))
        self.assertEqual(receipt['delivery_receipt']['turn_id'], 'parent-turn')
        self.assertEqual(json.loads((directory / 'result.json').read_text())['answer'], 'evidence on disk')

    def test_fast_child_not_blocked_by_slow_child(self):
        slow, _ = self.launch('slow')
        fast, _ = self.launch('fast')
        self.events['fast'].set()
        self.until(fast, 'delivered')
        self.assertEqual(json.loads((slow / 'callback.json').read_text())['status'], 'watching')

    def test_interrupted_and_closed_do_not_deliver(self):
        for status in ('interrupted', 'closed'):
            directory, _ = self.launch(agent=status, status=status)
            self.events[status].set()
            self.until(directory, 'stopped')
        self.assertFalse(self.capture.exists())

    def test_error_and_context_exhaustion_notify_parent(self):
        for status in ('error', 'context_exhausted'):
            directory, _ = self.launch(agent=status, status=status)
            self.events[status].set()
            self.until(directory, 'delivered')
        calls = [json.loads(line) for line in self.capture.read_text().splitlines()]
        self.assertEqual([c['output']['status'] for c in calls], ['error', 'context_exhausted'])

    def test_cancel_detaches_without_interrupting_child(self):
        directory, _ = self.launch()
        pid = json.loads((directory / 'callback.json').read_text())['pid']
        os.kill(pid, signal.SIGTERM)
        self.until(directory, 'cancelled')
        self.assertFalse(self.capture.exists())
        self.assertFalse(any(r.get('params', {}).get('name') == 'dsh_interrupt' for r in self.requests))

    def test_native_failure_preserves_result_without_retry_or_queue_fallback(self):
        directory, _ = self.launch()
        attempts = self.root / 'failed-attempts'
        self.node.write_text(f'#!{sys.executable}\nimport sys\nwith open({str(attempts)!r},"a") as f: f.write("attempt\\n")\nprint("fixture delivery failure",file=sys.stderr)\nsys.exit(2)\n')
        self.events['agent-one'].set()
        receipt = self.until(directory, 'delivery_failed')
        self.assertIn('fixture delivery failure', receipt['error'])
        self.assertTrue((directory / 'result.json').exists())
        self.assertEqual(attempts.read_text(), 'attempt\n')
        self.assertFalse(self.capture.exists())

    def test_duplicate_registration_does_not_overwrite_watch(self):
        directory, command = self.launch()
        original = json.loads((directory / 'callback.json').read_text())
        again = subprocess.run(command, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(again.returncode, 0)
        self.assertEqual(json.loads((directory / 'callback.json').read_text()), original)

    def test_mcp_error_notifies_without_claiming_task_completion(self):
        directory, _ = self.launch()
        self.results['agent-one'] = {'isError': True, 'content': [{'type': 'text', 'text': 'Unknown agent'}]}
        self.events['agent-one'].set()
        self.until(directory, 'delivered')
        self.assertEqual(json.loads((directory / 'result.json').read_text())['status'], 'watch_error')

    def test_explicit_queue_compatibility(self):
        directory, _ = self.launch(delivery='queue')
        self.events['agent-one'].set()
        self.until(directory, 'queued')
        calls = [json.loads(line) for line in self.capture.read_text().splitlines()]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:5], ['cli', 'queue', '--thread', THREAD, '--message'])
        self.assertIn('evidence on disk', calls[0][5])

    def test_large_answer_inline_preview_retains_full_artifact(self):
        directory, _ = self.launch()
        answer = 'x' * 12000
        self.results['agent-one']['content'][0]['text'] = json.dumps({
            'agent_id': 'agent-one', 'status': 'completed', 'wait_outcome': 'settled',
            'finish_reason': {'kind': 'completed'}, 'answer': answer, 'last_completed_answer': answer,
        })
        self.events['agent-one'].set()
        self.until(directory, 'delivered')
        output = json.loads(self.capture.read_text())['output']
        self.assertEqual(len(output['answer']), 8000)
        self.assertEqual(output['truncated_fields'], ['answer'])
        self.assertEqual(output['finish_reason'], {'kind': 'completed'})
        self.assertNotIn('last_completed_answer', output)
        self.assertEqual(json.loads((directory / 'result.json').read_text())['answer'], answer)

    def test_missing_parent_fails_before_registering_wait(self):
        self.node.write_text(f'#!{sys.executable}\nimport sys\nprint("Unknown parent",file=sys.stderr)\nsys.exit(1)\n')
        directory = self.root / 'missing-parent'
        result = subprocess.run([sys.executable, str(SCRIPT), '--agent', 'unused', '--thread', THREAD,
                                 '--socket', self.socket_path, '--node', str(self.node),
                                 '--output-dir', str(directory)], capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads((directory / 'callback.json').read_text())['status'], 'setup_failed')
        self.assertFalse(self.requests)


if __name__ == '__main__':
    unittest.main()
