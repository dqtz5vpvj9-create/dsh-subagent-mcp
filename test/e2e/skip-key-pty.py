"""Run a real POSIX installation in a terminal and skip only its API-key prompt.

This is a CI driver, not part of the installed product. It never supplies a key,
accepts an unrelated prompt, or sends Ctrl+C as a successful completion.
"""
import argparse
import errno
import os
import pty
import re
import select
import signal
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--timeout', type=int, default=470)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('a command is required after --')
    prompt = 'DeepSeek API key (hidden; press Enter to configure later): '
    child, terminal = pty.fork()
    if child == 0:
        os.execvpe(command[0], command, os.environ)
    deadline = time.monotonic() + args.timeout
    transcript = ''
    skipped = False
    result = None
    try:
        while result is None:
            if time.monotonic() >= deadline:
                raise RuntimeError('The installer did not return to the shell after skipping the key.' if skipped
                                   else 'The installer did not reach the expected optional key prompt.')
            readable, _, _ = select.select([terminal], [], [], 0.2)
            if readable:
                try:
                    chunk = os.read(terminal, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    chunk = b''
                if chunk:
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                    transcript += chunk.decode('utf-8', errors='replace')
                    plain = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', transcript)
                    if not skipped and prompt in plain:
                        os.write(terminal, b'\r')
                        skipped = True
                        # An optional field must not keep the user's foreground
                        # process alive after the installer reports success.
                        deadline = min(deadline, time.monotonic() + 90)
            pid, status = os.waitpid(child, os.WNOHANG)
            if pid:
                result = os.waitstatus_to_exitcode(status)
        # The child can exit between a read and waitpid. Preserve the final
        # status lines for the caller's user-facing output assertions.
        while select.select([terminal], [], [], 0)[0]:
            try:
                chunk = os.read(terminal, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
            if not chunk:
                break
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
        if not skipped:
            raise RuntimeError('Installation exited without exercising the optional hidden key prompt.')
        if result != 0:
            raise RuntimeError(f'Installation exited with {result} after skipping the key.')
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        if result is None:
            os.killpg(child, signal.SIGTERM)
            until = time.monotonic() + 5
            while time.monotonic() < until:
                pid, _ = os.waitpid(child, os.WNOHANG)
                if pid:
                    break
                time.sleep(0.1)
            else:
                os.killpg(child, signal.SIGKILL)
                os.waitpid(child, 0)
        return 1
    finally:
        os.close(terminal)


if __name__ == '__main__':
    raise SystemExit(main())
