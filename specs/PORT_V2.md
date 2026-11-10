# Revised MiatOff integration

Approved direction: revise PR1 independently, reconstruct the backport from latest main rather than rebasing the dirty
old worktree. Main base e496a6e; old worktree nd-gauges-miatoff-port retained unchanged.

## Tasks and verification

- Preserve latest dashboard and its engineering-value rendering fixtures → `npm test` (native and no-Path2D cases).
- Add raw decoder using current intake/fuel names, explicit unavailable gauges and sequence freshness → `npm test`.
- Reuse unchanged collector, opt-in replay and synthetic harness → `python3 -m unittest discover -s tests`.
- Reconcile menu with MiatOff's guarded app/template; no systemApp/dictionary changes; reject legacy installs → framework
  Node suite and BusyBox installer tests. Full mzd-emu/car acceptance remains outstanding.
- Exclude firmware fonts from USB; use installed fonts → inspect generated MANIFEST and assert no TTF payload.
- Exercise actual collector/new dashboard without Path2D, intake/fuel readings, OFFLINE and recovery → browser test.
- Preserve old README as explicitly historical documentation; replace obsolete preview/installer test entry points.
- Require signed commits. The operator unlocked GPG; implementation commit 097d7d4 is signed and verified locally.
  No unsigned commits were created. Publication of the nd-gauges branch remains a separate operator decision.

## Decisions

The Applications label and OEM appearance remain, but the implementation uses the prior MiatOff app/template adapter
rather than carrying forward unguarded stock-file edits. This tradeoff was announced explicitly. No old-layout migration
is attempted without proven hashes/backups. Canvas fallback supports exactly the absolute SVG commands used in the
existing MDI icons, not arbitrary SVG. Production receives raw data only; old rendering fixtures inject a test adapter.

PR1 has no dashboard/firmware dependency. Its revision adds independent intake/outside/fuel conversion checks and rejects
malformed NUL-containing paths with HTTP 404 instead of aborting a handler thread. A new malformed-path test reproduced
the failure before the fix. Keep replay, OEM menu/firmware emulation and our dashboard out of that PR.
