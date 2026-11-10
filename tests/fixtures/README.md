# Publicly documented snapshot, not a drive recording

`miatoff-published-snapshot.txt` transcribes only the individually specified numeric fields from:

https://github.com/CeyssensHelder/MiatOff/blob/5d972dbe3929d39878f0c53353fed35df535d369/collector/README.md#format-of-livetxt

MiatOff describes that example as made from its private October 27, 2026 recording (approximately 122 km/h in sixth).
This is a public documentation excerpt under MiatOff's GPL-3.0-or-later, not access to that private source. See NOTICE.
No private dump was consulted. Ambiguous wheel ranges, ellipses and fields without individual values are omitted.

There are no timestamps and no series of frames. Do not loop this sample or add fictional timing and label it a real replay.
It verifies the decoder against published numbers, not collector parsing of an actual capture or physical calibration.
Unknown brake pressure and slope scales and undocumented gear/steering enums remain unavailable.

Fuel scaling is specifically a software-parity check: MiatOff data.js uses full ≈181 while this README mentions ≈184.
A documentation-derived assertion does not resolve that difference or calibrate fuel volume.

To validate a real recording, the owner must provide an authorised, sanitized telemetry extract with relative timestamps.
Keep it outside Git and use the format/privacy requirements in dev/REPLAY.md. Do not upload complete firmware dumps.
