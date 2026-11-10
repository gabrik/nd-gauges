# Local verification: revised port and PR1

## Backport

Branch: feat/miatoff-port-v2. Base: e496a6e. Worktree: /Users/gabri/workspace/nd-gauges-port-v2.
The earlier port worktree remains untouched. Original main remained clean after all tests.

Passing local checks:

- npm ci: zero reported vulnerabilities.
- npm test: initially 13 passing tests/entries; 14 after adding the explicitly labelled public documentation snapshot. Includes current dashboard rendering fixtures, ES5 parsing, native/no-Path2D
  rendering, raw units and correct intake/fuel names, unverified-value placeholders, embedded touch Back, no blanking on
  canvas click, and the adapted MiatOff menu/framework assertions.
- python3 -m unittest discover -s tests: 15 passing tests, 30.181 seconds. Actual collector, fabricated replay/EOF,
  path validation and synthetic BusyBox install/remove/recovery/tampering/conflict/USB tests. The installation test also
  verifies no TTF binaries enter the payload and CSS references the CMU's installed font.
- ND_BROWSER_CHANNEL=chrome npm run test:browser: one passing test, 6.6 seconds. The actual collector feeds the updated
  dashboard. Path2D is disabled; expected speed/intake/fuel labels are observed; clicking canvas doesn't hide the app;
  paused signals produce OFFLINE and resume clears it. No pageerror events were observed.
- node dev/test-installer.js: 11 passing guarded-installer tests; no BSD sed dependency in this replacement entry point.
- Python compilation, shell syntax and git diff --check passed. Vendored collector matches upstream byte-for-byte.
- No leftover nd-gauges-dev or miatoff-dev containers after final checks.

## PR1

Worktree: /Users/gabri/workspace/MiatOff-drive-harness, existing feat/collector-dev-harness branch.
Four files revised; no production collector, UI, installer or firmware assets changed.

- Added independent expected intake/outside/fuel conversions to collector/data and browser tests.
- Added malformed NUL URL cases. Before the fix these failed with RemoteDisconnected and a crashed handler; after the
  explicit rejection, both return HTTP 404 and all four synthetic harness tests pass.
- Browser verification initially exposed missing `python` on this macOS host. The test now defaults to python3 on POSIX,
  python on Windows, and honours PYTHON. The collector-dev browser test then passed (8.4 seconds total) using installed
  Chrome through an external temporary Playwright config. Production browser config was not changed.
- Documentation explicitly separates this preview from nd-gauges UI revisions and future emulator/replay work.
- git diff --check and Python compilation passed.

## Not completed / not claimed

The operator unlocked the signing key. PR1 revisions f4cc177 and f6c83fb and the nd-gauges implementation 097d7d4
were committed with locally valid GPG signatures. No unsigned commits were created. Full remote CI for the revised
code remains pending publication/results; the earlier successful CI does not validate these new commits. No firmware blobs, private dumps or real recordings were used.
No real Opera Presto, mzd-emu, MMUI, USB launcher or car acceptance was performed. Modern Chrome with Path2D disabled
is an additional compatibility check, not an Opera emulator. Stock hash gates, hardware timing and recovery still require
independent review and real-device validation before use. Firmware-font binaries inherited in main require licence review;
excluding them from new payloads does not remove them from repository history.
