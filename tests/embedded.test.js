'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('embedded touch Back asks the HMI to exit; canvas clicks never blank the app', () => {
    const nodes = [], forwarded = [];
    function element() {
        const node = {style: {}, children: [], appendChild(child) { this.children.push(child); }, getContext() { return {}; }};
        nodes.push(node); return node;
    }
    const host = {framework: {sendEventToMmui(...args) { forwarded.push(args); }}};
    const window = {GAUGES_EMBEDDED: true, parent: host, innerWidth: 800, innerHeight: 480,
        NDGaugesData: require('../app/data.js'), NDGaugesPath: require('../app/vector.js')};
    const box = {window, document: {body: element(), createElement: element, createTextNode: value => value,
        getElementsByTagName: () => [element()]}, setInterval() { return 1; }, clearInterval() {},
        XMLHttpRequest: class {open() {} send() {}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/gauges.js'), 'utf8'), box);
    const panel = nodes.find(n => n.id === 'ndg-panel');
    panel.onclick();
    assert.equal(panel.style.display, 'block');
    nodes.find(n => n.id === 'ndg-header').onclick();
    assert.deepEqual(forwarded, [['common', 'Global.GoBack']]);
    host.framework.sendEventToMmui = () => { throw Error('missing HMI'); };
    nodes.find(n => n.id === 'ndg-header').onclick();
    assert.equal(panel.style.display, 'block');
});
