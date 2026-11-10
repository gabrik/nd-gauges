/* SPDX-License-Identifier: GPL-3.0-or-later
 * Canvas fallback for the fixed MDI icons used by gauges.js. These icons use
 * absolute M/L/H/V/C/S/Z and unrotated circular A commands only. Not a general
 * SVG renderer. Opera Presto has Canvas but not Path2D.
 */
(function (root) {
    'use strict';
    function Path(text) { this.tokens = text.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g); }
    Path.prototype.trace = function (ctx) {
        var t = this.tokens, i = 0, cmd, previous, x = 0, y = 0, sx = 0, sy = 0;
        var bx = 0, by = 0, nx, ny, x1, y1, x2, y2, r, ry, rotation, large, sweep, dx, dy, k, cx, cy;
        function number() { return Number(t[i++]); }
        while (i < t.length) {
            if (/^[A-Za-z]$/.test(t[i])) { cmd = t[i++]; }
            switch (cmd) {
            case 'M':
                x = number(); y = number(); sx = x; sy = y;
                ctx.moveTo(x, y); cmd = 'L'; break;
            case 'L': x = number(); y = number(); ctx.lineTo(x, y); break;
            case 'H': x = number(); ctx.lineTo(x, y); break;
            case 'V': y = number(); ctx.lineTo(x, y); break;
            case 'C':
            case 'S':
                if (cmd === 'C') { x1 = number(); y1 = number(); }
                else { x1 = previous === 'C' || previous === 'S' ? 2 * x - bx : x;
                    y1 = previous === 'C' || previous === 'S' ? 2 * y - by : y; }
                x2 = number(); y2 = number(); nx = number(); ny = number();
                ctx.bezierCurveTo(x1, y1, x2, y2, nx, ny);
                bx = x2; by = y2; x = nx; y = ny; break;
            case 'A':
                r = number(); ry = number(); rotation = number(); large = number(); sweep = number();
                nx = number(); ny = number(); dx = nx - x; dy = ny - y;
                if (r !== ry || rotation !== 0) { throw new Error('Unsupported icon arc'); }
                if (dx || dy) {
                    r = Math.max(r, Math.sqrt(dx * dx + dy * dy) / 2);
                    k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, r * r / (dx * dx + dy * dy) - 0.25));
                    cx = (x + nx) / 2 - k * dy; cy = (y + ny) / 2 + k * dx;
                    ctx.arc(cx, cy, r, Math.atan2(y - cy, x - cx), Math.atan2(ny - cy, nx - cx), !sweep);
                }
                x = nx; y = ny; break;
            case 'Z': ctx.closePath(); x = sx; y = sy; cmd = null; break;
            default: throw new Error('Unsupported icon command: ' + cmd);
            }
            previous = cmd;
        }
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = Path; }
    else { root.NDGaugesPath = Path; }
}(this));
