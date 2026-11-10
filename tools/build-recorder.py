#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build a separate read-only recording stick, never an installer/full dump."""
import argparse
import hashlib
import importlib.util
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('usb', ROOT / 'tools/build-usb.py')
usb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usb)
ID = b'nd-gauges recorder v1\n'


def build(target):
    target = Path(target)
    if target.is_symlink() or (target.exists() and any(target.iterdir())):
        raise ValueError('Output must be new or empty; use a dedicated FAT32/MBR stick')
    name = usb.launcher_name('ND-RECORD.ID', 'record.sh', ID)
    if len(name.encode()) > 255 or any(c in name for c in '<>:"/\\|?*'):
        raise ValueError('Launcher is not FAT32-safe')
    files = {name: (ROOT / source).read_bytes() for name, source in (
        ('record.sh', 'cmu/record.sh'), ('record-filter.awk', 'cmu/record-filter.awk'),
        ('NOTICE', 'NOTICE'), ('LICENSE', 'vendor/miatoff/LICENSE'))}
    target.mkdir(parents=True, exist_ok=True)
    for relative, data in files.items():
        (target / relative).write_bytes(data)
    (target / 'MANIFEST').write_text(''.join(f'{hashlib.sha256(data).hexdigest()}  {relative}\n'
        for relative, data in sorted(files.items())), encoding='ascii')
    (target / 'ND-RECORD.ID').write_bytes(ID)
    (target / 'jci-autoupdate').touch()
    with zipfile.ZipFile(target / name, 'w') as archive:
        for entry in ('main_instructions.ini', 'versions.ini'):
            archive.writestr(entry, (ROOT / 'vendor/miatoff/launcher' / entry).read_bytes())
    for relative, data in files.items():
        if (target / relative).read_bytes() != data:
            raise OSError('Read-back failed: ' + relative)
    print(f'Built recorder only: {target}. Copy ALL files to a dedicated FAT32/MBR stick.')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/recorder-usb')
    args = parser.parse_args()
    try:
        build(args.output)
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')
