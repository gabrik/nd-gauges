# nd-gauges

An OEM-style Mazda Connect dashboard for the MX-5 ND. This integration preserves the layout, arcs, readout cards,
pedal bars and shift cues from `main` at `e496a6e`, and replaces its guessed data pipeline with MiatOff's passive collector.
**Experimental: synthetic host verification only, not real-car validation.**

## Preview

Python 3.10+, Node and Docker:

```sh
python3 dev/run.py --docker busybox:1.25
# Optional: hold a repeatable scenario; Enter pauses/resumes signals.
python3 dev/run.py --docker busybox:1.25 --at 6 --no-browser
```

Open the printed loopback URL. The actual collector publishes raw `live.txt`; `app/data.js` supplies the dashboard's
engineering-value keys. Speed-triggered `LiveSeq` changes, not HTTP success, maintain freshness. Pausing signals
leaves a readable snapshot but shows OFFLINE after two seconds; resuming clears it. Ctrl-C removes the temporary files
and collector container. Native POSIX mode requires GNU awk. BusyBox 1.25 tests do not prove CMU BusyBox 1.19 behaviour.

`dev/serve.py` delegates to this preview. Older JSON simulators are retained for reference only, not the live data path.

## Data and unknowns

- MiatOff raw speed ×0.01 km/h, RPM ×2, throttle ×0.1%, temperatures −40°C.
- Acceleration is centred on raw 4000, converted from m/s² to g. Lateral sign remains provisional.
- Intake air and fuel now populate `intake_air_c` and `fuel_level_pct`; fuel scaling is inherited from MiatOff and
  is not a calibrated litres measurement.
- Gear, brake, steering, oil temperature, odometer, trip kilometres and clutch remain unavailable where no validated
  mapping exists. The UI shows placeholders instead of guessed values. Its rendering tests can supply these fields
  as explicit engineering-value fixtures; they are not evidence that the CMU exposes them.
- MDI icons use a Canvas path fallback when Path2D is absent; ES5 parsing alone is not sufficient browser validation.

No private dumps or usable real recordings were found locally. Replay is opt-in with a narrowly allowed JSONL format;
see [dev/REPLAY.md](dev/REPLAY.md). Never commit recordings or firmware material. EOF stops publishing rather than
pretending an old trace is live. A real trace needs permission, redaction and independent reference readings.

## Applications integration

There is one production entry: **Gauges** in Applications. The adapted MiatOff userscript/app/template borrows disabled
`vdt` and gives the dashboard a full-screen iframe. Back exits and unload stops its timers. Existing MiatOff integration,
a competing entry, or an enabled borrowed app is not hijacked. This route replaces the previous `systemApp.js` and
English dictionary edits; neither file nor Common.js is patched by this installer. No floating launcher is installed.

This differs from the old overlay route tested in mzd-emu. The framework tests and browser checks are synthetic;
**the revised menu path still needs mzd-emu/Opera/MMUI and hardware acceptance**. Current `main`'s original rendering and
launcher fixture tests are retained alongside the adapted MiatOff framework tests.

## USB installer — review before using

```sh
python3 tools/build-usb.py --output dist/usb
```

Use a new or empty output folder and a dedicated FAT32/MBR USB stick. Copy **all** generated files, including the unusual
`$(...).up` ZIP filename. This is not a firmware update: **never accept a Mazda software-update screen; cancel it and
remove the stick if one appears.** No installation, USB launch or recovery has been tested on a real car.

The installer accepts only the analysed 74.00.324A Opera/boot stock hashes, or its own recognised installed state.
Unknown configurations, MiatOff, old nd-gauges layouts, unexpected staging, modified assets and damaged backups are
refused. There is no automated migration from the old `main` installer. A firmware version label alone is not accepted
as proof that patching is safe, and two configuration hashes do not attest a whole firmware image.

The manifest is verified, files are staged/read back, backups retained and config publication is atomic. Opera userscript
activation is last. Failures roll back; interrupted publication is recoverable only with recognised files/backups.
Changes are confined to new app/userscript assets, Opera configuration and `stage_gap2.sh`; collector output lives on tmpfs.
The script attempts to restore the watchdog and read-only mount on normal/error exits; power loss cannot run traps.
Do not timeout or kill a real smdb-read: it may retain a CMU semaphore. Do not modify Common.js.

`UNINSTALL` requests confirmed removal. `ND-GAUGES-RESTORE` requests dialog-free emergency restoration but **does not bypass
unknown-state checks**. Keep the original stick and seek recovery guidance rather than deleting unrecognised state.

The dashboard references the CMU's existing `/jci/fonts/Tipperary*.ttf`; USB payloads exclude the repository's font binaries.
Desktop previews fall back to installed system fonts. The inherited files in `app/fonts/` still need redistribution/licence
review before release; their presence in historical commits does not establish permission.

## Tests

```sh
npm ci
npm test
python3 -m unittest discover -s tests
# Install the usual Playwright browser, or select installed Chrome locally:
ND_BROWSER_CHANNEL=chrome npm run test:browser
# Legacy entry point now runs the guarded install/remove tests:
node dev/test-installer.js
```

The browser test uses the actual collector and this dashboard, disables Path2D, verifies intake/fuel readings, and checks
OFFLINE/recovery. Installer tests run against marked synthetic roots under Docker BusyBox, never host `/jci`.
No new remote CI run is claimed until these changes are signed and published.

## Design and historical research

The editable designs remain under `design/`. The complete previous README, including QEMU research, the Raspberry Pi
probe plan and mzd-emu instructions, is preserved at [docs/MAIN_E496A6E.md](docs/MAIN_E496A6E.md). Those installation and
JSON-preview instructions describe the old implementation, not this branch.

## Attribution and licence

GPL-3.0. MiatOff source is pinned to `5d972dbe3929d39878f0c53353fed35df535d369`; the collector is unmodified. See
[NOTICE](NOTICE), `LICENSE`, and `vendor/miatoff/LICENSE`. The USB launch technique derives from MiatOff/Miatafy TouchTune.
MDI icon artwork retains its existing Apache-2.0 provenance. None of these licences automatically covers firmware fonts.
