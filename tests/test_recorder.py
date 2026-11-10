"""Synthetic recorder tests. No firmware or private recordings."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dev'))
from replay import Recording


class RecorderTests(unittest.TestCase):
    def test_filter_whitelist_relative_time_and_replay_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            (work / 'slow').write_text('EngClnt_Te_Actl=129\nGPS=12345\n')
            text = '''@100
signal interface=com.jci.vbs.vdt; member=EngAout_N_Actl
   uint16 1604
signal interface=com.jci.vbs.bcm; member=PASCDNotification
   string "GPS PRIVATE VIN"
signal interface=com.jci.vbs.vdt; member=Veh_V_ActlEng
   uint16 12256
@100.1
signal interface=foreign; member=EngAout_N_Actl
   uint16 9999
signal interface=com.jci.vbs.vdt; member=Veh_V_ActlEng
   uint16 12260
'''
            result = subprocess.run(['docker', 'run', '--rm', '-i', '-v', f'{ROOT}:/src:ro',
                '-v', f'{work}:/w', 'busybox:1.25', 'awk', '-v', 'slow=/w/slow',
                '-f', '/src/cmu/record-filter.awk'], input=text, capture_output=True, text=True, check=True)
            self.assertNotIn('GPS', result.stdout)
            self.assertNotIn('PRIVATE', result.stdout)
            rows = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]['t'], 0)
            self.assertAlmostEqual(rows[1]['t'], 0.1)
            self.assertEqual(rows[1]['fields']['EngineSpeed'], 1604)
            self.assertEqual(rows[0]['fields']['EngClnt_Te_Actl'], 129)
            trace = work / 'trace.jsonl'
            trace.write_text(result.stdout)
            self.assertEqual(len(Recording(trace).times), 2)

    def test_builder_is_separate_and_rejects_nonempty_output(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / 'usb'
            command = [sys.executable, str(ROOT / 'tools/build-recorder.py'), '--output', str(target)]
            subprocess.run(command, check=True, capture_output=True)
            self.assertTrue((target / 'ND-RECORD.ID').is_file())
            self.assertFalse((target / 'install-gauges.sh').exists())
            self.assertTrue((target / 'record.sh').is_file())
            self.assertTrue((target / 'record-filter.awk').is_file())
            self.assertEqual(len(list(target.glob('*.up'))), 1)
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
