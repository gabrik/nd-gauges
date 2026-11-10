# SPDX-License-Identifier: GPL-3.0-or-later
"""Replay only explicitly supplied, sanitized raw-field snapshots. Never auto-discover dumps."""
from bisect import bisect_right
import json
import math
from pathlib import Path
from drive import FAST, SLOW, TRIP, encode


class Recording:
    def __init__(self, path):
        path = Path(path).resolve()
        if any(part.lower() in ('dumps', 'miatoff-dumps') for part in path.parts):
            raise ValueError('Private dump paths are prohibited; supply a separately sanitized recording')
        if path.stat().st_size > 10 * 1024 * 1024:
            raise ValueError('Recording exceeds 10 MiB')
        self.times, self.states = [], []
        state = {}
        allowed = set(FAST) | set(SLOW) | set(TRIP)
        with path.open(encoding='utf-8') as source:
            for line in source:
                row = json.loads(line)
                if not isinstance(row, dict) or set(row) != {'t', 'fields'}:
                    raise ValueError('Each recording row must contain only t and fields')
                t, fields = row['t'], row['fields']
                if type(t) not in (int, float) or not math.isfinite(t) or t < 0:
                    raise ValueError('Recording time must be finite and nonnegative')
                if (self.times and t <= self.times[-1]) or (not self.times and t != 0):
                    raise ValueError('Recording must start at t=0 with strictly increasing times')
                if not isinstance(fields, dict) or not fields or set(fields) - allowed:
                    raise ValueError('Unknown fields prohibited: remove GPS, identifiers and unrelated data')
                if any(type(v) is not int or not 0 <= v <= 65535 for v in fields.values()):
                    raise ValueError('Raw fixture values must be unsigned 16-bit integers')
                state = dict(state, **fields)
                if 'VehicleSpeed' not in state:
                    raise ValueError('First snapshot must include VehicleSpeed to clock collector writes')
                self.times.append(t)
                self.states.append(state)
        if not self.times:
            raise ValueError('Recording is empty')

    def fixture(self, seconds):
        # EOF stops D-Bus traffic so the page becomes stale, rather than inventing a loop.
        if seconds > self.times[-1]:
            return encode({})
        return encode(self.states[max(0, bisect_right(self.times, seconds) - 1)])
