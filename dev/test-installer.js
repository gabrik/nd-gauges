/* The old unguarded stock-menu patch was replaced. Test guarded install/remove instead. */
'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.env.PYTHON || 'python3',
    ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_install.py'],
    {cwd: path.join(__dirname, '..'), stdio: 'inherit'});
if (result.error) { console.error(result.error.message); }
process.exit(result.status === null ? 1 : result.status);
