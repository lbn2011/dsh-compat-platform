# profile-export orchestration unit slice — recheck 1: both targets green

> Date: 2026-11-07. **Status: RUN ONCE — GREEN.** One batch after the authors' `run-export.test.mjs`
> correction: `acceptance_exit=0`, `batch_verdict=green`, `green_count=2`, `stop_reason=none`.
> `evaluate` 39/39; `run` **47/47**. The first batch and its single failure are preserved in
> `2026-11-07-profile-export-orchestration-unit-split.md` §10 and are not rewritten here.

## 1. Invocation

```
bash experiments/acceptance/profile-export-orchestration-unit-split/run.sh
```

No arguments, one attempt, no additional pre-check, no retry, no source edit, no `bash -n`, no real CLI.
The runner and payload were unchanged from the first batch — `run.sh`
`279b0a568e16d8dec3ee2a19df63ea64bcd60637bf9a483b2c638097643d72ff`, `payload.sh`
`db75bc466f08d3d55f404eca636f1874960b25faffd1fb5bc7cb6740477c8d46` — so this batch measured the same
runner bytes as the first.

The only change the authors made was in `tests/run-export.test.mjs`: it now constructs the real
`PrepareRefusal` and adds a same-named plain `Error` negative case. The declared number of tests was
`47`; that declaration is not a result — the measured counts are in §3.

## 2. Batch

| field | value |
|---|---|
| run id | `20261107T040803Z-profile-export-orchestration-unit-split-508051-263` |
| `acceptance_exit` | `0` |
| `batch_verdict` | `green` |
| `stop_reason` | `none` |
| `green_count` | `2` |
| `targets` / `ids` | `2` / `evaluate run` |
| `snapshot_lines` | `9` |
| `evidence_write_failures` | `none` |

No batch-root `status.txt` exists, consistent with no `run.sh`-level refusal. Both targets launched, so
no target is `not-run` and no count is unknown in this batch.

Raw: [`summary.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/summary.txt),
[`argv.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/argv.txt),
[`snapshot.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/snapshot.txt).

## 3. Per target

| # | id | `systemd_run_rc` | TAP (tests/pass/fail/skipped/cancelled/todo) | `node_rc` | hash | TAP lines / bytes | duration | `launch_status` |
|---|---|---|---|---|---|---|---|---|
| 1 | `evaluate` | `0` | `39 / 39 / 0 / 0 / 0 / 0` | `0` | `identical` | `244` / `7735` | `202.606734 ms` | **green** |
| 2 | `run` | `0` | `47 / 47 / 0 / 0 / 0 / 0` | `0` | `identical` | `292` / `9364` | `282.12097 ms` | **green** |

Six TAP fields appear exactly once per target with bare decimals summing to `tests`;
`acc_tap_malformed_fields=` is empty; `acc_node_rc_basis=complete-summary-observed` for both.

`run` moved from `46 tests / 45 pass / 1 fail` in the first batch to `47 / 47 / 0` here, on a file with
a different digest. One more test exists than there were before; no bisection was performed to say
which case that is, and nothing is claimed about the internal change beyond what the authors state.

Raw: `1-evaluate/`
[`status.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/1-evaluate/status.txt) ·
[`out/node-tap.log`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/1-evaluate/out/node-tap.log) ·
[`terminal-query.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/1-evaluate/terminal-query.txt) ·
[`unit.log`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/1-evaluate/unit.log) ·
[`journal.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/1-evaluate/journal.txt)

`2-run/`
[`status.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/2-run/status.txt) ·
[`out/node-tap.log`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/2-run/out/node-tap.log) ·
[`terminal-query.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/2-run/terminal-query.txt) ·
[`unit.log`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/2-run/unit.log) ·
[`journal.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T040803Z-profile-export-orchestration-unit-split-508051-263/2-run/journal.txt)

## 4. Envelope, caps and capacity

| field | evaluate | run |
|---|---|---|
| `acc_envelope_check` | `pass` (6/6 `acc_verify_*` ok) | `pass` (6/6) |
| cgroup `memory.max` / `memory.swap.max` | `402653184` / `0` | `402653184` / `0` |
| cgroup `pids.max` / `cpu.max` | `32` / `50000 100000` | `32` / `50000 100000` |
| `acc_cap_type` | `exec` | `exec` |
| runtime ceiling | `120000000` µs (`span-fallback`, rendered `2min`) | same |
| `acc_gate_memavailable_kib` ≥ `819200` | `1166040` | `1168796` |
| `acc_gate` | `pass` | `pass` |
| `acc_sandbox_rc` / `acc_raw_exit` | `0` / `0` | `0` / `0` |
| unit tail | `672ms`, CPU `269ms`, peak `61.9M` | `487ms`, `255ms`, `35.7M` |

Four limits read from cgroup files; `Type` and the ceiling from systemd properties. One capacity
sample per launch: two samples, no trend, no attribution. `memory.events` was not read by this payload,
so nothing is claimed about proximity to any limit, and nothing about host memory health.

## 5. Selected hash witness across the two batches

`hash_status=identical` for both launches; all four diff files are 0 lines. Nine files:

| file | sha256 (this batch) | vs first batch |
|---|---|---|
| `tests/evaluate-export.test.mjs` | `ca270dcb0a06cc54b1363261588b78b8e10fa293447526c9f7720756e824375d` | unchanged |
| `tests/run-export.test.mjs` | `9b51e392a3a6dea6f9d9fe9f46e8065de8a71f78210913694963863d36f91f57` | **changed** `4f455cc8…` → `9b51e392…` |
| `observation.mjs` | `bae0f3cd6f1eaea85682a30a83959e0136ae0e83dc691b4cdac3c088e4b8678e` | unchanged |
| `capture.mjs` | `f7af3584819c88dfd8d3764a7ea93346f342bb8aa192569e46c215aba827b405` | unchanged |
| `prepare.mjs` | `c9ae27a9dac1c8ddac211ff4841eaf7079789154c38bf4f50d63aabe274b25fa` | unchanged |
| `evaluate-export.mjs` | `7cb9e54e86667380290fdbdb3677ad9d88782f6b990ba35cc4398ebf904470fd` | unchanged |
| `run-export.mjs` | `4b2be6ffbf018abdf5585169a1b96b82c75b960dda80a9e84021cebb2d6787df` | unchanged |
| `run.sh` | `279b0a568e16d8dec3ee2a19df63ea64bcd60637bf9a483b2c638097643d72ff` | unchanged |
| `payload.sh` | `db75bc466f08d3d55f404eca636f1874960b25faffd1fb5bc7cb6740477c8d46` | unchanged |

Exactly one of the nine changed between the two batches: the test file the authors edited. Everything
else — including `run-export.mjs`, the module whose `PrepareRefusal` handling the failing assertion
touched — is byte-identical across both batches. Because one file changed and one observation sequence
followed, this is **not** a closure of the selection and **not** a proof that the edit alone caused the
green: no controlled comparison, no reverted variant, no second file combination was run.

## 6. Terminal state

Both launches: `terminal_query_rc=0`, `LoadState=not-found`, `ActiveState=inactive`, `SubState=dead`,
`MainPID=0`, `terminal_ok=yes`, `terminal_note=notfound-settled`, `stop_attempted=no`,
`stop_rc=not-attempted`. Both journals end `Deactivated successfully`; no unit of this slice remained.

## 7. History index for this stage

| # | event | run id | result | record |
|---|---|---|---|---|
| 1 | single-target slice, one target | `20261106T190515Z-profile-export-unit-493524-31564` | refused at the capacity gate `764264` vs `819200` (shortfall `54936`); no workload, no TAP — counts unknown, never zero | [`2026-11-07-profile-export-unit.md`](2026-11-07-profile-export-unit.md) |
| 2 | three-module split, batch 1 | `20261107T021014Z-profile-export-unit-split-503446-18723` | stopped at launch 2: `observation` 35/35, `capture` 21/20/1, `prepare` not-run | [`2026-11-07-profile-export-unit-split.md`](2026-11-07-profile-export-unit-split.md) |
| 3 | three-module split, recheck 1 | `20261107T022340Z-profile-export-unit-split-504184-14687` | stopped at launch 3: 35/35, 21/21, `prepare` 39/37/2 | [`2026-11-07-profile-export-unit-split-recheck.md`](2026-11-07-profile-export-unit-split-recheck.md) |
| 4 | three-module split, recheck 2 | `20261107T025959Z-profile-export-unit-split-505534-15399` | green: 35/35, 21/21, 42/42 | [`2026-11-07-profile-export-unit-split-recheck-2.md`](2026-11-07-profile-export-unit-split-recheck-2.md) |
| 5 | orchestration split, batch 1 | `20261107T034631Z-profile-export-orchestration-unit-split-507129-29183` | stopped at launch 2: `evaluate` 39/39, `run` 46/45/1 (`SOURCE_MISSING` vs `null`) | [`2026-11-07-profile-export-orchestration-unit-split.md`](2026-11-07-profile-export-orchestration-unit-split.md) §10 |
| 6 | orchestration split, recheck 1 (this record) | `20261107T040803Z-profile-export-orchestration-unit-split-508051-263` | **green**: 39/39 and 47/47, `acceptance_exit=0` | this file |

Events 1–4 are the earlier three-module stage and are listed for orientation only: their counts belong
to those runs, not to this slice. This index covers this stage only; it is **not** a repository-wide
test-history audit.

## 8. Non-claims

- One batch, one attempt, no retry, no repair, no additional test, no real CLI, no installation.
- Green means each of the two files' own assertions passed under this envelope. It is not export
  success, fixture validity, bundle resolution, CLI fit or compatibility of any kind, and it is not a
  closure of the orchestration stage.
- Both test files drive mocked ports: `run-export.mjs` can prepare, capture and write against real
  ports, and those paths were **not** exercised here.
- Two targets, two counts, two separate facts — no suite total is claimed.
- One file changed and one green followed; that is an observed sequence, not a causal proof.
- Two capacity samples, no trend, no attribution, no host-health inference.
