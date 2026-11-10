# Shipped phase budget, measured — 2026-11-10

## Status and scope

**Actual result: two bounded rounds, both `acceptance_exit=0`.** In each round the wedged
fixture ran under the policy's own `BUDGET` (`phaseSeconds: 80`), was killed with `SIGKILL`,
and produced a receipt that says `status: incomplete`, `cleanup: unconfirmed`,
`process.timedOut: true`. Control and selected hash manifests were byte-identical between the
two rounds, and each round's before/after pair showed no drift.

Runs:

| Round | Run directory | Exit | Peak memory | Peak pids | `MemAvailableKiB` |
|---|---|---|---|---|---|
| 1 | `/data/dsh-ecosystem-test-artifacts/runs/20261110T105628Z-trusted-extraction-hang-1363152-2208` | 0 | 43442176 B | 21 | 1367804 |
| 2 | `/data/dsh-ecosystem-test-artifacts/runs/20261110T105807Z-trusted-extraction-hang-1363541-8092` | 0 | 36483072 B | 21 | above the 819200 gate |

What this does **not** establish: nothing about loadability, activation or readiness of any
plugin; nothing about a real profile; nothing about hostile code. The target is a synthetic
fixture whose `apply()` spins forever, observed inside the same isolation boundary the main
batch uses.

## What was open, and what closed it

`docs/requirements-and-design/2026-11-09-isolation-checklist.md` Gate 4 said the kill path had
run "with a reduced demo budget" and that "the arithmetic for the shipped 80 s budget
(120 > 80 + 10 + 20) is still only asserted statically". That inequality was not a
measurement. This slice turns it into one.

`scripts/trusted-extraction-batch/failure-paths.mjs` gained `--budget-profile demo|shipped`.
The `shipped` profile is **imported from `packages/runtime/src/isolation-policy.js`**, not
restated, so the suite cannot drift from the numbers the product enforces; the probe refuses
`64` if the selected budget fails `checkBudget`.

Because 80 s of phase budget cannot share a 120 s envelope with the unit tests and the normal
fixture observation, the measurement lives in its own slice:
`scripts/trusted-extraction-hang-budget/{run.sh,payload.sh}`. It still runs the isolation probe
first — a kill path observed outside a verified boundary would not mean much.

## What each round recorded

`attestation.txt` in both rounds, byte-identical:

```
budget_profile=shipped
phase_seconds=80
status=incomplete
cleanup=unconfirmed
timed_out=true
signal=SIGKILL
checks={"isolationGate":true,"networkDenied":true,"networkCodeRecorded":true,"hangIncomplete":true,"hangCleanupUnconfirmed":true,"hangTimedOut":true}
```

`hang-budget-used.json` confirms the executed budget was the shipped one
(`outerSeconds 120 / phaseSeconds 80 / killGraceSeconds 10 / readbackSeconds 20`), and
`isolation.txt` confirms the boundary in the same round: `gate=none`, `uid=65534`,
`capEff=0000000000000000`, `noNewPrivs=1`, 22 mounts, all five sentinel words good.

The attestation step is not decorative: it refuses (74) unless the receipt says
`incomplete`/`unconfirmed`/`timedOut` **and** the recorded profile is `shipped` with
`phaseSeconds === 80`. A demo-sized run cannot be mistaken for this evidence.

## Wall clock

Round 1 took 81.3 s, round 2 81.3 s of real time — about one phase budget plus probe and
read-back. The envelope's own `RuntimeMaxSec=120` was never reached, which is what "the outer
limit exists so there is time to kill, reap and read back" is supposed to look like.

## Deviations

1. Two exploratory mock runs of `host-negative-tests.sh` and `negative-tests.sh` were executed
   **outside** any envelope while the `--setenv` cases were being written; they are not
   evidence. The bounded qualification run
   `20261110T105604Z-bounded-runner-qualification-1361578-19518` is.
2. `scripts/bounded-runner/policy.sh` changed in this slice: `trusted-extraction-hang` was
   added to `br_prefix_allowed` and `trusted-extraction-hang-*` to `BR_UNIT_FAMILIES`. Without
   both, the core would refuse 70 before creating a unit (the same trap
   `config-check-batch` hit). `core.manifest` was refreshed to the new digest, and the
   qualification suite was re-run afterwards.
3. The first attempt at the accepted `--setenv` mock case asserted an empty value
   (`--setenv=NAME=`) would be accepted. The core refuses it, so the *test* was wrong, not the
   implementation; the case now uses a non-empty second value and the empty-value refusal is
   its own case.
4. `scripts/trusted-extraction-batch/failure-paths.mjs` is a selected input of **two** runners;
   its new flag was added before either round, so no round straddles two versions.
5. The spec repository's vendored copy of the core carries `policy.sh`, so it had to be
   re-synced and re-pinned; see the spec record.

## Selected inputs at run time

`control-before.txt` and `selected-before.txt` are byte-identical across the two rounds, and
`control-diff.txt` / `selected-diff.txt` are empty in both. The eight selected inputs are
listed in `scripts/trusted-extraction-hang-budget/run.sh`.

## Reproduce

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/trusted-extraction-hang-budget/run.sh
```

Takes no arguments, must be invoked by absolute path (a relative entry refuses 77 before
launch), takes about 85 s of wall clock, and needs no other unit to be active.
