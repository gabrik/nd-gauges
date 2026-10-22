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

> ⚠️ Scaling factors (0.1 %, 0.1 deg, 0.001 g) are educated guesses from signal
> naming conventions. Calibrate against real data on first run — see
> "Calibration" below.

### Install mechanism

The CMU's update scanner executes `.up` filenames found on USB sticks via a shell,
unescaped. The USB stick carries a file whose *name* is a shell script that finds
the mounted stick (via the `GAUGES.ID` marker + its `cksum`) and runs
`install-gauges.sh` as root. Same technique as TouchTune (GPL-3.0).

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

## Calibration

After first install, SSH into the CMU and watch real values:

```sh
sh /jci/scripts/gauges-ctl.sh status
tail -f /tmp/nd-gauges/cardata.json      # hmm: use cat in a watch loop
```

Compare at idle (rpm ~800, throttle 0, steer 0, g ~0) and adjust the
`GAUGES_SCALE_*` factors at the top of `cmu/scripts/gauges-daemon.sh`.

## Safety

- Root filesystem is remounted read-write only for the duration of the install,
  with the CMU watchdog disabled and re-enabled afterwards (same pattern as
  TouchTune). Runtime data goes to tmpfs only.
- The overlay draws on top of the UI; it does not patch `Common.js` or any
  stock file. Uninstall removes only files it created.
- Gauges are **not** a replacement for the stock instruments. Track/offroad use.
- Modifying the CMU can brick it and may void warranty. You are on your own.

## License

GPL-3.0 (derives install technique from Miatafy/TouchTune).
