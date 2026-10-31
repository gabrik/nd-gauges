// ==UserScript==
// @name        nd-gauges
// @description Custom gauges overlay for Mazda Connect (MX-5 ND)
// @version     0.1.0
// ==/UserScript==
//
// Runs inside the CMU's Opera engine (ES5 only — no let/const/arrow/fetch).
// Polls gauges/cardata.json (produced by gauges-daemon.sh) and draws gauges
// on a fullscreen <canvas> overlay.

(function () {
	'use strict';

	if (window.__ndGaugesLoaded) { return; }
	window.__ndGaugesLoaded = true;

	// ---------------------------------------------------------------- config
	// Colors are the REAL Mazda Connect OEM tokens, pulled directly from the
	// stock firmware CSS (grepped jci/gui/common/css + control CSS for hex
	// values; #ff2801 alone accounts for ~74 occurrences, used everywhere the
	// stock UI highlights/focuses/redlines something — not a guess).
	var COLOR = {
		bg: '#000',
		fg: '#fff',
		dim: '#c8c8c8',     // secondary/disabled text, e.g. greyed-out list rows
		accent: '#ff2801',  // THE stock accent red (focus, redline, highlight)
		warn: '#FFB320',    // stock warning-lamp amber
		good: '#1EFF00'     // stock positive/good-status green
	};

	var DEG = '\u00b0'; // degree sign, used in a few canvas labels below
	var CFG = {
		dataUrl: window.GAUGES_DATA_URL || 'gauges/cardata.json',
		cssUrl: window.GAUGES_CSS_URL || 'gauges/gauges.css',
		pollMs: 200,
		staleMs: 2000,
		maxRpm: 8000,
		redline: 7200,
		maxSpeed: 260,        // km/h, scale for nothing yet (digital display)
		speedUnit: 'km/h',
		// Coolant/oil thresholds in °C. Coolant is a real sensor driving the
		// stock analog gauge; oil is shown IF your daemon provides it, but
		// SkyActiv engines have no physical oil temp sensor — see README
		// Calibration section before trusting this field.
		// The true scale runs 25-145°C so that 50 lands on the 2nd tick and
		// 130 on the penultimate tick (6-tick layout) instead of being the
		// very first/last tick -- gaugeLabelLo/Hi are the values actually
		// PRINTED (50/130, matching the real ND MID), independent of the
		// underlying min/max used for the needle and fill math. cold/hot are
		// separate color-coding thresholds within that scale.
		gaugeMin: 25, gaugeMax: 145, gaugeMid: 100,
		gaugeLabelLo: 50, gaugeLabelHi: 130,
		coolantCold: 60, coolantHot: 110,
		oilCold: 60, oilHot: 120,
		alwaysShow: !!window.GAUGES_DEV   // dev harness: skip framework checks
	};

	var state = {
		launcher: null,
		panel: null,
		canvas: null,
		ctx: null,
		open: false,
		data: null,
		lastOk: 0
	};

	// ------------------------------------------------------------ framework
	function inApplicationsScreen() {
		if (CFG.alwaysShow) { return true; }
		try {
			return typeof framework === 'object' &&
				framework.getCurrentApp() === 'system' &&
				framework.getCurrCtxtId() === 'Applications';
		} catch (e) {
			return false;
		}
	}

	// ---------------------------------------------------------------- DOM
	function injectCss() {
		var l = document.createElement('link');
		l.rel = 'stylesheet';
		l.type = 'text/css';
		l.href = CFG.cssUrl;
		document.getElementsByTagName('head')[0].appendChild(l);
	}

	function buildDom() {
		var launcher = document.createElement('div');
		launcher.id = 'ndg-launcher';
		launcher.appendChild(document.createTextNode('GAUGES'));
		document.body.appendChild(launcher);

		var panel = document.createElement('div');
		panel.id = 'ndg-panel';
		panel.style.display = 'none';

		// Header matches the real stock chrome (back arrow + title, same as
		// Settings/Applications/etc.) so the screen reads as native, not an
		// overlay bolted on top.
		var header = document.createElement('div');
		header.id = 'ndg-header';
		var back = document.createElement('span');
		back.id = 'ndg-back';
		back.appendChild(document.createTextNode('\u2039'));
		var title = document.createElement('span');
		title.id = 'ndg-title';
		title.appendChild(document.createTextNode('nd-gauges'));
		header.appendChild(back);
		header.appendChild(title);
		panel.appendChild(header);

		var canvas = document.createElement('canvas');
		canvas.id = 'ndg-canvas';
		panel.appendChild(canvas);

		var badge = document.createElement('div');
		badge.id = 'ndg-offline';
		badge.appendChild(document.createTextNode('OFFLINE'));
		panel.appendChild(badge);

		document.body.appendChild(panel);

		launcher.onclick = function () { openPanel(); };
		panel.onclick = function () {
			state.open = false;
			panel.style.display = 'none';
		};

		state.launcher = launcher;
		state.panel = panel;
		state.canvas = canvas;
		state.ctx = canvas.getContext('2d');
	}

	function resize() {
		var w = window.innerWidth, h = window.innerHeight - 64; // minus header
		state.canvas.width = w;
		state.canvas.height = h;
	}

	function openPanel() {
		state.open = true;
		state.panel.style.display = 'block';
		state.launcher.style.display = 'none';
		resize();
	}

	// ------------------------------------------------------- Applications tile
	// If install-gauges.sh has patched systemApp.js to add an 'nd-gauges' row
	// to the real Applications list (appName:'ndgauges', mmuiEvent:'SelectNdGauges'),
	// hook it here so selecting that row opens the panel directly instead of
	// going to the native MMUI backend, which has no idea what 'SelectNdGauges'
	// means. framework.sendEventToMmui is looked up fresh on every call by
	// systemApp.js's _menuItemSelectCallback, so patching it works regardless
	// of load order — no race with when systemApp's own listeners got bound.
	// Falls back cleanly (does nothing) if the patch was never applied, e.g. a
	// firmware update overwrote systemApp.js and install-gauges.sh hasn't
	// re-run yet — the Applications-screen launcher button still works then.
	function installMmuiHook() {
		if (typeof framework !== 'object' || typeof framework.sendEventToMmui !== 'function') {
			return false;
		}
		if (framework.sendEventToMmui.__ndGaugesPatched) { return true; }
		var orig = framework.sendEventToMmui;
		var patched = function (uiaId, mmuiEvent) {
			if (mmuiEvent === 'SelectNdGauges') {
				openPanel();
				return;
			}
			return orig.apply(this, arguments);
		};
		patched.__ndGaugesPatched = true;
		framework.sendEventToMmui = patched;
		return true;
	}

	// ---------------------------------------------------------------- poll
	function poll() {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', CFG.dataUrl + '?_=' + new Date().getTime(), true);
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4 && xhr.status === 200) {
				try {
					state.data = JSON.parse(xhr.responseText);
					state.lastOk = new Date().getTime();
				} catch (e) { /* keep last good frame */ }
			}
		};
		try { xhr.send(null); } catch (e) { /* ignore */ }
	}

	// -------------------------------------------------------------- render
	function num(v, digits) {
		if (v === null || v === undefined || isNaN(v)) { return '--'; }
		return digits ? Number(v).toFixed(digits) : String(Math.round(v));
	}

	// Picks a readout color by linear position between a "cold"/normal
	// threshold and a "hot" one — white in range, shading to the stock
	// warning amber then the stock accent red as it climbs past hot.
	function tempColor(v, cold, hot) {
		if (v === null || v === undefined || isNaN(v)) { return COLOR.dim; }
		if (v < cold) { return '#5fb8ff'; } // below normal operating range: cool blue, same idea as a real coolant gauge's cold segment
		if (v < hot) { return COLOR.fg; }
		if (v < hot + 15) { return COLOR.warn; }
		return COLOR.accent;
	}

	// Analog dial matching Kansei Link's actual on-screen gauge product
	// (kanseilink.com, the project's own stated inspiration) and the real
	// stock cluster convention: thick chunky tick marks (not thin hairlines),
	// a red needle (matches both Kansei's choice and our own #ff2801 accent),
	// a hollow ring hub (not a filled dot), and the digital numeral placed
	// low in the dial near the "0" mark rather than dead-center over the
	// pivot -- all verified against Kansei's real product screenshots.
	// Sweep (135deg->405deg, bottom-left to bottom-right through the top,
	// 270deg total) is the standard automotive gauge convention.
	function drawDial(ctx, F, cx, cy, r, opts) {
		var startA = Math.PI * 0.75, endA = Math.PI * 2.25, sweep = endA - startA;
		var max = opts.max, value = Math.max(0, Math.min(max, opts.value || 0));
		var tickStep = opts.tickStep, majorEvery = opts.majorEvery || 1;

		// face
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = '#0a0a0a';
		ctx.fill();

		// redline zone (thick arc segment on the tick ring itself, Kansei-style)
		if (opts.redline != null) {
			var redA = startA + sweep * (opts.redline / max);
			ctx.beginPath();
			ctx.arc(cx, cy, r - 6, redA, endA);
			ctx.strokeStyle = COLOR.warn;
			ctx.lineWidth = 10;
			ctx.stroke();
		}

		// thick chunky ticks (Kansei's ring style), majors longer + numbered
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = '600 ' + Math.round(r * 0.12) + 'px ' + F;
		for (var v = 0; v <= max; v += tickStep) {
			var a = startA + sweep * (v / max);
			var isMajor = Math.round(v / tickStep) % majorEvery === 0;
			var inRed = opts.redline != null && v >= opts.redline;
			var outerR = r - 4, innerR = isMajor ? r - 20 : r - 13;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(a) * innerR, cy + Math.sin(a) * innerR);
			ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR);
			ctx.strokeStyle = inRed ? COLOR.warn : COLOR.fg;
			ctx.lineWidth = isMajor ? 5 : 3;
			ctx.lineCap = 'round';
			ctx.stroke();
			if (isMajor && opts.showNumbers) {
				var numR = r - 38;
				ctx.fillStyle = inRed ? COLOR.warn : COLOR.dim;
				ctx.fillText(String(Math.round(v / (opts.numberDivisor || 1))),
					cx + Math.cos(a) * numR, cy + Math.sin(a) * numR);
			}
		}
		ctx.lineCap = 'butt';

		// needle: red, matching Kansei's own needle color and our OEM accent
		var needleA = startA + sweep * (value / max);
		ctx.strokeStyle = COLOR.accent;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(cx - Math.cos(needleA) * r * 0.14, cy - Math.sin(needleA) * r * 0.14);
		ctx.lineTo(cx + Math.cos(needleA) * (r - 30), cy + Math.sin(needleA) * (r - 30));
		ctx.stroke();

		// hollow ring hub (Kansei-style), not a filled dot
		ctx.beginPath();
		ctx.arc(cx, cy, 9, 0, Math.PI * 2);
		ctx.strokeStyle = COLOR.fg;
		ctx.lineWidth = 2;
		ctx.stroke();

		// digital numeral placed low in the dial, near the "0" tick, same
		// spot Kansei puts its speed readout -- keeps it clear of the needle
		// sweep and the hub, and it's the natural empty space in this layout.
		if (opts.centerText) {
			ctx.font = 'bold ' + Math.round(r * 0.34) + 'px ' + F;
			ctx.fillStyle = opts.centerColor || COLOR.fg;
			ctx.fillText(opts.centerText, cx, cy + r * 0.52);
		}
		if (opts.unitLabel) {
			ctx.font = '600 ' + Math.round(r * 0.11) + 'px ' + F;
			ctx.fillStyle = COLOR.dim;
			ctx.fillText(opts.unitLabel, cx, cy + r * 0.3);
		}
	}

	// Arc gauge matching the REAL ND2 instrument cluster's own MID display,
	// closely: a thin grey track (not three equal color zones), short solid
	// blue/red segments only at the two ENDS, small regular tick marks,
	// STATIC numeric labels at the ends and middle (50/100/150, not a
	// number that follows the needle), and the needle itself is a thicker
	// tick sliding along the track -- not a center-pivot clock hand. An icon
	// (thermometer for coolant, a drop for oil) replaces the text label.
	// `invert` flips it to open upward instead of downward, matching how the
	// real MID's fuel gauge sits at the bottom of its dial (opening up)
	// while the coolant gauge sits at the top (opening down) -- used here so
	// the two stacked arcs visually mirror each other.
	function drawArcGauge(ctx, F, cx, cy, r, value, min, max, mid, labelLo, labelHi, cold, hot, invert, icon) {
		var topStartA = Math.PI * 1.1, topEndA = Math.PI * 1.9;
		var sweep = topEndA - topStartA;
		var baseA = invert ? Math.PI * 0.9 : topStartA;
		var dir = invert ? -1 : 1;
		var ccw = !!invert;

		function angleAt(frac) { return baseA + dir * sweep * frac; }

		// Real gauge reference: tick marks are spaced evenly in ANGLE, but
		// "100" (mid) always sits at dead center even though 50-100 (50 units)
		// and 100-130 (30 units) aren't equal spans -- a deliberate piecewise
		// scale that compresses the rarely-interesting cold side and expands
		// the hot side where resolution actually matters. Map value -> fraction
		// piecewise around mid so this holds for any min/mid/max we're given.
		function valueToFrac(v) {
			if (v <= mid) { return 0.5 * (v - min) / (mid - min); }
			return 0.5 + 0.5 * (v - mid) / (max - mid);
		}

		function arcSeg(f0, f1, color, width) {
			var a0 = angleAt(f0), a1 = angleAt(f1);
			ctx.beginPath();
			ctx.arc(cx, cy, r, a0, a1, ccw);
			ctx.strokeStyle = color;
			ctx.lineWidth = width;
			ctx.lineCap = 'butt';
			ctx.stroke();
		}

		// Needle's fraction along the sweep, computed up front so the track
		// itself can be clipped to it: filled (grey/blue/red) up to the needle,
		// transparent (nothing drawn) past it -- like a fill-level indicator.
		// No value -> show the full track (don't make a missing sensor look
		// like a zero reading).
		var hasValue = value !== null && value !== undefined && !isNaN(value);
		var vClamped = hasValue ? Math.max(min, Math.min(max, value)) : null;
		var needleFrac = hasValue ? valueToFrac(vClamped) : 1;

		// 6 gaps (7 tick points) so one lands exactly at frac 0.5 (the "100"
		// position), one at frac 1/6 ("50"), and one at frac 5/6 ("130").
		var tickCount = 6;
		// Blue/red end caps span exactly one tick-gap each (1st->2nd tick,
		// penultimate->last tick), so they align perfectly with the tick marks
		// instead of an arbitrary fraction.
		var capFrac = 1 / tickCount;
		// Blue/red end caps are the cold/danger zone markers and always stay
		// fully visible regardless of the needle; only the plain grey middle
		// section tracks the needle (filled up to it, transparent past it).
		arcSeg(needleFrac, 1, '#353535', 6);
		arcSeg(0, Math.min(1, needleFrac), '#6a6a6a', 6);
		arcSeg(0, capFrac, '#3a82ff', 6);
		arcSeg(1 - capFrac, 1, COLOR.accent, 6);

		// small regular tick marks along the track. The 1st, middle ("100"),
		// and last ticks are drawn thicker/longer than the rest.
		// Three tiers: 0/3/6 (1st, "100", last) boldest; 1/5 ("50"/"130")
		// medium; the rest plain.
		var boldTicks = { 0: true, 3: true, 6: true };
		var medTicks = { 1: true, 5: true };
		for (var i = 0; i <= tickCount; i++) {
			var tf = i / tickCount;
			var ta = angleAt(tf);
			var bold = !!boldTicks[i];
			var med = !!medTicks[i];
			var tOuter = r + (bold ? 7 : med ? 6 : 5), tInner = r - (bold ? 5 : med ? 4 : 3);
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(ta) * tInner, cy + Math.sin(ta) * tInner);
			ctx.lineTo(cx + Math.cos(ta) * tOuter, cy + Math.sin(ta) * tOuter);
			ctx.strokeStyle = COLOR.dim;
			ctx.lineWidth = bold ? 3 : med ? 2.2 : 1.5;
			ctx.stroke();
		}

		// static scale labels: printed as labelLo / mid / labelHi (50/100/130),
		// positioned via their real value-to-fraction mapping against the
		// wider true min/max -- so they land on the 2nd/penultimate ticks
		// instead of the very first/last one. Fixed positions, independent of
		// the live value (confirmed against the reference: these don't move
		// with the needle).
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = '600 ' + Math.round(r * 0.1) + 'px ' + F;
		ctx.fillStyle = COLOR.dim;
		var labelR = r - 16;
		[labelLo, mid, labelHi].forEach(function (lv) {
			var la = angleAt(valueToFrac(lv));
			ctx.fillText(String(lv), cx + Math.cos(la) * labelR, cy + Math.sin(la) * labelR);
		});

		// needle: a thicker tick sliding along the track itself, not a
		// center-pivot hand -- matches the reference's actual indicator style.
		if (hasValue) {
			var needleA = angleAt(needleFrac);
			var nOuter = r + 7, nInner = r - 9;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(needleA) * nInner, cy + Math.sin(needleA) * nInner);
			ctx.lineTo(cx + Math.cos(needleA) * nOuter, cy + Math.sin(needleA) * nOuter);
			ctx.strokeStyle = COLOR.fg;
			ctx.lineWidth = 3.5;
			ctx.lineCap = 'round';
			ctx.stroke();
			ctx.lineCap = 'butt';
		}

		// small plain inner arc, same shape as the main track but smaller and
		// undecorated -- the reference has exactly this second, thinner arc
		// framing the icon underneath the scale.
		var innerR = r * 0.7;
		ctx.beginPath();
		ctx.arc(cx, cy, innerR, angleAt(0), angleAt(1), ccw);
		ctx.strokeStyle = COLOR.dim;
		ctx.lineWidth = 1;
		ctx.stroke();

		// Value sits closest to the scale/inner arc, icon sits further out --
		// i.e. value above the icon for coolant (top-opening), value below the
		// icon for oil (bottom-opening, mirrored).
		var textSign = invert ? -1 : 1;
		ctx.font = '600 ' + Math.round(r * 0.2) + 'px ' + F;
		ctx.fillStyle = tempColor(value, cold, hot);
		ctx.fillText((value != null ? num(value, 0) + DEG : '--'), cx, cy + textSign * r * -0.50);
		if (icon) { drawVectorIcon(ctx, icon, cx, cy + textSign * r * -0.25, r * 0.20); }
	}

	// Real automotive icons -- Material Design Icons' "coolant-temperature"
	// and "oil-temperature" glyphs (Apache-2.0, pictogrammers.com/library/mdi),
	// the same symbol family used on actual dashboards, not a hand-drawn
	// approximation. Loaded as Path2D (24x24 viewBox) so they stay crisp at
	// any size and recolor with the live temperature's zone color.
	var ICON_PATH = {
		coolant: new Path2D('M11.5,1A1.5,1.5 0 0,0 10,2.5V14.5C9.37,14.97 9,15.71 9,16.5A2.5,2.5 0 0,0 11.5,19A2.5,2.5 0 0,0 14,16.5C14,15.71 13.63,15 13,14.5V13H17V11H13V9H17V7H13V5H17V3H13V2.5A1.5,1.5 0 0,0 11.5,1M0,15V17C0.67,17 0.79,17.21 1.29,17.71C1.79,18.21 2.67,19 4,19C5.33,19 6.21,18.21 6.71,17.71C6.82,17.59 6.91,17.5 7,17.41V15.16C6.21,15.42 5.65,15.93 5.29,16.29C4.79,16.79 4.67,17 4,17C3.33,17 3.21,16.79 2.71,16.29C2.21,15.79 1.33,15 0,15M16,15V17C16.67,17 16.79,17.21 17.29,17.71C17.79,18.21 18.67,19 20,19C21.33,19 22.21,18.21 22.71,17.71C23.21,17.21 23.33,17 24,17V15C22.67,15 21.79,15.79 21.29,16.29C20.79,16.79 20.67,17 20,17C19.33,17 19.21,16.79 18.71,16.29C18.21,15.79 17.33,15 16,15M8,20C6.67,20 5.79,20.79 5.29,21.29C4.79,21.79 4.67,22 4,22C3.33,22 3.21,21.79 2.71,21.29C2.35,20.93 1.79,20.42 1,20.16V22.41C1.09,22.5 1.18,22.59 1.29,22.71C1.79,23.21 2.67,24 4,24C5.33,24 6.21,23.21 6.71,22.71C7.21,22.21 7.33,22 8,22C8.67,22 8.79,22.21 9.29,22.71C9.73,23.14 10.44,23.8 11.5,23.96C11.66,24 11.83,24 12,24C13.33,24 14.21,23.21 14.71,22.71C15.21,22.21 15.33,22 16,22C16.67,22 16.79,22.21 17.29,22.71C17.79,23.21 18.67,24 20,24C21.33,24 22.21,23.21 22.71,22.71C22.82,22.59 22.91,22.5 23,22.41V20.16C22.21,20.42 21.65,20.93 21.29,21.29C20.79,21.79 20.67,22 20,22C19.33,22 19.21,21.79 18.71,21.29C18.21,20.79 17.33,20 16,20C14.67,20 13.79,20.79 13.29,21.29C12.79,21.79 12.67,22 12,22C11.78,22 11.63,21.97 11.5,21.92C11.22,21.82 11.05,21.63 10.71,21.29C10.21,20.79 9.33,20 8,20Z'),
		oil: new Path2D('M10 5H13V3H10V2C10 1.4 9.6 1 9 1S8 1.4 8 2V15.3C7.4 15.6 7 16.3 7 17C7 18.1 7.9 19 9 19S11 18.1 11 17C11 16.3 10.6 15.6 10 15.3V13H13V11H10V9H13V7H10V5M22 17.5C22 17.5 24 19.7 24 21C24 22.1 23.1 23 22 23S20 22.1 20 21C20 19.7 22 17.5 22 17.5M22.9 15.5C22.6 16 22 16.1 21.5 15.9L19.4 14.7L15.8 21C15.5 21.6 14.8 22 14 22H5C3.9 22 3 21.1 3 20V17C3 15.9 3.9 15 5 15V20H14L16.1 16.4L13 18.2V15.8L19.2 12.2L22.5 14.1C23 14.4 23.1 15 22.9 15.5M3.5 13.9L1.8 15.6C1.4 16 .8 16 .4 15.6S0 14.6.4 14.2L2.1 12.5C2.5 12.1 3.1 12.1 3.5 12.5S3.9 13.5 3.5 13.9Z')
	};
	function drawVectorIcon(ctx, key, cx, cy, size) {
		var path = ICON_PATH[key];
		if (!path) { return; }
		ctx.save();
		ctx.translate(cx - size / 2, cy - size / 2);
		ctx.scale(size / 24, size / 24);
		ctx.fillStyle = COLOR.dim;
		ctx.fill(path);
		ctx.restore();
	}

	// Corner readout card: translucent rounded box, a big value and a label
	// underneath -- matches Kansei Link's actual real-product layout (four
	// corner cards around the dial) far better than a cramped text row did.
	function drawCornerCard(ctx, F, x, y, w, h, value, label, color) {
		var r = 10;
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
		ctx.fillStyle = 'rgba(20,20,20,0.7)';
		ctx.fill();

		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = 'bold ' + Math.round(h * 0.42) + 'px ' + F;
		ctx.fillStyle = color || COLOR.fg;
		ctx.fillText(value, x + w / 2, y + h * 0.42);
		ctx.font = '600 ' + Math.round(h * 0.2) + 'px ' + F;
		ctx.fillStyle = COLOR.dim;
		ctx.fillText(label, x + w / 2, y + h * 0.78);
	}

	function draw() {
		if (!state.open) { return; }
		var ctx = state.ctx;
		var W = state.canvas.width, H = state.canvas.height;
		var d = state.data || {};
		var stale = (new Date().getTime() - state.lastOk) > CFG.staleMs;
		var F = "'Tipperary', Arial, Helvetica, sans-serif";

		document.getElementById('ndg-offline').style.display = stale ? 'block' : 'none';

		ctx.fillStyle = COLOR.bg;
		ctx.fillRect(0, 0, W, H);

		var gear = d.gear;
		var gearTxt = '--';
		if (gear !== null && gear !== undefined && !isNaN(gear)) {
			if (gear === 0) { gearTxt = 'N'; }
			else if (gear >= 128) { gearTxt = 'R'; }
			else { gearTxt = String(gear); }
		}

		var pad = 14;
		var cardW = W * 0.19, cardH = H * 0.19;

		// --- left column: two stacked arc gauges, coolant over oil -----------
		// Matches the real MID's own coolant-gauge convention directly (not
		// a corner-card readout): a semicircular track with distinct
		// blue/grey/red zones, a tick scale implied by the zone boundaries,
		// and a needle. Both gauges share the same 50-150°C scale.
		var arcR = Math.min(W * 0.21, H * 0.27);
		var arcColX = arcR + W * 0.025;
		var arcMargin = H * 0.06;
		var arcTopCy = arcR + arcMargin;
		var arcBotCy = H - arcR - arcMargin;
		drawArcGauge(ctx, F, arcColX, arcTopCy, arcR,
			d.coolant_c, CFG.gaugeMin, CFG.gaugeMax, CFG.gaugeMid,
			CFG.gaugeLabelLo, CFG.gaugeLabelHi,
			CFG.coolantCold, CFG.coolantHot, false, 'coolant');
		drawArcGauge(ctx, F, arcColX, arcBotCy, arcR,
			d.oil_c, CFG.gaugeMin, CFG.gaugeMax, CFG.gaugeMid,
			CFG.gaugeLabelLo, CFG.gaugeLabelHi,
			CFG.oilCold, CFG.oilHot, true, 'oil');

		// --- tachometer + speedometer (center, side by side) ------------------
		// Shifted right of the arc column; sized to clear the top/bottom-right
		// cards the same way as before.
		// Two circles side by side need centerSpan >= 4*dialR to avoid
		// overlapping (each circle's radius on both the outer edges and the
		// shared inner gap) -- solve for the largest radius that fits, then
		// place both dials with a small margin off each boundary.
		var centerX0 = arcColX + arcR + pad;
		var centerX1 = W - pad - cardW;
		var centerSpan = centerX1 - centerX0;
		var dialMargin = 6;
		var dialR = Math.min(H * 0.5 - cardH - pad, centerSpan / 4 - dialMargin);
		var dialCy = H * 0.52;
		var tachCx = centerX0 + dialR + dialMargin;
		var spdCx = centerX1 - dialR - dialMargin;
		drawDial(ctx, F, tachCx, dialCy, dialR, {
			value: d.rpm, max: CFG.maxRpm, redline: CFG.redline,
			tickStep: 500, majorEvery: 2, numberDivisor: 1000,
			showNumbers: true, unitLabel: 'x1000 RPM',
			centerText: num(d.rpm), centerColor: COLOR.fg
		});
		drawDial(ctx, F, spdCx, dialCy, dialR, {
			value: d.speed_kmh, max: CFG.maxSpeed,
			tickStep: 20, majorEvery: 2, numberDivisor: 1,
			showNumbers: true, unitLabel: CFG.speedUnit,
			centerText: num(d.speed_kmh), centerColor: COLOR.fg
		});

		// --- right column: gear (top) + g-force (bottom) ----------------------
		drawCornerCard(ctx, F, W - pad - cardW, pad, cardW, cardH,
			gearTxt, 'GEAR', COLOR.accent);

		var lat = d.lat_g || 0, lon = d.long_g || 0;
		var gmag = Math.sqrt(lat * lat + lon * lon);
		drawCornerCard(ctx, F, W - pad - cardW, H - pad - cardH, cardW, cardH,
			num(gmag, 2) + ' g', 'G-FORCE', COLOR.fg);
		ctx.textAlign = 'center';
		ctx.font = '600 ' + Math.round(cardH * 0.16) + 'px ' + F;
		ctx.fillStyle = COLOR.dim;
		ctx.fillText('steer ' + num(d.steer_deg, 0) + DEG + ' / thr ' + num(d.throttle_pct, 0) + '%',
			W - pad - cardW / 2, H - pad - cardH - 8);

		// brake lamp, small, near the throttle/steer line above
		ctx.beginPath();
		ctx.arc(W - pad - cardW - 16, H - pad - cardH - 8, 7, 0, Math.PI * 2);
		ctx.fillStyle = d.brake ? COLOR.accent : '#2a2a2a';
		ctx.fill();
	}

	// ---------------------------------------------------------------- main
	function tick() {
		if (state.open) {
			draw();
		} else {
			state.launcher.style.display = inApplicationsScreen() ? 'block' : 'none';
		}
	}

	function boot() {
		injectCss();
		buildDom();
		window.onresize = resize;
		setInterval(poll, CFG.pollMs);
		setInterval(tick, 100);
		// framework may not exist yet (userjs can run before the main GUI
		// scripts finish); keep trying until it does, then stop.
		var hookTimer = setInterval(function () {
			if (installMmuiHook()) { clearInterval(hookTimer); }
		}, 200);
	}

	if (document.body) { boot(); }
	else {
		var t = setInterval(function () {
			if (document.body) { clearInterval(t); boot(); }
		}, 200);
	}
}());
