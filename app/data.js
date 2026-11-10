/* SPDX-License-Identifier: GPL-3.0-or-later
 * Raw conversions adapted from MiatOff meters/js/data.js at 5d972dbe3929d39878f0c53353fed35df535d369.
 * ES5 for Opera Presto. No guesses for undocumented byte enums or steering.
 */
(function (root) {
    'use strict';
    var G = 9.80665;
    var FIELDS = {
        VehicleSpeed: ['speed_kmh', 0.01, 0],
        EngineSpeed: ['rpm', 2, 0],
        AccelPedalPosition: ['throttle_pct', 0.1, 0],
        LongitudinalAccelerometer: ['long_g', 0.01 / G, -40 / G],
        // MiatOff's provisional convention: positive lateral G is a right turn.
        LateralAcceleration: ['lat_g', -0.01 / G, 40 / G],
        EngClnt_Te_Actl: ['coolant_c', 1, -40],
        DR_IntakeAirTemp: ['intake_air_c', 1, -40],
        'Out-CarTemperature': ['outside_c', 1, -40],
        FuelGaugePosition: ['fuel_level_pct', 100 / 181, 0],
        PID_Drv1Dstnc_curr: ['trip', 1, 0],
        Drv1AvlFuelE: ['consumption', 1, 0]
    };
    function Data(clock) {
        this.clock = clock || function () { return new Date().getTime(); };
        this.value = {};
        this.sequence = null;
        this.updated = null;
    }
    Data.prototype.ingest = function (text) {
        var lines = String(text).split(/\r?\n/), raw = {}, i, m, n, rule, any = false;
        var next = {gear: null, brake: null, steer_deg: null, oil_c: null,
            odometer_km: null, trip_km: null, clutch_pct: null};
        for (i = 0; i < lines.length; i++) {
            m = /^([A-Za-z][A-Za-z0-9_-]*)=(-?(?:\d+(?:\.\d*)?|\.\d+))$/.exec(lines[i]);
            if (m && isFinite(Number(m[2]))) { raw[m[1]] = Number(m[2]); }
        }
        n = raw.LiveSeq;
        if (!(n >= 1) || Math.floor(n) !== n || n === this.sequence) { return false; }
        for (i in FIELDS) {
            if (!FIELDS.hasOwnProperty(i)) { continue; }
            rule = FIELDS[i];
            next[rule[0]] = null;
            if (raw.hasOwnProperty(i)) {
                next[rule[0]] = raw[i] * rule[1] + rule[2];
                any = true;
            }
        }
        if (!any) { return false; }
        this.value = next;
        this.sequence = n;
        this.updated = this.clock();
        return true;
    };
    Data.prototype.stale = function () {
        return this.updated === null || this.clock() - this.updated > 2000;
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = Data; }
    else { root.NDGaugesData = Data; }
}(this));
