#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build a dedicated nd-gauges USB payload; never overwrite a nonempty directory."""
import argparse
import hashlib
import io
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ID = b'nd-gauges v0.2.0\n'


def cksum(data):
    # POSIX CRC-32/CKSUM, adapted from MiatOff tools/stickkit.py.
    crc = 0
    length = len(data)
    suffix = bytearray()
    while length:
        suffix.append(length & 255)
        length >>= 8
    for byte in data + suffix:
        crc ^= byte << 24
        for _ in range(8):
            crc = ((crc << 1) ^ (0x04C11DB7 if crc & 0x80000000 else 0)) & 0xFFFFFFFF
    return (~crc) & 0xFFFFFFFF


def launcher_name():
    return ('$(S=${HOME%root};B=$ND_ROOT;N=0;for D in sda1 sdb1 sdc1 sdd1;do '
            'P=$B${S}tmp${S}mnt${S}$D;M=$P${S}GAUGES.ID;'
            f'[ -f $M ]&&set -- $(cksum $M)&&[ $1 = {cksum(ID)} ]&&[ $2 = {len(ID)} ]&&'
            '{ N=$((N+1));I=$P${S}install-gauges.sh;};done;'
            '[ $N = 1 ]&&[ -f $I ]&&sh $I).up')


def payload():
    files = {}
    for folder, destination in (('app', 'app/gauges'), ('cmu/menu/app', 'app'),
                                ('cmu/menu/userjs', 'userjs')):
        for p in sorted((ROOT / folder).rglob('*')):
            if p.is_file() and not (folder == 'app' and 'fonts' in p.relative_to(ROOT / folder).parts):
                files[f'{destination}/{p.relative_to(ROOT / folder).as_posix()}'] = p.read_bytes()
    for name in ('gauges-daemon.sh', 'gauges-ctl.sh'):
        files['app/collector/' + name] = (ROOT / 'cmu/scripts' / name).read_bytes()
    files['app/collector/miatoff-collector.sh'] = (ROOT / 'vendor/miatoff/miatoff-collector.sh').read_bytes()
    files['app/NOTICE'] = (ROOT / 'NOTICE').read_bytes()
    files['app/LICENSE'] = (ROOT / 'vendor/miatoff/LICENSE').read_bytes()
    return files


def build(target):
    target = Path(target)
    if target.is_symlink() or (target.exists() and any(target.iterdir())):
        raise ValueError('Output must be a new or empty directory; use a dedicated USB stick')
    name = launcher_name()
    if len(name.encode()) > 255 or any(c in name for c in '<>:"/\\|?*'):
        raise ValueError('Launcher filename is not FAT32-safe')
    target.mkdir(parents=True, exist_ok=True)
    files = payload()
    for relative, data in files.items():
        p = target / 'payload' / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    manifest = ''.join(f'{hashlib.sha256(data).hexdigest()}  {relative}\n' for relative, data in sorted(files.items()))
    (target / 'MANIFEST').write_text(manifest, encoding='ascii', newline='\n')
    shutil.copyfile(ROOT / 'cmu/install-gauges.sh', target / 'install-gauges.sh')
    (target / 'GAUGES.ID').write_bytes(ID)
    (target / 'jci-autoupdate').touch()
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for entry in ('main_instructions.ini', 'versions.ini'):
            info = zipfile.ZipInfo(entry, (2026, 6, 18, 17, 37, 52))
            archive.writestr(info, (ROOT / 'vendor/miatoff/launcher' / entry).read_bytes())
    (target / name).write_bytes(output.getvalue())
    # Read back every app payload file before declaring the build successful.
    for relative, data in files.items():
        if (target / 'payload' / relative).read_bytes() != data:
            raise OSError('Payload read-back failed: ' + relative)
    print(f'Built {target}; copy ALL files to a dedicated FAT32/MBR stick.')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/usb')
    args = parser.parse_args()
    try:
        build(args.output)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Cannot build stick: {error}\n')
