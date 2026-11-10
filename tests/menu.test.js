#!/usr/bin/env node
/*
 * Tests for the MiatOff Meters app and its userscript, against a fake HMI
 * framework with the shapes of Mazda Connect 74.00.324A (framework/js/
 * GuiFramework.js and apps/system/js/systemApp.js as read in dump 003).
 *
 * Run: node tests/menu.test.js
 * Adapted from MiatOff 5d972dbe3929d39878f0c53353fed35df535d369 (GPL-3.0-or-later).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../cmu/menu");
const FILES = {
    userjs: path.join(ROOT, "userjs/ndgauges-apps.js"),
    app: path.join(ROOT, "app/js/ndgaugesApp.js"),
    tmplt: path.join(ROOT, "app/templates/NdGauges/js/NdGaugesTmplt.js"),
};
let failures = 0;
function check(cond, msg) {
    console.log((cond ? "PASS  " : "FAIL  ") + msg);
    if (!cond) failures++;
}

// --- ES5 only: the HMI is Opera Presto.
for (const [name, file] of Object.entries(FILES)) {
    const src = fs.readFileSync(file, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/"(?:\\.|[^"\\])*"/g, '""');
    const es6 = /=>|\blet\s|\bconst\s|`|\bclass\s|\.\.\.\w/.exec(code);
    check(!es6, `${name}: ES5 only${es6 ? " (found " + es6[0] + ")" : ""}`);
    try { new vm.Script(src, { filename: file }); check(true, `${name}: parses`); }
    catch (e) { check(false, `${name}: parses (${e.message})`); }
}

// --- fake HMI
function makeHmi(opts) {
    opts = opts || {};
    const sent = [], routed = [], selected = [], listeners = [];
    const sys = {
        _masterApplicationDataList: { items: [
            { appData: { appName: "vdt_settings", isVisible: false, mmuiEvent: "SelectVehicleTelemetryTransfer" }, disabled: true },
            { appData: { appName: "vdt", isVisible: false, audioSourceId: "None", mmuiEvent: "SelectDriveRecord" }, text1Id: "DriveRecord", disabled: true },
        ] },
        _applicationsCtxtWiseAppNames: { Applications: ["vdt"] },
        _contextTable: { Applications: { controlProperties: { List2Ctrl: {} } } },
    };
    sys._contextTable.Applications.controlProperties.List2Ctrl.selectCallback =
        function (ctrl, appData) { selected.push(appData); }.bind(sys);
    if (opts.noVdt) sys._masterApplicationDataList.items.splice(1, 1);
    if (opts.miatOff) sys.miatoffInstalled = true;
    if (opts.vdtEnabled) sys._masterApplicationDataList.items[1].disabled = false;
    if (opts.miatOffEntry) sys._masterApplicationDataList.items.push({appData: {appName: 'miatoff'}});
    const fw = {
        _currentAppUiaId: opts.startApp || "system",
        _currCtxt: "Applications",
        _appInstances: { system: sys },
        getAppInstance(id) { return this._appInstances[id]; },
        getCurrentApp() { return this._currentAppUiaId; },
        getCurrCtxtId() { return this._currCtxt; },
        websockets: { sendEventMsg(...a) { sent.push(a); } },
        debug: { triggerEvtToMmuiCallbacks() {} },
        localize: { _appDicts: { system: {} } },
        common: { _contextCategory: { _contextCategoryTable: {} } },
        routeMmuiMsg(msg) { routed.push(JSON.parse(JSON.stringify(msg))); },
    };
    // Stock v74 sendEventToMmui, copied in behaviour.
    fw.sendEventToMmui = function (uiaId, eventId, params, fromVui) {
        const currentUiaId = this.getCurrentApp();
        const currentContextId = this.getCurrCtxtId();
        this.websockets.sendEventMsg(uiaId, eventId, params, fromVui, currentUiaId, currentContextId);
        this.debug.triggerEvtToMmuiCallbacks(uiaId, eventId, params);
    };
    if (opts.noWebsockets) delete fw.websockets;
    const origRoute = fw.routeMmuiMsg, origSend = fw.sendEventToMmui;
    const W = { framework: fw, log: { error() {}, debug() {} },
                opera: { addEventListener(type, fn) { listeners.push([type, fn]); } } };
    W.window = W;
    vm.createContext(W);
    vm.runInContext(fs.readFileSync(FILES.userjs, "utf8"), W);
    const fire = () => listeners.forEach(([t, fn]) => t === "AfterEvent.load" && fn({}));
    return { W, fw, sys, sent, routed, selected, listeners, fire, origRoute, origSend };
}

const competing = makeHmi({miatOff: true});
competing.fire();
check(competing.fw.routeMmuiMsg === competing.origRoute &&
      !competing.sys.ndgaugesInstalled, 'competing MiatOff integration is left untouched');

for (const options of [{vdtEnabled: true}, {miatOffEntry: true}]) {
    const blocked = makeHmi(options);
    blocked.fire();
    check(blocked.fw.routeMmuiMsg === blocked.origRoute && !blocked.sys.ndgaugesInstalled,
          'enabled borrowed app or competing menu entry is not hijacked');
}

// 1. Install when the system app is there; once only.
let h = makeHmi({ startApp: "nativegui" });
check(h.listeners.length === 1 && h.listeners[0][0] === "AfterEvent.load", "listens to AfterEvent.load");
h.fire();
check(h.sys._masterApplicationDataList.items.length === 2, "nothing added before the system app is current");
h.fw._currentAppUiaId = "system";
h.fire(); h.fire(); h.fire();
const items = h.sys._masterApplicationDataList.items.filter(i => i.appData.appName === "ndgauges");
check(items.length === 1 && items[0].appData.mmuiEvent === "Selectndgauges" && !items[0].disabled,
      "Meters added once to Applications");
check(h.fw.localize._appDicts.system.ndgauges === "Gauges", "label 'Gauges'");
check(h.fw.common._contextCategory._contextCategoryTable["ndgauges.*"] === "Applications", "context category set");
check(h.sys._applicationsCtxtWiseAppNames.Applications.indexOf("ndgauges") >= 0, "listed in Applications names");

// 2. Selecting Meters asks MMUI for Drive Record; other items pass unchanged.
const select = h.sys._contextTable.Applications.controlProperties.List2Ctrl.selectCallback;
select({}, { appName: "radio", mmuiEvent: "SelectRadio" }, {});
check(h.selected[0].appName === "radio" && h.selected[0].mmuiEvent === "SelectRadio", "other items unchanged");
select({}, { appName: "ndgauges", mmuiEvent: "Selectndgauges" }, {});
check(h.selected[1].appName === "vdt" && h.selected[1].mmuiEvent === "SelectDriveRecord",
      "Meters selects the borrowed Drive Record app");

// 3. MMUI -> GUI rewriting while active.
h.fw.routeMmuiMsg({ msgType: "ctxtChg", uiaId: "vdt", ctxtId: "DriveChartDetails" });
check(h.routed[0].uiaId === "ndgauges" && h.routed[0].ctxtId === "Start", "ctxtChg for Drive Record opens MiatOff Start");
h.fw.routeMmuiMsg({ msgType: "focusStack", appIdList: [{ id: "vdt" }, { id: "system" }] });
check(h.routed[1].appIdList[0].id === "ndgauges", "focus stack names MiatOff");
h.fw.routeMmuiMsg({ msgType: "alert", uiaId: "vdt" });
check(h.routed[2].uiaId === "ndgauges", "alerts for Drive Record go to MiatOff");
h.fw.routeMmuiMsg({ msgType: "ctxtChg", uiaId: "radio", ctxtId: "Now" });
check(h.routed[3].uiaId === "radio", "other apps' messages unchanged");

// 4. GUI -> MMUI while MiatOff is current: MMUI sees Drive Record.
h.fw._currentAppUiaId = "ndgauges"; h.fw._currCtxt = "Start";
h.fw.sendEventToMmui("common", "Global.GoBack", {}, false);
check(JSON.stringify(h.sent[0]) === JSON.stringify(["common", "Global.GoBack", {}, false, "vdt", "DriveChartDetails"]),
      "events from MiatOff carry Drive Record as current app/context");
h.fw.sendEventToMmui("ndgauges", "Something", null, false);
check(h.sent[1][0] === "vdt", "events addressed to MiatOff go to Drive Record");

// 4b. Back key while MiatOff is shown: the page goes up a level first.
let pageBack = true, backCalls = 0;
h.fw.common._cachedTemplate = { ndgaugesBack() { backCalls++; return pageBack; } };
h.fw.sendEventToMmui("common", "Global.GoBack", null, false);
check(h.sent.length === 2 && backCalls === 1, "back inside the page (previews, gauge): MMUI not told");
pageBack = false;
h.fw.sendEventToMmui("common", "Global.GoBack", null, false);
check(h.sent.length === 3 && h.sent[2][1] === "Global.GoBack" && h.sent[2][4] === "vdt",
      "back at the style list: normal Global.GoBack (leaves the app)");
pageBack = "yes";
h.fw.sendEventToMmui("common", "Global.GoBack", null, false);
check(h.sent.length === 4, "only an exact true from the page keeps the back key");
h.fw.common._cachedTemplate = {};
h.fw.sendEventToMmui("common", "Global.GoBack", null, false);
check(h.sent.length === 5, "back with a template without ndgaugesBack: normal");
h.sent.splice(2);

// 5. Leaving: focus stack without MiatOff ends the borrowing; then everything is stock.
h.fw.routeMmuiMsg({ msgType: "focusStack", appIdList: [{ id: "system" }] });
h.fw._currentAppUiaId = "system"; h.fw._currCtxt = "Applications";
h.fw.routeMmuiMsg({ msgType: "ctxtChg", uiaId: "vdt", ctxtId: "DriveChartDetails" });
check(h.routed[h.routed.length - 1].uiaId === "vdt", "after leaving, Drive Record messages are stock again");
h.fw.common._cachedTemplate = { ndgaugesBack() { throw new Error("must not be asked"); } };
h.fw.sendEventToMmui("common", "Global.Back", {}, false);
check(JSON.stringify(h.sent[2]) === JSON.stringify(["common", "Global.Back", {}, false, "system", "Applications"]),
      "after leaving, events go through the stock function");

// 6. Missing hooks: nothing changes, even after many load events.
for (const opts of [{ noVdt: true }, { noWebsockets: true }]) {
    const m = makeHmi(opts);
    for (let i = 0; i < 30; i++) m.fire();
    check(m.sys._masterApplicationDataList.items.every(i => i.appData.appName !== "ndgauges") &&
          m.fw.routeMmuiMsg === m.origRoute && m.fw.sendEventToMmui === m.origSend,
          `missing hook (${Object.keys(opts)[0]}): HMI left untouched`);
}

// 7. In a page without the framework (e.g. the Meters iframe) nothing happens.
{
    const listeners = [];
    const W = { opera: { addEventListener(t, fn) { listeners.push(fn); } } };
    W.window = W;
    vm.createContext(W);
    vm.runInContext(fs.readFileSync(FILES.userjs, "utf8"), W);
    let ok = true;
    try { listeners.forEach(fn => fn({})); } catch (e) { ok = false; }
    check(ok, "pages without the framework are ignored");
}

// --- app and template with a minimal DOM
function el(tag) {
    return { tag, attrs: {}, children: [], className: "", id: "", src: "",
             setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); } };
}
const loaded = [];
const ctx = { log: { addSrcFile() {}, debug() {} }, document: { createElement: el },
              baseApp: { init(app, uiaId) { app.uiaId = uiaId; } },
              framework: { registerAppLoaded(...a) { loaded.push(["app", ...a]); },
                           registerTmpltLoaded(...a) { loaded.push(["tmplt", ...a]); } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(FILES.app, "utf8"), ctx);
vm.runInContext(fs.readFileSync(FILES.tmplt, "utf8"), ctx);
check(JSON.stringify(loaded[0]) === JSON.stringify(["app", "ndgauges", null, false]), "app registers as 'ndgauges' without language files");
check(loaded[1][0] === "tmplt" && loaded[1][1] === "NdGaugesTmplt", "template registers");
const app = vm.runInContext("new ndgaugesApp('ndgauges')", ctx);
app.appInit();
const start = app._contextTable.Start;
check(start && start.template === "NdGaugesTmplt" && start.templatePath === "apps/ndgauges/templates/NdGauges",
      "context Start uses the MiatOff template from the app folder");
ctx.parent = el("div");
const t = vm.runInContext("new NdGaugesTmplt('ndgauges', parent, 'NdGaugesTmplt1', {})", ctx);
const frame = t.divElt.children[0];
check(ctx.parent.children[0] === t.divElt && frame.tag === "iframe" &&
      frame.src === "apps/ndgauges/gauges/index.html", "template shows the Meters page reading live.txt");
check(t.properties.statusBarVisible === false, "full screen (no status bar)");
check(t.handleControllerEvent("cw") === undefined, "knob ignored while the page has no NdGauges API");
check(t.ndgaugesBack() === false, "back leaves the app while the page has no NdGauges API");
const calls = [];
let backResult = true;
frame.contentWindow = { NDGaugesPage: { next() { calls.push("next"); }, prev() { calls.push("prev"); },
                                         select() { calls.push("select"); return false; },
                                         back() { calls.push("back"); return backResult; } } };
check(t.handleControllerEvent("cw") === "consumed" && t.handleControllerEvent("ccw") === "consumed" &&
      t.handleControllerEvent("selectStart") === "consumed" && t.handleControllerEvent("select") === "consumed" &&
      calls.join() === "next,prev,select", "knob turns and presses go to the page (select on release)");
check(t.handleControllerEvent("goBack") === undefined && t.handleControllerEvent("downStart") === undefined &&
      calls.length === 3, "back key and other events are not handled in the template");
check(t.ndgaugesBack() === true && calls[3] === "back", "back: the page went up a level");
backResult = false;
check(t.ndgaugesBack() === false, "back at the style list: false (app closes)");
frame.contentWindow.NDGaugesPage.back = function () { throw new Error("x"); };
check(t.ndgaugesBack() === false, "a failing page never keeps the back key");
t.cleanUp();
check(frame.src === "about:blank", "cleanUp stops the page");

console.log("");
console.log(failures ? `${failures} failure(s)` : "All tests passed.");
process.exit(failures ? 1 : 0);
