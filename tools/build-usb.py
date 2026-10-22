#!/usr/bin/env python3
"""Build the FAT32 USB payload into dist/usb/.

Generates the $(...).up filename whose shell payload finds the mounted USB
(via GAUGES.ID + cksum) and executes install-gauges.sh. Technique adapted
from Miatafy/TouchTune (GPL-3.0).
"""
import os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist", "usb")

UP_TEMPLATE = (
    "$(S=${{HOME%root}};B=$TT_ROOT;N=0;"
    "for D in sda1 sdb1 sdc1 sdd1;do "
    "P=$B${{S}}tmp${{S}}mnt${{S}}$D;M=$P${{S}}GAUGES.ID;"
    "[ -f $M ]&&set -- $(cksum $M)&&[ $1 = {ck1} ]&&[ $2 = {ck2} ]&&"
    "{{ N=$((N+1));I=$P${{S}}install-gauges.sh; }};done;"
    "[ $N = 1 ]&&[ -f $I ]&&sh $I).up"
)

def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    # marker file (content fixed so cksum is stable)
    id_path = os.path.join(DIST, "GAUGES.ID")
    with open(id_path, "w") as f:
        f.write("nd-gauges v0.1.0\n")

    shutil.copy(os.path.join(ROOT, "cmu", "install-gauges.sh"),
                os.path.join(DIST, "install-gauges.sh"))
    shutil.copytree(os.path.join(ROOT, "app"), os.path.join(DIST, "payload", "app"))
    shutil.copytree(os.path.join(ROOT, "cmu", "scripts"),
                    os.path.join(DIST, "payload", "cmu", "scripts"))
    shutil.copy(os.path.join(ROOT, "README.md"), os.path.join(DIST, "README.TXT"))

    out = subprocess.check_output(["cksum", id_path]).decode().split()
    ck1, ck2 = out[0], out[1]
    up_name = UP_TEMPLATE.format(ck1=ck1, ck2=ck2)
    open(os.path.join(DIST, up_name), "w").close()

    print("built %s" % DIST)
    print("GAUGES.ID cksum: %s %s" % (ck1, ck2))
    print(".up filename: %s" % up_name)
    print()
    print("Copy ALL files (including the $(...).up one) to a FAT32/MBR USB stick.")

if __name__ == "__main__":
    sys.exit(main())
