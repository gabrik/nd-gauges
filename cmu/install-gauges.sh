#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Guarded nd-gauges installer, modelled on MiatOff's Meters transaction.
# Known-stock hashes from MiatOff 5d972dbe3929d39878f0c53353fed35df535d369.
# No Common.js edits, unknown-file overwrites, or arbitrary startup hooks.
set -u
OPERA_STOCK=a6db0eb9a67198dd0c55cae34ad7459a42241392421710196acba6313a2a988e
GAP2_STOCK=2ec71fc955d0107a6e90d1ab4e6f00c9438b56d3e621ef018d57c8ef07bfae7f
USB=$(CDPATH='' cd "$(dirname "$0")" && pwd) || exit 1
R=${ND_ROOT:-}
if [ -n "$R" ]; then
    case "$R" in /*) ;; *) echo 'Test root must be absolute' >&2; exit 1 ;; esac
    [ "$R" != / ] && [ "$(cat "$R/.nd-gauges-test-root" 2>/dev/null)" = synthetic ] || exit 1
fi
APP="$R/jci/gui/apps/ndgauges"
JS="$R/jci/opera/opera_dir/userjs-ndgauges"
STATE="$R/jci/nd-gauges-state"
OPERA="$R/jci/opera/opera_home/opera.ini"
GAP="$R/jci/scripts/stage_gap2.sh"
WD='/sys/class/gpio/Watchdog Disable/value'
RW=0
WD_OFF=0
log() { printf '%s\n' "[nd-gauges] $*" | tee -a "$USB/nd-gauges.log" >&2; }
exists() { [ -e "$1" ] || [ -L "$1" ]; }
sha() {
    [ -f "$1" ] && [ ! -L "$1" ] || return 1
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        openssl dgst -sha256 "$1" | awk '{print $NF}'
    fi
}
finish() {
    code=$?
    trap - EXIT
    if [ "$RW" = 1 ] && [ -z "$R" ]; then
        mount -o ro,remount / || { log 'ERROR: root still writable; restart the unit'; code=1; }
    fi
    [ "$WD_OFF" = 0 ] || printf '0\n' > "$WD"
    sync
    exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
rw() {
    [ -n "$R" ] && { RW=1; return 0; }
    if [ -f "$WD" ]; then
        printf '1\n' > "$WD" || return 1
        WD_OFF=1
    fi
    mount -o rw,remount / || return 1
    RW=1
}
render_opera() {
    awk '
        $0 == "User JavaScript=0" {print "User JavaScript=1"; print "Allow File XMLHttpRequest=1"; a++; next}
        $0 == "User JavaScript File=$OPERA_DIR/userjs/" {
            print "User JavaScript File=/jci/opera/opera_dir/userjs-ndgauges/"; b++; next
        }
        $0 == "Allow File XMLHttpRequest=1" {bad=1}
        {print}
        END {if (a != 1 || b != 1 || bad) exit 1}
    ' "$1"
}
render_gap() {
    cat "$1" && printf '\n# nd-gauges: passive MiatOff collector; tmpfs only.\n[ -f /jci/gui/apps/ndgauges/collector/gauges-daemon.sh ] && /bin/sh /jci/gui/apps/ndgauges/collector/gauges-daemon.sh </dev/null >/dev/null 2>&1 &\n'
}
# Validate the manifest before using any of its paths. No traversal or symlinks.
manifest_ok() {
    local base="$1" manifest="$2" sum rel extra n=0
    [ -f "$manifest" ] && [ ! -L "$manifest" ] || return 1
    while read -r sum rel extra; do
        [ -z "$extra" ] && [ "${#sum}" = 64 ] || return 1
        case "$sum" in *[!0-9a-f]*) return 1 ;; esac
        case "$rel" in app/?*|userjs/?*) ;; *) return 1 ;; esac
        case "$rel" in *..*|*//*|*/|*[!a-zA-Z0-9_./-]*) return 1 ;; esac
        if [ -n "$base" ]; then
            [ "$(sha "$base/$rel")" = "$sum" ] || return 1
        fi
        n=$((n + 1))
    done < "$manifest"
    [ "$n" -gt 0 ]
}
area_ok() {
    local dir="$1" area="$2" sum rel extra n=0 links
    exists "$dir" || return 0
    [ -d "$dir" ] && [ ! -L "$dir" ] || return 1
    while read -r sum rel extra; do
        case "$rel" in "$area"/*)
            [ "$(sha "$dir/${rel#*/}")" = "$sum" ] || return 1
            n=$((n + 1)) ;;
        esac
    done < "$STATE/manifest"
    [ "$(find "$dir" -type f | wc -l | tr -d ' ')" = "$n" ] || return 1
    links=$(find "$dir" -type l)
    if [ "$area" = app ]; then
        [ "$links" = "$APP/gauges/live.txt" ] &&
            [ "$(readlink "$APP/gauges/live.txt")" = /tmp/nd-gauges/live.txt ] || return 1
    else
        [ -z "$links" ] || return 1
    fi
}
known_config() {
    local actual
    actual=$(sha "$1") || return 1
    [ "$actual" = "$2" ] || [ "$actual" = "$(sha "$3")" ]
}
# The saved originals must be stock. Patched files must be precisely our
# transformation of those originals, not merely something named "patched".
temp_ok() {
    exists "$1.ndgauges.tmp" || return 0
    local sum
    sum=$(sha "$1.ndgauges.tmp") || return 1
    [ "$sum" = "$(sha "$2")" ] || [ "$sum" = "$(sha "$3")" ]
}
state_ok() {
    ! exists "$APP.new" && ! exists "$JS.new" && ! exists "$STATE.new" || return 1
    [ -d "$STATE" ] && [ ! -L "$STATE" ] &&
        [ -z "$(find "$STATE" -type l)" ] &&
        [ "$(find "$STATE" -type f | wc -l | tr -d ' ')" = 6 ] &&
        [ "$(cat "$STATE/marker" 2>/dev/null)" = nd-gauges-state-v1 ] &&
        [ "$(sha "$STATE/opera.stock")" = "$OPERA_STOCK" ] &&
        [ "$(sha "$STATE/gap2.stock")" = "$GAP2_STOCK" ] &&
        manifest_ok '' "$STATE/manifest" || return 1
    render_opera "$STATE/opera.stock" | cmp - "$STATE/opera.patched" || return 1
    render_gap "$STATE/gap2.stock" | cmp - "$STATE/gap2.patched" || return 1
    temp_ok "$OPERA" "$STATE/opera.stock" "$STATE/opera.patched" &&
        temp_ok "$GAP" "$STATE/gap2.stock" "$STATE/gap2.patched" &&
        known_config "$OPERA" "$OPERA_STOCK" "$STATE/opera.patched" &&
        known_config "$GAP" "$GAP2_STOCK" "$STATE/gap2.patched" &&
        area_ok "$APP" app && area_ok "$JS" userjs
}
prepare_state() {
    mkdir "$STATE.new" || return 1
    printf 'nd-gauges-state-v1\n' > "$STATE.new/marker" &&
        cp "$USB/MANIFEST" "$STATE.new/manifest" &&
        cp -p "$OPERA" "$STATE.new/opera.stock" && cp -p "$GAP" "$STATE.new/gap2.stock" &&
        render_opera "$OPERA" > "$STATE.new/opera.patched" &&
        render_gap "$GAP" > "$STATE.new/gap2.patched" || return 1
    chmod 644 "$STATE.new/opera.patched" && chmod 755 "$STATE.new/gap2.patched" || return 1
    sync
    mv "$STATE.new" "$STATE" && state_ok
}
publish() {
    local src="$1" dst="$2"
    [ ! -L "$dst.ndgauges.tmp" ] || return 1
    cp -p "$src" "$dst.ndgauges.tmp" &&
        [ "$(sha "$dst.ndgauges.tmp")" = "$(sha "$src")" ] || return 1
    sync
    mv -f "$dst.ndgauges.tmp" "$dst" && sync
}
install_area() {
    local dir="$1" area="$2" sum rel extra
    mkdir "$dir.new" || return 1
    while read -r sum rel extra; do
        case "$rel" in "$area"/*)
            mkdir -p "$dir.new/$(dirname "${rel#*/}")" &&
                cp "$USB/payload/$rel" "$dir.new/${rel#*/}" &&
                chmod 644 "$dir.new/${rel#*/}" &&
                [ "$(sha "$dir.new/${rel#*/}")" = "$sum" ] || return 1 ;;
        esac
    done < "$STATE/manifest"
    if [ "$area" = app ]; then
        ln -s /tmp/nd-gauges/live.txt "$dir.new/gauges/live.txt" || return 1
    fi
    find "$dir.new" -type d -exec chmod 755 '{}' ';'
    sync
    mv "$dir.new" "$dir" && area_ok "$dir" "$area"
}
stop_collector() {
    local pid n=0
    pid=$(cat /tmp/nd-gauges/collector.pid 2>/dev/null)
    case "$pid" in ''|*[!0-9]*) return 0 ;; esac
    [ -z "$R" ] || return 0
    kill -0 "$pid" 2>/dev/null || return 0
    tr '\000' ' ' < "/proc/$pid/cmdline" | grep -Fq "$APP/collector/miatoff-collector.sh" || return 1
    kill -TERM "$pid" || return 1
    while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 10 ]; do sleep 1; n=$((n + 1)); done
    ! kill -0 "$pid" 2>/dev/null
}
restore() {
    # Disable the HMI hook before removing its files. Never signal smdb-read.
    publish "$STATE/opera.stock" "$OPERA" && publish "$STATE/gap2.stock" "$GAP" || return 1
    rm -rf "$APP" "$JS" "$APP.new" "$JS.new" || return 1
    sync
    rm -rf "$STATE"
}
checkpoint() {
    # Failure/crash injection exists only inside an explicitly marked synthetic root.
    [ -n "$R" ] || return 0
    [ "${ND_CRASH_AT:-}" != "$1" ] || kill -KILL $$
    [ "${ND_FAIL_AT:-}" != "$1" ]
}
confirm() {
    [ -n "$R" ] && return 0
    [ -x /jci/tools/jci-dialog ] || return 1
    /jci/tools/jci-dialog --confirm --title=nd-gauges --text="$1" --ok-label=CONFIRM --cancel-label=CANCEL
}

# Refuse competing and legacy layouts rather than silently taking them over.
for path in "$R/jci/gui/apps/miatoff" "$R/jci/opera/opera_dir/userjs-miatoff" \
            "$R/jci/gui/gauges" "$R/jci/scripts/gauges-daemon.sh" \
            "$R/jci/opera/opera_dir/userjs/ndgauges.js"; do
    exists "$path" && { log "Conflicting/legacy installation: $path; nothing changed"; exit 1; }
done
[ -d "$R/jci/gui/apps" ] && [ -d "$R/jci/opera/opera_dir" ] || exit 1
REMOVE=0
[ ! -f "$USB/UNINSTALL" ] && [ ! -f "$USB/ND-GAUGES-RESTORE" ] || REMOVE=1
if exists "$STATE"; then
    state_ok || { log 'Unknown installed state; refusing changes'; exit 1; }
    if [ "$REMOVE" = 1 ] || [ ! -d "$APP" ] || [ ! -d "$JS" ] ||
        [ "$(sha "$OPERA")" != "$(sha "$STATE/opera.patched")" ] ||
        [ "$(sha "$GAP")" != "$(sha "$STATE/gap2.patched")" ]; then
        if [ ! -f "$USB/ND-GAUGES-RESTORE" ]; then
            confirm 'Remove/recover nd-gauges and restore the original configuration?' || exit 0
        fi
        stop_collector || { log 'Collector could not stop safely'; exit 1; }
        rw && restore || { log 'Restore failed; keep backups and retry'; exit 1; }
        log 'Restored. Remove stick and restart the unit. Run again to reinstall if desired.'
        exit 0
    fi
    cmp "$USB/MANIFEST" "$STATE/manifest" >/dev/null 2>&1 || {
        log 'Different payload: remove the existing version before installing a new one'; exit 1;
    }
    log 'Already installed; nothing changed'
    exit 0
fi
[ "$(sha "$OPERA")" = "$OPERA_STOCK" ] && [ "$(sha "$GAP")" = "$GAP2_STOCK" ] || {
    log 'Stock configuration hashes differ from analysed 74.00.324A; nothing changed'; exit 1;
}
for path in "$APP" "$JS" "$STATE.new" "$APP.new" "$JS.new" "$OPERA.ndgauges.tmp" "$GAP.ndgauges.tmp"; do
    exists "$path" && { log "Unknown existing path: $path"; exit 1; }
done
[ "$REMOVE" = 0 ] || { log 'Not installed; nothing changed'; exit 0; }
manifest_ok "$USB/payload" "$USB/MANIFEST" || { log 'Damaged or invalid payload'; exit 1; }
[ -z "$(find "$USB/payload" -type l)" ] || { log 'Payload symlinks prohibited'; exit 1; }
confirm 'Install experimental nd-gauges? Restart the unit after removing the stick.' || exit 0
rw && prepare_state || { log 'Cannot prepare verified backups; no configuration edits attempted'; exit 1; }
if ! { install_area "$APP" app && checkpoint app &&
       install_area "$JS" userjs && checkpoint userjs &&
       publish "$STATE/gap2.patched" "$GAP" && checkpoint gap2 &&
       publish "$STATE/opera.patched" "$OPERA" && checkpoint opera; }; then
    log 'Installation failed; rolling back'
    restore || log 'ERROR: rollback incomplete; retain stick/backups and use ND-GAUGES-RESTORE'
    exit 1
fi
log 'Installed. Remove stick and restart the unit. Experimental; not car-validated.'
