// SPDX-License-Identifier: GPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../app/data.js');

test('raw CMU fields use documented conversions, not the old simulator guesses', () => {
  let now = 10000;
  const d = new Data(() => now);
  assert.equal(d.ingest('LiveSeq=1\nVehicleSpeed=12256\nEngineSpeed=1604\nAccelPedalPosition=661\nLongitudinalAccelerometer=4000\nLateralAcceleration=4000\nEngClnt_Te_Actl=129\n'), true);
  assert.equal(d.value.speed_kmh, 122.56);
  assert.equal(d.value.rpm, 3208);
  assert(Math.abs(d.value.throttle_pct - 66.1) < 1e-9);
  assert(Math.abs(d.value.long_g) < 1e-9);
  assert(Math.abs(d.value.lat_g) < 1e-9);
  assert.equal(d.value.coolant_c, 89);
  assert.equal(d.stale(), false);
  now += 2100;
  assert.equal(d.ingest('LiveSeq=1\nEngineSpeed=2000\n'), false);
  assert.equal(d.stale(), true);
  assert.equal(d.ingest('LiveSeq=2\nEngineSpeed=2000\n'), true);
  assert.equal(d.value.rpm, 4000);
  assert.equal(d.stale(), false);
});

test('new dashboard receives intake and fuel keys while unsupported gauges stay unavailable', () => {
  const d = new Data();
  d.ingest('LiveSeq=1\nDR_IntakeAirTemp=71\nFuelGaugePosition=120\n');
  assert.equal(d.value.intake_air_c, 31);
  assert(Math.abs(d.value.fuel_level_pct - 120 * 100 / 181) < 1e-9);
  for (const key of ['oil_c', 'odometer_km', 'trip_km', 'clutch_pct']) assert.equal(d.value[key], null);
});

test('unknown enums and missing/invalid values never invent neutral, reverse, pedal or steering readings', () => {
  const d = new Data();
  assert.equal(d.ingest('LiveSeq=1\nEngineSpeed=400\nGearPosNotification=128\nBrakePedalDepressedStatus=2\nSteWhlComp_An_Est=16000\n'), true);
  assert.equal(d.value.gear, null);
  assert.equal(d.value.brake, null);
  assert.equal(d.value.steer_deg, null);
  assert.equal(d.value.speed_kmh, null);
  assert.equal(d.ingest('LiveSeq=2\nEngineSpeed=garbage\nVehicleSpeed=12oops\n'), false);
  assert.equal(d.ingest('LiveSeq=3\nEngineSpeed=Infinity\n'), false);
  assert.equal(d.ingest('EngineSpeed=400\n'), false);
});
