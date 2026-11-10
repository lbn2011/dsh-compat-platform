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
   entry's module inside the sandbox — disclosed as `FAILURE_PHASE_READ_BY_REIMPORT`. This is
   the same mechanism the host's own `inactiveEntries(ctx, importNow = true)` uses. It does not
   re-run the module: an ECMAScript module is evaluated at most once per resolved URL, and a
   module that threw during evaluation is cached in its errored state and rethrows the same error
   object. `tests/reimport-cache.test.js` measures all three facts (same namespace, same error
   object, side-effect file written once) instead of assuming them, so the limitation code
   records a residual dependency on the runtime's module cache rather than an observed side
   effect.
4. Writes a receipt (`src/trusted-extraction-receipt.js`, `src/trusted-extraction-supervisor.js`)
   with `certification: false`, `correlation: 'not-established'`, a fixed `notDerived` list and
   a fixed ten-code `limitations` list.
5. Records the network verdict from one outbound attempt made **inside** the sandbox: only an errno
   in `NETWORK_DENY_CODES` is `denied`; a successful connect is `reachable` and fails the gate.
6. Kills a target that outlives its phase budget (`SIGKILL`), records `timedOut`, and reports
   `status: incomplete` with `cleanup: unconfirmed` rather than a truncated green.

## What it does not do

- It does not establish loadability, activation, compatibility or admission for any real
  plugin. Only synthetic fixtures are observed.
- It does not read a production profile.
- It is a boundary against accidental host access, not a proof against hostile code.

## Tests

```bash
node --test --test-concurrency=1 "tests/*.test.js"     # 32 pure tests
```

The bounded observation runs through `scripts/trusted-extraction-batch/`; see
`docs/testing/2026-11-09-trusted-extraction.md` for the first measured rounds and
`docs/testing/2026-11-09-trusted-extraction-failure-paths.md` for the kill path and the observed
network refusal. The shipped 80 s phase budget (rather than a reduced demo budget) is exercised
by `scripts/trusted-extraction-hang-budget/`, recorded in
`docs/testing/2026-11-10-shipped-phase-budget.md`.
