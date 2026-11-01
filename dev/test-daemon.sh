#!/bin/sh
# Integration test: run the UNMODIFIED CMU daemon against mock dbus tools
# fed by the drive simulator, then validate the JSON it produces.
set -u
cd "$(dirname "$0")/.."

mkdir -p dev/out dev/state
export GAUGES_STATE_DIR="$PWD/dev/state"
export GAUGES_OUT="$PWD/dev/out/cardata.json"
export GAUGES_POLL=0.2
export GAUGES_SIM_STATE="$PWD/dev/state.json"
export PATH="$PWD/dev/mock-dbus:$PATH"

SIM_PID=""; DAEMON_PID=""
cleanup() {
	[ -n "$SIM_PID" ] && kill "$SIM_PID" 2>/dev/null
	[ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null
	rm -f "$GAUGES_STATE_DIR/daemon.pid"
}
trap cleanup EXIT INT TERM

echo "starting simulator..."
python3 dev/simulator.py & SIM_PID=$!
sleep 0.5

echo "starting gauges-daemon (with mock dbus on PATH)..."
sh cmu/scripts/gauges-daemon.sh & DAEMON_PID=$!

echo "collecting 8s of data..."
sleep 8

echo "--- cardata.json ---"
cat "$GAUGES_OUT"
echo "--- validate ---"
python3 - "$GAUGES_OUT" <<'PYEOF'
import json, sys, time
d = json.load(open(sys.argv[1]))
keys = ["ts", "speed_kmh", "gear", "brake", "rpm", "throttle_pct",
        "steer_deg", "lat_g", "long_g", "coolant_c", "oil_c",
        "intake_air_c", "fuel_level_pct"]
missing = [k for k in keys if k not in d]
assert not missing, "missing keys: %s" % missing
assert time.time() - d["ts"] < 5, "stale ts"
print("OK: all keys present, ts fresh")
print(json.dumps(d, indent=1))
PYEOF
echo "--- samples over 3s (values should change) ---"
for i in 1 2 3; do cat "$GAUGES_OUT"; echo; sleep 1; done
echo "PASS"
