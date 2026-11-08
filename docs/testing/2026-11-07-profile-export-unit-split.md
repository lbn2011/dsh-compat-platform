# profile-export unit slice, split by target — RUN ONCE, STOPPED AT LAUNCH 2

> Date: 2026-11-07. **Status: RUN ONCE — STOPPED AT LAUNCH 2.** One batch, one invocation:
> `acceptance_exit=11`, `stop_reason=failed:capture`, `green_count=1` (observation green, capture
> failed, prepare never launched). §§1–8 are the pre-launch draft and are preserved as written; §9
> carries the measured result. The single-target slice's capacity refusal
> (`2026-11-07-profile-export-unit.md`) stands unchanged as history and is **not** superseded here.

## 1. Purpose and boundary

This is the second unit slice for the profile-export stage. The first
(`experiments/acceptance/profile-export-unit/`, record `2026-11-07-profile-export-unit.md`) runs one
target and has been executed once, refused at the capacity gate; **that slice and its record are
untouched by this document.**

This slice runs three fixed targets, one per unit, serially in one batch:

| # | target | module under test |
|---|---|---|
| 1 | `experiments/profile-export-fixture/tests/observation.test.mjs` | `observation.mjs` |
| 2 | `experiments/profile-export-fixture/tests/capture.test.mjs` | `capture.mjs` |
| 3 | `experiments/profile-export-fixture/tests/prepare.test.mjs` | `prepare.mjs` |

It answers one question per target — does that module behave as its own test asserts — and nothing
else. It does not touch the real CLI, the fixture bundle, the templates or the manifests, and it is
**not** an export test.

## 2. Invocation

```
bash experiments/acceptance/profile-export-unit-split/run.sh
```

No arguments. Fixed id order `observation capture prepare`. A non-green launch stops the batch; the
remaining targets are written `launch_status=not-run` and are never launched. One batch, one attempt,
no automatic retry, no way to request a subset.

Two kinds of refusal are distinguished, and **their exit codes differ**:

- a **`run.sh`-level refusal** (arguments, lock, missing selected input, unreadable unit table,
  conflicting units) happens before any unit exists and exits **70**;
- a **payload-level refusal** (envelope mismatch, capacity gate below floor, missing target file
  inside the unit) happens inside an already-launched unit before node starts. The batch then exits
  **11** with `stop_reason=refused:<id>`, while that target's own raw code **70** is preserved verbatim
  in its `systemd_run.rc` and `status.txt`, and the target is recorded `launch_status=refused`.

Neither kind reports counts. The same rule covers a pre-launch hash mismatch: the target is refused
**without being launched** (exit 78 in priority, batch 11 unless a hash code outranks it).

## 3. Fixed envelope (per launch; candidate budget, user-approved trial)

| field | value |
|---|---|
| `Type` | `exec` |
| `MemoryMax` / `MemorySwapMax` | `384M` / `0` |
| `TasksMax` / `CPUQuota` | `32` / `50%` |
| `RuntimeMaxSec` | `120` |
| node heap | `--max-old-space-size=192` |
| capacity gate | one `MemAvailable >= 819200` KiB sample per launch |
| sandbox | bwrap, read-only root, private PID/net/IPC/UTS, tmpfs `/tmp` + `/home`, `/dev`, `env -i` |
| writable | `out/` is the only **persistent** bind; `/tmp` and `/home` are tmpfs, `/dev` is a devtmpfs mount — writable but non-persistent |
| lock | `experiments/acceptance/runs/.acceptance.lock`, shared, whole batch |

The cgroup limit is an aggregate over the service process tree; the V8 heap option is one process's
old-space cap, not a tree-wide bound. The budget is approved for a **staged trial only**; a limit hit
is recorded, not fixed by raising the budget.

The envelope is verified inside the unit before node starts — four limit fields from the **cgroup
files**, `Type` and the runtime ceiling from **systemd properties** — and any missing, unreadable or
differing value refuses with 70 before the workload begins.

## 4. Selected inputs (**eight named hashes, not a closure**)

The three test files, the three modules under test, and the two slice scripts. Declared imports: the
tests use only `node:` builtins plus fixture modules — `capture.test.mjs` imports `../capture.mjs`
**and** `../observation.mjs`; `prepare.test.mjs` imports `../prepare.mjs`; `observation.test.mjs`
imports `../observation.mjs`. All three modules are inside the eight, so the named set covers the
imports. No `package.json` exists at `experiments/profile-export-fixture/` and no third-party package
appears in those imports; that is why the list stops at eight. It remains a **named selection, not a
closure** — the fixture bundle, templates, manifests and CLI are deliberately excluded.

One batch `snapshot.txt` is taken before anything launches. Each launch's `hashes-before.txt` is
compared with it **before** `systemd-run` (a mismatch prevents the launch: 78 on drift, 77 if the
manifests cannot be read), and `hashes-after.txt` is compared after the workload, covering the window
it ran in.

## 5. Recorded artifacts

Batch level: `summary.txt` is the **primary** record; `argv.txt` and `snapshot.txt` sit beside it. A
batch-root `status.txt` exists **only** for a `run.sh`-level preflight refusal — a normal run has none.
Per target: `1-observation/`, `2-capture/`, `3-prepare/`, each with `argv.txt`, `command.txt`,
`hashes-before.txt`, `hashes-after.txt`, `hash-diff-before.txt`, `hash-diff-after.txt`,
`systemd-run.rc`, `unit.log`, `journal.txt`, `terminal-query.txt`, `status.txt`,
`out/node-tap.log`, `out/node-stderr.log`. A not-run target holds `status.txt` only, and a target whose
own `status.txt` could not be written carries `status-withdrawn.txt` instead, so the withdrawn green
conclusion and its count remain visible in the record.

Exit codes, as implemented: `0` all three green; `11` the batch stopped at a non-green launch
(including a payload refusal inside a launched unit, whose raw `70` stays in that target's files);
`70` `run.sh`-level refusal or unconfirmed terminal state; `73` evidence write failure (highest);
`75` lock; `76` batch directory existed; `77` manifest unreadable; `78` selection drifted. Priority
`73 > 70 > 0 green > 77 > 78 > 11`, and a write failure in a target's record makes that target
`error`, stops the batch, and still writes `not-run` records for the remaining targets.

## 6. What a run must record (from real artifacts, never from expectation)

- per launch: the `systemd-run` argv as written, `systemd_run_rc`, the payload's `acc_*` lines;
- per launch: `acc_envelope_check` with all six `acc_verify_*` results, then `acc_gate_*`;
- per launch: all six TAP fields, `acc_tap_summary_complete`, `acc_tap_lines`, `acc_tap_bytes`;
- per launch: `node_rc` with its basis (`complete-summary-observed` only when the summary was complete)
  and the raw sandbox status;
- per launch: `hash_status` against the batch snapshot, both sides, and the diff files;
- per launch: `LoadState`, `ActiveState`, `SubState`, `MainPID`, settled note, `stop_attempted`;
- batch: `batch_verdict`, `stop_reason`, `green_count`, `snapshot_lines`, `evidence_write_failures`;
- raw paths for every one of the above.

If a TAP summary is incomplete, that target's counts are **unknown, not zero**, and the target is not
green. A not-run target has unknown counts too — writing `0` for it would be a fabricated observation.

## 7. Non-claims

- No counts, caps, hashes or timings exist yet. Any number in a later revision must cite a run id and a
  path under `runs/`.
- A green batch would not imply export success, fixture validity, bundle resolution, CLI fit or
  compatibility of any kind.
- Eight hashes are a witness over named files, not coverage; three targets are a selection, not a
  closure of the unit stage.
- Zero `memory.events` counters would mean those counters were zero, not that no limit was approached.
- One digest state per target is not a stability study.
- The gate is one sample per launch: no trend, no attribution about host memory conditions.

## 8. Blocking items before a GO

1. The three test files and three modules must exist and be frozen by their authors (032, dfdf); the
   slice hashes them and fails closed if any is missing.
2. The runner must be reviewed by someone other than its author. **No `bash -n` has been performed** —
   parse validity is unverified.
3. The export stage (`--dump-config` against the real built CLI) is a different runner, a different
   budget question and a separate authorisation; nothing here covers it.

## 9. Measured — one batch, one invocation

Run id: `20261107T021014Z-profile-export-unit-split-503446-18723`, batch root
`experiments/acceptance/profile-export-unit-split/runs/20261107T021014Z-profile-export-unit-split-503446-18723/`.
Command, verbatim and without arguments: `bash experiments/acceptance/profile-export-unit-split/run.sh`.
One attempt; no retry, no repair, no additional test, no real CLI, no installation.

### 9.1 Batch

| field | value | source |
|---|---|---|
| `acceptance_exit` | `11` | `summary.txt` |
| `batch_verdict` | `stopped` | `summary.txt` |
| `stop_reason` | `failed:capture` | `summary.txt` |
| `green_count` | `1` | `summary.txt` |
| `targets` / `ids` | `3` / `observation capture prepare` | `summary.txt` |
| `snapshot_lines` | `8` | `summary.txt` |
| `evidence_write_failures` | `none` | `summary.txt` |

`11` here means "the batch stopped at a non-green launch", not a payload refusal: both launched
targets passed their envelope checks and their capacity gates.

### 9.2 Per target

| # | id | launched | `systemd_run_rc` | TAP | `node_rc` | hash | terminal | `launch_status` |
|---|---|---|---|---|---|---|---|---|
| 1 | `observation` | yes | `0` | `35 tests / 35 pass / 0 fail / 0 skipped / 0 cancelled / 0 todo` | `0` | `identical` | `not-found` / `inactive` / `dead`, `MainPID=0`, `notfound-settled`, `stop_attempted=no` | **`green`** |
| 2 | `capture` | yes | `1` | `21 / 20 / 1 / 0 / 0 / 0` | `1` | `identical` | same settled `not-found`, `stop_attempted=no` | **`failed`** |
| 3 | `prepare` | **no** | — | **unknown** | — | — | — | `not-run` (`detail=batch stopped: failed:capture`) |

`prepare` was never launched: no `argv.txt`, no `unit.log`, no TAP, no `systemd-run.rc`. Its counts are
**unknown, not zero** — `3-prepare/status.txt` says exactly that. No suite total is claimed for either
launched target; the two counts are two separate facts.

TAP completeness: both launched targets printed all six fields exactly once with bare decimals and
`pass+fail+skipped+cancelled+todo == tests`; `acc_tap_malformed_fields=` is empty in both.
`acc_node_rc_basis=complete-summary-observed` for both.

### 9.3 Envelope and capacity, per launched target

| field | launch 1 (`observation`) | launch 2 (`capture`) | source |
|---|---|---|---|
| `acc_envelope_check` | `pass` | `pass` | `unit.log` |
| `acc_verify_*` (6) | all `ok` | all `ok` | `unit.log` |
| `acc_cgroup_memory_max` | `402653184` | `402653184` | cgroup file |
| `acc_cgroup_memory_swap_max` | `0` | `0` | cgroup file |
| `acc_cgroup_pids_max` | `32` | `32` | cgroup file |
| `acc_cgroup_cpu_max` | `50000 100000` | `50000 100000` | cgroup file |
| `acc_cap_type` | `exec` | `exec` | systemd property |
| `acc_cap_runtime_max_usec` | `120000000` via `acc_cap_runtime_source=span-fallback` (rendered `2min`) | same | systemd property |
| `acc_node_heap_cap_mib` | `192` | `192` | payload constant |
| `acc_gate_memavailable_kib` vs required `819200` | `1047232` | `1037608` | `unit.log` |
| `acc_gate` | `pass` | `pass` | `unit.log` |
| `acc_bwrap_root` / namespaces / home | `read-only` / `pid,net,ipc,uts` / `tmpfs` | same | `unit.log` |
| `acc_sandbox_rc` / `acc_raw_exit` | `0` / `0` | `1` / `1` | `unit.log` |
| unit tail | `702ms`, CPU `259ms`, `Memory peak: 66.6M (swap: 0B)` | `430ms`, CPU `214ms`, `Memory peak: 35M (swap: 0B)` | `unit.log` |

Four limit values come from cgroup files and two from systemd properties — the runtime ceiling is
read as the rendered string `2min` and parsed to `120000000` µs, so `acc_cap_runtime_source=span-fallback`
records that provenance rather than implying a native numeric property was read.

These peaks are two samples of one run each, kept at the cgroup aggregate level. They are **not** a
fit proof for the budget and **not** evidence about host memory conditions; `memory.events` counters
were not read by this payload, so nothing is claimed about how close any limit came.

### 9.4 The one failure, verbatim, and its static cause

Item 3 of `capture.test.mjs`, `location: .../tests/capture.test.mjs:203:1`, `failureType:
'testCodeFailure'`, `code: 'ERR_ASSERTION'`, `operator: 'deepStrictEqual'`, stack at
`capture.test.mjs:212:12`:

```
not ok 3 - bytes past the cap are dropped but the kept prefix is retained as a copy
  + actual - expected
    [
  +   60000,
      2000
    ]
```

The assertion is `assert.deepEqual(clock.pending(), [GRACE_MS])` at `capture.test.mjs:212`; the fake
clock reported two pending timers, `60000` and `2000`. `2000` is `GRACE_MS`
(`experiments/profile-export-fixture/capture.mjs:37`). `60000` equals `TIMEOUT_MS`
(`capture.mjs:34`), the export-wide timer scheduled at `capture.mjs:464` — reached only when control
passes the `if (settled || terminated) return` guard at `:462`, so it is scheduled in this scenario,
not in every scenario. The grace timer is a separate scheduling at `:364-367`.

Static reading, therefore: the test's expectation enumerates only the grace timer while this scenario
also holds the export-wide timeout. This is **not** proven by execution: no bisection and no source
edit were made, and the alternative reading (that `pending()` ought to report only the most recent
timer) is not excluded by the failure record.

The sibling assertion of the same shape at `capture.test.mjs:319` passed, and the source accounts for
that without any further experiment: `fire(ms)` sets `timer.fired = true` **before** invoking the
callback (`capture.test.mjs:79-86`), and `pending()` returns only timers with `cleared === false &&
fired === false` (`:90-92`). The timeout case fires `TIMEOUT_MS` at `:317` before reaching `:319`, so
only the grace timer remains pending there; the overflow case never fires the timeout, so both are
pending at `:212`. That is a correspondence read out of the source between two adjacent cases — not a
bisection, and not an additional empirical proof of this failure's cause.

No resource cause is claimed for this failure: the target's envelope and gate passed, the summary was
complete, and the assertion is about a timer list. The raw record carries no OOM/`oom_kill`/`max` or
timeout evidence either way, so a resource influence is not excluded by it.

### 9.5 Selected hash witness (8 files, equals `snapshot.txt`)

| file | sha256 |
|---|---|
| `tests/observation.test.mjs` | `782e74eb294bc88b8b2b31f214a029b9eae1bc7112b8af78dab835ef4e13ddfd` |
| `tests/capture.test.mjs` | `ca3fe223b1914907f039d0ecf308253fd8d11a82bc9636d95df6e0cb4619f661` |
| `tests/prepare.test.mjs` | `d3381e30e0e31cc0867c9e68cdffa737681c13204fafb97df982f84992e03db9` |
| `observation.mjs` | `bae0f3cd6f1eaea85682a30a83959e0136ae0e83dc691b4cdac3c088e4b8678e` |
| `capture.mjs` | `f7af3584819c88dfd8d3764a7ea93346f342bb8aa192569e46c215aba827b405` |
| `prepare.mjs` | `c9ae27a9dac1c8ddac211ff4841eaf7079789154c38bf4f50d63aabe274b25fa` |
| `run.sh` (this slice) | `96e1bbd68b356358ef9e9e2ea0f4c5b36a0e609149afcea85b442cc0ea984f2c` |
| `payload.sh` (this slice) | `a9f60f2e6475daf5a5889feeccf6619676bb7edf7ff2f21e7e5bfa9bbb0ca8ae` |

`hash_status=identical` for both launches; `hash-diff-before.txt` and `hash-diff-after.txt` are 0 lines
each, on both sides. This is a witness over eight named files, measured before and after this batch —
**not a closure** over the fixture package, and not a claim that these eight files decide the outcome.

### 9.6 Raw paths

`summary.txt`, `argv.txt`, `snapshot.txt` at the batch root; `1-observation/` and `2-capture/` each with
`argv.txt`, `command.txt`, `hashes-before.txt`, `hashes-after.txt`, `hash-diff-before.txt`,
`hash-diff-after.txt`, `systemd-run.rc`, `unit.log`, `journal.txt`, `terminal-query.txt`, `status.txt`,
`out/node-tap.log`, `out/node-stderr.log`; `3-prepare/status.txt` only. No batch-root `status.txt`
exists — consistent with there having been no `run.sh`-level refusal.

### 9.7 Deviations and limits of this measurement

- One launch failed. Nothing was repaired, retried or re-run; `prepare` has no observation at all.
- The batch took one capacity sample per launch, so there is no trend and no attribution.
- The green launch is green for **its own test file only**: it says nothing about export success,
  fixture validity, bundle resolution, CLI fit or compatibility of any kind.
- Eight hashes and three targets are a selection, not a closure of this stage.
- `capture.test.mjs` and `capture.mjs` are now a known failing pair. The source reading in §9.4 shows
  which timers each case holds pending, but it does not decide whether the **test's expected list** or
  the **module's timer set** is wrong — that decision, and any fix, belongs to the authors of those two
  files, not to this runner or this record. No source was edited for this measurement.
- The `:319`/`:212` comparison is a reading of the clock model in the source, not an experiment run
  specifically to test it; it removes a puzzle, not the failure.

> Later observation, recorded separately and **not** a revision of anything above: after the authors'
> `capture.test.mjs` correction, one further batch (`20261107T022340Z-profile-export-unit-split-504184-14687`)
> ran `capture` green at `21/21/0` and stopped at `prepare` (`39/37/2`, never launched before). See
> `2026-11-07-profile-export-unit-split-recheck.md`. The failure table in §9.2–§9.5 stands as measured
> for its own batch and is not superseded.
