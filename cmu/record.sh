#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Narrow read-only recorder inspired by MiatOff dump-stick CALIBRATE.
# No firmware/config copies, remounts, watchdog changes, NVRAM or GPS queries.
set -u
HERE=$(CDPATH='' cd "$(dirname "$0")" && pwd) || exit 1
cd "$HERE" || exit 1
command -v sha256sum >/dev/null 2>&1 || exit 1
sha256sum -c MANIFEST >/dev/null 2>&1 || exit 1
R=${ND_RECORD_TEST_ROOT:-}
MONITOR=/usr/bin/dbus-monitor
SMDB=/jci/bin/smdb-read
BASE=/tmp
DURATION=300
INTERVAL=10
if [ -n "$R" ]; then
    [ -f "$R/.nd-gauges-test-root" ] && [ "$(cat "$R/.nd-gauges-test-root")" = synthetic ] || exit 1
    MONITOR="$R/dbus-monitor"; SMDB="$R/smdb-read"; BASE="$R/tmp"
    DURATION=2; INTERVAL=1
    mkdir -p "$BASE" || exit 1
else
    [ -d /jci/gui ] && [ -S /tmp/dbus_service_socket ] || exit 1
    [ -x /jci/tools/jci-dialog ] || exit 1
    /jci/tools/jci-dialog --confirm --title='Gauges recorder' \
        --text='Read-only vehicle recording for 5 minutes. No installation. Passenger operation only. Start?' || exit 0
fi
[ -x "$MONITOR" ] || exit 1
# Never start another polling loop alongside a recognised running collector.
for f in "$BASE/nd-gauges/collector.pid" "$BASE/miatoff/collector.pid"; do
    [ -f "$f" ] || continue
    p=$(cat "$f")
    case "$p" in ''|*[!0-9]*) exit 1 ;; esac
    if kill -0 "$p" 2>/dev/null; then exit 1; fi
done
LOCK="$BASE/nd-gauges-recorder.lock"
mkdir "$LOCK" 2>/dev/null || exit 1
MON_PID=; FILTER_PID=; SLOW_PID=; PART=; OUT=; CODE=1
cleanup() {
    trap '' INT TERM HUP
    : > "$LOCK/stop"
    [ -z "$MON_PID" ] || kill "$MON_PID" 2>/dev/null || true
    [ -z "$FILTER_PID" ] || wait "$FILTER_PID" 2>/dev/null || true
    # Never signal this loop or its smdb-read child. A blocked read may delay exit.
    [ -z "$SLOW_PID" ] || wait "$SLOW_PID" 2>/dev/null || true
    if [ "$CODE" = 0 ] && [ -n "$PART" ] && [ -s "$PART" ]; then
        mv "$PART" "$OUT/session.jsonl" || CODE=1
    fi
    rm -f "$LOCK/bus" "$LOCK/slow" "$LOCK/slow.tmp" "$LOCK/stop"
    rmdir "$LOCK" 2>/dev/null || true
    status=incomplete
    if [ -n "$OUT" ] && [ -d "$OUT" ]; then
        if [ "$CODE" = 0 ]; then status=complete; else status=incomplete; fi
        printf 'status=%s\n' "$status" >> "$OUT/meta.txt"
    fi
    sync
    if [ -z "$R" ]; then
        /jci/tools/jci-dialog --info --title='Gauges recorder' --no-cancel \
            --text="Recording $status. Keep the output private; remove the stick only after recording ends." >/dev/null 2>&1 &
    fi
    trap - EXIT
    exit "$CODE"
}
trap cleanup EXIT
trap 'CODE=1; exit 1' INT TERM HUP
mkdir -p recordings || exit 1
n=1
while [ "$n" -le 9999 ]; do
    OUT="$HERE/recordings/$(printf '%04d' "$n")"
    if mkdir "$OUT" 2>/dev/null; then break; fi
    n=$((n + 1))
done
[ "$n" -le 9999 ] || exit 1
PART="$OUT/session.jsonl.part"
printf 'format=nd-gauges-jsonl-v1\nrequested_seconds=%s\n' "$DURATION" > "$OUT/meta.txt"
slow_loop() {
    # This asynchronous worker must not inherit the parent session's cleanup trap.
    trap - EXIT INT TERM HUP
    while [ ! -f "$LOCK/stop" ]; do
        if [ -x "$SMDB" ]; then
            "$SMDB" -n vdm_vdt_current_data 2>/dev/null | awk '
                BEGIN { n=split("EngClnt_Te_Actl DR_IntakeAirTemp Out-CarTemperature YawRate BrakePressure FuelGaugePosition DR_Slope",a," "); for(i=1;i<=n;i++) ok[a[i]]=1 }
                ($1 in ok) && index($0, ": ") { v=$0; sub(/^[^:]*: */, "", v); if(v ~ /^[0-9]+$/ && v+0<=65535) print $1 "=" v }
            ' > "$LOCK/slow.tmp"
            mv "$LOCK/slow.tmp" "$LOCK/slow"
        fi
        [ ! -f "$LOCK/stop" ] || break
        sleep "$INTERVAL"
    done
}
slow_loop & SLOW_PID=$!
mkfifo "$LOCK/bus" || exit 1
"$MONITOR" --address unix:path=/tmp/dbus_service_socket \
    "type='signal',interface='com.jci.vbs.vdt'" > "$LOCK/bus" 2>/dev/null & MON_PID=$!
awk '/^signal / { if ((getline u < "/proc/uptime") > 0) { split(u,a," "); print "@" a[1] }; close("/proc/uptime") } { print; fflush() }' \
    < "$LOCK/bus" | awk -v slow="$LOCK/slow" -f record-filter.awk > "$PART" & FILTER_PID=$!
sleep "$DURATION"
# An unexpectedly terminated monitor is an incomplete capture, not a valid session.
kill -0 "$MON_PID" 2>/dev/null || exit 1
kill -0 "$FILTER_PID" 2>/dev/null || exit 1
[ -s "$PART" ] || exit 1
CODE=0
exit 0
