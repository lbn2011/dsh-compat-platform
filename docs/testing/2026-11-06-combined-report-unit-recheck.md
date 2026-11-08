# combined-report unit slice — recheck 1 (refused at the capacity gate again)

**Status: RUN ONCE — REFUSED AT THE CAPACITY GATE.** One invocation, authorised by a fresh
single-attempt GO. The workload did not start, so this entry contains **no test counts**.

Parent record: [`2026-11-06-combined-report-unit.md`](./2026-11-06-combined-report-unit.md)
(the first attempt, run `…448944-22547`). That record is unchanged except for a link to
this one.

## 1. Invocation

`bash experiments/acceptance/combined-report-unit/run.sh` — exactly once. No pretest, no
`bash -n`, no extra `node`, no polling, no automatic retry. `run.sh` and `payload.sh` are the
frozen bytes from the previous GO; their sha256 values are identical across both attempts
(see §5), so the two refusals are measurements of the same code.

## 2. Identity and outcome

| field | value |
|---|---|
| run id | `20261105T231441Z-combined-report-unit-453269-2607` |
| unit | `combined-report-unit-20261105T231441Z-453269` |
| `systemd_run_rc` | `70` |
| `acceptance_exit` | `70` |
| `evidence_write_failures` | `none` |
| `hash_status` | `identical` (17 rows before, 17 after) |
| workdir | `experiments/acceptance/combined-report-unit/runs/20261105T231441Z-combined-report-unit-453269-2607/` |

## 3. The refusal, with both numbers

| field | value |
|---|---|
| `acc_gate` | `below_floor` |
| `acc_gate_memavailable_kib` | `1225256` |
| `acc_gate_required_kib` | `1228800` |
| shortfall | `3544 KiB` (≈3.5 MiB) |
| `acc_refusal` | `mem_gate_below_floor` |
| `acc_launch_blockers` | `MEM_GATE_BELOW_FLOOR:available=1225256kB,required=1228800kB` |
| `acc_workload_started` | `no` |
| `acc_node_rc` | `refused_before_workload` |

The gate is a single `MemAvailable` sample, read once, compared against a fixed floor. It
refused. Nothing was loosened, waited for, retried or re-sampled.

**The shortfall is small and that changes nothing.** 3.5 MiB below a floor is still below
the floor: the gate exists to be a threshold, not a suggestion. This entry therefore records
a **refusal**, not a near-pass, and no later summary may call it "almost enough".

## 4. Envelope read back, and terminal state

| field | value |
|---|---|
| `acc_cgroup_memory_max` | `805306368` |
| `acc_cgroup_swap_max` | `0` |
| `acc_cgroup_pids_max` | `32` |
| `acc_cgroup_cpu_max` | `50000 100000` |
| `acc_unit_type` | `exec` |
| `acc_unit_memory_max` / `_swap_max` / `_tasks_max` | `805306368` / `0` / `32` |
| `acc_unit_runtime_max` | `2min` |
| `acc_runtime_usec_numeric` | `<unavailable>` |
| `acc_runtime_usec_resolved` | `120000000` |
| `acc_capture_ok` | `yes` |

Terminal query, this unit only, once: `terminal_query_rc=0`, `load_state=not-found`,
`active_state=inactive`, `sub_state=dead`, `main_pid=0`, `stop_attempted=no`,
`stop_rc=not-attempted`, `terminal_ok=yes`, `confirmation=notfound-settled`. The two
confirmation reads read `not-read` / `<missing>` because no stop was attempted — that is a
distinct fact from "read and failed", and it is recorded as such rather than as a blank.

`acc_runtime_usec_numeric` is `<unavailable>` on this host, so the 120 s limit is confirmed
only through the resolved value `120000000` µs, not through a numeric pass-through.

## 5. Selected hashes, counted as they are

17 rows before and 17 after, `identical`. Counted by reading `hashes-before.txt` (17 lines)
with file tools, **not** by `wc -l`: the line count is what the file shows, and no command
was run to confirm it independently.

Composition: 3 targets + 12 selected inputs + `run.sh` + `payload.sh`. Two of those rows are
directly comparable with the first attempt and match byte for byte:

| file | sha256 (both attempts) |
|---|---|
| `run.sh` | `54a74059be832df1edf8b081b6622f628ae81936fea2743753104054d89b4e6e` |
| `payload.sh` | `a9a917dce2b5945aba70284faee270351de65d67dadfa3cc73bc9a133229c781` |

That equality is the only claim made here about the two runs being comparable. The list
remains a **selected witness over identified files, not a closure**: an unlisted module that
changed would not be caught, `experiments/` is untracked so HEAD is not a version for the
two scripts, and two equal manifests show only that these bytes matched at two moments.

## 6. No test counts exist

`tests`, `pass`, `fail`, `skipped`, `cancelled` are **unknown**. node never started, so there
is no TAP body, no summary line, and no `acc_node_report_complete`. This is not `0 pass`:
the payload's own rule is that a missing report must never read as zero failures, and the
same rule applies to this document.

Consequently: the three targets have **not** been measured together on this host, in either
attempt. Nothing here says they pass, and nothing says they fail.

## 7. What this run does and does not show

- **Shows:** the envelope is applied and read back correctly; the gate refuses below its
  floor and the refusal is recorded with both numbers; the terminal query settles cleanly
  and no leftover unit was created; every required record was written (no write failures);
  the selected hash set was identical before and after.
- **Does not show:** any test result; any statement about the three targets' correctness;
  any statement about this host's general health; any comparison between 899980 KiB (first
  attempt) and 1225256 KiB (this one) beyond the two sampled numbers — two samples are not a
  trend, and the difference is not attributed to any cause here.
- **Not a near-pass.** 3544 KiB under the floor is a refusal. Loosening the floor to fit one
  sample would make the gate meaningless.

## 8. Non-claims

Not realLoader evidence. Not Loader acceptance. Not a certification. Not a dependency
closure. Not global host health. Not a coverage claim for the combined-report behaviour. Not
a repaired or re-run attempt: the first attempt's record stands as measured, and this one is
a second, separate, single invocation.

## 9. Next step

A further attempt requires a **new** explicit single-attempt GO. This entry consumes the one
it was given and records exactly one launch. No retry, no wait-for-memory loop, no limit
change, no script or test edit was made in this attempt, and none is proposed here.
