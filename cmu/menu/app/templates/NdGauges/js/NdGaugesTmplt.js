/* SPDX-License-Identifier: GPL-3.0-or-later
 * nd-gauges full-screen template, adapted from MiatOff's MiatoffMetersTmplt
 * at 5d972dbe3929d39878f0c53353fed35df535d369. See NOTICE.
 * One canvas page today: Back exits. Optional controller methods are forwarded
 * only when a page provides them. ES5 for the CMU's Opera Presto.
 */
log.addSrcFile('NdGaugesTmplt.js', 'ndgauges');

function NdGaugesTmplt(uiaId, parentDiv, templateId, controlProperties) {
    this.templateName = 'NdGaugesTmplt';
    this.onScreenClass = 'TemplateFull';
    this.properties = {statusBarVisible: false, leftButtonVisible: false,
        hasActivePanel: false, isDialog: false};
    this.divElt = document.createElement('div');
    this.divElt.id = templateId;
    this.divElt.className = 'TemplateFull NdGaugesTmplt';
    this.frame = document.createElement('iframe');
    this.frame.className = 'NdGaugesFrame';
    this.frame.setAttribute('frameborder', '0');
    this.frame.setAttribute('scrolling', 'no');
    this.frame.src = 'apps/ndgauges/gauges/index.html';
    this.divElt.appendChild(this.frame);
    parentDiv.appendChild(this.divElt);
}
NdGaugesTmplt.prototype._page = function () {
    try {
        return (this.frame && this.frame.contentWindow && this.frame.contentWindow.NDGaugesPage) || null;
    } catch (e) { return null; }
};
NdGaugesTmplt.prototype.handleControllerEvent = function (eventID) {
    var page = this._page(), method;
    if (!page) { return; }
    if (eventID === 'cw' || eventID === 'right') { method = 'next'; }
    else if (eventID === 'ccw' || eventID === 'left') { method = 'prev'; }
    else if (eventID === 'select' || eventID === 'selectStart') { method = 'select'; }
    if (method && typeof page[method] === 'function') {
        if (eventID !== 'selectStart') { page[method](); }
        return 'consumed';
    }
};
NdGaugesTmplt.prototype.ndgaugesBack = function () {
    var page = this._page();
    try { return !!(page && typeof page.back === 'function' && page.back() === true); }
    catch (e) { return false; }
};
NdGaugesTmplt.prototype.cleanUp = function () {
    var page = this._page();
    try {
        if (page && typeof page.stop === 'function') { page.stop(); }
    } catch (e) { /* A broken page must not keep the HMI open. */ }
    try { if (this.frame) { this.frame.src = 'about:blank'; } }
    catch (ignored) { /* Continue releasing our frame reference. */ }
    this.frame = null;
};
framework.registerTmpltLoaded('NdGaugesTmplt');
