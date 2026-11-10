#!/bin/sh
# Compatibility entry point: validates the actual MiatOff collector under BusyBox.
set -eu
cd "$(dirname "$0")/.."
exec python3 tests/test_collector.py
