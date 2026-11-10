# Read-only recorder impact

## Target
Dedicated recording stick, strict vehicle-signal filter, serial slow reader and existing launcher-name generator.

## Dependents
`tools/build-usb.py:launcher_name` is used by installer builds and tests/test_install.py. Default output must remain
byte-identical. No runtime collector, decoder, dashboard or firmware configuration changes are required.

## Coverage / risk
Risk: Medium. Shared launcher has regression coverage, but recording subprocess lifetime/privacy need new BusyBox tests.
No release-plan stories exist. New files remain independent of installer payloads.

## Approved scope / verification plan
- Separate empty-output recorder builder, ID and entry script; duplicate-stick and tamper refusal → synthetic launcher test.
- Fixed field/interface whitelist and relative, strictly increasing speed-clocked JSONL → parser/privacy/replay tests.
- Bounded recording, confirmation, no firmware writes; serialized slow reads at ten-second intervals, let active reads finish;
  stop only the owned D-Bus monitor, preserve partial output on interruption → BusyBox capture/lifecycle tests.
- No full dumps, diagnostics, GPS, NVRAM, phone information or host-machine installs. Fail closed for conflicting collectors.
- Reuse existing GPL source/launcher provenance, not Mazda files. Documentation and signed commits; do not deploy/push.
- Re-run existing Node, Python and browser gates after integration. Hardware/scanner/BusyBox 1.19 remain unverified.
