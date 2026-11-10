# SPDX-License-Identifier: GPL-3.0-or-later
"""Synthetic root only. Never loads real Mazda files or executes on the host root."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('usb_builder', ROOT / 'tools/build-usb.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
OPERA = b'[User Prefs]\nUser JavaScript File=$OPERA_DIR/userjs/\nUser JavaScript=0\n\n[Network]\nPerson=0\n'
GAP = b'#!/bin/sh\n# synthetic empty boot stage\n'


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='nd-install-')
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.car = self.work / 'car'
        self.usb = builder.build(self.work / 'usb')
        self.opera = self.car / 'jci/opera/opera_home/opera.ini'
        self.gap = self.car / 'jci/scripts/stage_gap2.sh'
        self.app = self.car / 'jci/gui/apps/ndgauges'
        self.js = self.car / 'jci/opera/opera_dir/userjs-ndgauges'
        for path, data in ((self.opera, OPERA), (self.gap, GAP),
                           (self.car / '.nd-gauges-test-root', b'synthetic\n')):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        (self.car / 'jci/gui/apps').mkdir(parents=True)
        (self.car / 'jci/opera/opera_dir').mkdir(parents=True)
        # Patch constants only in this test's disposable script, never via production env overrides.
        script = self.usb / 'install-gauges.sh'
        text = script.read_text()
        for key, value in (('OPERA_STOCK', OPERA), ('GAP2_STOCK', GAP)):
            start = key + '='
            self.assertIn(start, text)
            line = next(line for line in text.splitlines() if line.startswith(start))
            text = text.replace(line, start + hashlib.sha256(value).hexdigest())
        script.write_text(text)

    def run_install(self, fail='', crash=''):
        return subprocess.run([
            'docker', 'run', '--rm', '-v', f'{self.work}:/w',
            '-e', 'ND_ROOT=/w/car', '-e', f'ND_FAIL_AT={fail}', '-e', f'ND_CRASH_AT={crash}',
            os.environ.get('ND_BUSYBOX_IMAGE', 'busybox:1.25'), 'sh', '-c',
            'sh /w/usb/install-gauges.sh; code=$?; exit $code',
        ], capture_output=True, text=True, timeout=30)

    def snapshot(self):
        return {str(p.relative_to(self.car)): p.read_bytes() for p in self.car.rglob('*') if p.is_file()}

    def test_install_idempotent_and_remove_restores_exact_bytes(self):
        result = self.run_install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(b'User JavaScript=1\nAllow File XMLHttpRequest=1', self.opera.read_bytes())
        self.assertIn(b'userjs-ndgauges', self.opera.read_bytes())
        self.assertTrue((self.app / 'gauges/live.txt').is_symlink())
        self.assertFalse(any(p.suffix.lower() == '.ttf' for p in (self.usb / 'payload').rglob('*')),
                         'Firmware fonts must not be redistributed in the USB payload')
        self.assertIn(b'file:///jci/fonts/Tipperary.ttf', (self.app / 'gauges/gauges.css').read_bytes())
        self.assertEqual(os.readlink(self.app / 'gauges/live.txt'), '/tmp/nd-gauges/live.txt')
        self.assertEqual(self.run_install().returncode, 0)
        (self.usb / 'UNINSTALL').touch()
        result = self.run_install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.opera.read_bytes(), OPERA)
        self.assertEqual(self.gap.read_bytes(), GAP)
        self.assertFalse(self.app.exists())
        self.assertFalse(self.js.exists())
        self.assertFalse((self.car / 'jci/nd-gauges-state').exists())

    def test_unknown_config_changes_nothing(self):
        self.opera.write_bytes(OPERA + b'foreign modification\n')
        before = self.snapshot()
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_miatoff_or_foreign_app_blocks_without_changes(self):
        foreign = self.car / 'jci/gui/apps/miatoff'
        foreign.mkdir()
        before = self.snapshot()
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_tampered_payload_is_rejected_before_writes(self):
        (self.usb / 'payload/app/gauges/gauges.js').write_text('tampered')
        before = self.snapshot()
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_each_publish_failure_rolls_back(self):
        for phase in ('app', 'userjs', 'gap2', 'opera'):
            result = self.run_install(fail=phase)
            self.assertNotEqual(result.returncode, 0, phase)
            self.assertEqual(self.opera.read_bytes(), OPERA, phase)
            self.assertEqual(self.gap.read_bytes(), GAP, phase)
            self.assertFalse(self.app.exists(), phase)
            self.assertFalse(self.js.exists(), phase)

    def test_interrupted_install_can_be_restored_without_dialog(self):
        for phase in ('app', 'userjs', 'gap2', 'opera'):
            self.assertNotEqual(self.run_install(crash=phase).returncode, 0)
            (self.usb / 'ND-GAUGES-RESTORE').touch()
            result = self.run_install()
            self.assertEqual(result.returncode, 0, phase + result.stdout + result.stderr)
            self.assertEqual(self.opera.read_bytes(), OPERA)
            self.assertEqual(self.gap.read_bytes(), GAP)
            self.assertFalse(self.app.exists())
            (self.usb / 'ND-GAUGES-RESTORE').unlink()

    def test_changed_installed_file_is_not_deleted(self):
        self.assertEqual(self.run_install().returncode, 0)
        path = self.app / 'gauges/gauges.js'
        path.write_text('foreign modification')
        (self.usb / 'UNINSTALL').touch()
        before = self.snapshot()
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_unknown_staging_is_never_deleted(self):
        self.assertEqual(self.run_install().returncode, 0)
        unknown = self.app.with_name('ndgauges.new')
        unknown.mkdir()
        (unknown / 'foreign.txt').write_text('preserve me')
        (self.usb / 'UNINSTALL').touch()
        before = self.snapshot()
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_corrupted_backup_is_never_restored(self):
        self.assertEqual(self.run_install().returncode, 0)
        (self.car / 'jci/nd-gauges-state/opera.stock').write_text('corrupt backup')
        (self.usb / 'ND-GAUGES-RESTORE').touch()
        before = self.snapshot()
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_launcher_requires_exactly_one_matching_stick(self):
        marker = self.car / 'tmp/mnt/sda1'
        marker.mkdir(parents=True)
        (marker / 'GAUGES.ID').write_bytes(builder.ID)
        (marker / 'install-gauges.sh').write_text('echo launched > /w/probe\n')
        command = ['docker', 'run', '--rm', '-v', f'{self.work}:/w',
                   '-e', 'ND_ROOT=/w/car', '-e', 'HOME=/root',
                   '-e', 'ND_LAUNCHER=' + builder.launcher_name()[:-3],
                   'busybox:1.25', 'sh', '-c', 'eval "$ND_LAUNCHER"']
        subprocess.run(command, capture_output=True, timeout=30)
        self.assertEqual((self.work / 'probe').read_text(), 'launched\n')
        (self.work / 'probe').unlink()
        duplicate = self.car / 'tmp/mnt/sdb1'
        duplicate.mkdir()
        (duplicate / 'GAUGES.ID').write_bytes(builder.ID)
        (duplicate / 'install-gauges.sh').write_text('echo ambiguous > /w/probe\n')
        subprocess.run(command, capture_output=True, timeout=30)
        self.assertFalse((self.work / 'probe').exists())

    def test_builder_refuses_nonempty_output_and_launcher_is_valid_zip(self):
        with self.assertRaises(ValueError):
            builder.build(self.usb)
        import zipfile
        name = builder.launcher_name()
        self.assertLessEqual(len(name.encode()), 255)
        self.assertTrue(zipfile.is_zipfile(self.usb / name))
        self.assertTrue((self.usb / 'jci-autoupdate').is_file())


if __name__ == '__main__':
    unittest.main()
