# combined-report unit slice — recheck 2 (refused at the capacity gate, third attempt)

**Status: RUN ONCE — REFUSED AT THE CAPACITY GATE.** One invocation under a fresh
single-attempt GO. The workload did not start; this entry contains **no test counts**.

Predecessors, both kept as measured:
[`2026-11-06-combined-report-unit.md`](./2026-11-06-combined-report-unit.md) (first attempt)
and [`2026-11-06-combined-report-unit-recheck.md`](./2026-11-06-combined-report-unit-recheck.md)
(second attempt). Neither is superseded by this one.

## 1. Invocation

`bash experiments/acceptance/combined-report-unit/run.sh` — exactly once. No pretest, no
`bash -n`, no extra `node`, no capacity polling, no automatic retry. `run.sh` and
`payload.sh` were not edited: their sha256 values are unchanged from both earlier attempts
(§5), so all three refusals measure the same frozen scripts.

## 2. Identity and outcome

| field | value |
|---|---|
| run id | `20261106T124906Z-combined-report-unit-470929-2539` |
| unit | `combined-report-unit-20261106T124906Z-470929` |
| raw unit exit (`systemd_run_rc`) | `70` |
| `acceptance_exit` | `70` |
| `evidence_write_failures` | `none` |
| `hash_status` | `identical` (17 rows before, 17 after) |
| run dir | `experiments/acceptance/combined-report-unit/runs/20261106T124906Z-combined-report-unit-470929-2539/` |

The launcher's own exit equals the unit's because no write failed, the terminal state was
confirmed, and the hash comparison was readable: nothing outranked the unit's code.

## 3. The refusal, with both numbers

| field | value |
|---|---|
| `acc_gate` | `below_floor` |
| `acc_gate_memavailable_kib` | `1203776` |
| `acc_gate_required_kib` | `1228800` |
| shortfall | `25024 KiB` (≈24.4 MiB) |
| `acc_refusal` | `mem_gate_below_floor` |
| `acc_launch_blockers` | `MEM_GATE_BELOW_FLOOR:available=1203776kB,required=1228800kB` |
| `acc_workload_started` | `no` |
| `acc_node_rc` | `refused_before_workload` |

One `MemAvailable` sample, read once, compared to a fixed floor. It refused; the gate was
not loosened, not re-sampled, and not waited on.

## 4. Envelope read back, and terminal state

| field | value |
|---|---|
| `acc_cgroup_memory_max` / `_swap_max` / `_pids_max` / `_cpu_max` | `805306368` / `0` / `32` / `50000 100000` |
| `acc_unit_type` | `exec` |
| `acc_unit_memory_max` / `_swap_max` / `_tasks_max` | `805306368` / `0` / `32` |
| `acc_unit_runtime_max` | `2min` |
| `acc_runtime_usec_numeric` | `<unavailable>` |
| `acc_runtime_usec_resolved` | `120000000` |
| `acc_capture_ok` | `yes` |
| heap cap | `--max-old-space-size=384` (argument, never reached: no workload) |

Terminal query, this unit only, once: `terminal_query_rc=0`, `load_state=not-found`,
`active_state=inactive`, `sub_state=dead`, `main_pid=0`, `stop_attempted=no`,
`stop_rc=not-attempted`, `terminal_ok=yes`, `confirmation=notfound-settled`. The two
confirmation reads show `not-read` / `<missing>` because no stop was attempted — recorded as
"not read", which is not the same fact as "read and failed".

## 5. Selected hashes, counted as they are

17 rows before, 17 after, `identical`. Counted by reading `hashes-before.txt` (17 lines) with
file tools — **not** by `wc -l`; no command was used to confirm the count independently.

Composition: 3 targets + 12 selected inputs + `run.sh` + `payload.sh`. The two script rows
match all earlier attempts:

| file | sha256 |
|---|---|
| `run.sh` | `54a74059be832df1edf8b081b6622f628ae81936fea2743753104054d89b4e6e` |
| `payload.sh` | `a9a917dce2b5945aba70284faee270351de65d67dadfa3cc73bc9a133229c781` |

That equality is the only comparability claim made here. The list remains a **selected
witness, not a closure**: an unlisted module could have changed unnoticed, `experiments/` is
untracked so HEAD is not a version for either script, and equal manifests only show that
these bytes matched at two moments.

## 6. No test counts exist

`tests`, `pass`, `fail`, `skipped`, `cancelled` are **unknown**. node never started: there is
no TAP body, no summary, no `acc_node_report_complete`. By the payload's own rule a missing
report must never read as zero failures, and the same rule binds this document.

Across all three attempts the three targets have therefore **not** been measured together on
this host. Nothing here says they pass; nothing says they fail.

## 7. The three samples, without a story

| attempt | run | `MemAvailable` KiB | floor | shortfall |
|---|---|---|---|---|
| 1 | `…448944-22547` | `899980` | `1228800` | `322820` |
| 2 | `…453269-2607` | `1225256` | `1228800` | `3544` |
| 3 | `…470929-2539` | `1203776` | `1228800` | `25024` |

Three samples are listed because they are measurements, not because they form a trend. No
cause is attributed to the variation, no direction is claimed, and the third is not "better"
or "worse" than the second in any sense that matters: each was refused.

## 8. What this run does and does not show

- **Shows:** the envelope is applied and read back correctly; the gate refuses below its
  floor and records both numbers; the terminal query settles and leaves no unit behind; all
  required records were written; the selected hash set was identical before and after.
- **Does not show:** any test result, any statement about the three targets, any statement
  about the host's general health, or any trend across the three attempts.
- **Not a near-pass.** 24.4 MiB below the floor is a refusal.

## 9. Non-claims

Not realLoader evidence, not Loader acceptance, not a certification, not a dependency
closure, not global host health, not a coverage claim. Not a repaired or repeated run: each
attempt stands as its own single invocation, and the earlier records are unchanged apart from
links.

## 10. Next step

A further attempt needs a **new** explicit single-attempt GO. This entry consumes the one it
was given and records exactly one launch. No retry, no wait-for-memory loop, no limit change,
no script or test edit was made in this attempt.
