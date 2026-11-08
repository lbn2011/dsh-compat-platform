# 2026-11-07 — profile-export real driver unit slice, recheck (`profile-export-main-unit`)

Status: **RUN ONCE — GREEN (`acceptance_exit=0`, `batch_verdict=green`).** One authorised invocation of
the frozen slice after two code-only repairs, no retry, nothing edited afterwards. The first invocation
(53 tests / 52 pass / 1 fail, `acceptance_exit=11`) is preserved in
[`2026-11-07-profile-export-main-unit.md`](../../../../projects/dsh-compat-platform/docs/testing/2026-11-07-profile-export-main-unit.md)
§12 and is **not** overwritten, restated as a pass, or folded into the numbers below.

## 1. Invocation

`bash experiments/acceptance/profile-export-main-unit/run.sh` — one invocation, no extra pre-checks, no
code changes after the GO, no retry, no real CLI and no real export.

Envelope unchanged from the slice definition: `Type=exec`, `MemoryMax=384M`, `MemorySwapMax=0`,
`TasksMax=32`, `CPUQuota=50%`, `RuntimeMaxSec=120`, node `--max-old-space-size=192`, one
`MemAvailable >= 819200` KiB sample, shared lock, bwrap read-only root with private pid/net/ipc/uts
namespaces, `env -i`.

## 2. Batch result

| item | value |
|---|---|
| batch | [`runs/20261107T060810Z-profile-export-main-unit-511486-15157`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157) |
| unit | `profile-export-main-unit-20261107T060810Z-511486-1-main` |
| `acceptance_exit` | **0** |
| `batch_verdict` | `green` — `stop_reason=none`, `green_count=1` |
| `snapshot_lines` | `11` |
| `evidence_write_failures` | `none` |
| `payload_write_failure` | `none` |

Raw files: [`summary.txt`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/summary.txt),
[`argv.txt`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/argv.txt),
[`snapshot.txt`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/snapshot.txt),
[`1-main/status.txt`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/status.txt),
[`1-main/unit.log`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/unit.log),
[`1-main/out/node-tap.log`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/out/node-tap.log),
[`1-main/out/node-stderr.log`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/out/node-stderr.log),
[`1-main/out/syntax-1.err`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/out/syntax-1.err),
[`1-main/out/syntax-2.err`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/out/syntax-2.err),
[`1-main/terminal-query.txt`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/terminal-query.txt),
[`1-main/journal.txt`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/journal.txt),
[`1-main/systemd-run.rc`](../../../../experiments/acceptance/profile-export-main-unit/runs/20261107T060810Z-profile-export-main-unit-511486-15157/1-main/systemd-run.rc).

## 3. The two syntax checks — measured again, both `0`

| target | rc | stderr bytes |
|---|---|---|
| `experiments/acceptance/profile-export-real/run.sh` | **0** | 0 |
| `experiments/acceptance/profile-export-real/payload.sh` | **0** | 0 |

`acc_syntax_status=pass`, no `acc_syntax_stopped_after` line (neither check stopped the other), empty
`acc_syntax_note_1/2`, and both `.err` files are zero bytes. Parse only — `bash -n` does not execute
either target.

## 4. TAP — the actual counts

| field | value |
|---|---|
| `# tests` | **54** |
| `# pass` | **54** |
| `# fail` | **0** |
| `# skipped` / `# cancelled` / `# todo` | `0` / `0` / `0` |
| `# duration_ms` | `319.026545` |
| `acc_tap_lines` / `acc_tap_bytes` | `334` / `9672` |
| `acc_tap_malformed_fields` | empty |
| `node_rc` | `0`, basis `complete-summary-observed` |
| `acc_sandbox_rc` / `acc_raw_exit` | `0` / `0`, basis `bwrap-exit-status` |

`54`, not `53`: the repair split the mixed path case into the three remaining spellings plus a separate
trailing-separator case, so the file gained one test. The old file had 53 and one failure; this is a
different file, and the two counts are not comparable as "one fixed test" arithmetic.

## 5. Envelope and capacity, read inside the unit

| item | value |
|---|---|
| `memory.max` | `402653184` |
| `memory.swap.max` | `0` |
| `pids.max` | `32` |
| `cpu.max` | `50000 100000` |
| `Type` | `exec` |
| runtime | `2min` rendered → `span-fallback` → `120000000` µs |
| heap option | `192` MiB |
| envelope | `acc_envelope_check=pass` (six `acc_verify_*` `ok`) |
| gate | `acc_gate_memavailable_kib=1009492` ≥ `819200` → `acc_gate=pass` |
| sandbox | read-only root, namespaces `pid,net,ipc,uts`, tmpfs home |

No `acc_memory_peak`, `memory.events` or `cpu.stat` lines exist in this payload version, so no resource
figure is claimed. `1009492` KiB is one gate sample, not a capacity or host-health measurement.

## 6. Selected hashes — eleven, and what changed across the two runs

`hash_status=identical`; `hashes-before.txt` and `hashes-after.txt` hold eleven lines each and both
`hash-diff-before.txt` / `hash-diff-after.txt` are empty.

Diff against the first invocation's `snapshot.txt` — exactly **two** of the eleven changed:

| file | first run | this run |
|---|---|---|
| `experiments/acceptance/profile-export-main-unit/run.sh` | `82f1dfd6…` | `9cbb6dca…` |
| `experiments/acceptance/profile-export-real/tests/main.test.mjs` | `3cf95836…` | `901092f8…` |

The other nine — `payload.sh`, `profile-export-real/main.mjs`, `profile-export-real/run.sh`,
`profile-export-real/payload.sh` and the five fixture modules — are byte-identical across both runs.
This is a **within-stage comparison of eleven selected files**, not a closure over the tree and not a
claim that nothing else moved.

## 7. Terminal state and exits

| item | value |
|---|---|
| `systemd_run_rc` | `0` |
| `node_rc` | `0` |
| `acceptance_exit` | `0` |
| `terminal_query_rc` | `0` |
| terminal | `not-found` / `inactive` / `dead`, `MainPID=0`, `notfound-settled` |
| `stop_attempted` | `no` (`stop_rc=not-attempted`) |
| journal | `Starting` → `Started` → `Deactivated successfully` |

No unit of this family remained active afterwards.

## 8. What this run does and does not establish

- It establishes that the two real scripts parse under `bash -n` (rc `0`, empty stderr) inside the frozen
  envelope, and that the driver's test file — with the repaired path case — runs to a complete summary of
  54 tests, all passing, under the same envelope.
- The repaired case is exercised by the canonicalising `realpath` stub and passes: the driver is refused
  at `70` when `realpath` returns a spelling that differs. It does **not** establish that a real
  filesystem refuses `/tmp/slice/out/`; the stub is still a stub, and `main.mjs` still performs no
  lexical trailing-separator rejection. That gap is unchanged by this green run and remains a design
  question for the driver's owner.
- Green is not coverage. Eleven selected files are a witness; nothing here says the rest of the tree is
  unaffected, and no earlier stage's snapshot is asserted equal to this one.
- Green is not a causal proof: the two repairs are the only selected files that changed, which is
  consistent with the failure disappearing, but the sequence is an observation, not an experiment.
- No export result is claimed: no real CLI, no `profile-export-real/run.sh`, no plugin installation.
  This GO was not an export GO.
- No resource-headroom, host-health or stability claim is made.
