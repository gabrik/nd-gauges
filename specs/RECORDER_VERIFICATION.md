# Recorder verification (synthetic only)

Implementation: separate recorder stick; no changes to the vendored collector, decoder or dashboard.
Source provenance: MiatOff CALIBRATE timestamping/lifecycle and collector mappings, pinned in NOTICE.

## Evidence

- Initial recorder tests failed before the new builder/filter existed. Commit 91d233b specifies that contract;
  implementation fc7c28d passed those tests. Both commits are signed.
- Expanded BusyBox recorder suite: nine passing tests, covering real entry-script capture with fake tools, whitelist
  privacy filtering, speed-clocked relative time and replay schema, slow-field joins, normal shutdown and interruption
  while smdb-read is in flight, partial preservation, tampering, two matching sticks, existing collector refusal,
  empty-output refusal, safe launcher components and unchanged installer launcher bytes.
- Full `npm test`: 14 passing tests/entries. Full Python discovery: 24 passing tests in 43.813 s.
- Browser: actual collector to current dashboard, no Path2D, OFFLINE/recovery; one passing test, 6.6 s total.
- Python compilation, recorder shell syntax and git diff --check passed. Original main stayed clean.
- All recorder execution was inside Docker BusyBox 1.25 with a marked synthetic root and fake monitor/smdb commands.
  Tests did not execute against host /jci, actual firmware or a real smdb process.

## Explicit limitations

No physical USB scanner/CMU/MMUI/dialog, BusyBox 1.19 or real-drive acceptance. Read-only is not risk-free.
Five-minute recording includes only supported numeric fields; it is not a full MiatOff calibration log. Timestamps
are receipt/uptime based; replay resamples state at about 10 Hz. Unknown scaling/enums remain unresolved.
No existing collector is stopped. Existing/stale recorder locks are refused, not automatically removed.
A blocked smdb read may delay exit indefinitely: safety takes priority over a forced timeout.
Power loss cannot run cleanup; partial output may need manual validation. No actual capture is committed or published.
