#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Synthetic or explicitly supplied sanitized replay → MiatOff collector → nd-gauges."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import math
import mimetypes
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from urllib.parse import unquote, urlsplit
import uuid
import webbrowser

from drive import fixture_text
from replay import Recording

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.asset()

    def do_HEAD(self):
        self.asset(head=True)

    def asset(self, head=False):
        port = self.server.server_port
        if self.headers.get('Host') not in (f'127.0.0.1:{port}', f'localhost:{port}'):
            self.send_error(403, 'Use the loopback preview address')
            return
        path = unquote(urlsplit(self.path).path)
        if '\x00' in path:
            self.send_error(404)
            return
        target = (ROOT / 'app' / path.lstrip('/')).resolve()
        public = ROOT / 'app'
        allowed = target.parent == public and target.name in (
            'index.html', 'data.js', 'vector.js', 'gauges.js', 'gauges.css')
        if path == '/live.txt':
            target = self.server.live
        elif not allowed:
            self.send_error(404)
            return
        try:
            content = target.read_bytes()
        except (OSError, ValueError):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8' if path == '/live.txt'
                         else mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        if not head:
            self.wfile.write(content)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, *args):
        pass


class Harness:
    """Own the synthetic producer, collector process tree, HTTP server and temp files."""
    def __init__(self, port=8765, docker='', at=None, recording=None):
        self.port, self.docker, self.at = port, docker, at
        self.recording = recording
        self.done = threading.Event()
        self.process = self.server = self.producer = self.http_thread = None
        self.work = self.log = self.temp = None
        self.container = 'nd-gauges-dev-' + uuid.uuid4().hex

    def __enter__(self):
        try:
            self.start()
            return self
        except BaseException:
            self.close()
            raise

    def __exit__(self, *args):
        self.close()

    def write_state(self, seconds):
        for name, text in (self.recording.fixture(seconds) if self.recording else fixture_text(seconds)).items():
            path = self.work / name
            staged = path.with_suffix('.tmp')
            staged.write_text(text, encoding='utf-8', newline='\n')
            staged.replace(path)

    def produce(self):
        start = time.monotonic()
        while not self.done.wait(0.1):
            self.write_state(self.at if self.at is not None else time.monotonic() - start)

    def pause(self):
        """Stop mock D-Bus traffic without removing the last readable snapshot."""
        (self.work / 'feed').unlink(missing_ok=True)

    def resume(self):
        (self.work / 'feed').touch()

    def start(self):
        if not self.docker and (os.name == 'nt' or not shutil.which('gawk')):
            raise RuntimeError('Native mode needs POSIX sh and gawk. Install gawk or use --docker busybox:1.25.')
        self.temp = tempfile.TemporaryDirectory(prefix='nd-gauges dev ')
        self.work = Path(self.temp.name)
        for source in (ROOT / 'vendor/miatoff/miatoff-collector.sh', HERE / 'mock-dbus-monitor', HERE / 'mock-smdb-read'):
            destination = self.work / source.name
            shutil.copyfile(source, destination)
            destination.chmod(0o755)
        (self.work / 'out').mkdir()
        self.write_state(self.at if self.at is not None else 0)
        self.resume()
        # Bind first: an occupied port must not leave a collector behind.
        self.server = ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        self.server.live = self.work / 'out/live.txt'
        self.url = f'http://127.0.0.1:{self.server.server_port}/index.html'
        env = {
            'MO_OUT_DIR': 'W/out', 'MO_DBUS_MONITOR': 'W/mock-dbus-monitor',
            'MO_SMDB_READ': 'W/mock-smdb-read', 'MO_DEV_DATA': 'W',
            'MO_SLOW_S': '1', 'MO_ONESHOT': '0', 'MO_FLUSH_EVERY': '30',
            'MO_BUS': 'unix:path=/nonexistent-miatoff-dev-bus',
        }
        self.log = (self.work / 'host.log').open('w', encoding='utf-8')
        if self.docker:
            command = ['docker', 'run', '--rm', '--name', self.container,
                       '-v', f'{self.work}:/w']
            for key, value in env.items():
                command += ['-e', key + '=' + value.replace('W', '/w')]
            command += [self.docker, 'sh', '/w/miatoff-collector.sh']
            self.process = subprocess.Popen(command, stdout=self.log, stderr=subprocess.STDOUT)
        else:
            # Ubuntu's mawk and macOS awk can buffer pipe input. Pin streaming gawk
            # without changing the collector or the user's PATH outside this child.
            (self.work / 'awk').symlink_to(shutil.which('gawk'))
            env = {key: value.replace('W', str(self.work)) for key, value in env.items()}
            env['PATH'] = str(self.work) + os.pathsep + os.environ.get('PATH', '')
            self.process = subprocess.Popen(['sh', str(self.work / 'miatoff-collector.sh')],
                                            env=dict(os.environ, **env), stdout=self.log,
                                            stderr=subprocess.STDOUT, start_new_session=True)
        self.producer = threading.Thread(target=self.produce, daemon=True)
        self.producer.start()
        deadline = time.monotonic() + 30
        while True:
            if self.process.poll() is not None:
                raise RuntimeError('Collector exited: ' + (self.work / 'host.log').read_text())
            if self.server.live.exists():
                break
            if time.monotonic() > deadline:
                raise RuntimeError('No collector data after 30 s. Check Docker or native gawk.\n' +
                                   (self.work / 'host.log').read_text())
            time.sleep(0.1)
        self.http_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.http_thread.start()

    def close(self):
        self.done.set()
        if self.producer:
            self.producer.join()
        if self.server:
            if self.http_thread:
                self.server.shutdown()
                self.http_thread.join()
            self.server.server_close()
        try:
            if self.process:
                if self.docker:
                    self.docker_cleanup('stop', '-t', '3')
                elif self.process.poll() is None:
                    self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
                if self.docker:
                    # Also covers interruption while docker run was still starting.
                    self.docker_cleanup('rm', '-f')
                else:
                    # These are our fake programs only, never a real smdb-read.
                    try:
                        os.killpg(self.process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
        finally:
            if self.log:
                self.log.close()
            if self.temp:
                self.temp.cleanup()

    def docker_cleanup(self, *args):
        try:
            subprocess.run(['docker', *args, self.container], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=15, check=False)
        except (OSError, subprocess.TimeoutExpired):
            # Still reap the local process and clean temp files if Docker goes away.
            print(f'Warning: Docker cleanup failed; check container {self.container}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765, help='Loopback HTTP port (0 chooses a free port)')
    parser.add_argument('--docker', default='', metavar='IMAGE', help='Run collector in BusyBox, e.g. busybox:1.25')
    parser.add_argument('--at', type=float, help='Hold scenario at this second; collector still publishes at 10 Hz')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--recording', type=Path, help='Explicitly supplied sanitized raw-field JSONL; see dev/REPLAY.md')
    args = parser.parse_args()
    if args.at is not None and (not math.isfinite(args.at) or args.at < 0):
        parser.error('--at must be a finite nonnegative number')
    # Turn TERM into the same cleanup path as Ctrl-C (POSIX).
    def interrupted(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        with Harness(args.port, args.docker, args.at,
                     Recording(args.recording) if args.recording else None) as harness:
            label = 'USER-SUPPLIED REPLAY (not independently validated)' if args.recording else 'SYNTHETIC'
            print(f'{label} → MiatOff collector → nd-gauges\n{harness.url}', flush=True)
            print('Enter: pause/resume D-Bus feed (NO DATA after 3 s). Ctrl-C: stop.', flush=True)
            def keyboard():
                paused = False
                try:
                    while not harness.done.is_set():
                        # Unbuffered read: a blocked daemon thread must not hold
                        # Python's stdin lock during interpreter shutdown.
                        key = os.read(0, 1)
                        if not key or harness.done.is_set():
                            return
                        if key == b'\n':
                            paused = not paused
                            harness.pause() if paused else harness.resume()
                            print('Feed paused' if paused else 'Feed resumed', flush=True)
                except OSError:
                    pass
            threading.Thread(target=keyboard, daemon=True).start()
            if not args.no_browser:
                webbrowser.open(harness.url)
            while not harness.done.wait(0.2):
                if harness.process.poll() is not None or not harness.producer.is_alive():
                    raise RuntimeError('Synthetic producer or collector stopped unexpectedly')
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        parser.exit(1, f'Cannot run nd-gauges preview: {error}\n')


if __name__ == '__main__':
    main()
