# snapshot-compare unit slice, split — RUN ONCE, STOPPED AT LAUNCH 1

**Status: RUN ONCE — NOT GREEN.** One authorised batch was executed. Launch 1 (`snapshot`) failed
one assertion out of 41; the batch stopped there and launch 2 (`compare`) is `not-run`, with **no
counts of its own** — an unexecuted target has unknown counts, never zero.

Sections 1–9 below are the pre-launch draft, kept as history and not rewritten to fit the outcome;
where they describe intentions they may now read as unfulfilled. Section 10 is what was measured.
Section 8 records audit deviations, including one by this author.

## 0. Identity

| field | value |
|---|---|
| slice | `experiments/acceptance/snapshot-compare-unit-split/` |
| targets | `snapshot`, `compare` |
| launches | **1 of 2** — launch 2 `not-run` |
| batch dir | `experiments/acceptance/snapshot-compare-unit-split/runs/20261106T160945Z-snapshot-compare-unit-split-486898-24774/` |
| counts | `snapshot`: 41 tests / 40 pass / **1 fail**; `compare`: unknown (not run, no summary) |
| scripts | both are inside the 20-line selected set (`run.sh`, `payload.sh`); the batch measured them before and after, and the two sides were equal — equality **within this run** is not a closure, and it does not assert that these bytes equal some earlier review snapshot |

**Measured outcome, recorded at the top rather than at the bottom:** `batch_verdict=stopped`,
`stop_reason=failed:snapshot`, `green_count=0`, `evidence_write_failures=none`,
`acceptance_exit=11`.

Files as they stood when this record was written (the author of this record got the first item
wrong on the first pass — see the correction note below):

- present: `…/src/snapshot-diff.js`, `…/src/snapshot-diff.d.ts`, `…/src/compare-cli.js`,
  `…/tests/compare-cli.test.mjs`
- present: `…/tests/snapshot-diff.test.js` — 615 lines, read directly. It imports
  `../src/combined-report.js` (`buildCombinedReport`, `COMBINED_REPORT_VERSION`) and
  `../src/snapshot-diff.js` (`CHANGED_FIELDS`, `DIFF_ISSUE_CODES`, `LANE_COMPARISONS`,
  `SNAPSHOT_DIFF_LIMITATIONS`, `SNAPSHOT_DIFF_VERSION`, `SNAPSHOT_JSON_BUDGET`,
  `compareCombinedReports`, `snapshotDiffExitCode`).

**Correction.** An earlier draft of this section said that file was "absent" and that the slice
therefore could not run as designed. That was wrong: the claim came from a `glob` whose pattern
returned only `src/` matches, and absence from a pattern's results is not evidence of absence in
the tree. The file was read afterwards and its imports are listed above. The preflight still refuses
with `70` and launches nothing if either target or any selected input is missing — fail-closed
behaviour, not a prediction about the tree.

## 1. Why a split slice, and why this shape

The combined-report split slice measured three targets in three independent units and returned
34/34, 40/40, 11/11 as three separate facts. The snapshot/comparison stage has its own two
targets, and folding them into one `node --test` invocation would recreate exactly the coupling
that slice was built to avoid: one verdict for two files, one cgroup for two memory profiles, one
summary line from which a per-target cause cannot be read.

So this slice is a **copy-and-adapt** of the reviewed launcher, not a new design:

| kept unchanged | changed |
|---|---|
| `systemd-run --wait --pipe --collect`, `Type=exec` | two targets instead of three |
| `MemoryMax=384M`, swap `0`, `TasksMax=32`, `CPUQuota=50%`, `RuntimeMaxSec=120` | closed id set `snapshot\|compare` |
| node `--max-old-space-size=192`, `--test-concurrency=1`, TAP reporter | unit family `snapshot-compare-split-*` |
| one `MemAvailable >= 819200 KiB` gate per launch, one sample | selected input list for this stage's imports |
| one batch snapshot, one lock for the whole batch | `acc_sandbox_rc` printed once, not twice |
| fail-closed unit-table inspection, checked writes, `wr`/`hashset` | summary covers two launches |
| exit priority `73 > 70 > 77 > 78 > 0/11` | unit table also names the real pilot families |
| — | payload comment says one *invocation*, not one process |

The last row is a wording fix, not a behaviour change: `node --test` may spawn child processes for
the file it is handed, so "one test-runner invocation" is the accurate description.

Two scopes, kept apart and not to be merged: `MemoryMax=384M` is a cgroup limit on the unit and
therefore bounds the whole service process tree's memory **in aggregate** — which is exactly what
`memory.peak`/`memory.current` report. `--max-old-space-size=192` is a Node/V8 option for the old
space of the process it is passed to: it is **not** a tree-wide heap limit and **not** an RSS
ceiling, and whether a child process inherits it depends on how that child is actually started. No
claim is made that it does.

The combined-report scripts are **not edited**; this slice is additive.

## 2. Invocation

```bash
bash experiments/acceptance/snapshot-compare-unit-split/run.sh
```

No arguments, enforced (`$# -ne 0` refuses with `70` before the lock). Order is fixed:
`snapshot`, `compare`. The two targets are literal absolute paths inside the payload's closed id
map; a caller cannot name a path, a subset or an ordering.

## 3. Candidate envelope — all unproven

`MemoryMax=384M`, `MemorySwapMax=0`, `TasksMax=32`, `CPUQuota=50%`, `Type=exec`,
`RuntimeMaxSec=120`, node `--max-old-space-size=192`, `MemAvailable` floor `819200 KiB`, one
capacity sample per launch, no polling, no retry.

The only comparable measurement on record is 61988864 B peak for a 34-test target at this cap.
One sample is not a derivation: the cap and the heap are candidates, and a smaller (or larger)
target may behave differently. The floor is lowered relative to the 1228800 KiB used earlier, so
results here are not comparable with those refusals; every run echoes `acc_gate_required_kib`.

## 4. What must be recorded, per launch

- raw `systemd_run_rc`, `acc_exit`, `acc_sandbox_rc`, `acc_raw_exit`, and `acc_node_rc` with its
  `acc_node_rc_basis` — verbatim, never normalised;
- the live envelope read back **and compared** (`memory.max`, swap, `pids.max`, `cpu.max`, unit
  properties, resolved `RuntimeMaxSec`); `acc_capture_ok=yes` only ever accompanies a verified
  inspection;
- `acc_gate_memavailable_kib` against `acc_gate_required_kib`;
- a complete TAP summary or an explicit unknown — six fields, each exactly once, each a bare
  decimal, buckets summing to `# tests`;
- `memory.peak`, `memory.events` (`oom`, `oom_kill`, `max`), `cpu.stat` where available; absent
  values as `<unavailable>`, never `0`;
- hash lists before and after, both compared against the batch snapshot;
- terminal state with its confirmation, whether a stop was attempted, and each stop-confirmation
  read's own rc/load/active/pid.

## 5. Two failures that must not be merged

- **Pre-launch refusal.** A missing target, a missing input, a gate below the floor, or an
  envelope mismatch: nothing ran, no test outcome exists, and the record carries the refusal with
  its numbers.
- **Post-launch, unexplained.** The workload started and no parsable summary arrived: raw exits
  and raw counters are recorded, the state is `started-without-complete-summary` or
  `started-without-observable-output`, and `acc_capacity_attribution=none-claimed` is printed on
  every path. An executed test result is never discarded because a capacity question is open.

## 6. Green, and aggregation

A launch is green only with: workload started; six TAP fields each present exactly once and
numeric; buckets summing to `# tests`; `tests > 0`; `pass == tests`; `fail`, `skipped`,
`cancelled`, `todo` all `0`; sandbox exit `0`; hashes equal to the snapshot; terminal state
confirmed; no evidence write failed.

The batch is green only when both launches are green against the same snapshot **and** `write_fail`
is empty. There is no hand aggregation: `summary.txt` is written by the launcher, per-target counts
are listed separately, and no suite total is claimed. A stop at launch 1 leaves launch 2 as
`not-run`; a stop at launch 2 leaves two observations, the first of which may stand on its own
evidence. Two observations are a partial result, not "half of a green batch".

## 7. Selected inputs — a witness, not a closure

The input list was assembled by reading the two targets' import lines directly, not by walking the
dependency graph:

- `tests/snapshot-diff.test.js` imports `../src/combined-report.js`, `../src/snapshot-diff.js`
- `tests/compare-cli.test.mjs` imports `../src/compare-cli.js`, `../src/combined-report.js`,
  `../src/snapshot-diff.js`
- `src/compare-cli.js` imports `./snapshot-diff.js`, `./evidence-cli.js`
- `src/snapshot-diff.js` imports `./combined-report.js`
- `src/combined-report.js` imports `./analyze.js`, `./admission-diagnostics.js`,
  `./evidence-diagnostics.js`, `./runtime-evidence.js`
- `src/evidence-cli.js` and `src/evidence-diagnostics.js` import `./runtime-evidence.js`

`src/report.js` is in the list at review's request. `src/exit-codes.js` is an adjacent package
module the author added on his own initiative while assembling the witness — it was **not**
requested by review, and neither target imports it. Both are therefore a superset witness, not
proven dependencies. `projects/dsh-compat-spec/src/index.js`,
`…/src/admission-evidence.js` and `…/spec/admission-evidence.md` are listed as the spec-side files
this stage is expected to touch, which is a scope claim, not an import claim.

Sixteen inputs plus two targets plus two scripts are hashed; **listing is not importing**,
`experiments/` is untracked, and hash equality never proves nothing else changed.

## 8. Audit deviations

**8a. This author's deviation (this slice).** While correcting wording in this slice's own comments
and documents, this author ran one shell command: `bash grep -rn "whole process tree…"` over the
slice directory and this record, used only to locate the sentences to rephrase. That violates the
"file tools only, no commands" constraint under which these files were written. What it did and did
not do is recorded precisely:

- it ran outside the payload, outside any unit, and outside this runner — no `systemd-run`, no
  bwrap, no node, no test was invoked;
- its output was file paths and matching comment lines, and nothing in this record derives from it
  beyond locating text the author then edited by reading the files;
- it read the tree; it did not write, launch, or measure anything.

The broader statement therefore stays narrower than "no commands were run": **nothing here has been
executed, no test has been run, and no script has been syntax-checked** — but one read-only `grep`
invocation did happen, and a reader should treat the earlier "no commands" phrasing in the surviving
draft sections as superseded by this paragraph.

**8b. A previous author's deviation (not this slice).** A previous author's review of the
combined-report CLI used one unauthorised `ls`/`wc` audit outside that runner's stated constraints.
It is recorded here for continuity of the audit trail. It did not execute this slice, and nothing in
this record derives from it.

## 9. Blockers and gate

*(Pre-launch text, kept as history: it was true when written. The GO arrived and the batch was
executed once — see §10. The "nothing executed, nothing syntax-checked" statement below still holds
as far as it goes: no parser was ever run over the scripts, and the batch is the only execution.)*

Nothing here has been executed and nothing has been syntax-checked, so nothing here supports any
claim about test behaviour. Both targets are in the tree; what is still missing before a GO is
someone other than this author reviewing the two scripts, since this author could not run a parser
over them, and the two authors whose work this stage consumes being frozen.

The slice may be run only under a new explicit single-attempt GO from the Lead; one GO covers the
batch, and a non-green launch ends it — no retry, no re-sample, no raising of the hard caps.

## 10. Measured — one batch, one launch, stopped

### 10.1 Invocation and batch

One `bash experiments/acceptance/snapshot-compare-unit-split/run.sh`, no arguments, one batch,
no retry.

| field | value |
|---|---|
| batch | `20261106T160945Z-snapshot-compare-unit-split-486898-24774` |
| `acceptance_exit` | **11** |
| `batch_verdict` | `stopped` |
| `stop_reason` | `failed:snapshot` |
| `green_count` | `0` |
| `evidence_write_failures` | `none` |
| `snapshot_lines` | `20` (2 targets + 16 inputs + 2 scripts) |

### 10.2 Per target

| target | launched | tests | pass | fail | skip | cancel | todo | node rc | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `snapshot` | yes | 41 | 40 | **1** | 0 | 0 | 0 | 1 | `failed` |
| `compare` | **no** | unknown | unknown | unknown | unknown | unknown | unknown | `not-run` | `not-run` |

`compare` was never launched: the batch stopped at launch 1. Its counts are **unknown, not zero**,
and no TAP file for it exists — writing `0` there would invent a measurement.

### 10.3 The one failure

`projects/dsh-compat-platform/packages/analyzer/tests/snapshot-diff.test.js:79` —
"the diff envelope carries fixed literals, never a verdict"; the assertion itself is at `:88`,
`operator: deepStrictEqual`, `code: ERR_ASSERTION`, `failureType: testCodeFailure`.

```
  [
+   'certification',
    'channels',
-   'certification',
    'correlation',
    'diffVersion', 'issues', 'limitations', 'limitationsChanged', 'valid'
  ]
```

The observed envelope emits `certification` before `channels`; the test's own fixed literal array
listed `channels` before `certification`. The defect is therefore **in the test's sorted-expected
array** — its first two entries are out of order — and **not** a defect in the produced envelope's
key order, and not a contract that the envelope must emit keys in that sequence. Nothing is claimed
about the library: I did not run it outside the test, did not edit either file, and did not re-run
to see whether the assertion is stable. A later author changed exactly those two expected entries;
that change is retested separately, not here.

### 10.4 Envelope, gate, resources (launch 1)

| field | value |
|---|---|
| `acc_envelope_check` | `pass` — all nine `acc_verify_*` `ok` |
| `memory.max` / swap / `pids.max` | `402653184` / `0` / `32` |
| `cpu.max` / `Type` | `50000 100000` / `exec` |
| unit `MemoryMax`/`MemorySwapMax`/`TasksMax` | `402653184` / `0` / `32` |
| runtime | `acc_runtime_usec_numeric=<unavailable>`, resolved `120000000` |
| node heap option | `--max-old-space-size=192` |
| gate | `acc_gate_memavailable_kib=969012` ≥ `819200`, `acc_gate=pass` |
| `acc_memory_peak` | `71892992` |
| `memory.events` | `oom 0` / `oom_kill 0` / `max 0` |
| `cpu.stat` | `usage_usec 374311`; `nr_periods 9`; `nr_throttled 4`; `throttled_usec 167907` |
| TAP | 299 lines, `# duration_ms 367.331548`, summary complete |
| unit runtime / peak | `Service runtime: 899ms`, `Memory peak: 68.5M (swap: 0B)` |
| node argv | `/www/server/nodejs/v24.21.0/bin/node --max-old-space-size=192 --test --test-reporter=tap --test-concurrency=1 …/tests/snapshot-diff.test.js` |

`acc_capacity_attribution=none-claimed` and zero `oom` counters mean only that these processes did
not hit this cgroup's limit. The failure was an assertion, not a resource event; no cause is
attributed either way.

### 10.5 Hashes and terminal state

- `hash_status=ok`; `snapshot.txt` 20 lines, `hashes-before.txt` 20 lines, `hashes-after.txt`
  20 lines, and the launcher's comparison against the snapshot passed.
- Terminal: `terminal_query_rc=0`, `not-found` / `inactive` / `dead`, `main_pid=0`,
  `confirmation=notfound-settled`, `terminal_ok=yes`, `stop_attempted=no`, both confirmation reads
  `not-read`/`<missing>` (nothing was stopped, so there was nothing to confirm).
- Journal: Starting → Started → `Main process exited, code=exited, status=1/FAILURE` →
  `Failed with result 'exit-code'` → `Consumed 376ms CPU time, 68.5M memory peak`. No unit-level
  anomaly beyond the workload's own failure.

### 10.6 Raw paths

```
experiments/acceptance/snapshot-compare-unit-split/runs/20261106T160945Z-snapshot-compare-unit-split-486898-24774/
├── summary.txt, status.txt, snapshot.txt
└── 1-snapshot/{argv.txt, hashes-before.txt, hashes-after.txt, unit.log, systemd-run.rc,
               journal.txt, terminal-query.txt, terminal-query.err, status.txt, out/node-tap.log}
```

### 10.7 Non-claims

Not a green batch; not coverage; not a closure (listing is not importing, `experiments/` is
untracked); not host memory health; not comparable to the combined-report slice's numbers; not a
statement that the `snapshot` target is broken in general — one assertion failed once. `compare`
was not measured at all, so nothing is known about it, including whether it would pass.

**Follow-up:** the test-side expected-array change was retested in a second authorised batch, which
is recorded separately in
`projects/dsh-compat-platform/docs/testing/2026-11-07-snapshot-compare-unit-split-recheck.md`
(`snapshot` green 41/41; `compare` failed at module load). Nothing in this section is rewritten to
match that later outcome.
