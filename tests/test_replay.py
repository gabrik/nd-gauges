# SPDX-License-Identifier: GPL-3.0-or-later
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dev'))
from replay import Recording


class ReplayTests(unittest.TestCase):
    def test_explicit_fixture_updates_and_eof(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'sanitized.jsonl'
            path.write_text('\n'.join(json.dumps(row) for row in (
                {'t': 0, 'fields': {'VehicleSpeed': 0, 'EngineSpeed': 400}},
                {'t': 1, 'fields': {'VehicleSpeed': 3000, 'EngineSpeed': 1500}},
            )))
            r = Recording(path)
            self.assertIn('uint16 400', r.fixture(0)['signals.txt'])
            self.assertIn('uint16 3000', r.fixture(1)['signals.txt'])
            self.assertEqual(r.fixture(1.1)['signals.txt'], '\n')

    def test_unknown_private_nonfinite_or_out_of_order_input_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'recording.jsonl'
            for rows in (
                [{'t': 0, 'fields': {'LatitudeByGPS': 123}}],
                [{'t': 1, 'fields': {'VehicleSpeed': 0}}],
                [{'t': 0, 'fields': {'VehicleSpeed': -1}}],
                [{'t': float('nan'), 'fields': {'VehicleSpeed': 0}}],
                [{'t': 0, 'fields': {'VehicleSpeed': True}}],
            ):
                path.write_text('\n'.join(json.dumps(row) for row in rows))
                with self.assertRaises(ValueError):
                    Recording(path)
            # Rejection happens before opening or inspecting the private path.
            with self.assertRaisesRegex(ValueError, 'Private dump'):
                Recording(Path(temp) / 'dumps' / 'must-not-read.jsonl')


if __name__ == '__main__':
    unittest.main()
