"""Synthetic recorder tests. No firmware or private recordings."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dev'))
from replay import Recording


class RecorderTests(unittest.TestCase):
    def test_installer_launcher_default_is_byte_identical_to_before_recorder_support(self):
        spec = importlib.util.spec_from_file_location('usb_record_test', ROOT / 'tools/build-usb.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        self.assertEqual(hashlib.sha256(builder.launcher_name().encode()).hexdigest(),
                         'd3b84023dd10d4ee38083ca44492f183da1e1d79427f7236b64066e59f614fc6')
        with self.assertRaises(ValueError):
            builder.launcher_name(marker='unsafe;command')

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

    def run_capture(self, interrupt=False, tamper=False, duplicate=False, conflict=False, quick_slow=False):
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            car = work / 'car'
            usb = car / 'tmp/mnt/sda1'
            subprocess.run([sys.executable, str(ROOT / 'tools/build-recorder.py'), '--output', str(usb)],
                           check=True, capture_output=True)
            (car / '.nd-gauges-test-root').write_text('synthetic\n')
            sentinel = car / 'system.conf'
            sentinel.write_text('unchanged\n')
            monitor = car / 'dbus-monitor'
            monitor.write_text("#!/bin/sh\nwhile :; do\n echo 'signal interface=com.jci.vbs.vdt; member=EngAout_N_Actl'\n echo ' uint16 1604'\n echo 'signal interface=com.jci.vbs.bcm; member=PASCDNotification'\n echo ' string \"GPS PRIVATE\"'\n echo 'signal interface=com.jci.vbs.vdt; member=Veh_V_ActlEng'\n echo ' uint16 12256'\n sleep 0.1\ndone\n")
            monitor.chmod(0o755)
            smdb = car / 'smdb-read'
            smdb.write_text("#!/bin/sh\nsleep 3\necho 'EngClnt_Te_Actl (int, 4): 129'\necho 'GPS (int, 4): 12345'\necho finished > /w/car/smdb-finished\n")
            if quick_slow:
                smdb.write_text(smdb.read_text().replace('sleep 3', 'sleep 0.1'))
            smdb.chmod(0o755)
            if tamper:
                (usb / 'record-filter.awk').write_text('tampered')
            if duplicate:
                import shutil
                shutil.copytree(usb, car / 'tmp/mnt/sdb1')
            if conflict:
                (car / 'tmp/nd-gauges').mkdir()
                # PID 1 exists inside this test container.
                (car / 'tmp/nd-gauges/collector.pid').write_text('1')
            name = next(usb.glob('*.up')).name[:-3]
            if interrupt:
                command = 'sh /w/car/tmp/mnt/sda1/record.sh & p=$!; sleep 1; kill -TERM "$p"; wait "$p"'
            else:
                command = 'X=' + name
            result = subprocess.run(['docker', 'run', '--rm', '-v', f'{work}:/w',
                '-e', 'HOME=/root', '-e', 'ND_ROOT=/w/car', '-e', 'ND_RECORD_TEST_ROOT=/w/car',
                'busybox:1.25', 'sh', '-c', command], capture_output=True, text=True, timeout=15)
            self.assertEqual(sentinel.read_text(), 'unchanged\n')
            sessions = list(usb.glob('recordings/*/session.jsonl*'))
            if tamper or duplicate or conflict:
                self.assertEqual(sessions, [])
                self.assertFalse((car / 'smdb-finished').exists())
                return
            self.assertTrue((car / 'smdb-finished').exists(), 'in-flight smdb read must finish, never be killed')
            self.assertEqual(len(sessions), 1, result.stderr)
            self.assertEqual(sessions[0].name, 'session.jsonl.part' if interrupt else 'session.jsonl')
            self.assertNotIn('GPS', sessions[0].read_text())
            self.assertNotIn('PRIVATE', sessions[0].read_text())
            self.assertTrue(Recording(sessions[0]).times)
            if quick_slow:
                rows = [json.loads(line) for line in sessions[0].read_text().splitlines()]
                self.assertTrue(any(row['fields'].get('EngClnt_Te_Actl') == 129 for row in rows))
            self.assertFalse((car / 'tmp/nd-gauges-recorder.lock').exists())
            self.assertEqual(result.returncode == 0, not interrupt, result.stderr)

    def test_actual_capture_finishes_slow_read_and_produces_replayable_session(self):
        self.run_capture()

    def test_whitelisted_slow_values_join_live_frames(self):
        self.run_capture(quick_slow=True)

    def test_interruption_keeps_partial_capture_and_waits_for_slow_read(self):
        self.run_capture(interrupt=True)

    def test_tampered_payload_cannot_start_recording(self):
        self.run_capture(tamper=True)

    def test_two_matching_sticks_cannot_start_recording(self):
        self.run_capture(duplicate=True)

    def test_existing_collector_is_not_stopped_or_competed_with(self):
        self.run_capture(conflict=True)

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
