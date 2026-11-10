/*
 * nd-gauges: adds "Gauges" to Applications on Mazda Connect 74.00.324A.
 * Adapted from MiatOff 5d972dbe3929d39878f0c53353fed35df535d369; see NOTICE.
 *
 * Opera runs this userscript in every page it loads (opera.ini: User JavaScript
 * File points to this folder only). In the HMI it waits for the system app,
 * then:
 *  - adds an item to the Applications list;
 *  - when chosen, borrows the disabled "vdt" Drive Record app and routes
 *    its messages to nd-gauges in /jci/gui/apps/ndgauges/.
 * The idea comes from MZD-AIO's additionalApps.js (GPL-3.0). Unlike AIO it
 * wraps the framework functions instead of replacing them, calls the original
 * whenever nd-gauges is not involved, and does nothing at all when any
 * hook it needs is missing (other firmware, other mods). ES5 only.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(function (W) {
    var APP = "ndgauges";
    var LABEL = "Gauges";
    var CATEGORY = "Applications";
    var BORROWED_APP = "vdt";                     // disabled on this unit
    var BORROWED_CONTEXT = "DriveChartDetails";
    var BORROWED_EVENT = "SelectDriveRecord";

    var MAX_ATTEMPTS = 20;                        // load events to wait for the system app
    var state = { active: false, context: null, attempts: 0, done: false };

    function warn(text) {
        try {
            if (W.log && typeof W.log.error === "function") {
                W.log.error("[ndgauges] " + text);
            }
        } catch (e) {
        }
    }

    // Every hook this script touches, checked before anything is changed.
    function hooksPresent(fw, sys) {
        try {
            return typeof fw.getAppInstance === "function" &&
                typeof fw.routeMmuiMsg === "function" &&
                typeof fw.sendEventToMmui === "function" &&
                typeof fw.getCurrentApp === "function" &&
                typeof fw.getCurrCtxtId === "function" &&
                fw.websockets && typeof fw.websockets.sendEventMsg === "function" &&
                fw.debug && typeof fw.debug.triggerEvtToMmuiCallbacks === "function" &&
                fw.localize && fw.localize._appDicts && fw.localize._appDicts.system &&
                fw.common && fw.common._contextCategory && fw.common._contextCategory._contextCategoryTable &&
                sys && sys._masterApplicationDataList && sys._masterApplicationDataList.items &&
                typeof sys._masterApplicationDataList.items.push === "function" &&
                sys._contextTable && sys._contextTable[CATEGORY] &&
                sys._contextTable[CATEGORY].controlProperties &&
                sys._contextTable[CATEGORY].controlProperties.List2Ctrl &&
                typeof sys._contextTable[CATEGORY].controlProperties.List2Ctrl.selectCallback === "function";
        } catch (e) {
            return false;
        }
    }

    function borrowedItemPresent(sys) {
        var items = sys._masterApplicationDataList.items, i, found = false;
        for (i = 0; i < items.length; i++) {
            if (items[i] && items[i].appData && items[i].appData.appName === 'miatoff') {
                return false;
            }
            if (items[i] && items[i].disabled === true && items[i].appData &&
                items[i].appData.appName === BORROWED_APP && items[i].appData.mmuiEvent === BORROWED_EVENT) {
                found = true;
            }
        }
        return found;
    }

    // true only when the nd-gauges page handled Back internally.
    function pageTakesBack(fw) {
        var t = fw.common && fw.common._cachedTemplate;
        return !!(t && typeof t.ndgaugesBack === "function" && t.ndgaugesBack() === true);
    }

    function install() {
        var fw = W.framework, sys, list, origSelect, origRoute, origSend, names;
        if (state.done || typeof fw !== "object" || !fw || fw._currentAppUiaId !== "system" ||
            typeof fw.getAppInstance !== "function") {
            return;
        }
        sys = fw.getAppInstance("system");
        if (!sys || sys.ndgaugesInstalled || sys.miatoffInstalled) {
            return;
        }
        if (!hooksPresent(fw, sys) || !borrowedItemPresent(sys)) {
            state.attempts++;
            if (state.attempts >= MAX_ATTEMPTS) {
                state.done = true;
                warn("hooks not as expected; Gauges not added");
            }
            return;
        }
        state.done = true;
        sys.ndgaugesInstalled = true;

        sys._masterApplicationDataList.items.push({
            appData : { appName : APP, isVisible : true, audioSourceId : "None", mmuiEvent : "Select" + APP },
            text1Id : APP, disabled : false, itemStyle : "style01", hasCaret : false
        });
        fw.localize._appDicts.system[APP] = LABEL;
        fw.common._contextCategory._contextCategoryTable[APP + ".*"] = CATEGORY;
        names = sys._applicationsCtxtWiseAppNames;
        if (names && names[CATEGORY] && typeof names[CATEGORY].indexOf === "function" &&
            names[CATEGORY].indexOf(APP) === -1) {
            names[CATEGORY].push(APP);
        }

        // Applications list: our item asks MMUI for the borrowed app.
        list = sys._contextTable[CATEGORY].controlProperties.List2Ctrl;
        origSelect = list.selectCallback;
        list.selectCallback = function (listCtrlObj, appData, params) {
            if (appData && appData.appName === APP) {
                state.active = true;
                state.context = "Start";
                appData = { appName : BORROWED_APP, isVisible : true, audioSourceId : "None", mmuiEvent : BORROWED_EVENT };
            }
            return origSelect.call(this, listCtrlObj, appData, params);
        };

        // MMUI -> GUI: messages for the borrowed app go to nd-gauges.
        origRoute = fw.routeMmuiMsg;
        fw.routeMmuiMsg = function (msg) {
            try {
                if (state.active && msg) {
                    if (msg.msgType === "ctxtChg" && msg.uiaId === BORROWED_APP) {
                        msg.uiaId = APP;
                        msg.ctxtId = state.context;
                    } else if (msg.msgType === "focusStack" && msg.appIdList) {
                        var inStack = false, i;
                        for (i = 0; i < msg.appIdList.length; i++) {
                            if (msg.appIdList[i].id === BORROWED_APP) {
                                msg.appIdList[i].id = APP;
                            }
                            if (msg.appIdList[i].id === APP) {
                                inStack = true;
                            }
                        }
                        if (!inStack) {
                            state.active = false;
                            state.context = null;
                        }
                    } else if ((msg.msgType === "msg" || msg.msgType === "alert") && msg.uiaId === BORROWED_APP) {
                        msg.uiaId = APP;
                    }
                }
            } catch (e) {
                warn("routeMmuiMsg: " + e);
            }
            return origRoute.apply(this, arguments);
        };

        // GUI -> MMUI: while nd-gauges is involved, MMUI sees the borrowed app.
        origSend = fw.sendEventToMmui;
        fw.sendEventToMmui = function (uiaId, eventId, params, fromVui) {
            var current;
            if (state.active) {
                try {
                    current = this.getCurrentApp();
                    // Ask the page before forwarding Back; the single gauge returns false.
                    // Common sends Global.GoBack before the template sees the key.
                    if (current === APP && uiaId === "common" && eventId === "Global.GoBack" &&
                            pageTakesBack(this)) {
                        return;
                    }
                    if (uiaId === APP || current === APP) {
                        var ctxt = this.getCurrCtxtId();
                        if (uiaId === APP) {
                            uiaId = BORROWED_APP;
                        }
                        if (current === APP) {
                            current = BORROWED_APP;
                            ctxt = BORROWED_CONTEXT;
                        }
                        this.websockets.sendEventMsg(uiaId, eventId, params, fromVui, current, ctxt);
                        this.debug.triggerEvtToMmuiCallbacks(uiaId, eventId, params);
                        return;
                    }
                } catch (e) {
                    warn("sendEventToMmui: " + e);
                }
            }
            return origSend.apply(this, arguments);
        };
    }

    function tryInstall() {
        try {
            install();
        } catch (e) {
            warn("install: " + e);
        }
    }

    if (W.opera && typeof W.opera.addEventListener === "function") {
        W.opera.addEventListener("AfterEvent.load", tryInstall, false);
    }
})(typeof window !== "undefined" ? window : this);
