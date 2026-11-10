/*
 * MiatOff Meters: a Mazda Connect app that shows the Meters page full screen.
 * Installed as /jci/gui/apps/ndgauges/ and opened from Applications through the
 * userscript userjs/ndgauges-apps.js. ES5 only (the HMI runs in Opera Presto).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 * App structure after the Mazda Connect framework and MZD_Speedometer (GPL-3.0).
 */

log.addSrcFile("ndgaugesApp.js", "ndgauges");

function ndgaugesApp(uiaId)
{
    log.debug("ndgaugesApp constructor called");
    // Base application functionality (framework/js/BaseApp.js).
    baseApp.init(this, uiaId);
}

/*
 * Called by the framework right after the app is instantiated.
 */
ndgaugesApp.prototype.appInit = function()
{
    this._contextTable = {
        "Start" : {
            "sbName" : "Gauges",
            "template" : "NdGaugesTmplt",
            "templatePath" : "apps/ndgauges/templates/NdGauges",
        }
    };
    this._messageTable = {};
};

framework.registerAppLoaded("ndgauges", null, false);
