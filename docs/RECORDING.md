# Read-only vehicle recording stick

This is a narrow adaptation of MiatOff's CALIBRATE workflow, **not** its FULL dump tool. It captures only the vehicle
fields supported by nd-gauges replay. It does not install gauges, patch firmware/configuration, remount filesystems,
change watchdog/NVRAM, copy firmware files, query GPS or record a raw bus dump. It writes recordings on the USB and
uses a private lock/FIFO/slow-snapshot directory under /tmp. Root execution through the update-scanner filename trick
is still experimental: read-only intent is not a guarantee of safety. Not tested on a real CMU or BusyBox 1.19.

## Build and copy

```sh
python3 tools/build-recorder.py --output dist/recorder-usb
```

Needs Python 3.10+. Output must be new/empty; this builder creates files but **does not format or verify a physical
volume's partition scheme**. Prepare a dedicated empty FAT32/MBR stick (MiatOff recommends ≤32 GB). Verify the correct
volume with `diskutil info` on macOS, `lsblk -o NAME,PTTYPE` on Linux, or `Get-Disk` in PowerShell. Do not reformat a
volume without checking its identity and backups. Copy **all** generated files, including `jci-autoupdate`,
`ND-RECORD.ID` and the unusual `$(...).up` ZIP filename. Never combine this with an installer or MiatOff stick.

Remove other USB sticks. Safely eject it. Keep the car stationary initially, engine running in a ventilated location.
Insert after the home screen is ready, then confirm the **Gauges recorder** prompt. Cancellation does not start capture.
If a **Mazda software-update screen** appears, **cancel and remove the stick**, never approve a firmware update.

## Record

The capture runs for 300 seconds. A passenger operates the display; no aggressive or public-road calibration manoeuvres
are required for pipeline validation. If driving is needed, do it safely and legally. Do not shut off ignition or remove
USB while recording. Wait for the completion dialog before removing it. Slow reads may delay completion beyond five
minutes: they must finish rather than be forcefully terminated. Never timeout/kill a real `smdb-read`.

The recorder refuses to start if it sees a live collector PID at `/tmp/nd-gauges/collector.pid` or
`/tmp/miatoff/collector.pid`, or an existing recorder lock. It does not stop or take over the collector. Do not kill a
collector's process group to get past this check; use a boot without that collector or arrange a separately reviewed
shutdown. A lock left by an interrupted session is refused; don't blindly delete it while a read may still be active.

Missing D-Bus tools/socket, failed integrity checks or missing confirmation UI fail closed. Early preflight refusal can
be silent because no capture started. A successful confirmation is not proof of completed capture: inspect the result.

## Output and privacy

```
recordings/0001/
  session.jsonl        # complete, nonempty recording
  meta.txt            # format, requested duration and completion status
```

Sessions increment without overwriting earlier folders. Interrupted/failed captures retain `session.jsonl.part` and
an incomplete status when possible. Power loss cannot run cleanup or guarantee the last write survives. Keep partial
files for review; they may have an incomplete final JSON line. Do not rename one as complete without validation.

D-Bus capture permits only five `com.jci.vbs.vdt` uint16 signals: speed, RPM, throttle and longitudinal/lateral
acceleration. JSONL snapshots are emitted on speed events. Slow readings are taken serially every ten seconds (plus
read time): coolant, intake/outside temperature, yaw rate, brake pressure, fuel and slope. These numeric fields are
whitelisted **before persistence**; all other smdb output is discarded in the pipe. No trip/odometer, wheel counters,
undocumented enums, diagnostics, NMEA/PASCD, location, identifiers or phone data are included.

Relative timestamps start at the first valid speed frame and use host uptime sampled on signal receipt. They are not
precise CAN hardware timestamps. Equal-time speed frames are skipped. No valid speed means no complete session.
Unknown scales remain unknown: recording brake pressure does not turn it into a calibrated pedal percentage.

Review before sharing anyway: driving behaviour is private, and a filter is not an independent privacy audit. Keep
recordings outside Git; `recordings/` and build output are ignored. Do not upload a full MiatOff/firmware dump instead.

## Validate and replay locally

Copy only the recording to a private local `recordings/` folder, then:

```sh
python3 dev/run.py --docker busybox:1.25 --recording /path/to/recordings/0001/session.jsonl
```

The replay loader checks its strict field/time/value schema and size limit before startup. It rejects raw private-dump
paths and unknown fields. The preview resamples the recorded state at about 10 Hz; it is not an exact reproduction of
original signal scheduling. EOF stops traffic and the dashboard becomes OFFLINE. Retain original timestamps for any
future calibration analysis; synthetic or resampled replay alone is not physical calibration evidence.

The recorder's complete JSONL is already in this restricted replay format; no firmware or broad dump import is needed.
If needed, MiatOff's richer calibration workflow is documented upstream, but its raw logs require separate sanitization
and are not accepted directly by our loader.

## Tests and provenance

```sh
python3 -m unittest discover -s tests -p test_recorder.py
```

Docker BusyBox 1.25 tests cover the actual shell/filter, relative timestamps, schema compatibility, privacy exclusions,
builder refusal, launcher ambiguity, payload tampering, conflicting collector refusal and interruption/in-flight read
completion. No real firmware/configuration is used. Script design/timestamping and launcher derive from MiatOff at
`5d972dbe3929d39878f0c53353fed35df535d369`; GPL-3.0-or-later, see NOTICE and vendor/miatoff/LICENSE.
