// SPDX-License-Identifier: GPL-3.0-or-later
const {test, expect} = require('@playwright/test');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const path = require('node:path');

test('real collector feeds our canvas; paused signals go OFFLINE then recover', async ({page}) => {
  const child = spawn(process.env.PYTHON || 'python3', [
    path.join(__dirname, '../dev/run.py'), '--docker', 'busybox:1.25', '--port', '0', '--at', '6', '--no-browser',
  ], {stdio: ['pipe', 'pipe', 'pipe']});
  const exited = once(child, 'exit');
  let log = '';
  child.stderr.on('data', data => {log += data;});
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(log || 'preview startup timeout')), 35000);
      child.stdout.on('data', data => {
        log += data;
        const match = log.match(/http:\/\/127\.0\.0\.1:\d+\/index\.html/);
        if (match) {clearTimeout(timer); resolve(match[0]);}
      });
      child.once('error', error => {clearTimeout(timer); reject(error);});
      child.once('exit', code => {clearTimeout(timer); reject(Error(`preview exited ${code}: ${log}`));});
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      // Exercise the legacy Canvas fallback, not Chrome's modern Path2D.
      window.Path2D = undefined;
      const original = CanvasRenderingContext2D.prototype.fillText;
      window.drawnText = [];
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        window.drawnText.push(String(text));
        if (window.drawnText.length > 100) window.drawnText.shift();
        return original.call(this, text, ...args);
      };
    });
    await page.goto(url);
    await expect(page.locator('#ndg-panel')).toBeVisible();
    await expect(page.locator('#ndg-launcher')).toBeHidden();
    await page.locator('#ndg-canvas').click();
    await expect(page.locator('#ndg-panel')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.drawnText.includes('30'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.drawnText.includes('31°'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.drawnText.includes('66%'))).toBe(true);
    await expect(page.locator('#ndg-offline')).toBeHidden();
    child.stdin.write('\n');
    await expect(page.locator('#ndg-offline')).toBeVisible({timeout: 8000});
    child.stdin.write('\n');
    await expect(page.locator('#ndg-offline')).toBeHidden({timeout: 8000});
    expect(errors).toEqual([]);
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
});
