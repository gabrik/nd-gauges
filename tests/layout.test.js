'use strict';
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {createRequire} = require('module');
const file = path.resolve(__dirname, '../dev/test-layout.js');
test('latest dashboard layout and OEM-only launcher remain intact', () => require(file));
test('latest dashboard also renders all icons without Path2D', () => {
    const source = fs.readFileSync(file, 'utf8').replace('    Path2D: class {},\n', '');
    vm.runInNewContext(source, {require: createRequire(file), __dirname: path.dirname(file), console});
});
