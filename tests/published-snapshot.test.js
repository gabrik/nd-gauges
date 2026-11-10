// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Data = require('../app/data.js');

test('decoder matches MiatOff published drive-derived numbers, not an actual recording replay', () => {
    let now = 0;
    const data = new Data(() => now);
    const text = fs.readFileSync(path.join(__dirname, 'fixtures/miatoff-published-snapshot.txt'), 'utf8');
    assert.equal(data.ingest(text), true);
    assert.equal(data.value.speed_kmh, 122.56);
    assert.equal(data.value.rpm, 3208);
    assert(Math.abs(data.value.throttle_pct - 66.1) < 1e-9);
    assert.equal(data.value.coolant_c, 89);
    assert.equal(data.value.intake_air_c, 18);
    assert.equal(data.value.outside_c, 13);
    assert(Math.abs(data.value.long_g - (-0.06 / 9.80665)) < 1e-9);
    assert(Math.abs(data.value.lat_g - (0.23 / 9.80665)) < 1e-9);
    // Current upstream software convention; not a calibrated fuel volume.
    assert(Math.abs(data.value.fuel_level_pct - (18000 / 181)) < 1e-9);
    for (const key of ['gear', 'brake', 'steer_deg']) assert.equal(data.value[key], null);
    now = 2100;
    assert.equal(data.ingest(text), false);
    assert.equal(data.stale(), true, 'a lone published sample cannot stand in for a live recording');
});
