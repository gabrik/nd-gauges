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
	var CFG = {
		dataUrl: window.GAUGES_DATA_URL || 'gauges/cardata.json',
		cssUrl: window.GAUGES_CSS_URL || 'gauges/gauges.css',
		pollMs: 200,
		staleMs: 2000,
		maxRpm: 8000,
		redline: 7200,
		maxSpeed: 260,        // km/h, scale for nothing yet (digital display)
		speedUnit: 'km/h',
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

		var canvas = document.createElement('canvas');
		canvas.id = 'ndg-canvas';
		panel.appendChild(canvas);

		var badge = document.createElement('div');
		badge.id = 'ndg-offline';
		badge.appendChild(document.createTextNode('OFFLINE'));
		panel.appendChild(badge);

		document.body.appendChild(panel);

		launcher.onclick = function () {
			state.open = true;
			panel.style.display = 'block';
			launcher.style.display = 'none';
			resize();
		};
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
		var w = window.innerWidth, h = window.innerHeight;
		state.canvas.width = w;
		state.canvas.height = h;
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

	function draw() {
		if (!state.open) { return; }
		var ctx = state.ctx;
		var W = state.canvas.width, H = state.canvas.height;
		var d = state.data || {};
		var stale = (new Date().getTime() - state.lastOk) > CFG.staleMs;

		document.getElementById('ndg-offline').style.display = stale ? 'block' : 'none';

		// background
		ctx.fillStyle = '#0a0a0c';
		ctx.fillRect(0, 0, W, H);

		// --- RPM bar (top) -------------------------------------------------
		var rpm = d.rpm || 0;
		var barH = Math.round(H * 0.14);
		var pad = 20;
		var barW = W - pad * 2;
		ctx.fillStyle = '#1c1c22';
		ctx.fillRect(pad, pad, barW, barH);
		var frac = Math.max(0, Math.min(1, rpm / CFG.maxRpm));
		var redFrac = CFG.redline / CFG.maxRpm;
		var grad = ctx.createLinearGradient(pad, 0, pad + barW, 0);
		grad.addColorStop(0, '#2e86ff');
		grad.addColorStop(redFrac * 0.8, '#27c93f');
		grad.addColorStop(redFrac, '#ffbd2e');
		grad.addColorStop(1, '#ff5f56');
		ctx.fillStyle = grad;
		ctx.fillRect(pad, pad, barW * frac, barH);
		// redline marker
		ctx.fillStyle = '#ff5f56';
		ctx.fillRect(pad + barW * redFrac - 2, pad, 4, barH);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold ' + Math.round(barH * 0.55) + 'px Helvetica, Arial, sans-serif';
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		ctx.fillText(num(d.rpm) + ' rpm', pad + barW - 10, pad + barH / 2);

		// --- speed + gear (centre) -----------------------------------------
		ctx.textAlign = 'center';
		ctx.fillStyle = '#fff';
		ctx.font = 'bold ' + Math.round(H * 0.28) + 'px Helvetica, Arial, sans-serif';
		ctx.fillText(num(d.speed_kmh), W / 2, H * 0.48);
		ctx.font = Math.round(H * 0.05) + 'px Helvetica, Arial, sans-serif';
		ctx.fillStyle = '#888';
		ctx.fillText(CFG.speedUnit, W / 2, H * 0.48 + H * 0.16);

		var gear = d.gear;
		var gearTxt = '--';
		if (gear !== null && gear !== undefined && !isNaN(gear)) {
			if (gear === 0) { gearTxt = 'N'; }
			else if (gear >= 128) { gearTxt = 'R'; }
			else { gearTxt = String(gear); }
		}
		ctx.font = 'bold ' + Math.round(H * 0.12) + 'px Helvetica, Arial, sans-serif';
		ctx.fillStyle = '#ffbd2e';
		ctx.fillText(gearTxt, W / 2, H * 0.78);

		// --- throttle bar (right) -------------------------------------------
		var th = Math.max(0, Math.min(100, d.throttle_pct || 0));
		var tbW = 26, tbH = H * 0.45, tbX = W - pad - tbW, tbY = H * 0.3;
		ctx.fillStyle = '#1c1c22';
		ctx.fillRect(tbX, tbY, tbW, tbH);
		ctx.fillStyle = '#27c93f';
		ctx.fillRect(tbX, tbY + tbH * (1 - th / 100), tbW, tbH * th / 100);
		// brake lamp
		ctx.beginPath();
		ctx.arc(tbX + tbW / 2, tbY - 30, 14, 0, Math.PI * 2);
		ctx.fillStyle = d.brake ? '#ff5f56' : '#3a3a42';
		ctx.fill();

		// --- g-circle (left) -------------------------------------------------
		var gcX = pad + 110, gcY = H * 0.52, gcR = 100;
		ctx.strokeStyle = '#3a3a42';
		ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc(gcX, gcY, gcR, 0, Math.PI * 2); ctx.stroke();
		ctx.beginPath(); ctx.arc(gcX, gcY, gcR / 2, 0, Math.PI * 2); ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(gcX - gcR, gcY); ctx.lineTo(gcX + gcR, gcY);
		ctx.moveTo(gcX, gcY - gcR); ctx.lineTo(gcX, gcY + gcR);
		ctx.stroke();
		var lat = d.lat_g || 0, lon = d.long_g || 0;
		var mag = Math.sqrt(lat * lat + lon * lon);
		if (mag > 1.5) { lat *= 1.5 / mag; lon *= 1.5 / mag; }
		ctx.beginPath();
		ctx.arc(gcX + lat * (gcR / 1.5), gcY - lon * (gcR / 1.5), 10, 0, Math.PI * 2);
		ctx.fillStyle = '#2e86ff';
		ctx.fill();
		ctx.fillStyle = '#888';
		ctx.font = '16px Helvetica, Arial, sans-serif';
		ctx.fillText(num(mag, 2) + ' g', gcX, gcY + gcR + 24);

		// --- steering (bottom) ------------------------------------------------
		ctx.fillStyle = '#888';
		ctx.font = '20px Helvetica, Arial, sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText('steer ' + num(d.steer_deg, 1) + ' deg', pad, H - 30);
		ctx.textAlign = 'right';
		ctx.fillText('thr ' + num(d.throttle_pct, 0) + ' %', W - pad, H - 30);
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
	}

	if (document.body) { boot(); }
	else {
		var t = setInterval(function () {
			if (document.body) { clearInterval(t); boot(); }
		}, 200);
	}
}());
