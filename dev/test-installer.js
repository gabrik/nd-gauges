/* Exercise only menu patch functions in temporary fixtures, never CMU paths. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../cmu/install-gauges.sh'), 'utf8');
const functions = source.slice(source.indexOf('brace_balance_ok()'), source.indexOf('restore_applications_list()'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gauges-menu-test-'));
const app = path.join(dir, 'systemApp.js');
const dict = path.join(dir, 'systemAppDict.js');
const originalApp = `var items = [
{ appData : { mmuiEvent : 'SelectAndroidAuto' }, text1Id : 'AndroidAuto', disabled : false }
];
var a = ["androidauto"];
var b = ["androidauto"];
`;
const originalDict = '{\n"APDevice" : "Device",\n};\n';
function patch() {
    execFileSync('sh', ['-c', 'log() { :; };\n' + functions + '\npatch_applications_list'], {
        env: {...process.env, SYSTEM_APP_JS: app, SYSTEM_APP_DICT: dict,
            STATE_DIR: dir, BACKUP_SUFFIX: '.nd-gauges-orig'}
    });
}
try {
    fs.writeFileSync(app, originalApp);
    fs.writeFileSync(dict, originalDict);
    patch();
    assert.match(fs.readFileSync(dict, 'utf8'), /"NdGauges" : "Gauges"/);
    const patchedApp = fs.readFileSync(app, 'utf8');
    const patchedDict = fs.readFileSync(dict, 'utf8');
    patch();
    assert.equal(fs.readFileSync(app, 'utf8'), patchedApp);
    assert.equal(fs.readFileSync(dict, 'utf8'), patchedDict);
    fs.writeFileSync(dict, patchedDict.replace('"Gauges"', '"nd-gauges"'));
    patch();
    assert.equal(fs.readFileSync(dict, 'utf8'), patchedDict, 'upgrade old menu label');
    assert.equal(fs.readFileSync(app + '.nd-gauges-orig', 'utf8'), originalApp);
    assert.equal(fs.readFileSync(dict + '.nd-gauges-orig', 'utf8'), originalDict);
    console.log('PASS: Gauges menu insertion, repeat install, label upgrade and backup preservation');
} finally {
    fs.rmSync(dir, {recursive: true, force: true});
}
