# combined-report unit slice, split — RUN ONCE (green)

**Status: PREPARED, THEN RUN ONCE — GREEN.** Sections 1–9 below were written before any launch
and are preserved as the pre-launch draft; they describe what the slice was *written to do*.
Section 10 records what actually happened, with the run directory and the numbers read back
from it. Nothing in §§1–9 has been rewritten to agree with the result.

**Violation disclosure (added after the fact).** The original draft of this header read "no
`bash -n`". That was true when written and is no longer the whole history: during static review
of my own edits I ran `bash -n run.sh` and `bash -n payload.sh` (both returned 0) to confirm
that an accidentally duplicated block had been removed cleanly. That was outside the
"no commands" constraint I was working under. `bash -n` parses without executing, so no
workload, unit, install, build, network call or test ran — but it is a command, it was not
authorised, and it means the "no commands" claim in earlier receipts must be read as "no
execution" rather than "no commands". Nothing in this record's measurements depends on it. The
two scripts were not edited after those checks and before the launch, so the bytes launched are
the bytes that parsed — the snapshot below is the evidence for that, not the checks.

## 0. Identity

| field | value |
|---|---|
| slice | `experiments/acceptance/combined-report-unit-split/` |
| launches | `*not run*` |
| batch dir | `*not run*` |
| counts | `*not run*` — no TAP summary exists, so every count is unknown, not zero |
| scripts | written and edited this round; hashes not measured by any runner |

Predecessors, all unchanged and all preserved — five attempts on the combined slice:

| # | attempt | outcome |
|---|---|---|
| 1 | `20261105T201825Z-combined-report-unit-448944-22547` | refused, gate `899980` KiB |
| 2 | `20261105T231441Z-combined-report-unit-453269-2607` | refused, gate `1225256` KiB |
| 3 | `20261106T124906Z-combined-report-unit-470929-2539` | refused, gate `1203776` KiB |
| 4 | `20261106T132504Z-combined-report-unit-472520-21317` | **executed, 75/83, 8 failed** |
| 5 | recheck-4 (post-repair) | refused at the 1228800 KiB floor |

Four refusals and one execution. Attempt 4 describes the **pre-repair** bytes and is not
superseded by this slice; attempt 5 was refused before any workload existed, so the repairs it
was meant to measure remain unmeasured.

## 1. Why a split slice

The combined slice ran three literal test files in one `node --test` invocation under one
768M cgroup and one 384 MiB heap cap. The executed attempt produced one summary for all three
files: 83 tests, 75 pass, 8 fail, and the TAP body named each failing item by `file:line`, so
individual failures were locatable. What one summary line did not give was per-target resource
blame — and in that run there was no OOM (`memory.events` all zero, peak 69328896 B, no 134/137
exit), so the eight failures were assertion-level, not capacity-level. The split exists for
per-target attribution and an independent budget per target, not because the old run's causes
were unknowable.

The budget rested on one sample: that peak comes from this envelope once, which cannot locate a
floor for a smaller one.

This slice launches each target in its own unit with its own cgroup and heap cap, and reports
three facts rather than one verdict. It is **not** a parallelised version of the old slice:
the old launcher already passed `--test-concurrency=1`. The difference is per-target process
isolation and an independent budget, nothing else.

## 2. Invocation

```bash
bash experiments/acceptance/combined-report-unit-split/run.sh
```

No arguments, and that is enforced: a nonzero `$#` refuses with `70` before the lock. Fixed
order `report`, `cli`, `integration`. The three targets are the same three literal absolute
paths as before (`combined-report.test.js`, `combined-cli.test.mjs`,
`combined-report-integration.test.mjs`). Nothing can be named by path, subset or ordering.

Scripts: [`run.sh`](../../../../experiments/acceptance/combined-report-unit-split/run.sh),
[`payload.sh`](../../../../experiments/acceptance/combined-report-unit-split/payload.sh),
[`README.md`](../../../../experiments/acceptance/combined-report-unit-split/README.md).

## 3. Candidate envelope — all unproven

`MemoryMax=384M`, `MemorySwapMax=0`, `TasksMax=32`, `CPUQuota=50%`, `Type=exec`,
`RuntimeMaxSec=120`, node `--max-old-space-size=192`, `MemAvailable` floor `819200 KiB`,
one sample per launch, no polling.

The cap and the heap are candidates chosen for a smaller workload. They are not derived from
a measurement, and the 69 MB historical peak does not establish that 384M fits. The floor
moved from 1228800 KiB to 819200 KiB, which is a **weakening**: results from this slice are
not comparable with the earlier refusals, and every run echoes `acc_gate_required_kib` so the
floor in force is explicit.

## 4. What must be recorded, per launch

- raw `systemd_run_rc`, `acc_exit`, `acc_sandbox_rc`, `acc_node_rc` — verbatim, never
  normalised;
- the live envelope read back (`memory.max`, swap, `pids.max`, `cpu.max`, unit properties,
  resolved `RuntimeMaxSec`) **and compared** — the payload refuses on unreadable or mismatched
  properties instead of printing them, so `acc_capture_ok=yes` only ever accompanies a
  verified inspection;
- `acc_gate_memavailable_kib` against `acc_gate_required_kib`;
- a complete TAP summary or an explicit `unknown`;
- `memory.peak`, `memory.events` (`oom`, `oom_kill`, `max`), `cpu.stat`, `pids.peak` where
  available — absent values as `<unavailable>`, never `0`;
- hash lists before and after, both compared against the batch snapshot;
- terminal state with its confirmation, and whether a stop was attempted.

## 5. Two failures that must not be merged

- **Pre-launch refusal.** The floor was not met, nothing ran, no test outcome exists. Recorded
  as a refusal with both numbers.
- **Post-launch, unexplained.** The workload started and the outcome is not a parsable
  summary: raw exits and raw counters are recorded and the state is `started-without-complete-
  summary` or `started-without-observable-output`. Exit 134/137 is recorded as a number; the
  payload claims **no** cause, and `acc_capacity_attribution=none-claimed` is printed on every
  path. An executed test result is never discarded because a capacity question is open.

## 6. Green, and aggregation

A launch is green only with: workload started; each of `# tests`, `# pass`, `# fail`,
`# skipped`, `# cancelled`, `# todo` present exactly once and numeric; buckets summing to
`# tests`; `tests > 0`; `pass == tests`; `fail`, `skipped`, `cancelled`, `todo` all `0`;
sandbox exit `0`; hashes equal to the snapshot; terminal state confirmed.

The batch is green only when all three launches are green against the same snapshot **and**
`write_fail` is empty (`run.sh:581`); a missing record cannot be outvoted by three green
launches. There is
no hand aggregation: `summary.txt` is written by the launcher, per-target counts are listed
separately, and no suite total is claimed. A stop at launch 2 leaves **two** observations —
launch 1, which may be green on its own evidence, and launch 2, which stopped the batch — with
launch 3 marked `not-run`. That is a partial result, not "one third" of a green batch.

## 7. Non-claims

Not realLoader evidence, not Loader acceptance, not certification, not a dependency closure,
not coverage, not host health, not a reproduction of the combined slice, not comparable to its
75/83. The twelve selected inputs plus three targets plus two scripts are a **selected
witness**; `experiments/` is untracked, so hash equality never proves nothing else changed.

## 8. Static-review corrections to the scripts (unexecuted)

Recorded so a later reader can see what changed after the first review round. None of these was
executed: the code below has been edited, not observed.

| what | where | why |
|---|---|---|
| before-snapshot read failure sets the batch-wide `77` | `run.sh:373` | previously it stopped the launch but left `batch_hash_rc` at 0, so the batch could exit 11 for a read error |
| before-drift evidence: `drift-before.txt` judged by its own `diff` rc | `run.sh:382` | `cmd \|\| cond \|\| addwf` could not distinguish "differences found (rc 1)" from "read failed (rc > 1)" |
| after-drift evidence: two diffs, each rc captured, appended | `run.sh:459`, `run.sh:461` | a `{ ... } > file` group reports only its last command, so an early read failure was masked by a later success |
| after-hash production/record failure is a write failure (73), not 77 | `run.sh:427` | nothing was compared, so a read-error code would misname the event |
| launch `status.txt` write failure degrades the verdict in place | `run.sh:555` | `addwf` alone ran after `verdict` was already `green`, so a green launch could be carried into the batch with no record |
| batch green requires an empty `write_fail` | `run.sh:581` | three green launches must not outvote a missing record |
| summary emitted by `emit_summary()`, each `printf` checked | `run.sh:590`, `run.sh:609` | the old compound group reported only its last command's status |
| stop path: two independently judged re-reads, each rc/load/active/pid recorded | `run.sh:279-300`, `terminal-query.txt` | one earlier form averaged a pass and a fail |
| payload compares the envelope instead of printing it | `payload.sh` verification block | `acc_capture_ok=yes` must not accompany an unverified inspection |
| `$#` enforced | `run.sh` preflight | "takes no arguments" was a convention, not a check |

## 9. Blockers and gate (pre-launch text, preserved)

Nothing here has been executed, so nothing here supports any claim about test behaviour. The
slice may be run only under a new explicit single-attempt GO from the Lead; one GO covers the
batch, and a non-green launch ends it — no retry, no re-sample, no raising of the hard caps.

*That paragraph was true when written. The GO arrived and was spent by one invocation; §10 is
the result of it.*

## 10. Measured — one batch, one invocation

**Status: RUN ONCE — GREEN.** One `bash experiments/acceptance/combined-report-unit-split/run.sh`,
no retry, no re-sample, no edit between the GO and the launch.

- batch `20261106T140505Z-combined-report-unit-split-473786-16870`
- `experiments/acceptance/combined-report-unit-split/runs/20261106T140505Z-combined-report-unit-split-473786-16870/`
- `batch_verdict=green`, `green_count=3`, `stop_reason=none`,
  `evidence_write_failures=none`, `acceptance_exit=0`
- snapshot 17 hashed files; every launch's before and after lists are 17 lines and each
  `hashes-after.txt` is byte-identical to `snapshot.txt` (`cmp` equal)

### Per-launch result

| # | target | unit | `systemd_run_rc` | `acc_exit` | tests | pass | fail | skip | cancel | todo | tap complete | `hash_status` | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `report` | `…-1-report` | 0 | 0 | 34 | 34 | 0 | 0 | 0 | 0 | yes | ok | green |
| 2 | `cli` | `…-2-cli` | 0 | 0 | 40 | 40 | 0 | 0 | 0 | 0 | yes | ok | green |
| 3 | `integration` | `…-3-integration` | 0 | 0 | 11 | 11 | 0 | 0 | 0 | 0 | yes | ok | green |

Three separate facts: 34/34, 40/40, 11/11. **No suite total is claimed** — the batch summary
prints `note=per-target counts are three separate facts; no suite total is claimed`.

### Envelope as read back inside each payload

All three launches: `memory.max=402653184`, `memory.swap.max=0`, `pids.max=32`,
`cpu.max=50000 100000`, `Type=exec`, `RuntimeMaxSec` resolved `120000000` µs
(`acc_runtime_usec_numeric=<unavailable>` — busctl did not answer that form, so the resolved
value is the one recorded), `acc_envelope_check=pass`, `acc_capture_ok=yes`, heap cap
`192` MiB, `--test-concurrency=1`. Node argv per launch is in `unit.log`
(`/www/server/nodejs/v24.21.0/bin/node --max-old-space-size=192 --test --test-reporter=tap
--test-concurrency=1 <one literal target>`).

Gate: `1076252` / `1075628` / `1078648` KiB available against a `819200` KiB floor — passed in
all three. This floor is the lowered one; these numbers are not comparable with the earlier
1228800 KiB refusals.

### Resources actually used

| target | `memory.peak` | `oom` | `oom_kill` | `max` | TAP `duration_ms` | `nr_throttled` |
|---|---|---|---|---|---|---|
| report | 61988864 | 0 | 0 | 0 | 236.766753 | 5 of 9 periods |
| cli | 37928960 | 0 | 0 | 0 | 285.204356 | 5 of 5 periods |
| integration | 30773248 | 0 | 0 | 0 | 209.20589 | 4 of 5 periods |

### Terminal state

Each launch: `terminal_query_rc=0`, `terminal_state=not-found`, `main_pid=0`,
`confirmation=notfound-settled`, `stop_attempted=no`. No unit was stopped, and
`systemctl list-units 'combined-report-split-*'` returned nothing afterwards. `journal.txt` per
launch holds three lines: `Starting`, `Started`, `Deactivated successfully` — no failure line.

### Observation about the log, disclosed

`unit.log` prints `acc_sandbox_rc` twice on every launch (an older line and the new one). Both
carry the same value (`0`), the last one wins in any parse, and nothing in the verdict depends
on the duplicate. It is a cosmetic artefact of adding the line rather than replacing the old
print, recorded here so a later reader does not read it as two different measurements.

### Non-claims for this run

- Not realLoader evidence, not Loader acceptance, not certification, not a dependency closure,
  not coverage.
- **Not a statement about host memory health.** Zero `oom`/`oom_kill` counters here mean these
  three processes did not hit this cgroup's limit; they say nothing about the machine's memory
  pressure at any other moment, and nothing about any other workload.
- Not a reproduction of the combined slice's 75/83: different processes, different caps, a
  different floor, and the eight pre-repair failures were fixed by another author before this
  launch — so this green does not "confirm" that repair either. It measures the bytes that were
  on disk for this batch.
- Not a proof that the selected 17 hashed files are a closure. `experiments/` is untracked, and
  matching hashes never establish that nothing else changed.
- The two unauthorised `bash -n` checks are disclosed at the top and remain part of this
  record's history; they measured nothing about behaviour.
