# snapshot-compare unit slice, split — recheck 1

**Status: RUN ONCE — STOPPED AT LAUNCH 2. `snapshot` GREEN (41/41); `compare` failed at module
load.**

This record covers the second authorised batch of `experiments/acceptance/snapshot-compare-unit-split/`
and nothing else. The first batch and its failure are preserved in
`projects/dsh-compat-platform/docs/testing/2026-11-06-snapshot-compare-unit-split.md` §10 and are not
rewritten here. One launch per target, in order, no retry: the batch ran both targets because the
first was green, and stopped at the second.

## 1. Invocation

```
bash experiments/acceptance/snapshot-compare-unit-split/run.sh
```

No arguments, no extra pre-check by the operator, no edit between the previous batch and this one
except the test-side change described in §6, no automatic retry, no old entry point.

## 2. Batch

| field | value |
|---|---|
| batch | `20261106T161838Z-snapshot-compare-unit-split-487390-2117` |
| `acceptance_exit` | **11** |
| `batch_verdict` | `stopped` |
| `stop_reason` | `failed:compare` |
| `green_count` | **1** |
| `evidence_write_failures` | `none` |
| `snapshot_lines` | `20` |

## 3. Per target

| target | launched | tests | pass | fail | skip | cancel | todo | node rc | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `snapshot` | yes | 41 | **41** | 0 | 0 | 0 | 0 | 0 | **`green`** |
| `compare` | yes | 1 | 0 | **1** | 0 | 0 | 0 | 1 | `failed` |

`compare`'s `tests 1 / pass 0 / fail 1` is a **load failure, not a suite result**: node counted the
file itself as the single failing subtest because the module never finished compiling (§5). It says
nothing about how many tests that file contains, and no per-test count for it exists.

## 4. Envelope, gate, resources — both launches

| field | launch 1 `snapshot` | launch 2 `compare` |
|---|---|---|
| `acc_envelope_check` | `pass` (9/9 `acc_verify_*` ok) | `pass` (9/9 ok) |
| `memory.max` / swap / `pids.max` | `402653184` / `0` / `32` | `402653184` / `0` / `32` |
| `cpu.max` / `Type` | `50000 100000` / `exec` | `50000 100000` / `exec` |
| unit `MemoryMax`/`SwapMax`/`TasksMax` | `402653184` / `0` / `32` | `402653184` / `0` / `32` |
| runtime (resolved µs) | `120000000` | `120000000` |
| heap option | `--max-old-space-size=192` | `--max-old-space-size=192` |
| `acc_gate_memavailable_kib` | `1102976` ≥ `819200` pass | `1073144` ≥ `819200` pass |
| `acc_memory_peak` | `77000704` | `24862720` |
| `memory.events` oom / oom_kill / max | `0` / `0` / `0` | `0` / `0` / `0` |
| `cpu.stat` | `usage_usec 432510`, `nr_periods 10`, `nr_throttled 6`, `throttled_usec 403351` | `usage_usec 184265`, `nr_periods 4`, `nr_throttled 3`, `throttled_usec 153957` |
| TAP lines / duration | `256` / `436.604326` ms | `37` / `95.642601` ms |
| `acc_sandbox_rc` / `acc_raw_exit` / `acc_node_rc` | `0` / `0` / `0` | `1` / `1` / `1` |
| unit record | `Service runtime: 1.096s`, `Memory peak: 73.4M (swap: 0B)` | `Service runtime: 348ms`, `Memory peak: 23.7M (swap: 0B)` |

`acc_capacity_attribution=none-claimed` on both. All that the three recorded counters
`memory.events` oom / oom_kill / max = `0` / `0` / `0` assert is that **those three counts were
zero in this run**. They do not establish that nothing ever hit a limit: the cgroup also enforces
`pids.max=32` and `cpu.max='50000 100000'`, and neither has an event counter read here
(`memory.swap.peak` and `pids.peak` likewise say nothing about enforcement). Neither launch's
outcome is attributed to memory, CPU or pids, and none of these numbers is a statement about host
memory.

## 5. The `compare` failure

`projects/dsh-compat-platform/packages/analyzer/tests/compare-cli.test.mjs:454` fails to **parse**:

```
#   return { stream, calls };
#   ^^^^^^
# SyntaxError: Illegal return statement
#     at compileSourceTextModule (node:internal/modules/esm/utils:319:16)
```

`return` is reported at module top level because the enclosing function is closed **too early**:
`function fakeWritable({ mode }) {` opens at `:433`, its `stream.write = (text, callback) => {`
opens at `:436`, and after the two `if` blocks (`:442-449`) a closing brace at `:450` plus `};` at
`:453` end the function body, leaving `return { stream, calls };` (`:454`) and the trailing `}` at
`:455` outside any function. Node therefore never finishes compiling the module, none of its cases
execute, and the file-as-subtest is the only thing counted.

This is a **brace-imbalance defect inside the test file's own helper** — not a failing assertion, not
a library behaviour, and not a defect in what the CLI under test does. I read the file to locate it
and did not edit it; the defect stands as found for its author to fix.

`not ok 1` is the file-as-subtest the runner reports,
`failureType: 'testCodeFailure'`, `code: 'ERR_TEST_FAILURE'`, `duration_ms: 87.999154`.

## 6. Selected inputs: what changed since the previous batch

Both batches hashed the same 20 selected entries (`snapshot_lines=20`: 2 targets + 16 inputs +
`run.sh` + `payload.sh`), and each launch's before/after sets were equal to the batch snapshot
(`hash_status=ok`, 20 lines each).

Exactly **one** selected entry differs from the previous batch's snapshot:

| file | previous | now |
|---|---|---|
| `tests/snapshot-diff.test.js` | `e317bb1929aabae2344a1fc5daf9556df3e6d7f343af4ddd0f6d2b2a963d55ec` | `27be92bc43bf890c301a70008a10a981b441e66a83756aec417426be5ae858e7` |

That is the test-side change another author made to the expected literal array (§
`2026-11-06-snapshot-compare-unit-split.md` §10.3); the runner, payload and all other inputs are
byte-identical to the previous batch. The change of outcome on `snapshot` (1 fail → 0 fail) and this
single digest change are two facts, and no causal claim is made beyond "the only changed selected
input is the test that failed". Equality within a run is not a closure: this list is a witness of
what the runner hashed, not proof that nothing else in the tree affects the result.

## 7. Terminal state

| field | launch 1 | launch 2 |
|---|---|---|
| `terminal_query_rc` | `0` | `0` |
| `load_state` / `active_state` / `sub_state` | `not-found` / `inactive` / `dead` | `not-found` / `inactive` / `dead` |
| `main_pid` | `0` | `0` |
| `confirmation` | `notfound-settled` | `notfound-settled` |
| `stop_attempted` / `stop_rc` | `no` / `not-attempted` | `no` / `not-attempted` |
| `confirm1_*` / `confirm2_*` | `not-read` / `<missing>` | `not-read` / `<missing>` |

Nothing was stopped, so there was nothing to confirm. `systemd-run.rc` is `0` for launch 1 and `1`
for launch 2, matching each workload's own exit; the batch's own code is `11`.

Journal: launch 1 `Started …` → `Deactivated successfully` → `Consumed 434ms CPU time, 73.4M memory
peak`; launch 2 `Started …` → `Main process exited, code=exited, status=1/FAILURE` → `Failed with
result 'exit-code'`. No unit-level anomaly beyond the workload's own failure.

## 8. Raw paths

```
experiments/acceptance/snapshot-compare-unit-split/runs/20261106T161838Z-snapshot-compare-unit-split-487390-2117/
├── summary.txt, status.txt, snapshot.txt
├── 1-snapshot/{argv.txt, hashes-before.txt, hashes-after.txt, unit.log, systemd-run.rc,
│               journal.txt, terminal-query.txt, terminal-query.err, status.txt, out/node-tap.log}
└── 2-compare/{same set, out/node-tap.log contains the SyntaxError}
```

Previous batch, unchanged: `…/runs/20261106T160945Z-snapshot-compare-unit-split-486898-24774/`.

## 9. Non-claims

- Not a green batch: `compare` did not pass, and the batch exit is `11`.
- `compare` has **no** measured test count; the `1` in §3 is the file-as-subtest, not a suite size.
- `snapshot`'s green is this run, on these bytes, at this budget — not proof of the target in
  general, not coverage, and not a closure over the package.
- Not comparable to the `combined-report` slice's numbers (different budget, different targets).
- Zero `oom`/`oom_kill`/`max` counters and a passing gate are not host memory health, are not proof
  that no limit (pids, CPU) was ever reached, and no outcome here is attributed to capacity.
- No fix, no retry, and **no edit to any of the 20 selected inputs** by this author in this round —
  which is a statement about those 20 files, not about the whole tree: documentation elsewhere
  (this record, the previous record, the slice `README.md`) was written or corrected in parallel. The
  `compare-cli.test.mjs` syntax error stands as found and was not touched by this author.
