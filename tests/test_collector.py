#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual unmodified collector with fabricated input only; never reads a dump."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dev'))
from run import Harness
from replay import Recording


def get(url):
    with urlopen(url) as response:
        return response.read()


class CollectorTests(unittest.TestCase):
    def test_explicit_fabricated_replay_reaches_collector_without_invented_slow_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            trace = Path(temp) / 'approved-test-fixture.jsonl'
            trace.write_text('\n'.join(json.dumps(row) for row in (
                {'t': 0, 'fields': {'VehicleSpeed': 1234, 'EngineSpeed': 1111}},
                {'t': 4, 'fields': {'VehicleSpeed': 1234, 'EngineSpeed': 1111}},
            )))
            with Harness(port=0, docker=os.environ.get('MO_DOCKER_IMAGE', 'busybox:1.25'),
                         recording=Recording(trace)) as h:
                url = h.url.rsplit('/', 1)[0] + '/live.txt'
                raw = get(url).decode()
                self.assertIn('VehicleSpeed=1234\n', raw)
                self.assertIn('EngineSpeed=1111\n', raw)
                self.assertNotIn('EngClnt_Te_Actl', raw)
                time.sleep(4.5)
                frozen = get(url)
                time.sleep(0.4)
                self.assertEqual(get(url), frozen, 'EOF must not invent fresh samples')

    def test_actual_collector_http_and_lifecycle(self):
        source = ROOT / 'vendor/miatoff/miatoff-collector.sh'
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        with Harness(port=0, docker=os.environ.get('MO_DOCKER_IMAGE', 'busybox:1.25'), at=6) as h:
            base = h.url.rsplit('/', 1)[0]
            deadline = time.monotonic() + 5
            while b'EngClnt_Te_Actl=125' not in get(base + '/live.txt'):
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.1)
            raw = get(base + '/live.txt').decode()
            values = dict(line.split('=', 1) for line in raw.splitlines())
            self.assertEqual(values['VehicleSpeed'], '3000')
            self.assertEqual(values['AccelPedalPosition'], '1000')
            self.assertEqual(values['LongitudinalAccelerometer'], '4343')
            self.assertIn(b'data.js', get(h.url))
            for path in ('/../README.md', '/host.log', '/signals.txt', '/vendor/miatoff/LICENSE'):
                with self.assertRaises(HTTPError) as error:
                    get(base + path)
                self.assertEqual(error.exception.code, 404)
                error.exception.close()
            h.pause()
            time.sleep(0.3)
            frozen = get(base + '/live.txt')
            time.sleep(0.5)
            self.assertEqual(get(base + '/live.txt'), frozen)
            h.resume()
            deadline = time.monotonic() + 5
            while get(base + '/live.txt') == frozen:
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.1)
            work = h.work
        self.assertFalse(work.exists())
        self.assertIsNotNone(h.process.poll())
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)


if __name__ == '__main__':
    unittest.main()
