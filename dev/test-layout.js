/* Dependency-free rendering smoke test: exercise the overlay via DOM and XHR. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const calls = [];
const elements = [];
const timers = {};
const context = new Proxy({
    measureText(value) {
        return {width: value.length * 11, actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: value.length * 11, actualBoundingBoxAscent: 16,
            actualBoundingBoxDescent: 0};
    }
}, {
    get(target, key) {
        if (key in target) return target[key];
        return (...args) => {
            for (const value of args) {
                if (typeof value === 'number') assert.ok(Number.isFinite(value), key + ': finite coordinates');
            }
            calls.push({method: key, args, fill: target.fillStyle, font: target.font});
        };
    }
});
function element() {
    const node = {style: {}, children: [], appendChild(child) { this.children.push(child); },
        getContext: () => context};
    elements.push(node);
    return node;
}
let data = {};
let now = 1000;
class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
}
const sandbox = {
    Date: TestDate,
    window: {GAUGES_DEV: true, innerWidth: 800, innerHeight: 480},
    document: {
        body: element(),
        createElement: element,
        createTextNode: value => value,
        getElementsByTagName: () => [element()],
        getElementById: id => elements.find(node => node.id === id)
    },
    Path2D: class {},
    XMLHttpRequest: class {
        open() {}
        send() {
            this.status = 200;
            this.readyState = 4;
            this.responseText = JSON.stringify(data);
            this.onreadystatechange();
        }
    },
    setInterval(fn) { timers[fn.name] = fn; return fn.name; },
    clearInterval() {}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/gauges.js'), 'utf8'), sandbox);
sandbox.document.getElementById('ndg-launcher').onclick();
assert.equal(sandbox.document.getElementById('ndg-canvas').height, 416);

function render(sample) {
    data = sample;
    timers.poll();
    calls.length = 0;
    timers.tick();
    return calls.filter(call => call.method === 'fillText').map(call => call.args[0]);
}
function barAt(x, fill) {
    return calls.find(call => call.method === 'fillRect' && call.args[0] === x && call.fill === fill);
}
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'layout-sample.json'), 'utf8'));
let texts = render(sample);
for (const value of ['120', 'km/h', 'ODO', 'TRIP', '42816 km', '126.4 km',
    '4', '91°', '105°', '34°', '62%', 'Clutch', 'Thr', 'Brake']) {
    assert.ok(texts.includes(value), 'visible reading: ' + value);
}
assert.equal(calls.find(call => call.method === 'fillText' && call.args[0] === '120').fill, '#fff',
    'speed is white');
assert.ok(calls.find(call => call.method === 'fillText' && call.args[0] === 'km/h').font.includes('22px'),
    'speed unit uses the smaller size');
assert.equal(calls.filter(call => call.method === 'arc' && call.args[2] === 48).length, 1,
    'G-meter uses a compact 96px circle');
assert.ok(texts.includes('0.32 g'), 'G-meter retains live magnitude');
assert.ok(texts.includes('0.30') && texts.includes('0.10'), 'G-meter shows live directional components');
const gDirectional = calls.filter(call => call.method === 'fillText' && call.font.includes('10px'));
assert.equal(gDirectional.length, 4, 'G-meter has four directional readings');
assert.equal(barAt(479, '#ff2801').args[3], 0, 'released brake is empty');
assert.equal(barAt(529, '#078400').args[3], 156 * 0.45);
assert.equal(barAt(429, '#3a82ff').args[3], 156 * 0.35, 'clutch fill follows sample');
for (const [x, color] of [[429, '#3a82ff'], [479, '#ff2801'], [529, '#078400']]) {
    assert.equal(barAt(x, color).args[2], 22, 'pedal bars use the thinner width');
}
const gaugeArcs = calls.filter(call => call.method === 'arc' && call.args[2] === 640);
assert.equal(gaugeArcs.length, 16, 'four circular track segments per gauge');
assert.equal(new Set(gaugeArcs.map(call => call.args.slice(0, 2).join(','))).size, 4);
for (const {args} of gaugeArcs) {
    assert.ok(Math.abs(args[4] - args[3]) <= 30 * Math.PI / 180 + 1e-10, 'short circular sweep');
}
assert.equal(calls.filter(call => call.method === 'arc' && call.args[2] === 610).length, 4,
    'inner tracks are concentric circles with a fixed radial inset');
const scaleLabels = calls.filter(call => call.method === 'fillText' &&
    /^(50|100|130|-20|20|60|0)$/.test(call.args[0]) &&
    (call.args[2] < 82 || call.args[2] > 319));
assert.equal(scaleLabels.length, 12);
for (const label of scaleLabels) {
    const onScale = gaugeArcs.some(arc => Math.abs(Math.hypot(
        label.args[1] - arc.args[0], label.args[2] - arc.args[1]) - 625) < 1e-6);
    assert.ok(onScale, label.args[0] + ': centered between radii 610 and 640');
}
// Center the combined icon/value ink bounds on each arc, clear of its inner line.
const innerArcs = calls.filter(call => call.method === 'arc' && call.args[2] === 610);
for (const reading of ['91°', '34°', '105°', '62%']) {
    const value = calls.find(call => call.method === 'fillText' && call.args[0] === reading);
    const inner = innerArcs.filter(call => (call.args[1] > 0) === (value.args[2] < 200))
        .sort((a, b) => Math.abs(a.args[0] - value.args[1]) - Math.abs(b.args[0] - value.args[1]))[0];
    const rowLeft = value.args[1] - 22.4 - 10;
    const rowRight = value.args[1] + reading.length * 11;
    assert.ok(Math.abs((rowLeft + rowRight) / 2 - inner.args[0]) < 1e-6,
        reading + ': combined icon/value row centered on arc');
    const top = inner.args[1] > 0;
    const apex = inner.args[1] + (top ? -610 : 610);
    const clearance = top ? value.args[2] - 16 - apex : apex - value.args[2];
    assert.ok(clearance >= 6, reading + ': value line clear of inner arc');
}
const segments = calls.filter(call => call.method === 'fillRect' && call.args[1] === 92);
assert.ok(!calls.some(call => call.method === 'fillRect' && call.fill === '#14191f'),
    'RPM strip has no background panel');
assert.equal(segments.length, 18);
assert.equal(segments.filter(call => call.fill !== '#242a31').length, 8, 'RPM drives the strip');

texts = render({...sample, brake: 1, throttle_pct: 200, clutch_pct: 200, fuel_level_pct: 150, coolant_c: -100});
assert.equal(barAt(479, '#ff2801').args[3], 156, 'pressed brake is binary full');
assert.equal(barAt(529, '#078400').args[3], 156, 'throttle is clamped');
assert.equal(barAt(429, '#3a82ff').args[3], 156, 'clutch is clamped');
assert.ok(texts.includes('100%'));
assert.ok(texts.includes('25°'));

texts = render({});
assert.ok(texts.includes('RPM --'));
assert.ok(texts.includes('Thr --'));
assert.ok(texts.includes('Clutch --'));
assert.equal(barAt(429, '#3a82ff').args[3], 0, 'unavailable clutch is unlit');
assert.ok(texts.includes('Brake --'));
assert.ok(texts.includes('G-FORCE'));
assert.ok(!texts.includes('0.00 g'), 'unavailable acceleration is not zero');
assert.equal(calls.filter(call => call.method === 'fillText' && call.font.includes('10px') &&
    call.args[0] === '--').length, 4, 'unavailable directional readings are not fabricated');
assert.ok(!texts.includes('0%'), 'unavailable fuel is not fabricated');
assert.equal(calls.filter(call => call.method === 'fillText' && call.args[1] === 258 &&
    call.args[0] === '--').length, 2, 'both unwired distances are unavailable');
assert.equal(barAt(529, '#078400').args[3], 0);
for (const clutch_pct of [0, -10, null, '50', NaN, Infinity]) {
    render({...sample, clutch_pct});
    assert.equal(barAt(429, '#3a82ff').args[3], 0, 'zero/negative/invalid clutch stays unlit');
}
for (const distance of [0, null, -1, Infinity, '123']) {
    const distanceTexts = render({...sample, odometer_km: distance, trip_km: distance});
    if (distance === 0) {
        assert.ok(distanceTexts.includes('0 km'));
        assert.ok(distanceTexts.includes('0.0 km'));
    } else {
        assert.equal(calls.filter(call => call.method === 'fillText' && call.args[1] === 258 &&
            call.args[0] === '--').length, 2, 'invalid distance is not fabricated');
    }
}
render({...sample, fuel_level_pct: 0, coolant_c: 145, intake_air_c: -40});
render({...sample, fuel_level_pct: 100, oil_c: 145, intake_air_c: 80, rpm: 9000});
assert.equal(calls.filter(call => call.method === 'fillRect' && call.args[1] === 92 && call.fill === '#ff2801').length, 18);
texts = render({...sample, lat_g: 3, long_g: 4});
assert.ok(texts.includes('5.00 g'), 'G magnitude is not clamped with the dot');
const gDot = calls.find(call => call.method === 'arc' && call.args[2] === 4 && call.args[0] > 600);
assert.ok(Math.abs(Math.hypot(gDot.args[0] - 685.5, gDot.args[1] - 214) - 44) < 1e-6,
    'G dot stays inside the circle at high acceleration');
function rpmSegments() {
    return calls.filter(call => call.method === 'fillRect' && call.args[1] === 92);
}
function gearColor() {
    return calls.find(call => call.method === 'fillText' && call.args[0] === '4').fill;
}
for (const [rpm, color] of [[0, '#fff'], [5999, '#fff'], [6000, '#FFB320'],
    [6500, '#FFB320'], [7000, '#FFB320'], [7001, '#ff2801'],
    [7200, '#ff2801'], [7299, '#ff2801']]) {
    now = 1350; // even in the off phase, values below 7300 must stay steady
    render({...sample, rpm});
    const lit = rpmSegments().filter(call => call.fill !== '#242a31');
    assert.equal(lit.length, Math.ceil(rpm / 8000 * 18));
    assert.ok(lit.every(call => call.fill === color), rpm + ': correct steady color');
    assert.equal(gearColor(), '#fff', rpm + ': gear white below shift threshold');
}
for (const rpm of [7300, 7500, 8000, 9000]) {
    now = 1100;
    render({...sample, rpm});
    const lit = rpmSegments().filter(call => call.fill === '#ff2801');
    assert.equal(lit.length, Math.ceil(Math.min(rpm, 8000) / 8000 * 18));
    assert.equal(gearColor(), '#ff2801', rpm + ': gear red during flash on');
    now = 1350;
    render({...sample, rpm});
    assert.ok(rpmSegments().every(call => call.fill === '#242a31'), rpm + ': flash off');
    assert.equal(gearColor(), '#ff2801', rpm + ': gear stays red during flash off');
}
for (const rpm of [undefined, null, NaN, Infinity, -100]) {
    render({...sample, rpm});
    assert.ok(rpmSegments().every(call => call.fill === '#242a31'), 'invalid/negative RPM stays unlit');
    assert.equal(gearColor(), '#fff', 'invalid/negative RPM does not trigger gear warning');
}
context.measureText = value => ({width: value.length * 11});
assert.ok(render(sample).includes('91°'), 'legacy canvas with width-only text metrics');
// Production launches only through the OEM Applications row, never a floating button.
const productionStart = elements.length;
const forwarded = [];
const production = {...sandbox,
    window: {innerWidth: 800, innerHeight: 480},
    document: {...sandbox.document,
        getElementById: id => elements.slice(productionStart).find(node => node.id === id)},
    framework: {
        getCurrentApp: () => 'system',
        getCurrCtxtId: () => 'Applications',
        sendEventToMmui(...args) { forwarded.push(args); }
    }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/gauges.js'), 'utf8'), production);
const productionNode = id => production.document.getElementById(id);
assert.equal(productionNode('ndg-launcher'), undefined, 'no production floating launcher');
assert.equal(productionNode('ndg-title').children.join(''), 'Gauges');
timers.tick();
timers[''](); // framework hook retry
production.framework.sendEventToMmui('system', 'SelectNdGauges');
assert.equal(productionNode('ndg-panel').style.display, 'block', 'OEM row opens Gauges');
assert.equal(forwarded.length, 0, 'Gauges event stays client-side');
productionNode('ndg-panel').onclick();
timers.tick();
assert.equal(productionNode('ndg-panel').style.display, 'none');
production.framework.sendEventToMmui('system', 'SelectAndroidAuto');
assert.deepEqual(forwarded, [['system', 'SelectAndroidAuto']], 'other OEM events unchanged');
console.log('PASS: layout, alignment, missing data, pedal behavior, RPM cues and OEM-only Gauges launch');
