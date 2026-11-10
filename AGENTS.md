# nd-gauges contributor guardrails

Read README.md and specs/PORT_V2.md before changing vehicle integration.

- Never read, copy, commit or publish `dumps/`, `miatoff-dumps/`, firmware images or private recordings.
  Only use explicitly supplied, owner-approved sanitized traces. Synthetic fixtures are not real recordings.
- The collector in `vendor/miatoff/` is an unchanged upstream snapshot; preserve its licence and NOTICE provenance.
  Do not kill or timeout `smdb-read`. Do not silently add vehicle method polling.
- On-car JavaScript must parse as ES5 (Opera Presto). Shell must run under BusyBox ash/awk.
- Unknown enum/scaling values must remain unavailable; do not infer neutral/reverse, brake state or steering from guesses.
- Never patch Common.js. Only exact known stock or recognised installed configs may be changed.
  No broad removals, arbitrary startup hooks, firmware bypasses or automatic takeover of other mods.
- Exercise installers only inside the marked synthetic root under Docker. Never run an install on the development host.
  Test hash substitutions belong only in disposable test-script copies, never production environment variables.
- Use signed commits (`git commit -S`) on a feature branch. No push, car installation or deployment without operator approval.
- Report synthetic, permitted replay and on-car evidence separately. Do not describe the port as stable/car-tested.

Checks:

```sh
npm ci
npm test
python3 -m unittest discover -s tests
npm run test:browser  # Docker and a supported Playwright Chromium; ND_BROWSER_CHANNEL=chrome can use installed Chrome
```

`tests/test_install.py` checks tampering, conflicts, exact removal, failed publications, interruption and USB selection.
`tests/test_collector.py` runs the actual unchanged collector with fabricated inputs. `dev/run.py` serves only the app and
live.txt on loopback. Recording requirements are in dev/REPLAY.md.
