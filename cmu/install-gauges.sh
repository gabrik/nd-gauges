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

# Applications-list integration (the only production launcher). The stock
# systemApp.js and its English dictionary are backed up before editing; all
# other installed assets are new files. Both stock files are restored on
# uninstall. See README "Applications-list integration" for why this is
# needed and what the risk tradeoff is.
SYSTEM_APP_JS="/jci/gui/apps/system/js/systemApp.js"
SYSTEM_APP_DICT="/jci/gui/resources/js/system/systemAppDict_en_US.js"
BACKUP_SUFFIX=".nd-gauges-orig"

log() { printf '%s [nd-gauges] %s\n' "$(date '+%H:%M:%S' 2>/dev/null || echo '?')" "$1" | tee -a "$LOG" >&2; }

popup() { # text
	[ -x /jci/tools/jci-dialog ] || return 0
	killall -q jci-dialog 2>/dev/null || true
	/jci/tools/jci-dialog --info --title="Gauges" --text="$1" --no-cancel \
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

# ---------------------------------------------------- Applications-list patch
# Adds one row ('Gauges') to the real Applications list by editing
# systemApp.js's _initApplicationsDataList (plain, uncompiled JS, not a
# compiled .so) and registering the appName in _applicationsCtxtWiseAppNames.
# Selecting the row is intercepted entirely client-side in gauges.js (it
# patches framework.sendEventToMmui to catch mmuiEvent 'SelectNdGauges'), so
# no native/compiled code needs to understand the new row at all.

brace_balance_ok() { # file -> true if "{" count == "}" count (coarse JS sanity check)
	o=$(grep -o '{' "$1" | wc -l)
	c=$(grep -o '}' "$1" | wc -l)
	[ "$o" -eq "$c" ]
}

patch_applications_list() {
	if ! [ -f "$SYSTEM_APP_JS" ] || ! [ -f "$SYSTEM_APP_DICT" ]; then
		log "WARNING: $SYSTEM_APP_JS or dict not found; Gauges cannot be launched until the Applications-list patch succeeds"
		return 1
	fi
	if grep -q "'ndgauges'" "$SYSTEM_APP_JS" 2>/dev/null; then
		# Upgrade the old display name without replacing the original backup.
		[ -f "$SYSTEM_APP_DICT$BACKUP_SUFFIX" ] || cp -a "$SYSTEM_APP_DICT" "$SYSTEM_APP_DICT$BACKUP_SUFFIX" || return 1
		sed -i 's/"NdGauges"[[:space:]]*:[[:space:]]*"nd-gauges"/"NdGauges" : "Gauges"/' "$SYSTEM_APP_DICT" || return 1
		grep -q '"NdGauges"[[:space:]]*:[[:space:]]*"Gauges"' "$SYSTEM_APP_DICT" || return 1
		log "Applications-list entry already present; display name is Gauges"
		return 0
	fi

	[ -f "$SYSTEM_APP_JS$BACKUP_SUFFIX" ] || cp -a "$SYSTEM_APP_JS" "$SYSTEM_APP_JS$BACKUP_SUFFIX"
	[ -f "$SYSTEM_APP_DICT$BACKUP_SUFFIX" ] || cp -a "$SYSTEM_APP_DICT" "$SYSTEM_APP_DICT$BACKUP_SUFFIX"

	_item_file="$STATE_DIR/ndg_app_item.txt"
	_dict_file="$STATE_DIR/ndg_dict_item.txt"
	mkdir -p "$STATE_DIR"
	cat > "$_item_file" << 'EOF'
        { appData : { appName : 'ndgauges', isVisible : true, audioSourceId : 'None', mmuiEvent : 'SelectNdGauges' }, text1Id : 'NdGauges', disabled : false, itemStyle : 'style01', hasCaret : false }
EOF
	cat > "$_dict_file" << 'EOF'
	"NdGauges" : "Gauges",
EOF

	# 1) add our item to _initApplicationsDataList's items array (anchor is the
	#    one line with both SelectAndroidAuto and text1Id:'AndroidAuto', —
	#    unique on firmware 74.00.324/324A, verified against five other
	#    SelectAndroidAuto occurrences used by other data lists in this file)
	sed -i "/mmuiEvent : 'SelectAndroidAuto'.*text1Id : 'AndroidAuto',/{
		s/ }\$/ },/
		r $_item_file
	}" "$SYSTEM_APP_JS"

	# 2) register the appName so _buildApplicationsDataList includes it
	#    (both vehicle-configuration branches of _updateApplicationStructure)
	sed -i 's/"androidauto"\]/"androidauto","ndgauges"]/g' "$SYSTEM_APP_JS"

	# 3) add the display string
	sed -i "/\"APDevice\" :/r $_dict_file" "$SYSTEM_APP_DICT"

	rm -f "$_item_file" "$_dict_file"

	if grep -q "'ndgauges'" "$SYSTEM_APP_JS" && grep -q "'SelectNdGauges'" "$SYSTEM_APP_JS" \
		&& [ "$(grep -c '"ndgauges"\]' "$SYSTEM_APP_JS")" -ge 2 ] \
		&& grep -q 'NdGauges' "$SYSTEM_APP_DICT" \
		&& brace_balance_ok "$SYSTEM_APP_JS" && brace_balance_ok "$SYSTEM_APP_DICT"
	then
		log "Applications-list patch applied (Gauges tile)"
		return 0
	fi

	log "ERROR: Applications-list patch failed validation — restoring originals"
	cp -a "$SYSTEM_APP_JS$BACKUP_SUFFIX" "$SYSTEM_APP_JS"
	cp -a "$SYSTEM_APP_DICT$BACKUP_SUFFIX" "$SYSTEM_APP_DICT"
	return 1
}

restore_applications_list() {
	if [ -f "$SYSTEM_APP_JS$BACKUP_SUFFIX" ]; then
		cp -a "$SYSTEM_APP_JS$BACKUP_SUFFIX" "$SYSTEM_APP_JS" && rm -f "$SYSTEM_APP_JS$BACKUP_SUFFIX"
		log "systemApp.js restored from backup"
	fi
	if [ -f "$SYSTEM_APP_DICT$BACKUP_SUFFIX" ]; then
		cp -a "$SYSTEM_APP_DICT$BACKUP_SUFFIX" "$SYSTEM_APP_DICT" && rm -f "$SYSTEM_APP_DICT$BACKUP_SUFFIX"
		log "systemAppDict restored from backup"
	fi
}

# ------------------------------------------------------------------ uninstall
if [ -f "$REPO_DIR/UNINSTALL" ]; then
	popup "Removing Gauges..."
	go_rw
	restore_applications_list
	rm -f "$USERJS"
	rm -rf "$GUI_DIR"
	rm -f "$SCRIPTS_DIR/gauges-daemon.sh" "$SCRIPTS_DIR/gauges-ctl.sh"
	# remove guarded autostart lines
	for f in /etc/rc.d/rc.local /jci/scripts/autorun.sh; do
		[ -f "$f" ] && sed -i '/# nd-gauges autostart/,+1d' "$f" 2>/dev/null
	done
	log "uninstalled"
	popup "Gauges removed. Remove the USB stick."
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

popup "Installing Gauges..."

# -------------------------------------------------------------------- install
go_rw

mkdir -p "$GUI_DIR" "$GUI_DIR/fonts" "$SCRIPTS_DIR"
cp payload/app/gauges.css "$GUI_DIR/gauges.css" || { log "ERROR: css copy failed"; exit 1; }
cp payload/app/gauges.js "$USERJS" || { log "ERROR: userjs copy failed"; exit 1; }
cp payload/app/fonts/*.ttf "$GUI_DIR/fonts/" || { log "ERROR: font copy failed"; exit 1; }
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

patch_applications_list || {
	log "ERROR: installation incomplete — Applications-list entry unavailable"
	popup "Gauges installation incomplete: Applications entry could not be installed. Check nd-gauges.log."
	exit 1
}

log "files installed; starting daemon"
sh "$SCRIPTS_DIR/gauges-ctl.sh" start >> "$LOG" 2>&1 \
	&& log "daemon running" || log "WARNING: daemon did not start (check $LOG)"

popup "Gauges installed. Open Applications and select Gauges. Remove the USB stick."
log "install complete"
exit 0
