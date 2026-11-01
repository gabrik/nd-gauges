# nd-gauges

Custom gauges for the Mazda MX-5 ND (Gen 6 Mazda Connect CMU, firmware 74.00.324/324A).

Inspired by Kansei Link and built on the same public mechanisms used by
[Miatafy/TouchTune](https://github.com/Miatafy/TouchTune) (USB install),
[serezhka/mzd_speedometer](https://github.com/serezhka/mzd_speedometer) (overlay + dbus bridge)
and [silverchris/mazda-cmu-documentation](https://github.com/silverchris/mazda-cmu-documentation).

## How it works

```
CAN bus ──> JCI daemons ──> dbus (unix:/tmp/dbus_service_socket)
                                 │
                    gauges-daemon.sh (shell, polls methods +
                                 subscribes to signals)
                                 │
                                 ▼
                    /tmp/nd-gauges/cardata.json   (tmpfs, no flash wear)
                                 │  symlinked from /jci/gui/gauges/cardata.json
                                 ▼
                    Opera userjs overlay (app/gauges.js)
                    polls JSON 5x/s and draws gauges on a <canvas>
```

### Vehicle data sources (dbus)

| Data | Interface | Member | Type |
|---|---|---|---|
| Speed | `com.jci.vbs.bcm` | `GetCarSpeed(uint32 unit)` method | uint32 |
| Gear | `com.jci.vbs.bcm` | `GetGearPos` method | byte |
| Brake pedal | `com.jci.vbs.bcm` | `GetBrkPedalDepressedStatus` method | byte |
| Engine RPM | `com.jci.vbs.vdt` | `EngAout_N_Actl` signal | int16 |
| Throttle % | `com.jci.vbs.vdt` | `ApedPos_Pc_ActlArb` signal | int16 (0.1 % units) |
| Steering angle | `com.jci.vbs.vdt` | `SteWhlComp_An_Est` signal | int16 (0.1 deg units) |
| Lateral accel | `com.jci.vbs.vdt` | `Lateral_Acceleration` signal | int16 (0.001 g units) |
| Longitudinal accel | `com.jci.vbs.vdt` | `VehLong_A_Actl` signal | int16 (0.001 g units) |
| Coolant temp | `com.jci.vbs.vdt` | `EngClnt_Te_Actl` signal — **unconfirmed member name** | int16, °C (guessed, see below) |
| Oil temp | — | **not wired by default** — see below | n/a |
| Intake air temp | — | Unwired (`intake_air_c` stays null); standard OBD-II Mode 01 PID `0x0F` is a candidate | n/a |
| Fuel level | — | Unwired (`fuel_level_pct` stays null); standard OBD-II Mode 01 PID `0x2F` is a candidate | n/a |

> ⚠️ **Coolant temp signal name is a guess, not a confirmation.** It definitely
> exists on the vehicle bus (it drives the stock analog coolant gauge), but
> the member name isn't in any public dbus reverse-engineering docs we could
> find (checked `com.jci.vbs.vdt` and `com.jci.vbs.eem` in full). The default
> in `gauges-daemon.sh` follows this interface's own naming convention
> (compare `EngAout_N_Actl`, `ApedPos_Pc_ActlArb`) but needs confirming with a
> live `dbus-monitor` capture — see Calibration below and the Raspberry Pi
> probe plan. If the name is wrong, `coolant_c` just stays `null` forever
> (same safe-failure behavior as every other guessed value here).
>
> **Oil temp has no default signal at all, on purpose.** SkyActiv-generation
> Mazda engines (including the ND's) have no physical oil temperature
> sensor — community OBD-II research confirms the "oil temp" PID some tools
> show for these engines is an ECU-calculated estimate (from coolant temp,
> RPM, and load), not a sensor reading, and there's no evidence that estimate
> is even mirrored onto the bus the CMU listens to. Rather than guess at a
> signal name for something that may not exist, oil is left disabled
> (`GAUGES_OIL_MEMBER` empty — the overlay just shows `--`). Set it if you
> find a real member via `dbus-monitor`.

> **Intake air and fuel level are display-only placeholders for now.** The
> extracted CMU data schema contains `DR_IntakeAirTemp` and `FuelGaugePosition`,
> but neither is a documented live signal in the public `com.jci.vbs.vdt` API.
> The overlay displays values if supplied; the daemon writes `null` until a
> live CMU signal or an OBD query path is confirmed on the car.
>
> ⚠️ Scaling factors (0.1 %, 0.1 deg, 0.001 g) are educated guesses from signal
> naming conventions. Calibrate against real data on first run — see
> "Calibration" below.

### Install mechanism

The CMU's update scanner executes `.up` filenames found on USB sticks via a shell,
unescaped. The USB stick carries a file whose *name* is a shell script that finds
the mounted stick (via the `GAUGES.ID` marker + its `cksum`) and runs
`install-gauges.sh` as root. Same technique as TouchTune (GPL-3.0).

## Research: CMU emulation (QEMU)

> ⚠️ **Hardware correction:** earlier notes in this section targeted the
> **wrong CPU architecture**. The Gen 6 Mazda Connect CMU application
> processor is an **NXP/Freescale i.MX6D — dual-core ARM Cortex-A9, ARMv7** —
> not SH4/SuperH, running **Linux 3.0.35** from Freescale's `L3.0.35_4.1.0`
> BSP. The SH4 mix-up most likely came from the CMU's separate CAN/LIN gateway
> chip (the "VIP"), which *is* a Renesas part (`R5F35MCEJFB/F`) but is an
> unrelated 16-bit **M16C**-family microcontroller over SPI — it does not run
> Linux and is not the thing `gauges-daemon.sh` talks to over dbus. Confirmed
> independently, on this exact firmware version (`v74.00.324A`), by:
> [Miatafy — CMU Hardware Specs](https://miatafy.com/hardware/platform/),
> [Miatafy — Runtime Analysis](https://miatafy.com/internals/runtime-analysis/),
> [Miatafy — Filesystem & Partition Layout](https://miatafy.com/internals/filesystem/),
> [silverchris/mazda-cmu-documentation — Hardware](https://silverchris.github.io/mazda-cmu-documentation/hardware.html)
> (live `/proc/cpuinfo`: `ARMv7 Processor rev 10 (v7l)`, `Hardware: JCI i.MX...`),
> and the [ZDI teardown](https://www.thezdi.com/blog/2024/11/7/multiple-vulnerabilities-in-the-mazda-in-vehicle-infotainment-ivi-system)
> identifying the die as `SCIMX06DAVT10AC` (i.MX6).
>
> Additional detail worth carrying forward: the root filesystem is **not
> ext4** — it's **Datalight Reliance Nitro on a FlashFX NAND** translation
> layer, a proprietary flash filesystem. Mounting a real extracted rootfs
> image (vs. a hand-built busybox disk) will need its own driver/translation
> story, independent of the CPU-architecture fix below.

Before building the dev harness we attempted to fully emulate the CMU's
firmware under QEMU so we could run the real JCI daemons and dbus interfaces
locally. Here is what we tried and where it stands (as run against the wrong
architecture — see correction above; a retry against ARM/i.MX6 is future work).

### What we did

| Step | Outcome |
|---|---|
| Extracted firmware from `cmu150_EU_74.00.324A_update.up` (assumed SH-4A rootfs + kernel — **incorrect**, see correction above; real target is ARM Cortex-A9) | ✅ Full rootfs extracted |
| Built `qemu-system-sh4` + cross-toolchain in Docker (Ubuntu 22.04) | ✅ Kernel and guest image compiled |
| Booted the stock CMU kernel under QEMU (`-M r2d`, `-cpu sh4a`) — a Hitachi SH4 devkit board, unrelated to the real i.MX6 hardware | ✅ Kernel boots to init panic (missing `/dev`) |
| Constructed a minimal ext4 guest disk with busybox userspace | ✅ Shell reachable via serial |
| Started JCI daemons inside the guest | ❌ Daemons crash — depend on proprietary hardware init (`jci-hwm`, `/dev/cmu*` char devices) |
| Exposed emulated dbus socket to macOS host | ❌ Not reached — blocked by daemon crash |

### Why it stalled

The JCI middleware stack initialises a chain of proprietary hardware-manager
daemons (`jci-hwm`, `jci-sm`, `jci-audio`) that open CMU-specific `/dev` nodes
(power management, audio DSP, CAN bridge). QEMU has no model for these devices,
and the daemons abort without them — taking dbus with them.

Emulating those devices would require reverse-engineering closed-source kernel
modules, which is a multi-month effort by itself. This is independent of the
architecture mistake above — the Hitachi `r2d` SH4 devkit board was never
going to expose `/dev/cmu*`-style nodes, but neither would a generic ARM board
model out of the box. A retry should target `qemu-system-arm` with a machine
model closer to the real i.MX6 SoC (e.g. `-M sabrelite`), which at least
models real i.MX6 peripherals instead of an unrelated Hitachi devkit — a
meaningfully better starting point, though the missing proprietary `/dev`
nodes problem likely still applies.

**On-ARM-host note:** the i.MX6D app CPU is 32-bit ARMv7 (Cortex-A9). Any
64-bit ARMv8-A host (e.g. aarch64 Android devices, since AArch64 cores retain
AArch32/ARMv7 execution support) is a much closer TCG host/guest ISA match
than x86_64, and QEMU's ARMv7 TCG target is far more mature than its SH4
target — worth factoring into the choice of dev/build host for a retry.

### Plan B — Raspberry Pi probe

Instead of full emulation we will attach a **Raspberry Pi 4** to the CMU's
exposed UART/SSH interface while the car is running, and proxy the live dbus
socket to a laptop for offline analysis. This gives us real signal values,
correct scaling factors, and actual byte mappings for the gear-position enum —
everything the dev harness currently has to guess.

The QEMU lab scripts live in
[`MazdaConnect-QEMU`](https://github.com/gabrik/mazda-research/tree/main/MazdaConnect-QEMU)
(separate repo) for reference.

---

## Testing the stock UI without a car (mzd-emu)

The QEMU kernel-boot path above is blocked on a hardware machine-ID mismatch
(the proprietary kernel panics in QEMU's `sabrelite` board model before it even
reaches UART init — see "Why it stalled" above) and isn't needed for UI/app
testing anyway. For that, **[ScorpAL/mzd-emu](https://github.com/ScorpAL/mzd-emu)**
runs the **real, unmodified** stock Mazda Connect GUI (the actual HTML5/JS/CSS
firmware code) in a regular modern browser via two small local Node.js
servers — no kernel, no QEMU, no car required. It's built against firmware
**74.00.324 EU N**, matching this project's target firmware exactly.

This has been run end-to-end on this project's firmware: real Mazda boot
splash → distraction-warning disclaimer → live, clickable rotary-menu home
screen, all rendered in Chrome.

### 1. Extract the stock GUI from the `.up` firmware file

The `.up` file is a password-protected ZIP (not a custom encryption scheme).
The password below is public knowledge, independently confirmed across
multiple Mazda-modding forum threads:

```sh
UP_FILE="/path/to/cmu150_EU_74.00.324A_update.up"
PASSWORD='5X/9vAVhovyU2ygK'

mkdir -p /tmp/cmu-extract && cd /tmp/cmu-extract
unzip -P "$PASSWORD" "$UP_FILE" "rootfs1upd/*"
zcat rootfs1upd/e0000000001.dat.gz > rootfs.tar.gz
```

`rootfs.tar.gz` contains the CMU's full root filesystem, including the
`jci/gui/` tree mzd-emu needs — no further decryption or parsing required.

### 2. Set up mzd-emu

```sh
git clone https://github.com/ScorpAL/mzd-emu.git
cd mzd-emu
npm install                                        # needs Node.js 20.19+

mkdir -p jci
tar xzf /tmp/cmu-extract/rootfs.tar.gz -C . ./jci  # places the jci/ tree here
```

### 3. Set the vehicle profile to an actual MX-5 (important!)

**mzd-emu's default config is not an MX-5 — it's a 2nd-gen Mazda CX-9.**
Mazda's internal vehicle-model codes (`SETTINGS_VehicleModelType_*`) are
publicly documented; cross-checking them against
[Wikipedia's Mazda project-code list](https://en.wikipedia.org/wiki/User:KA467/Mazda_project_codes)
gives an exact mapping:

| Code | Model | Chassis |
|---|---|---|
| `J78A` (mzd-emu's shipped default) | Mazda CX-9 (2nd gen) | `TC` |
| **`J12A`** (what we want) | **Mazda MX-5 (ND)** | **`ND`** |

This isn't cosmetic — it changes real menu behavior. The CX-9 profile ships
with a head-up display, which the MX-5 ND **never offered on any trim**
(confirmed independently across multiple MX-5 owner forums); left at the
default, the emulator's settings menus show a HUD brightness/style screen
that doesn't exist on a real MX-5 ND, and some vehicle-settings branches key
off `vehicleType === J78A` specifically.

Two edits fix this:

```sh
# server/config/vehicle.json — change:
#   "vehicleType": "SETTINGS_VehicleModelType_J78A"
# to:
#   "vehicleType": "SETTINGS_VehicleModelType_J12A"
```

```sh
# server/mmui/services/vehicleEquipment.js — change:
#   Hud_Installed: 1,
# to:
#   Hud_Installed: 0, // the MX-5 ND never offered a factory HUD
```

`J12A` is already a recognized value in mzd-emu's own validation list
(`server/mmui/services/settings.js`), so no other code changes are needed.
Restart the servers after editing either file.

### 4. Run it

```sh
npm start
```

This starts both servers together — the GUI HTTP server on port 8080, and a
WebSocket "MMUI" backend on port 2700 that stands in for the head unit's
internal software — and opens your default browser to:

```
http://localhost:8080/jci/gui/index.html
```

**Resize the browser window/tab to 800×480** to match the real CMU's screen
resolution — mzd-emu's canvas-based elements (including the nd-gauges overlay
below) size themselves to the window, so a full desktop window makes
everything look stretched/oversized compared to the real head unit.

Controls (mapped to the real rotary-controller input):

| Key(s) | Emulates |
|---|---|
| `←` `→` `↑` `↓` | Tilting the rotary knob |
| `Enter` | Pushing (clicking) the knob |
| `N` / `M` | Rotating the knob CCW / CW |
| `Backspace` | The dedicated Back button |

Stop both servers with `Ctrl+C`.

### Testing the nd-gauges overlay inside mzd-emu

`nd-gauges`'s own overlay (`app/gauges.js`, `app/gauges.css`) is plain
HTML/JS/CSS injected into this same Opera-based UI, so mzd-emu can run it
for real, on top of the actual stock firmware UI — not just the standalone
`dev/` mock harness below (which focuses on the dbus → JSON daemon side, not
on-screen rendering). This has been verified working end-to-end.

mzd-emu's own README states `jci/` is a read-only firmware dump it never
modifies on disk. To respect that, wire the overlay in through mzd-emu's
existing browser-shim injection point (`client/ui-polyfills.html`, served at
`/emulator/`) instead of editing `jci/gui/index.html` directly:

```sh
# 1. Copy the overlay script next to mzd-emu's own browser shims
cp /path/to/nd-gauges/app/gauges.js mzd-emu/client/ndgauges.js

# 2. Place gauges.css and a sample cardata.json at their real on-car paths
#    (jci/gui/gauges/ is a new subdirectory — nothing existing is overwritten)
mkdir -p mzd-emu/jci/gui/gauges
cp /path/to/nd-gauges/app/gauges.css mzd-emu/jci/gui/gauges/gauges.css
cat > mzd-emu/jci/gui/gauges/cardata.json << 'EOF'
{
  "rpm": 3200,
  "speed_kmh": 72,
  "gear": 4,
  "throttle_pct": 45,
  "brake": false,
  "lat_g": 0.3,
  "long_g": 0.1,
  "steer_deg": -8.5
}
EOF
```

Then add two lines to `mzd-emu/client/ui-polyfills.html`, right after its
existing `<script src="/emulator/ui-wayland.js"></script>` line:

```html
<script>
    window.GAUGES_DEV = true; // always show the launcher, skip framework checks
</script>
<script src="/emulator/ndgauges.js"></script>
```

Restart `npm start`, reload the browser, and a **GAUGES** button appears over
the stock UI; clicking it opens the full overlay panel, polling
`jci/gui/gauges/cardata.json` exactly like it would on the real car. Edit the
sample JSON values (or point `window.GAUGES_DATA_URL` at a live feed from the
`dev/` harness's `dev/simulator.py`) to drive the gauges with different data
without touching anything under `jci/`.

---

## Local development & testing (no car needed)

Everything except the final USB install can be tested on a Mac/Linux laptop:

```sh
# 1. Full daemon integration test (mock dbus + simulated driving data)
sh dev/test-daemon.sh

# 2. Visual test of the overlay UI in a browser
python3 dev/simulator.py &                                    # fake car data
GAUGES_STATE_DIR=dev/state GAUGES_OUT=dev/out/cardata.json \
  PATH="$PWD/dev/mock-dbus:$PATH" sh cmu/scripts/gauges-daemon.sh &
python3 dev/serve.py                                          # http://localhost:8765/dev/
```

- `dev/simulator.py` generates a realistic drive scenario (idle → launch through
  gears → cruise → braking → cornering) into `dev/state.json`.
- `dev/mock-dbus/dbus-send` / `dbus-monitor` emulate the CMU's dbus replies from
  that state, so the **unmodified** daemon shell code runs locally.
- `dev/serve.py` + `dev/index.html` load the **unmodified** overlay app with a
  mocked JCI `framework` object.

What still requires the car: the `.up` filename injection, the install script,
real dbus scaling factors, and the gear-position byte mapping.

## Car installation (USB)

```sh
sh tools/build-usb.sh            # produces dist/usb/
# copy dist/usb/* onto a FAT32 (MBR) USB stick, including the weird $(...).up file
```

1. Settings → System → About must show **74.00.324** or **74.00.324A**.
2. Car on, insert stick, confirm the nd-gauges dialog.
3. The installer copies files, starts the daemon immediately, and reboots the GUI.

Uninstall: put an empty file named `UNINSTALL` next to `GAUGES.ID` on the stick.

### Files installed on the CMU

| Path | What |
|---|---|
| `/jci/opera/opera_dir/userjs/ndgauges.js` | overlay app (auto-loaded by the UI) |
| `/jci/gui/gauges/gauges.css` | overlay styles |
| `/jci/gui/gauges/cardata.json` | symlink → `/tmp/nd-gauges/cardata.json` |
| `/jci/scripts/gauges-daemon.sh` | dbus → JSON bridge |
| `/jci/scripts/gauges-ctl.sh` | start/stop/status helper (SSH) |

Daemon autostart across boots: the installer starts the daemon for the current
boot and appends a guarded line to the first writable startup hook it finds
(candidate list in `install-gauges.sh`). Verify after first install over SSH;
the overlay shows **OFFLINE** when the daemon is not running (data > 2 s old).

### Applications-list integration (OEM+ tile)

By default the overlay is just a floating **GAUGES** button that appears
while the Applications screen is open — functional, but obviously bolted on.
To make it look like it shipped from the factory, the installer also adds a
real **nd-gauges** row to the actual Applications list, styled identically to
CarPlay, Android Auto, and Vehicle Status Monitor and selectable the same way
(rotary knob or touch).

This works because the real Applications list isn't an extensible
plugin registry — it's a fixed array hardcoded in `systemApp.js`
(`_initApplicationsDataList`), which is plain, uncompiled JavaScript sitting
on the CMU's filesystem (not a compiled `.so`), so it's directly editable.
Selecting any row sends an `mmuiEvent` string to the native MMUI backend over
websocket; a brand-new event like `SelectNdGauges` means nothing to that
compiled backend, so `gauges.js` patches `framework.sendEventToMmui` (looked
up fresh on every call, so there's no load-order race) to intercept that one
event client-side and open the panel directly, passing every other event
through unmodified.

`install-gauges.sh` handles this patch itself:

- Backs up `systemApp.js` and its English string dictionary
  (`systemAppDict_en_US.js`) to `*.nd-gauges-orig` before editing, once.
- Inserts one row into `_initApplicationsDataList`'s array and registers its
  `appName` in both branches of `_applicationsCtxtWiseAppNames` (the function
  that filters which rows actually render).
- Validates the result (checks the new strings exist, and that `{`/`}` counts
  stay balanced in both files) before declaring success. If validation fails,
  it immediately restores both files from the backup rather than leaving a
  possibly-broken systemApp.js in place.
- Is idempotent: running the installer again when already patched is a no-op.
- Uninstall restores both files from the `*.nd-gauges-orig` backups exactly.

This was built and verified against the real, unmodified firmware GUI code
running in [mzd-emu](#testing-the-stock-ui-without-a-car-mzd-emu) — confirmed
end-to-end: the row appears in Applications next to the real OEM entries,
focusable/selectable via the same rotary-controller keys as any other row,
and opens the gauges panel on select.

**The tradeoff**, honestly: this is the one place nd-gauges patches an
existing stock file rather than only adding new ones (see Safety below). A
firmware update will overwrite `systemApp.js` back to stock, silently
dropping the patch (and the backup, since it gets overwritten too) —
re-running the installer reapplies it. If you'd rather keep the zero-stock-
file-modification guarantee, delete the `patch_applications_list` /
`restore_applications_list` calls from `install-gauges.sh`; the floating
button keeps working either way, since it doesn't depend on this patch at all.

## Calibration

After first install, SSH into the CMU and watch real values:

```sh
sh /jci/scripts/gauges-ctl.sh status
tail -f /tmp/nd-gauges/cardata.json      # hmm: use cat in a watch loop
```

Compare at idle (rpm ~800, throttle 0, steer 0, g ~0) and adjust the
`GAUGES_SCALE_*` factors at the top of `cmu/scripts/gauges-daemon.sh`.

For coolant specifically: `coolant_c` staying `null` after the engine is
running means `GAUGES_COOLANT_MEMBER`'s guessed name doesn't match what's
actually on the bus. Find the real one with a raw `dbus-monitor` capture
(the Raspberry Pi probe plan above is the intended way to do this on a live
car) and set `GAUGES_COOLANT_MEMBER`/`GAUGES_SCALE_COOLANT`/
`GAUGES_COOLANT_OFFSET` to match. Oil stays `null` by design unless you find
and set `GAUGES_OIL_MEMBER` yourself (see the data table above for why).

## Visual design

The overlay's look (fonts, colors, header chrome) is pulled directly from
the real firmware, not guessed:

- **Font**: the actual `Tipperary` family shipped on the CMU
  (`/jci/fonts/Tipperary.ttf`, `TipperaryBold.ttf`, `TipperarySemibold.ttf`),
  copied into `app/fonts/` and loaded via `@font-face` in `gauges.css`. This
  is the exact font `jci/gui/common/css/common.css` sets as the UI default.
- **Accent color**: `#ff2801`, confirmed by grepping every stock CSS file in
  the extracted firmware — it alone accounts for ~74 occurrences, used for
  every focus/highlight/redline state across the real UI. Not a guess, not a
  "close enough" red.
- **Secondary text**: `#c8c8c8`, the real dimmed/disabled-row color (visible
  on the stock Applications screen when CarPlay/Android Auto are
  unavailable).
- **Header bar**: a back-arrow + title strip matching the real chrome used
  by every stock list screen (Settings, Applications, etc.), so the overlay
  reads as a native screen instead of something bolted on top.
- **Temperature color coding**: readings shade from a cool blue (below
  normal operating range) through white (normal) to the stock warning amber
  and finally the stock accent red (overheating) — `CFG.coolantCold`/
  `coolantHot`/`oilCold`/`oilHot` in `gauges.js` control the thresholds.

### Real analog gauges, not just digits

The current display uses four stacked arc gauges: coolant above oil on the
left, intake-air temperature above fuel level on the right. Each arc has a
sliding tick-style needle, a dark unfilled track, a filled section, fixed scale
labels, and an icon. Temperature arcs retain blue/cool and red/hot end caps;
the fuel arc marks the low-fuel end in red and fills toward the reading. Its
pump icon includes a left-pointing marker for the MX-5's filler side. The
intake-air and fuel gauges show `--` on the car until their live data sources
are confirmed; the local dev fixture supplies sample values for layout work.


The center holds compact gear and G-force readouts, with steering, throttle,
and brake status below. The tachometer and speedometer are omitted from this
layout.

The four-gauge layout was checked in the local harness at the fixed
800×480 CMU resolution. The Applications-list tile and overlay had previously
been verified end-to-end in mzd-emu.

## Safety

- Root filesystem is remounted read-write only for the duration of the install,
  with the CMU watchdog disabled and re-enabled afterwards (same pattern as
  TouchTune). Runtime data goes to tmpfs only.
- The overlay draws on top of the UI and only adds new files, with one
  deliberate exception: `systemApp.js` is patched to add the Applications-list
  tile (see [above](#applications-list-integration-oem-tile)), backed up
  first and restored exactly on uninstall. No other stock file is touched.
- Gauges are **not** a replacement for the stock instruments. Track/offroad use.
- Modifying the CMU can brick it and may void warranty. You are on your own.

## License

GPL-3.0 (derives install technique from Miatafy/TouchTune).
