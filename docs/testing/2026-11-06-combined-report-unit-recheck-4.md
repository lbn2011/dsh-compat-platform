# combined-report unit slice — recheck 4 (refused at the capacity gate again, after the three-file fix)

**Status: RUN ONCE — REFUSED AT THE CAPACITY GATE.** The workload did not start, so **no
post-fix test result exists**. This is the fifth authorised single invocation and the fourth
refusal.

Predecessors, all kept as measured:
[`…-unit.md`](./2026-11-06-combined-report-unit.md) (refused),
[`…-recheck.md`](./2026-11-06-combined-report-unit-recheck.md) (refused),
[`…-recheck-2.md`](./2026-11-06-combined-report-unit-recheck-2.md) (refused),
[`…-recheck-3.md`](./2026-11-06-combined-report-unit-recheck-3.md) (**executed: 75/83, 8
failed**).

## 1. Invocation

`bash experiments/acceptance/combined-report-unit/run.sh` — exactly once, after the Lead
accepted the three-file correction and both authors froze. No pretest, no `bash -n`, no extra
`node`, no capacity polling, no automatic retry. `run.sh` and `payload.sh` were not touched;
their hashes are unchanged from every earlier attempt (§5), so the runner really is frozen
while the library and tests moved.

## 2. Identity and outcome

| field | value |
|---|---|
| run id | `20261106T133937Z-combined-report-unit-473037-1938` |
| unit | `combined-report-unit-20261106T133937Z-473037` |
| `systemd_run_rc` / `acceptance_exit` | `70` / `70` |
| `evidence_write_failures` | `none` |
| `hash_status` | `identical` (17 rows before, 17 after) |
| terminal state | `not-found` / `inactive` / `dead` / `MainPID=0`, `stop_attempted=no` |

Raw paths, verbatim:
`experiments/acceptance/combined-report-unit/runs/20261106T133937Z-combined-report-unit-473037-1938/{unit.log,journal.txt,terminal-query.txt,status.txt,argv.txt,hashes-before.txt,hashes-after.txt,systemd-run.rc}`,
workload output directory `…/out`.

## 3. The refusal

| field | value |
|---|---|
| `acc_gate` | `below_floor` |
| `acc_gate_memavailable_kib` | `1186032` |
| `acc_gate_required_kib` | `1228800` |
| shortfall | `42768 KiB` (≈41.8 MiB) |
| `acc_refusal` | `mem_gate_below_floor` |
| `acc_workload_started` / `acc_node_rc` | `no` / `refused_before_workload` |

One sample, compared to a fixed floor, refusing before any process ran. The floor was not
lowered and no second sample was taken.

## 4. Caps and envelope, read back

`805306368` / swap `0` / pids `32` / `50000 100000` / `Type=exec`, `RuntimeMaxSec=120`
(`acc_runtime_usec_numeric=<unavailable>`, resolved `120000000`), `acc_capture_ok=yes`,
`acc_node_heap_cap_mib=384`. Launch argv as recorded in `argv.txt` matches this envelope
exactly; the payload received `unit`, `run_dir/out` and nothing else.

## 5. The 17-hash cross-run delta: exactly three files

Manifests of the executed run (`…472520-21317`) and this one, 17 rows each. Three rows differ,
and they are precisely the intended three:

| file | before (executed run) | after (this run) |
|---|---|---|
| `…/analyzer/tests/combined-report.test.js` | `65f3976…` | `2eb3319…` |
| `…/analyzer/tests/combined-cli.test.mjs` | `2f21275…` | `b87dab6…` |
| `…/analyzer/src/combined-cli.js` | `d3426a4…` | `609bea1…` |

Unchanged and therefore still the frozen baseline in both: `run.sh`
`54a74059be832df1edf8b081b6622f628ae81936fea2743753104054d89b4e6e`, `payload.sh`
`a9a917dce2b5945aba70284faee270351de65d67dadfa3cc73bc9a133229c781`. The four other library
files, both spec validators, `spec/admission-evidence.md`, `package.json`, the `.d.ts` and the
integration test also hash the same as before — consistent with the stated scope, and nothing
more than that: a 17-row manifest is a **selected witness, not a dependency closure**, and
`experiments/` is untracked, so equality here does not establish that nothing else changed.

I read the manifests row by row with file tools; the count of 17 comes from the file's own
lines, not `wc -l`.

## 6. The previous eight failures: unmeasured after the fix

There is **no** post-fix result for any of the eight. The launcher refused before `node`
existed, so no TAP body, no summary, no per-test verdict. Specifically:

| # | previous failure | status now |
|---|---|---|
| 8 | integration `:342` `0 → 3` | **not re-observed** |
| 10 | integration `:428` `2 → 3` | **not re-observed** |
| 13 | cli `:154` `1 → 3` | **not re-observed** |
| 14 | cli `:179` `2 → 3` | **not re-observed** |
| 20 | cli `:305` `0 → 1` | **not re-observed** |
| 23 | cli `:357` `1 → 3` | **not re-observed** |
| 38 | cli `:583` stderr text | **not re-observed** |
| 59 | report `:299` `'invalid' → 'clear'` | **not re-observed** |

The corrected files are on disk and are the ones hashed above; whether they make those
assertions pass is **unknown**, and no count from this run may be reported as a test count.
The historical 75/83 stands as the only executed measurement, describing the *unfixed* bytes.

On #59 specifically, the record keeps two separate facts: at source level the first entry of
the malformed table is a legal lane, so `clear` was the correct classification and the
expectation was wrong; and at log level the TAP output never named which index failed. The
author's split into an independent positive case plus six negative cases with labels is a
restructure, not evidence about which shape tripped the old assertion.

## 7. The five samples, listed without a story

| attempt | run | `MemAvailable` KiB | shortfall |
|---|---|---|---|
| 1 | `…448944-22547` | `899980` | `322820` |
| 2 | `…453269-2607` | `1225256` | `3544` |
| 3 | `…470929-2539` | `1203776` | `25024` |
| 4 | `…472520-21317` | `1576044` | gate passed |
| 5 | `…473037-1938` | `1186032` | `42768` |

Measurements in time order, not a trend: the fourth passed and the fifth did not, which shows
the floor is instantaneous rather than a capacity claim about the host. No cause is attributed
and no direction is claimed.

## 8. What this run shows and does not show

- **Shows:** the frozen runner still produces a complete, honest refusal record after the
  library and tests changed; the hash manifest changed in exactly the three expected files;
  the unit settles and leaves nothing behind.
- **Does not show:** any test outcome, any statement that the eight failures are fixed, any
  statement about the other slices, the Loader, or the host's health.

## 9. Non-claims

Not realLoader evidence, not acceptance, not certification, not a dependency closure, not
coverage, not host health, not a near-pass, not a retry: one invocation, consumed.

## 10. Next step

A further attempt needs a **new** explicit single-attempt GO. Nothing was edited in this
round; the three corrected files are frozen pending that GO, and this refusal measured the
same runner bytes as every attempt before it.
