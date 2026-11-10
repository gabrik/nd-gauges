#!/bin/sh
# MiatOff collector: live vehicle data for the MiatOff Meters page (docs/13).
#
# Fast (6-10 Hz): listens to the broadcast D-Bus signals of Mazda's vehicle
#   bus service (com.jci.vbs.vdt, com.jci.vbs.bcm) with Mazda's own
#   dbus-monitor. Listening takes no lock and touches no smdb.
# Slow (every SLOW_S seconds): one `smdb-read -n vdm_vdt_current_data` for the
#   values that are not on D-Bus (temperatures, yaw rate, brake pressure,
#   fuel level).
#
# Output: $OUT_DIR/live.txt, one "Field=value" per line with raw values and the
# smdb field names, replaced atomically (write live.txt.tmp, then mv). Fields
# only on D-Bus keep their D-Bus member name. LiveSeq counts the writes, so a
# reader can see when the data stops.
#
# smdb safety: smdb is guarded by one named POSIX semaphore per namespace,
# without recovery. A killed smdb-read can leave it locked, after which the
# unit resets itself (docs/13). So: at most one smdb-read at a time, never a
# timeout, and the collector never signals smdb-read. Stopping the collector
# lets a running smdb-read finish on its own.
#
# Target: BusyBox 1.19 ash/awk on Mazda Connect 74.00.324A. Nothing is written
# outside $OUT_DIR (tmpfs).
#
# SPDX-License-Identifier: GPL-3.0-or-later

OUT_DIR="${MO_OUT_DIR:-/tmp/miatoff}"
BUS="${MO_BUS:-unix:path=/tmp/dbus_service_socket}"
DBUS_MONITOR="${MO_DBUS_MONITOR:-/usr/bin/dbus-monitor}"
SMDB_READ="${MO_SMDB_READ:-/jci/bin/smdb-read}"
SLOW_S="${MO_SLOW_S:-10}"
ONESHOT="${MO_ONESHOT:-0}"              # test hook: one slow sweep, one monitor run
FLUSH_EVERY="${MO_FLUSH_EVERY:-30}"     # also write after this many signals without speed
# Slow fields per smdb namespace: "namespace:field,field,...". One smdb-read
# per namespace per round, one after the other.
SLOW_SOURCES="vdm_vdt_current_data:EngClnt_Te_Actl,DR_IntakeAirTemp,Out-CarTemperature,YawRate,BrakePressure,FuelGaugePosition,DR_Slope vdm:PID_Drv1Dstnc_curr,Drv1AvlFuelE"

LIVE="$OUT_DIR/live.txt"
SLOW="$OUT_DIR/slow.txt"
SLOW_RAW="$OUT_DIR/slow.raw"
PIDFILE="$OUT_DIR/collector.pid"
LOG="$OUT_DIR/collector.log"
SLOW_PID=
PIPE_PID=

log() { printf '%s\n' "[collector $(cut -d' ' -f1 /proc/uptime 2>/dev/null)] $*" >> "$LOG"; }

# One smdb-read per namespace, in the foreground of this loop, never killed.
# Without -e smdb-read prints every entry as "Name (type, size): value".
slow_round() {
    local src ns fields
    [ -x "$SMDB_READ" ] || return 0
    : > "$SLOW.tmp"
    for src in $SLOW_SOURCES; do
        ns=${src%%:*}
        fields=${src#*:}
        "$SMDB_READ" -n "$ns" > "$SLOW_RAW" 2>/dev/null
        awk -v want="$fields" '
            BEGIN { n = split(want, a, ","); for (i = 1; i <= n; i++) w[a[i]] = 1 }
            ($1 in w) && index($0, ": ") { v = $0; sub(/^[^:]*: */, "", v); print $1 "=" v }
        ' "$SLOW_RAW" >> "$SLOW.tmp"
    done
    mv -f "$SLOW.tmp" "$SLOW"
    rm -f "$SLOW_RAW"
}

slow_loop() {
    # Untrapped TERM ends this subshell; a running smdb-read is its child and
    # is not signalled, so it finishes and exits on its own.
    while :; do
        slow_round
        sleep "$SLOW_S"
    done
}

# dbus-monitor text -> live.txt. Values of the last signal of each kind are
# kept; the file is rewritten on every vehicle-speed signal (~10 Hz) or after
# FLUSH_EVERY other signals, with slow.txt appended.
fast_pipeline() {
    "$DBUS_MONITOR" --address "$BUS" \
        "type='signal',interface='com.jci.vbs.vdt'" \
        "type='signal',interface='com.jci.vbs.bcm'" 2>>"$LOG" |
    awk -v out="$LIVE" -v tmp="$LIVE.tmp" -v slow="$SLOW" -v every="$FLUSH_EVERY" '
        function flush(   k, line) {
            seq++
            since = 0
            printf "" > tmp
            for (k in val) printf "%s=%s\n", k, val[k] > tmp
            while ((getline line < slow) > 0) print line > tmp
            close(slow)
            printf "LiveSeq=%d\n", seq > tmp
            close(tmp)
            system("mv -f \"" tmp "\" \"" out "\"")
        }
        BEGIN {
            # D-Bus member -> smdb field name the Meters page knows.
            map["Veh_V_ActlEng"] = "VehicleSpeed"
            map["EngAout_N_Actl"] = "EngineSpeed"
            map["ApedPos_Pc_ActlArb"] = "AccelPedalPosition"
            map["VehLong_A_Actl"] = "LongitudinalAccelerometer"
            map["Lateral_Acceleration"] = "LateralAcceleration"
            map["OdoCount"] = "Odocount"
            ok["com.jci.vbs.vdt"] = 1
            ok["com.jci.vbs.bcm"] = 1
        }
        /^signal / {
            iface = $0; sub(/.*interface=/, "", iface); sub(/;.*/, "", iface)
            member = $0; sub(/.*member=/, "", member)
            name = (member in map) ? map[member] : member
            # Only the two vehicle interfaces; no diagnostics, DTCs, timers or NMEA text.
            if (!(iface in ok) || member ~ /(Diag|DTC|PASCD|GlobalRealTime|Total_Distance)/) name = ""
            n = 0
            since++
            next
        }
        name != "" && $1 ~ /^(byte|boolean|u?int(16|32|64)|double)$/ {
            n++
            if (member == "WheelSpeedNotification") {
                # struct (qqqqqqt): counter, status, four wheels, timestamp; wheel order unknown.
                if (n == 1) val["WheelSpeedSeq"] = $2
                else if (n >= 3 && n <= 6) val["WheelSpeed" (n - 2)] = $2
            } else if (n == 1) {
                val[name] = $2
            } else {
                next
            }
            any = 1
            if ((member == "Veh_V_ActlEng" && n == 1) || since >= every) flush()
        }
        END { if (any) flush() }
    '
}

stop() {
    trap '' TERM INT HUP
    log "stopping"
    [ -z "$PIPE_PID" ] || kill "$PIPE_PID" 2>/dev/null       # awk; dbus-monitor then ends on SIGPIPE
    [ -z "$SLOW_PID" ] || kill "$SLOW_PID" 2>/dev/null       # the loop only, never smdb-read
    rm -f "$PIDFILE" "$LIVE.tmp" "$SLOW.tmp"
    exit 0
}

mkdir -p "$OUT_DIR" || exit 1
old=$(cat "$PIDFILE" 2>/dev/null)
if [ -n "$old" ] && [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null && \
    tr '\000' ' ' < "/proc/$old/cmdline" 2>/dev/null | grep -q 'miatoff-collector'; then
    exit 0      # already running
fi
echo $$ > "$PIDFILE"
renice -n 5 -p $$ >/dev/null 2>&1 || true
log "started (bus $BUS, slow every ${SLOW_S}s)"

if [ "$ONESHOT" = 1 ]; then
    slow_round
    fast_pipeline
    rm -f "$PIDFILE"
    exit 0
fi

trap stop TERM INT HUP
slow_loop &
SLOW_PID=$!
while :; do
    fast_pipeline &
    PIPE_PID=$!
    wait "$PIPE_PID"
    log "dbus-monitor ended; restarting in 2 s"
    sleep 2
done
