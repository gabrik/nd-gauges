# Recording-based validation

No real vehicle recording is bundled or has been validated. Public GitHub code searches for CMU D-Bus
recordings did not find a reusable trace. MiatOff's documentation refers to private recordings;
we did not read them. Its published example measurements inform the conversion tests but are not a drive trace.

## What can be shared

An owner may explicitly share a separately sanitized recording of their vehicle data, with permission
for this use. To publish it in the project, obtain explicit redistribution/licensing permission as well.
Do not share firmware dumps, head-unit files, VINs, GPS, wall-clock timestamps, phone data or identifiers.
Never point the replay tool at `dumps/` or `miatoff-dumps/`: it refuses those resolved path components.
That path guard is only a safeguard, not proof that arbitrary files elsewhere are safe to read.

Use newline-delimited JSON with relative seconds and raw fields:

```jsonl
{"t":0,"fields":{"VehicleSpeed":0,"EngineSpeed":400,"LongitudinalAccelerometer":4000,"LateralAcceleration":4000}}
{"t":1,"fields":{"VehicleSpeed":1000,"EngineSpeed":1000}}
{"t":2,"fields":{"VehicleSpeed":2000,"EngineSpeed":1500}}
```

**This example is fabricated, not recorded data.** First time must be zero; subsequent times strictly increase.
Later rows may update a subset of fields. The first snapshot needs `VehicleSpeed` to trigger collector writes.
The tool accepts only the five known fast fields plus the documented slow fields listed in `dev/drive.py`.
Values must be unsigned integers up to 65535. This intentionally restrictive preview format is not a general
smdb capture/export format. Gear, brake-switch and steering enums are deliberately not accepted or interpreted.

```sh
python3 dev/run.py --docker busybox:1.25 --recording /path/to/owner-approved-sanitized.jsonl
```

Snapshots are resampled into the mock D-Bus stream at 10 Hz. At EOF the stream stops and the page goes OFFLINE;
it does not silently loop or keep inventing fresh data. Mock slow reads use a one-second interval for development.
This validates integration/decoding, **not original signal timing, hardware load or physical accuracy**.

## Evidence needed for a real-data claim

Keep these separate:

1. **Replay correctness:** compare output with independently calculated expected values for selected samples.
2. **Physical correctness:** compare with independently observed speed/RPM/temperature and known manoeuvres.
   Copying the same formula into a test is not independent calibration.
3. **On-unit behaviour:** validate MMUI routing, Commander/Back, XHR under Opera Presto, collector load,
   startup, shutdown and install/remove on the supported car/firmware.

Record the trace source, owner permission, firmware/vehicle profile, redactions and comparison method alongside
results. Do not label a synthetic fixture or an uncorroborated replay as a real-car validation.
