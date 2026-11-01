#!/bin/sh
# nd-gauges data daemon — bridges JCI dbus vehicle data to JSON for the overlay.
#
# Polls com.jci.vbs.bcm methods (speed/gear/brake) and subscribes to
# com.jci.vbs.vdt signals (rpm/throttle/steering/g) via dbus-monitor,
# writing an atomic JSON snapshot to $GAUGES_OUT every $GAUGES_POLL seconds.
#
# Runs on busybox ash (CMU) and on any POSIX sh for local testing with the
# mock dbus tools in dev/mock-dbus (just put them on PATH).
#
# Config (env):
#   GAUGES_OUT        JSON output path   (default /tmp/nd-gauges/cardata.json)
#   GAUGES_STATE_DIR  scratch dir        (default /tmp/nd-gauges)
#   GAUGES_POLL       poll interval sec  (default 0.2)
#   GAUGES_SPEED_UNIT unit arg for GetCarSpeed (default 0; 0=km/h? calibrate!)
#   GAUGES_SCALE_*    divisors for raw signal scaling (calibrate on-car)
#   GAUGES_COOLANT_MEMBER  com.jci.vbs.vdt signal member for coolant temp.
#                          UNCONFIRMED: coolant temp definitely exists on the
#                          vehicle bus (it drives the stock analog gauge) but
#                          the member name isn't in the public dbus docs we
#                          checked (com.jci.vbs.vdt, com.jci.vbs.eem). This
#                          default is a plausible guess following this
#                          interface's own "Signal_Unit_Qualifier" naming
#                          convention (compare EngAout_N_Actl, ApedPos_Pc_ActlArb)
#                          — confirm the real name with dbus-monitor on the car
#                          (see README → Plan B / Calibration) before trusting it.
#                          Set empty to disable coolant polling entirely.
#   GAUGES_SCALE_COOLANT   divisor for the raw coolant value (GUESS, calibrate)
#   GAUGES_COOLANT_OFFSET  added AFTER scaling, e.g. for a Kelvin→Celsius raw
#                          encoding (GUESS, calibrate)
#   GAUGES_OIL_MEMBER      com.jci.vbs.vdt signal member for oil temp. Empty
#                          by default and NOT guessed: SkyActiv engines have no
#                          physical oil temperature sensor (community OBD-II
#                          research confirms "oil temp" PIDs on these engines
#                          are ECU-calculated estimates, not sensor readings),
#                          so there's no principled signal name to guess at,
#                          and no confirmation such an estimate is even mirrored
#                          onto this bus. Leave unset unless you find a real
#                          member via dbus-monitor; the overlay just shows
#                          "--" for oil temp when this is empty.

set -u

GAUGES_OUT="${GAUGES_OUT:-/tmp/nd-gauges/cardata.json}"
GAUGES_STATE_DIR="${GAUGES_STATE_DIR:-/tmp/nd-gauges}"
GAUGES_POLL="${GAUGES_POLL:-0.2}"
GAUGES_SPEED_UNIT="${GAUGES_SPEED_UNIT:-0}"
DBUS_ADDR="unix:path=${DBUS_SERVICE_SOCKET:-/tmp/dbus_service_socket}"

# Raw -> engineering unit divisors (GUESSES — calibrate, see README)
GAUGES_SCALE_THROTTLE="${GAUGES_SCALE_THROTTLE:-10}"    # 0.1 %  -> %
GAUGES_SCALE_STEER="${GAUGES_SCALE_STEER:-10}"          # 0.1 deg -> deg
GAUGES_SCALE_G="${GAUGES_SCALE_G:-1000}"                # 0.001 g -> g

# Coolant/oil temp: see Config comment above. Coolant member name is an
# UNCONFIRMED guess; oil is off by default (no known sensor on this engine).
GAUGES_COOLANT_MEMBER="${GAUGES_COOLANT_MEMBER:-EngClnt_Te_Actl}"
GAUGES_SCALE_COOLANT="${GAUGES_SCALE_COOLANT:-1}"
GAUGES_COOLANT_OFFSET="${GAUGES_COOLANT_OFFSET:-0}"
GAUGES_OIL_MEMBER="${GAUGES_OIL_MEMBER:-}"
GAUGES_SCALE_OIL="${GAUGES_SCALE_OIL:-1}"
GAUGES_OIL_OFFSET="${GAUGES_OIL_OFFSET:-0}"

PIDFILE="$GAUGES_STATE_DIR/daemon.pid"
MONPID=0

mkdir -p "$GAUGES_STATE_DIR"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
	echo "nd-gauges: already running (pid $(cat "$PIDFILE"))" >&2
	exit 1
fi
echo $$ > "$PIDFILE"

cleanup() {
	[ "$MONPID" != 0 ] && kill "$MONPID" 2>/dev/null
	rm -f "$PIDFILE"
	exit 0
}
trap cleanup INT TERM HUP

# ---------------------------------------------------------------------------
# Signal collector: dbus-monitor -> per-signal raw value files in $STATE_DIR
# ---------------------------------------------------------------------------
dbus-monitor --address="$DBUS_ADDR" "type='signal',interface='com.jci.vbs.vdt'" 2>/dev/null |
awk -v dir="$GAUGES_STATE_DIR" -v coolant_member="$GAUGES_COOLANT_MEMBER" -v oil_member="$GAUGES_OIL_MEMBER" '
	/member=EngAout_N_Actl/        { want="rpm_raw";     next }
	/member=ApedPos_Pc_ActlArb/    { want="thr_raw";     next }
	/member=SteWhlComp_An_Est/     { want="steer_raw";   next }
	/member=Lateral_Acceleration/  { want="lat_raw";     next }
	/member=VehLong_A_Actl/        { want="long_raw";    next }
	coolant_member != "" && $0 ~ ("member=" coolant_member) { want="coolant_raw"; next }
	oil_member != "" && $0 ~ ("member=" oil_member)         { want="oil_raw";     next }
	want != "" && $1 ~ /^(int16|uint16|int32|uint32|byte|double)$/ {
		out = dir "/" want
		print $2 > out
		close(out)
		want=""
	}
' &
MONPID=$!

# ---------------------------------------------------------------------------
# Method call helper: prints the last typed value of a dbus-send reply
# ---------------------------------------------------------------------------
dbus_call() { # iface method [args...]
	iface="$1"; method="$2"; shift 2
	dbus-send --print-reply --address="$DBUS_ADDR" --type=method_call \
		--dest="$iface" "/$(echo "$iface" | tr . /)" "$iface.$method" "$@" 2>/dev/null |
	awk '$1=="boolean"{v=($2=="true")?1:0}
	     $1 ~ /^(byte|uint32|uint16|int16|int32|double)$/ {v=$2}
	     END{if (v=="") print "null"; else print v}'
}

read_raw() { # name -> raw value or null
	f="$GAUGES_STATE_DIR/$1"
	if [ -f "$f" ]; then
		v=$(cat "$f" 2>/dev/null)
		case "$v" in ''|*[!0-9.-]*) echo null ;; *) echo "$v" ;; esac
	else
		echo null
	fi
}

scale() { # raw divisor -> scaled or null (awk for floats)
	if [ "$1" = null ]; then echo null; else
		awk "BEGIN{printf \"%.3f\", $1/$2}"
	fi
}

scale_offset() { # raw divisor offset -> scaled+offset or null (awk for floats)
	if [ "$1" = null ]; then echo null; else
		awk "BEGIN{printf \"%.1f\", ($1/$2)+$3}"
	fi
}

json_field() { # key value(ornull)
	if [ "$2" = null ]; then printf '"%s":null' "$1"; else printf '"%s":%s' "$1" "$2"; fi
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
TMP_OUT="$GAUGES_OUT.tmp"

while :; do
	speed=$(dbus_call com.jci.vbs.bcm GetCarSpeed "uint32:$GAUGES_SPEED_UNIT")
	gear=$(dbus_call com.jci.vbs.bcm GetGearPos)
	brake=$(dbus_call com.jci.vbs.bcm GetBrkPedalDepressedStatus)

	rpm_raw=$(read_raw rpm_raw)
	thr=$(scale "$(read_raw thr_raw)" "$GAUGES_SCALE_THROTTLE")
	steer=$(scale "$(read_raw steer_raw)" "$GAUGES_SCALE_STEER")
	lat=$(scale "$(read_raw lat_raw)" "$GAUGES_SCALE_G")
	lon=$(scale "$(read_raw long_raw)" "$GAUGES_SCALE_G")
	if [ -n "$GAUGES_COOLANT_MEMBER" ]; then
		coolant=$(scale_offset "$(read_raw coolant_raw)" "$GAUGES_SCALE_COOLANT" "$GAUGES_COOLANT_OFFSET")
	else
		coolant=null
	fi
	if [ -n "$GAUGES_OIL_MEMBER" ]; then
		oil=$(scale_offset "$(read_raw oil_raw)" "$GAUGES_SCALE_OIL" "$GAUGES_OIL_OFFSET")
	else
		oil=null
	fi

	{
		printf '{"ts":%s,' "$(date +%s)"
		json_field speed_kmh "$speed"; printf ','
		json_field gear "$gear"; printf ','
		json_field brake "$brake"; printf ','
		json_field rpm "$rpm_raw"; printf ','
		json_field throttle_pct "$thr"; printf ','
		json_field steer_deg "$steer"; printf ','
		json_field lat_g "$lat"; printf ','
		json_field long_g "$lon"; printf ','
		json_field coolant_c "$coolant"; printf ','
		json_field oil_c "$oil"; printf ','
		# Reserved until live CMU/OBD sources are confirmed on the car.
		json_field intake_air_c null; printf ','
		json_field fuel_level_pct null; printf ','
		json_field odometer_km null; printf ','
		json_field trip_km null; printf ','
		json_field clutch_pct null
		printf '}\n'
	} > "$TMP_OUT" 2>/dev/null && mv "$TMP_OUT" "$GAUGES_OUT" 2>/dev/null

	sleep "$GAUGES_POLL"
done
