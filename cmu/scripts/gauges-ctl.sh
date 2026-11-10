#!/bin/sh
# nd-gauges daemon control (run over SSH on the CMU)
# usage: gauges-ctl.sh start|stop|status
set -u

STATE_DIR="${GAUGES_STATE_DIR:-/tmp/nd-gauges}"
PIDFILE="$STATE_DIR/collector.pid"
DAEMON="$(dirname "$0")/gauges-daemon.sh"
LOG="$STATE_DIR/daemon.log"

is_running() {
	pid=$(cat "$PIDFILE" 2>/dev/null)
	case "$pid" in ''|*[!0-9]*) return 1 ;; esac
	kill -0 "$pid" 2>/dev/null &&
		tr '\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'miatoff-collector'
}

case "${1:-status}" in
start)
	if is_running; then echo "already running (pid $(cat "$PIDFILE"))"; exit 0; fi
	mkdir -p "$STATE_DIR"
	nohup sh "$DAEMON" > "$LOG" 2>&1 &
	sleep 1
	is_running && echo "started (pid $(cat "$PIDFILE"))" || { echo "failed to start, log:"; cat "$LOG"; exit 1; }
	;;
stop)
	if is_running; then kill "$(cat "$PIDFILE")" && echo "stopped"; else echo "not running"; fi
	;;
status)
	if is_running; then
		echo "running (pid $(cat "$PIDFILE"))"
		[ -f "$STATE_DIR/live.txt" ] && cat "$STATE_DIR/live.txt"
	else
		echo "not running"
	fi
	;;
*)
	echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
