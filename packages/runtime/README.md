# @dsh-ecosystem/dsh-compat-trusted-extraction (draft)

Read-only observation of a **synthetic** DSH profile's entry outcomes, inside a bubblewrap
boundary. This package is the separately disclosed trusted-extraction path: unlike the inert
JSON analyzers, running it **executes code**, so it is kept apart from `diagnose`/GUI and
never enters their envelopes.

## What it does

1. Probes the boundary first: identity, mount allowlist, write attempts, sentinels
   (`src/child-probe.js`, `src/isolation-policy.js`). A failed gate refuses before any target
   code runs.
2. Boots the fixture's entry-list YAML through the official `@deepseek-ai/dsh-app-boot`
   `boot()` and reads each entry's final `fiber.state`
   (`src/trusted-extraction-adapter.js`).
3. Distinguishes an import failure from an activation failure by re-importing the failed
   entry's module inside the sandbox — disclosed as `FAILURE_PHASE_READ_BY_REIMPORT`.
4. Writes a receipt (`src/trusted-extraction-receipt.js`, `src/trusted-extraction-supervisor.js`)
   with `certification: false`, `correlation: 'not-established'`, a fixed `notDerived` list and
   a fixed nine-code `limitations` list.

## What it does not do

- It does not establish loadability, activation, compatibility or admission for any real
  plugin. Only synthetic fixtures are observed.
- It does not read a production profile.
- It is a boundary against accidental host access, not a proof against hostile code.

## Tests

```bash
node --test --test-concurrency=1 "tests/*.test.js"     # 28 pure tests
```

The bounded observation runs through `scripts/trusted-extraction-batch/`; see
`docs/testing/2026-11-09-trusted-extraction.md` for the measured rounds.
