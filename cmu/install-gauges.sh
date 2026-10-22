#!/bin/sh
# nd-gauges installer — runs ON THE CMU as root via the .up filename injection.
#
# Installs the overlay app + data daemon, starts the daemon immediately, and
# tries to hook daemon autostart into a startup script if one is found.
# Put an empty file named UNINSTALL next to GAUGES.ID on the USB to remove.
#
# Safety pattern (watchdog + rw remount + ro restore) mirrors Miatafy
# TouchTune (GPL-3.0): https://github.com/Miatafy/TouchTune

set -u

REPO_DIR=$(CDPATH='' cd "$(dirname "$0")" && pwd) || exit 1
cd "$REPO_DIR" || exit 1

LOG="$REPO_DIR/nd-gauges.log"
WATCHDOG_VALUE="/sys/class/gpio/Watchdog Disable/value"
GUI_DIR="/jci/gui/gauges"
USERJS="/jci/opera/opera_dir/userjs/ndgauges.js"
SCRIPTS_DIR="/jci/scripts"
STATE_DIR="/tmp/nd-gauges"

log() { printf '%s [nd-gauges] %s\n' "$(date '+%H:%M:%S' 2>/dev/null || echo '?')" "$1" | tee -a "$LOG" >&2; }

popup() { # text
	[ -x /jci/tools/jci-dialog ] || return 0
	killall -q jci-dialog 2>/dev/null || true
	/jci/tools/jci-dialog --info --title="nd-gauges" --text="$1" --no-cancel \
		>/dev/null 2>&1 &
}

watchdog_off() { [ -f "$WATCHDOG_VALUE" ] && printf '1\n' > "$WATCHDOG_VALUE"; }
watchdog_on()  { [ -f "$WATCHDOG_VALUE" ] && printf '0\n' > "$WATCHDOG_VALUE"; }

RW=0
finalize() {
	if [ "$RW" = 1 ]; then
		mount -o ro,remount / 2>/dev/null && log "root remounted read-only" \
			|| log "ERROR: could not remount root read-only"
		watchdog_on
	fi
	sync 2>/dev/null || true
}
trap finalize EXIT HUP INT TERM

go_rw() {
	log "disabling watchdog, remounting root read-write"
	watchdog_off
	mount -o rw,remount / || { log "ERROR: rw remount failed"; exit 1; }
	RW=1
}

# ------------------------------------------------------------------ uninstall
if [ -f "$REPO_DIR/UNINSTALL" ]; then
	popup "Removing nd-gauges..."
	go_rw
	rm -f "$USERJS"
	rm -rf "$GUI_DIR"
	rm -f "$SCRIPTS_DIR/gauges-daemon.sh" "$SCRIPTS_DIR/gauges-ctl.sh"
	# remove guarded autostart lines
	for f in /etc/rc.d/rc.local /jci/scripts/autorun.sh; do
		[ -f "$f" ] && sed -i '/# nd-gauges autostart/,+1d' "$f" 2>/dev/null
	done
	log "uninstalled"
	popup "nd-gauges removed. Remove the USB stick."
	exit 0
fi

# --------------------------------------------------------------------- checks
[ -d /jci/gui ] || { log "ERROR: /jci/gui not found — not a Mazda CMU?"; exit 1; }
[ -d payload ] || { log "ERROR: payload/ missing on USB"; exit 1; }

# Firmware check (informational): 74.00.324/324A expected.
FW=$(grep -rsoh '74\.00\.[0-9A-Za-z]*' /jci/etc /jci/version* 2>/dev/null | head -1)
if [ -n "$FW" ]; then
	log "detected firmware: $FW"
	case "$FW" in
		74.00.324|74.00.324A) : ;;
		*) log "WARNING: firmware '$FW' is not 74.00.324/324A — continuing anyway" ;;
	esac
else
	log "WARNING: could not detect firmware version — continuing anyway"
fi

popup "Installing nd-gauges..."

# -------------------------------------------------------------------- install
go_rw

mkdir -p "$GUI_DIR" "$SCRIPTS_DIR"
cp payload/app/gauges.css "$GUI_DIR/gauges.css" || { log "ERROR: css copy failed"; exit 1; }
cp payload/app/gauges.js "$USERJS" || { log "ERROR: userjs copy failed"; exit 1; }
cp payload/cmu/scripts/gauges-daemon.sh "$SCRIPTS_DIR/gauges-daemon.sh"
cp payload/cmu/scripts/gauges-ctl.sh "$SCRIPTS_DIR/gauges-ctl.sh"
chmod +x "$SCRIPTS_DIR/gauges-daemon.sh" "$SCRIPTS_DIR/gauges-ctl.sh"

# cardata.json lives in tmpfs (no flash wear); symlink into the web root.
mkdir -p "$STATE_DIR"
ln -sf "$STATE_DIR/cardata.json" "$GUI_DIR/cardata.json"

# Daemon autostart: append a guarded launch line to the first hook that
# exists on this firmware. Verified over SSH after first install.
HOOKED=0
for f in /etc/rc.d/rc.local /jci/scripts/autorun.sh; do
	if [ -f "$f" ] && ! grep -q 'nd-gauges autostart' "$f" 2>/dev/null; then
		{ echo '# nd-gauges autostart';
		  echo "[ -x $SCRIPTS_DIR/gauges-ctl.sh ] && sh $SCRIPTS_DIR/gauges-ctl.sh start &";
		} >> "$f" && { HOOKED=1; log "autostart hook added to $f"; }
	fi
done
[ "$HOOKED" = 0 ] && log "NOTE: no known autostart hook found; daemon started for this boot only (use gauges-ctl.sh start over SSH)"

log "files installed; starting daemon"
sh "$SCRIPTS_DIR/gauges-ctl.sh" start >> "$LOG" 2>&1 \
	&& log "daemon running" || log "WARNING: daemon did not start (check $LOG)"

popup "nd-gauges installed. Open Applications and tap GAUGES. Remove the USB stick."
log "install complete"
exit 0
