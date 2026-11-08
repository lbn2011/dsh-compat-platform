# profile-export unit slice, split by target — recheck 2: all three targets green

> Date: 2026-11-07. **Status: RUN ONCE — GREEN.** One batch after the authors' `prepare.test.mjs`
> correction: `acceptance_exit=0`, `batch_verdict=green`, `green_count=3`, `stop_reason=none`. The
> earlier batches and their failures are preserved in `2026-11-07-profile-export-unit-split.md` §9 and
> `2026-11-07-profile-export-unit-split-recheck.md`; neither is rewritten here.

## 1. Invocation

```
bash experiments/acceptance/profile-export-unit-split/run.sh
```

No arguments, one attempt, no additional pre-check, no retry, no code repair, no real CLI, no
installation. The frozen runner and payload were unchanged from both earlier batches — `run.sh`
`96e1bbd68b356358ef9e9e2ea0f4c5b36a0e609149afcea85b442cc0ea984f2c`, `payload.sh`
`a9f60f2e6475daf5a5889feeccf6619676bb7edf7ff2f21e7e5bfa9bbb0ca8ae` — so this batch measures the
same runner bytes as the previous two.

## 2. Batch

| field | value | source |
|---|---|---|
| run id | `20261107T025959Z-profile-export-unit-split-505534-15399` | batch root |
| `acceptance_exit` | `0` | `summary.txt` |
| `batch_verdict` | `green` | `summary.txt` |
| `stop_reason` | `none` | `summary.txt` |
| `green_count` | `3` | `summary.txt` |
| `targets` / `ids` | `3` / `observation capture prepare` | `summary.txt` |
| `snapshot_lines` | `8` | `summary.txt` |
| `evidence_write_failures` | `none` | `summary.txt` |

No batch-root `status.txt` exists, consistent with no `run.sh`-level refusal. All three targets were
launched, so no target carries `launch_status=not-run` this time and no count is unknown.

## 3. Per target

| # | id | `systemd_run_rc` | TAP (tests/pass/fail/skipped/cancelled/todo) | `node_rc` | hash | TAP lines / bytes | `launch_status` |
|---|---|---|---|---|---|---|---|
| 1 | `observation` | `0` | `35 / 35 / 0 / 0 / 0 / 0` | `0` | `identical` | `220` / `6384` | **`green`** |
| 2 | `capture` | `0` | `21 / 21 / 0 / 0 / 0 / 0` | `0` | `identical` | `136` / `4245` | **`green`** |
| 3 | `prepare` | `0` | `42 / 42 / 0 / 0 / 0 / 0` | `0` | `identical` | `262` / `8458` | **`green`** |

TAP durations `221.24 ms`, `209.47 ms`, `319.06 ms`. All six fields appear exactly once per target with
bare decimals summing to `tests`; `acc_tap_malformed_fields=` is empty for all three, and every target
carries `acc_node_rc_basis=complete-summary-observed`.

`prepare` now reports **42** tests where the previous batch reported **39**. That is a difference
between two test files with different digests; no bisection was performed to identify which cases were
added, so nothing beyond the two counts is claimed.

## 4. Envelope, caps and capacity

| field | observation | capture | prepare |
|---|---|---|---|
| `acc_envelope_check` | `pass` (6/6 `acc_verify_*` ok) | `pass` | `pass` |
| cgroup `memory.max` | `402653184` | `402653184` | `402653184` |
| cgroup `memory.swap.max` | `0` | `0` | `0` |
| cgroup `pids.max` | `32` | `32` | `32` |
| cgroup `cpu.max` | `50000 100000` | `50000 100000` | `50000 100000` |
| `acc_cap_type` | `exec` | `exec` | `exec` |
| `acc_cap_runtime_max_usec` | `120000000` (`span-fallback`, rendered `2min`) | same | same |
| `acc_gate_memavailable_kib` ≥ `819200` | `1057716` | `1118144` | `1107884` |
| `acc_gate` | `pass` | `pass` | `pass` |
| `acc_sandbox_rc` | `0` | `0` | `0` |
| unit tail | `698ms`, CPU `265ms`, peak `56.4M` | `383ms`, `204ms`, `33.8M` | `580ms`, `288ms`, `37.9M` |

Four limits read from cgroup files; `Type` and the runtime ceiling from systemd properties, the ceiling
resolved from the rendered string `2min` (`acc_cap_runtime_source=span-fallback`). One capacity sample
per launch: three samples, no trend, no attribution. Peaks are cgroup-aggregate samples; `memory.events`
was not read, so nothing is claimed about how close any limit came, and nothing is claimed about host
memory health.

## 5. Terminal state

All three launches: `terminal_query_rc=0`, `LoadState=not-found`, `ActiveState=inactive`,
`SubState=dead`, `MainPID=0`, `terminal_ok=yes`, `terminal_note=notfound-settled`,
`stop_attempted=no`, `stop_rc=not-attempted`. Journals end with `Deactivated successfully`; no unit of
this slice remained after the batch.

## 6. Selected hash witness and the change since each earlier batch

`hash_status=identical` for all three launches; all six `hash-diff-before.txt` / `hash-diff-after.txt`
files are 0 lines. Eight files, 8 lines in `snapshot.txt`:

| file | sha256 |
|---|---|
| `tests/observation.test.mjs` | `782e74eb294bc88b8b2b31f214a029b9eae1bc7112b8af78dab835ef4e13ddfd` |
| `tests/capture.test.mjs` | `8e25c29b248d76b7b05e5beda4feacd554f878e789d6ca234e75b790c2f028e0` |
| `tests/prepare.test.mjs` | `9c6deec01ec88916c5803eea5832bdb6b78a7717e0b36539604516f846281f02` |
| `observation.mjs` | `bae0f3cd6f1eaea85682a30a83959e0136ae0e83dc691b4cdac3c088e4b8678e` |
| `capture.mjs` | `f7af3584819c88dfd8d3764a7ea93346f342bb8aa192569e46c215aba827b405` |
| `prepare.mjs` | `c9ae27a9dac1c8ddac211ff4841eaf7079789154c38bf4f50d63aabe274b25fa` |
| `run.sh` | `96e1bbd68b356358ef9e9e2ea0f4c5b36a0e609149afcea85b442cc0ea984f2c` |
| `payload.sh` | `a9f60f2e6475daf5a5889feeccf6619676bb7edf7ff2f21e7e5bfa9bbb0ca8ae` |

- Versus **recheck 1**: exactly one line changed — `tests/prepare.test.mjs` `d3381e30…` → `9c6deec0…`.
- Versus **batch 1**: exactly two lines changed — `tests/capture.test.mjs` `ca3fe223…` → `8e25c29b…`
  and `tests/prepare.test.mjs` `d3381e30…` → `9c6deec0…`.

All three module files and both slice scripts are byte-identical across the three batches. Eight named
files are a witness, **not a closure**: the fixture bundle, templates, manifests and CLI are outside
this selection and outside this stage.

## 7. Raw paths

Run root
[`runs/20261107T025959Z-profile-export-unit-split-505534-15399/`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/):

| artifact | link |
|---|---|
| batch summary | [`summary.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/summary.txt) |
| batch argv | [`argv.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/argv.txt) |
| batch snapshot (8 lines) | [`snapshot.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/snapshot.txt) |
| `observation` TAP | [`1-observation/out/node-tap.log`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/1-observation/out/node-tap.log) |
| `observation` status | [`1-observation/status.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/1-observation/status.txt) |
| `observation` terminal | [`1-observation/terminal-query.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/1-observation/terminal-query.txt) |
| `capture` TAP | [`2-capture/out/node-tap.log`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/2-capture/out/node-tap.log) |
| `capture` status | [`2-capture/status.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/2-capture/status.txt) |
| `capture` terminal | [`2-capture/terminal-query.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/2-capture/terminal-query.txt) |
| `prepare` TAP | [`3-prepare/out/node-tap.log`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/3-prepare/out/node-tap.log) |
| `prepare` status | [`3-prepare/status.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/3-prepare/status.txt) |
| `prepare` terminal | [`3-prepare/terminal-query.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T025959Z-profile-export-unit-split-505534-15399/3-prepare/terminal-query.txt) |

Each target directory also holds `argv.txt`, `command.txt`, `hashes-before.txt`, `hashes-after.txt`,
`hash-diff-before.txt`, `hash-diff-after.txt`, `systemd-run.rc`, `unit.log`, `journal.txt`,
`out/node-stderr.log`.

## 8. History index for this stage

Four measured events, in order. Each keeps its own record as written; nothing below revises an earlier
result, and a later green does not remove an earlier failure.

| # | event | run id | result | record |
|---|---|---|---|---|
| 1 | single-target slice, one target | `20261106T190515Z-profile-export-unit-493524-31564` | **refused at the capacity gate**: `acc_gate_memavailable_kib=764264` vs required `819200` (shortfall `54936`), `acc_refusal=mem_gate_below_floor`, `acc_workload_started=no`, `acceptance_exit=70`, `verdict=refused`. No TAP at all — the workload never started, so **all counts unknown, not zero**. | [`2026-11-07-profile-export-unit.md`](2026-11-07-profile-export-unit.md) §9 |
| 2 | split slice, batch 1 | `20261107T021014Z-profile-export-unit-split-503446-18723` | **stopped at launch 2**: `observation` green `35/35/0`, `capture` failed `21/20/1`, `prepare` **not-run** (`launch_status=not-run`, counts unknown, never zero); `acceptance_exit=11`, `stop_reason=failed:capture`, `green_count=1`. | [`2026-11-07-profile-export-unit-split.md`](2026-11-07-profile-export-unit-split.md) §9 |
| 3 | split slice, recheck 1 | `20261107T022340Z-profile-export-unit-split-504184-14687` | **stopped at launch 3**: `observation` green `35/35/0`, `capture` green `21/21/0`, `prepare` failed `39/37/2`; `acceptance_exit=11`, `stop_reason=failed:prepare`, `green_count=2`. | [`2026-11-07-profile-export-unit-split-recheck.md`](2026-11-07-profile-export-unit-split-recheck.md) |
| 4 | split slice, recheck 2 (this record) | `20261107T025959Z-profile-export-unit-split-505534-15399` | **green**: `35/35`, `21/21`, `42/42`, `acceptance_exit=0`, `green_count=3`, no not-run target, no unknown count. | this file |

Raw paths for the three earlier events, for the reader who wants the originals:

- event 1 — [`profile-export-unit/runs/20261106T190515Z-profile-export-unit-493524-31564/summary.txt`](../../../../experiments/acceptance/profile-export-unit/runs/20261106T190515Z-profile-export-unit-493524-31564/summary.txt), [`.../unit.log`](../../../../experiments/acceptance/profile-export-unit/runs/20261106T190515Z-profile-export-unit-493524-31564/unit.log), [`.../terminal-query.txt`](../../../../experiments/acceptance/profile-export-unit/runs/20261106T190515Z-profile-export-unit-493524-31564/terminal-query.txt)
- event 2 — [`.../runs/20261107T021014Z-profile-export-unit-split-503446-18723/summary.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T021014Z-profile-export-unit-split-503446-18723/summary.txt), [`1-observation/out/node-tap.log`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T021014Z-profile-export-unit-split-503446-18723/1-observation/out/node-tap.log), [`2-capture/out/node-tap.log`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T021014Z-profile-export-unit-split-503446-18723/2-capture/out/node-tap.log), [`3-prepare/status.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T021014Z-profile-export-unit-split-503446-18723/3-prepare/status.txt)
- event 3 — [`.../runs/20261107T022340Z-profile-export-unit-split-504184-14687/summary.txt`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T022340Z-profile-export-unit-split-504184-14687/summary.txt), [`1-observation/out/node-tap.log`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T022340Z-profile-export-unit-split-504184-14687/1-observation/out/node-tap.log), [`2-capture/out/node-tap.log`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T022340Z-profile-export-unit-split-504184-14687/2-capture/out/node-tap.log), [`3-prepare/out/node-tap.log`](../../../../experiments/acceptance/profile-export-unit-split/runs/20261107T022340Z-profile-export-unit-split-504184-14687/3-prepare/out/node-tap.log)

Scope limit of this index: it covers **this stage only** — the profile-export unit slices and their four
measured batches. It is not an audit of the repository's test history, and it makes no claim that any
other record, runner or stage has been reviewed or reconciled.

## 9. Deviations and non-claims

- One batch, one attempt, no retry, no repair, no additional test, no real CLI, no installation.
- Green means each of three files' own assertions passed under this envelope. It is **not** export
  success, fixture validity, bundle resolution, CLI fit or compatibility of any kind, and it is not a
  closure of the unit stage.
- The two green transitions (`capture` in recheck 1, `prepare` here) each followed a single test-file
  correction while the corresponding module stayed byte-identical. That is a sequence of observations,
  not a causal proof: no controlled comparison was run.
- Three targets, three counts, three separate facts — no suite total is claimed.
- One capacity sample per launch: no trend, no attribution, no host-health inference.
