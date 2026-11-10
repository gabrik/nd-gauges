#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Wrapper around the unmodified MiatOff collector. Installed beside it; the
# repository fallback supports local development. All runtime data is in RAM.
set -u
HERE=$(CDPATH='' cd "$(dirname "$0")" && pwd) || exit 1
COLLECTOR="$HERE/miatoff-collector.sh"
[ -f "$COLLECTOR" ] || COLLECTOR="$HERE/../../vendor/miatoff/miatoff-collector.sh"
export MO_OUT_DIR="${GAUGES_STATE_DIR:-/tmp/nd-gauges}"
exec sh "$COLLECTOR"
