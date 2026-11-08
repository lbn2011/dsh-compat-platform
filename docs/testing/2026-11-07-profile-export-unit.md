# profile-export unit slice — RUN ONCE, REFUSED AT THE CAPACITY GATE

> Date: 2026-11-07. **Status: one authorised attempt, executed once, refused inside the launched unit
> before the workload started. `acceptance_exit=70`, `verdict=refused`, no TAP counts exist.**
> §§1–8 below are preserved verbatim as the pre-launch draft (they were written before any execution);
> §9 holds the measured facts and supersedes every forward-looking statement in them. §§1–8 §7's "no
> counts exist yet" and §8's blocking list describe the pre-launch state only.

## 1. Purpose and boundary

The profile-export work is staged. This is stage one: exercise the **pure observation function** and
its single test file in isolation. Stage two (`export`, the real CLI with `--dump-config`) is a
different runner and is **not** authorised here.

The unit stage answers one question — does the observation function behave as its test asserts — and
nothing else. A green unit run would not be evidence that the official CLI exports a profile, that the
fixtures compose, or that the 384 MiB envelope fits an export.

## 2. Invocation

```
bash experiments/acceptance/profile-export-unit/run.sh
```

No arguments. One launch, serial, one attempt, **no automatic retry**. Two kinds of refusal are
distinguished: a **pre-launch** refusal (arguments, lock, missing inputs, conflicting units) happens
before any unit exists; a **payload** refusal (empty capacity gate, envelope mismatch) happens *inside
an already-launched unit*, before node starts. Neither is a partial run, and neither reports counts.

## 3. Fixed envelope (candidate budget, user-approved trial)

| field | value |
|---|---|
| unit type | `Type=exec` |
| `MemoryMax` / `MemorySwapMax` | `384M` / `0` |
| `TasksMax` / `CPUQuota` | `32` / `50%` |
| `RuntimeMaxSec` | `120` |
| node heap | `--max-old-space-size=192` |
| capacity gate | one `MemAvailable >= 819200` KiB sample before the workload |
| sandbox | bwrap, read-only root, private PID/net/IPC/UTS, tmpfs `/tmp` + `/home`, `env -i` |
| lock | `experiments/acceptance/runs/.acceptance.lock` (shared, whole run) |

The budget is approved for a **staged trial only**. It is not evidence that the CLI fits it, and a
limit hit is recorded rather than fixed by raising the budget.

## 4. Selected inputs (**four named hashes, not a closure**)

| file | role |
|---|---|
| `experiments/profile-export-fixture/tests/observation.test.mjs` | the one test file |
| `experiments/profile-export-fixture/observation.mjs` | the observation module under test |
| `experiments/acceptance/profile-export-unit/run.sh` | launcher |
| `experiments/acceptance/profile-export-unit/payload.sh` | sandboxed workload |

Deliberately **excluded**: the profile fixtures, templates, manifests and the CLI itself. Listing four
files is not a claim that four files decide the outcome; it is the smallest set this stage names.

## 5. What a run must record (to be filled from real artifacts, never from expectation)

- launch: `systemd-run` argv as written, `systemd-run.rc`, raw unit status;
- envelope: `acc_cap_*` readback, `acc_verify_*` results, `acc_envelope_check`, `acc_gate_*`;
- TAP: all six fields plus `acc_tap_summary_complete`, `acc_tap_lines`, `acc_tap_bytes`;
- node: `acc_node_rc` with `acc_node_rc_basis` (`complete-summary-observed` only when the summary was
  complete) and `acc_raw_exit`;
- hashes: `hashes-before.txt` / `hashes-after.txt`, line count per side, comparison result;
- terminal: `LoadState`, `ActiveState`, `MainPID`, whether settled, `stop_attempted`;
- `verdict`, `acceptance_exit`, `evidence_write_failures`;
- raw paths for every one of the above.

If the TAP summary is incomplete, the counts are **unknown**, not zero, and the run is not green.

## 6. Author's own audit of the prepared scripts (claims limited to what the source shows)

- `wr()` and `hashset()` propagate failure. `argv.txt`, `command.txt` and `hashes-before.txt` are
  checked, and any failure there exits **73 before the launch** — nothing starts with incomplete
  pre-launch evidence.
- `unit.log` is opened through a checked file descriptor **before** the launch, so an unwritable path
  is 73 and is not mistaken for a launch that ran and said nothing.
- The later `summary.txt` and `status.txt` writes are checked individually; a failure re-derives
  `acceptance_exit=73` and degrades the verdict to `error` (written to `verdict-override.txt`), so a
  green conclusion cannot survive an unrecorded summary. These two files are written as single
  `printf` invocations with an explicit `-s` check afterwards, **not** as compound groups.
- Earlier drafts of `payload.sh` contained two real defects the author found and fixed: a 27-line
  block of meaningless self-comparisons in the gate (which would have made the gate inert) and a TAP
  field list using the wrong names (`skip`/`cancel` instead of `skipped`/`cancelled`). Both are fixed;
  neither was ever executed.
- `$# -ne 0` is refused with 70 before the lock is taken.
- **No syntax check has been run** — the author was forbidden commands — so parse validity is
  unverified and remains a review item. Not every write in the file has been individually audited
  against this list; what is claimed is the checks named above.
- Terminal state uses one strict predicate: query rc 0, a **single unambiguous** `LoadState`/`MainPID`
  reading (parsed with `-F=` and rejected when the field is duplicated or missing), `ActiveState`
  `inactive|failed`, `MainPID=0`. An unreadable or contradictory state is 70 and needs manual
  confirmation; nothing is stopped.
- Green requires **all** of: no refusal, envelope check pass, gate pass, complete summary,
  `tests == pass > 0`, zero fail/skipped/cancelled/todo, hashes identical, terminal confirmed, no
  write failure, launch rc 0.
- Priority: `73 > 70 (terminal/refusal) > 77 > 78 (hash) > 0 green > launch rc > 11`. Hash faults are
  evaluated **before** green, so drift is never hidden behind a passing run.

## 7. Non-claims

- No counts, caps, hashes or timings exist yet. Any number in a later revision must cite a run id.
- A green unit run would not imply export success, fixture validity, CLI fit or compatibility.
- Four hashes are a witness over named files, not coverage.
- Zero `memory.events` counters would mean those counts were zero, not that no limit was approached.
- The candidate envelope's suitability is unproven until the export stage runs inside it.

## 8. Blocking items before a GO

1. `experiments/profile-export-fixture/tests/observation.test.mjs` and
   `experiments/profile-export-fixture/observation.mjs` must exist and be frozen (032, dfdf).
2. The runner must be reviewed by someone other than its author; no `bash -n` has been performed.
3. The export runner does not exist yet; it is a separate authorisation and a separate document.

## 9. Measured — one authorised attempt (refused before the workload)

### 9.1 Invocation and identity

```
bash experiments/acceptance/profile-export-unit/run.sh
```

| item | value |
|---|---|
| run dir | `experiments/acceptance/profile-export-unit/runs/20261106T190515Z-profile-export-unit-493524-31564/` |
| unit | `profile-export-unit-20261106T190515Z-493524` (`.service`) |
| arguments | `argv=no-arguments`, `hashed_count=4` |
| launch rc | `systemd_run_rc=70` |
| overall | `acceptance_exit=70`, `verdict=refused` |
| `acc_exit_basis` | `refusal` |
| write failures | `evidence_write_failures=none` |

`argv.txt:1` records the exact launch:

```
systemd-run --wait --pipe --collect --unit=profile-export-unit-20261106T190515Z-493524 -p Type=exec -p MemoryMax=384M -p MemorySwapMax=0 -p TasksMax=32 -p CPUQuota=50% -p RuntimeMaxSec=120 -- /bin/bash …/payload.sh <unit> <out>
```

No extra command was run: no `bash -n`, no capture test, no export, no retry.

### 9.2 The refusal, verbatim from `unit.log`

| field | value |
|---|---|
| `acc_refusal` | `mem_gate_below_floor` |
| `acc_gate_required_kib` | `819200` |
| `acc_gate_memavailable_kib` | `764264` |
| `acc_gate_shortfall_kib` | `54936` |
| `acc_workload_started` | `no` |
| `acc_node_rc` | `refused_before_workload` |
| `acc_gate` (summary) | `not-observed` |

`764264 < 819200`, a shortfall of **54936 KiB** (≈53.6 MiB). The gate is a single sample taken once,
inside the unit, before node. This is a **refusal, not a near-pass**.

### 9.3 Envelope was verified and passed before the gate

`acc_envelope_check=pass`, with all six checks `ok` (`acc_verify_memory_max`, `_memory_swap_max`,
`_pids_max`, `_cpu_max`, `_runtime_max_usec`, `_type`). The values do **not** all come from the same
source: the four limit fields come from the **cgroup files**, while `Type` and the runtime ceiling come
from **systemd unit properties** (the latter resolved from the rendered string, see below).

| source | field | observed |
|---|---|---|
| cgroup file | `memory.max` | `402653184` |
| cgroup file | `memory.swap.max` | `0` |
| cgroup file | `pids.max` | `32` |
| cgroup file | `cpu.max` | `50000 100000` |
| systemd property | `Type` | `exec` |
| systemd property | `RuntimeMaxUSec` | `120000000` (rendered `2min`) |
| node option | heap | `acc_node_heap_cap_mib=192` |

`acc_cap_runtime_source=span-fallback`: the numeric microsecond value was not readable through the
busctl interface, so the rendered `2min` was parsed by the anchored full-consumption parser and
resolved to `120000000`. The value therefore comes from the **rendered string**, and that is recorded
rather than described as a numeric readback.

`acc_capture_ok=yes` printed only after every check passed — and the run was then refused by the gate
that follows it, which is the intended order.

### 9.4 Counts: unknown, not zero

`status.txt` carries exactly one TAP-related field, `acc_tap_summary_complete=unknown`; it does not
carry the six counts. The six fields appear in `summary.txt` and are all `unknown`
(`tests=unknown pass=unknown fail=unknown skipped=unknown cancelled=unknown todo=unknown`, with
`tap_complete=unknown`). Node never ran, so there is no observation of the test file at all. Writing
`0` in either file would be a fabricated observation.

`acc_gate=not-observed` in `summary.txt` means the summary carries **no pass marker** for the gate — it
does **not** mean the gate was never sampled. The sample exists in the raw record: `unit.log` holds
`acc_gate_memavailable_kib=764264`, `acc_gate_shortfall_kib=54936` and
`acc_refusal=mem_gate_below_floor`. The raw files are the authority here and were not edited.

### 9.5 Hash witness

| file | sha256 (before) |
|---|---|
| `experiments/profile-export-fixture/tests/observation.test.mjs` | `782e74eb294bc88b8b2b31f214a029b9eae1bc7112b8af78dab835ef4e13ddfd` |
| `experiments/profile-export-fixture/observation.mjs` | `bae0f3cd6f1eaea85682a30a83959e0136ae0e83dc691b4cdac3c088e4b8678e` |
| `experiments/acceptance/profile-export-unit/run.sh` | `325252aca2043c70e7486bc3cf2e74a097ef664a78f882e4ef41bed1a08668cb` |
| `experiments/acceptance/profile-export-unit/payload.sh` | `55be8a0ad64f50269666965d556fd44f4ab89f3fc1004c31f444db43d761173f` |

`hashes-before.txt` and `hashes-after.txt` hold 4 lines each, `hash-diff.txt` is empty (0 lines) and
`hash_status=identical`. Equality here covers **these four files in this run only**; it is not a
closure and says nothing about the fixture tree, templates or the CLI.

### 9.6 Terminal state

`terminal_query_rc=0`; `LoadState=not-found`, `ActiveState=inactive`, `SubState=dead`,
`MainPID=0`; `terminal_ok=yes`, `terminal_note=notfound-settled`; `stop_attempted=no`,
`stop_rc=not-attempted`.

Journal (`journal.txt`, 4 lines): `Starting` → `Started` → `Main process exited, code=exited,
status=70/SOFTWARE` → `Failed with result 'exit-code'`. Unit tail: `Service runtime: 82ms`,
`CPU time consumed: 42ms`, `Memory peak: 3.3M (swap: 0B)` — the small footprint is consistent with a
refusal before node, and is not a measurement of the workload.

### 9.7 Deviations and limitations of this record

- No deviation from the authorised command: one invocation, no retry, no extra checks.
- The gate sample is **one point in time**; it is not a trend and carries no attribution about host
  memory conditions.
- Because the refusal precedes the workload, **nothing in this run measures the test file, the
  observation module, or the envelope's fit**. The envelope checks that passed measure only that the
  unit was created with the requested limits.
- The budget itself is unchanged and unproven: no observation here suggests 384 MiB is sufficient or
  insufficient for the unit stage, let alone for export.
- A further attempt needs a new authorisation; this document does not authorise one.
