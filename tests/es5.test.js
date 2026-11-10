// SPDX-License-Identifier: GPL-3.0-or-later
const {test} = require('node:test');
const {readFileSync, readdirSync} = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
function sources(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(p) : (p.endsWith('.js') ? [p] : []);
  });
}
for (const file of [...sources(path.join(__dirname, '../app')), ...sources(path.join(__dirname, '../cmu/menu'))]) {
  test(path.relative(path.join(__dirname, '..'), file) + ' parses as ES5', () => {
    acorn.parse(readFileSync(file, 'utf8'), {ecmaVersion: 5});
  });
}
