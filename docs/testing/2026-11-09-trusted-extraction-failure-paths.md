# Trusted extraction — failure paths (2026-11-09)

Status: **executed, two bounded green rounds.** Closes the two claims the first
extraction slice only asserted: that the network verdict is observed rather than
inferred, and that the phase budget really kills and reaps a wedged target.

The slice that produced the first observation is `docs/testing/2026-11-09-trusted-extraction.md`.
That record's numbers still describe those bytes; nothing here is additive with it.

## 0. Scope and non-claims

- Not a loadability or compatibility result for anything.
- The kill path is demonstrated with a **3 s demo budget**, not the shipped 80 s one. The
  shipped 80 s budget is still covered only by the arithmetic check in `checkBudget`.
- `certification` stays `false`, `correlation` stays `not-established`.
- No production profile was read. The child only ever *attempts* a read of a protected path
  from inside the sandbox, where it is absent.

## 1. What changed

| File | Change |
| --- | --- |
| `packages/runtime/src/isolation-policy.js` | new `NETWORK_DENY_CODES` and pure `networkVerdict(attempt)`; the word is a policy decision, not a supervisor guess |
| `packages/runtime/src/child-probe.js` | one bounded outbound attempt (`--network-target`) written to `network-attempt.json` |
| `packages/runtime/src/trusted-extraction-supervisor.js` | `runSandbox(args, {timeoutMs, killSignal:'SIGKILL'})` uses the **phase** budget; `observeFixture` takes a `budget`; `networkConnect` comes from `networkVerdict`; `--config` now uses `basename(configPath)` |
| `packages/runtime/tests/isolation-policy.test.js` | one new test: the network word follows the observation, and `reachable`/`unknown` fail the sentinel gate (17 in this file, 29 in the package) |
| `scripts/trusted-extraction-batch/failure-paths.mjs` | new: runs the probe with a network attempt, then a hanging fixture under a reduced budget |
| `scripts/trusted-extraction-batch/{payload,run}.sh` | new step 5b; hashed inputs 14 → 17 |
| `examples/trusted-extraction/{config-hang.yml,plugin-hang.mjs}` | a fixture that cannot finish |

## 2. Two real defects found while doing this

1. **`observeFixture` ignored the config it was given.** The child argument was the literal
   `/run-fixture/config.yml`, so every caller got `config.yml` regardless of `configPath` — while
   `inputWitness.config` hashed the path they passed. Harmless in the shipped slice because the only
   caller passed `config.yml`, but it made a hang config silently un-runnable. Fixed to
   `/run-fixture/` + `basename(configPath)`.
2. **A never-settling `apply()` does not hang the boot.** The first hang fixture returned a promise
   that never resolved; the loader does not await an `apply()` return value for a plain plugin, so
   the boot finished and the receipt was green. The fixture now blocks the event loop, which is also
   what a runaway activation looks like from outside. Both attempts are recorded here because the
   first one looked like a passing test of nothing.

A third, smaller one: with an empty sentinel list, `every(...)` is vacuously true and the sentinel
gate passed without testing anything. `failure-paths.mjs` now requires at least one sentinel.

## 3. Rounds

| Round | Run dir | Result |
| --- | --- | --- |
| 1 | `20261108T191557Z-trusted-extraction-batch-868344-1794165357` | exit 0, `verdict=pass`, `memory_peak=35151872` |
| 2 | `20261108T191629Z-trusted-extraction-batch-868581-1794165389` | exit 0, `verdict=pass`, `memory_peak=35520512` |

Both rounds: `tests_exit=0` (29/29), `static_contract=pass`, `isolation_exit=0`,
`fixture_exit=0`, `pids_peak=21`, `hashes=identical`, terminal
`LoadState=not-found ActiveState=inactive SubState=dead MainPID=0`. The two rounds'
`hashes-before.txt` are byte-identical, so this is the same 17 selected inputs twice.

## 4. What the new step measured

Network (observed, from inside the sandbox):

```
networkAttempt = {"label":"network","target":"1.1.1.1:443","attempted":true,"ok":false,"code":"ENETUNREACH"}
sentinelVerdict.networkConnect = "denied"
```

Hang (reduced budget 30/3/2/2):

```
status=incomplete  cleanup=unconfirmed
process = {"status":null,"signal":"SIGKILL","stdoutBytes":0,"stderrBytes":0,"timedOut":true}
phases  = all "not-observed"
checks  = {"isolationGate":true,"networkDenied":true,"networkCodeRecorded":true,
           "hangIncomplete":true,"hangCleanupUnconfirmed":true,"hangTimedOut":true}
failed  = []
```

No process survived the kill: `pgrep -af "trusted-extraction-adapter|plugin-hang|bwrap"` found
nothing after the exploratory run.

The ordinary fixture is unchanged by the `basename` fix: `include active`, `ok active`,
`import-throw failed (import)`, `activate-throw failed (activation)`, five phases observed.

## 5. Deviations

- Three exploratory runs outside any envelope preceded the bounded rounds (one per defect). They are
  recorded here and are not rounds; they produce no evidence.
- The payload was edited **before** round 1 and not after, so both rounds ran the same bytes.
- `failure-paths` writes its exit line into `failure-paths/report.txt` (a subdirectory), so the
  top-level `summary.txt` does not repeat it; the value is in `failure-paths.json` and that report.
- The demo budget is a mechanism demonstration. Claiming the shipped 80 s budget was "tested" would
  be false.

## 6. Files at run time (from `hashes-before.txt`, both rounds)

| File | sha256 |
| --- | --- |
| `packages/runtime/src/isolation-policy.js` | `0166bd0256330a6ce0cf387f44c59e7e3c8866baf9694df86e211d1f4faa7364` |
| `packages/runtime/src/child-probe.js` | `1df524db75f8d0458661e34e3411e2d48e7f449de26e380851aa9fc6b4688259` |
| `packages/runtime/src/trusted-extraction-supervisor.js` | `1f9337d9db7efece251d67017b08669d002a0d66c7d9dc59ccef4b0214a16d3e` |
| `packages/runtime/tests/isolation-policy.test.js` | `f83920efc43f69edefbd00eaad77eb26a851aec2a6e6bd0ae840ed011175b1c9` |
| `scripts/trusted-extraction-batch/payload.sh` | `3c248b3cb02a93db360f06d31f1f5a2c0dcca7e998ca3ed364bdffa54ae18c5a` |
| `scripts/trusted-extraction-batch/run.sh` | `fc7b56da212b79a5687868160f731865196991cb9837428936965c5e7571814b` |
| `scripts/trusted-extraction-batch/failure-paths.mjs` | `4c1726ff38e89af0443bb1e686852a0f74656f3abb1af76d60ad8ee6e6a94658` |
| `examples/trusted-extraction/config-hang.yml` | `0311041aec507fd2a8f6b55b59db9f6c55b04b24d534bb62f5752baf1802593d` |
| `examples/trusted-extraction/plugin-hang.mjs` | `c60e3043d2ab7e3c64a47ecb98aebbb2d8eb8299edceee8b56f2af4f6423f5d8` |

The other eight hashed inputs (adapter, receipt, package.json, unit receipt tests, `config.yml`
and the three normal fixtures) are unchanged from
`docs/testing/2026-11-09-trusted-extraction.md` §7.

## 7. Reproduce

```bash
bash projects/dsh-compat-platform/scripts/trusted-extraction-batch/run.sh
# <run_dir>/failure-paths.json holds the six checks
```
