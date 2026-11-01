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
		intakeMin: -40, intakeMax: 80, intakeMid: 20,
		intakeLabelLo: -20, intakeLabelHi: 60,
		intakeCold: 0, intakeHot: 45,
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

	function fuelColor(v) {
		if (v <= 15) { return COLOR.accent; }
		if (v <= 25) { return COLOR.warn; }
		return COLOR.fg;
	}

	// Arc gauge matching the REAL ND2 instrument cluster's own MID display:
	// a thin grey track, colored end caps, static scale labels, and a thicker
	// sliding tick for the needle. Each gauge uses an icon instead of a text
	// label. `invert` mirrors the lower pair so the four arcs face inward.
	function drawArcGauge(ctx, F, gauge) {
		var cx = gauge.cx, cy = gauge.cy, r = gauge.r;
		var value = gauge.value, min = gauge.min, max = gauge.max, mid = gauge.mid;
		var labelLo = gauge.labelLo, labelHi = gauge.labelHi;
		var cold = gauge.cold, hot = gauge.hot, invert = gauge.invert, icon = gauge.icon;
		var options = gauge.options || {};
		var lowCapColor = options.lowCapColor || '#3a82ff';
		var highCapColor = options.highCapColor || COLOR.accent;
		var topStartA = Math.PI * 1.1, topEndA = Math.PI * 1.9;
		var sweep = topEndA - topStartA;
		var baseA = invert ? Math.PI * 0.9 : topStartA;
		var dir = invert ? -1 : 1;
		var ccw = !!invert;

		function angleAt(frac) { return baseA + dir * sweep * frac; }

		// Temperature scales use a piecewise map so the chosen midpoint sits
		// at the center. Fuel uses the same map with equal lower/upper ranges.
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

		// 6 gaps (7 tick points); temperature labels align to the 2nd, center,
		// and penultimate ticks. Fuel labels use its 0/50/100 scale.
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
		arcSeg(0, capFrac, lowCapColor, 6);
		arcSeg(1 - capFrac, 1, highCapColor, 6);

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

		// Static scale labels use each gauge's configured low/mid/high values.
		// Their positions are fixed and independent of the live reading.
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

		// Value sits closest to the scale/inner arc, icon sits further out.
		// The bottom pair is vertically mirrored from the top pair.
		var textSign = invert ? -1 : 1;
		ctx.font = '600 ' + Math.round(r * 0.2) + 'px ' + F;
		ctx.fillStyle = hasValue ?
			(options.colorMode === 'fuel' ? fuelColor(vClamped) : tempColor(vClamped, cold, hot)) : COLOR.dim;
		ctx.fillText((hasValue ? num(vClamped, 0) + (options.suffix || DEG) : '--'),
			cx, cy + textSign * r * -0.50);
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
	// Material Design Icons air-filter and gas-station glyphs (Apache-2.0).
	// The fuel pump gets a left-pointing marker for the MX-5's filler side.
	ICON_PATH.air = new Path2D('M19,18.31V20A2,2 0 0,1 17,22H7A2,2 0 0,1 5,20V16.3C4.54,16.12 3.95,16 3,16A1,1 0 0,1 2,15A1,1 0 0,1 3,14C3.82,14 4.47,14.08 5,14.21V12.3C4.54,12.12 3.95,12 3,12A1,1 0 0,1 2,11A1,1 0 0,1 3,10C3.82,10 4.47,10.08 5,10.21V8.3C4.54,8.12 3.95,8 3,8A1,1 0 0,1 2,7A1,1 0 0,1 3,6C3.82,6 4.47,6.08 5,6.21V4A2,2 0 0,1 7,2H17A2,2 0 0,1 19,4V6.16C20.78,6.47 21.54,7.13 21.71,7.29C22.1,7.68 22.1,8.32 21.71,8.71C21.32,9.1 20.8,9.09 20.29,8.71V8.71C20.29,8.71 19.25,8 17,8C15.74,8 14.91,8.41 13.95,8.9C12.91,9.41 11.74,10 10,10C9.64,10 9.31,10 9,9.96V7.95C9.3,8 9.63,8 10,8C11.26,8 12.09,7.59 13.05,7.11C14.09,6.59 15.27,6 17,6V4H7V20H17V18C18.5,18 18.97,18.29 19,18.31M17,10C15.27,10 14.09,10.59 13.05,11.11C12.09,11.59 11.26,12 10,12C9.63,12 9.3,12 9,11.95V13.96C9.31,14 9.64,14 10,14C11.74,14 12.91,13.41 13.95,12.9C14.91,12.42 15.74,12 17,12C19.25,12 20.29,12.71 20.29,12.71V12.71C20.8,13.1 21.32,13.1 21.71,12.71C22.1,12.32 22.1,11.69 21.71,11.29C21.5,11.08 20.25,10 17,10M17,14C15.27,14 14.09,14.59 13.05,15.11C12.09,15.59 11.26,16 10,16C9.63,16 9.3,16 9,15.95V17.96C9.31,18 9.64,18 10,18C11.74,18 12.91,17.41 13.95,16.9C14.91,16.42 15.74,16 17,16C19.25,16 20.29,16.71 20.29,16.71V16.71C20.8,17.1 21.32,17.1 21.71,16.71C22.1,16.32 22.1,15.69 21.71,15.29C21.5,15.08 20.25,14 17,14Z');
	ICON_PATH.fuel = new Path2D('M18,10A1,1 0 0,1 17,9A1,1 0 0,1 18,8A1,1 0 0,1 19,9A1,1 0 0,1 18,10M12,10H6V5H12M19.77,7.23L19.78,7.22L16.06,3.5L15,4.56L17.11,6.67C16.17,7 15.5,7.93 15.5,9A2.5,2.5 0 0,0 18,11.5C18.36,11.5 18.69,11.42 19,11.29V18.5A1,1 0 0,1 18,19.5A1,1 0 0,1 17,18.5V14C17,12.89 16.1,12 15,12H14V5C14,3.89 13.1,3 12,3H6C4.89,3 4,3.89 4,5V21H14V13.5H15.5V18.5A2.5,2.5 0 0,0 18,21A2.5,2.5 0 0,0 20.5,18.5V9C20.5,8.31 20.22,7.68 19.77,7.23Z');
	ICON_PATH.fuelArrow = new Path2D('M4.5,8.5L0,12L4.5,15.5Z');
	function drawVectorIcon(ctx, key, cx, cy, size) {
		var path = ICON_PATH[key];
		if (!path) { return; }
		ctx.save();
		ctx.translate(cx - size / 2, cy - size / 2);
		ctx.scale(size / 24, size / 24);
		ctx.fillStyle = COLOR.dim;
		if (key === 'fuel') {
			ctx.fill(ICON_PATH.fuelArrow);
			ctx.translate(1.5, 0);
		}
		ctx.fill(path);
		ctx.restore();
	}

	// Vehicle readout card: translucent rounded box, big value and label.
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

		// Fixed geometry for the CMU's 800x480 screen (416px canvas below
		// the 64px header); this isn't intended to be a responsive layout.
		var cardW = 128, cardH = 75;
		var arcR = 112, arcColX = 132, arcRightX = 668;
		var arcTopCy = 137, arcBotCy = 279;
		drawArcGauge(ctx, F, {
			cx: arcColX, cy: arcTopCy, r: arcR, value: d.coolant_c,
			min: CFG.gaugeMin, max: CFG.gaugeMax, mid: CFG.gaugeMid,
			labelLo: CFG.gaugeLabelLo, labelHi: CFG.gaugeLabelHi,
			cold: CFG.coolantCold, hot: CFG.coolantHot, invert: false, icon: 'coolant'
		});
		drawArcGauge(ctx, F, {
			cx: arcColX, cy: arcBotCy, r: arcR, value: d.oil_c,
			min: CFG.gaugeMin, max: CFG.gaugeMax, mid: CFG.gaugeMid,
			labelLo: CFG.gaugeLabelLo, labelHi: CFG.gaugeLabelHi,
			cold: CFG.oilCold, hot: CFG.oilHot, invert: true, icon: 'oil'
		});
		drawArcGauge(ctx, F, {
			cx: arcRightX, cy: arcTopCy, r: arcR, value: d.intake_air_c,
			min: CFG.intakeMin, max: CFG.intakeMax, mid: CFG.intakeMid,
			labelLo: CFG.intakeLabelLo, labelHi: CFG.intakeLabelHi,
			cold: CFG.intakeCold, hot: CFG.intakeHot, invert: false, icon: 'air'
		});
		drawArcGauge(ctx, F, {
			cx: arcRightX, cy: arcBotCy, r: arcR, value: d.fuel_level_pct,
			min: 0, max: 100, mid: 50, labelLo: 0, labelHi: 100,
			cold: 0, hot: 100, invert: true, icon: 'fuel',
			options: {
				colorMode: 'fuel', suffix: '%',
				lowCapColor: COLOR.accent, highCapColor: COLOR.dim
			}
		});

		// Preserve the smaller vehicle readouts in the open center channel.
		var cardGap = 12;
		var cardY = 170;
		var gearX = 266;
		var gforceX = gearX + cardW + cardGap;
		drawCornerCard(ctx, F, gearX, cardY, cardW, cardH,
			gearTxt, 'GEAR', COLOR.accent);

		var lat = d.lat_g || 0, lon = d.long_g || 0;
		var gmag = Math.sqrt(lat * lat + lon * lon);
		drawCornerCard(ctx, F, gforceX, cardY, cardW, cardH,
			num(gmag, 2) + ' g', 'G-FORCE', COLOR.fg);
		var statusY = cardY + cardH + 25;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = '600 ' + Math.round(cardH * 0.2) + 'px ' + F;
		ctx.fillStyle = COLOR.dim;
		ctx.fillText('steer ' + num(d.steer_deg, 0) + DEG + ' / thr ' + num(d.throttle_pct, 0) + '%',
			412, statusY);

		// Brake lamp sits beside the steering/throttle line.
		ctx.beginPath();
		ctx.arc(300, statusY, 7, 0, Math.PI * 2);
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
