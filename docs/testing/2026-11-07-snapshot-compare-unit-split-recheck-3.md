# snapshot-compare unit slice, split — recheck 3

**Status: RUN ONCE — STOPPED AT LAUNCH 2. `snapshot` GREEN (41/41); `compare` ran to completion with
a full TAP summary and 2 failures out of 36.**

Fourth authorised batch of `experiments/acceptance/snapshot-compare-unit-split/`. The three earlier
batches and their failures are preserved, not rewritten:
`2026-11-06-…-unit-split.md` §10 (assertion failure; `compare` never ran),
`2026-11-07-…-recheck.md` (module-level `return`; `compare` failed at load), and
`2026-11-07-…-recheck-2.md` (runtime ceiling at 120 s; TAP stopped at item 26, no summary).

## 1. Invocation and what changed since recheck 2

```
bash experiments/acceptance/snapshot-compare-unit-split/run.sh
```

Between recheck 2 and this batch exactly two selected files changed, both authored by someone else
and frozen before the GO: `src/compare-cli.js` (the concurrent-pending-write refusal) and
`tests/compare-cli.test.mjs` (now 783 lines). No edit by this author, no retry, no pre-check.

## 2. Batch

| field | value |
|---|---|
| batch | `20261106T163127Z-snapshot-compare-unit-split-488717-23398` |
| `acceptance_exit` | **11** |
| `batch_verdict` | `stopped` |
| `stop_reason` | `failed:compare` |
| `green_count` | **1** |
| `evidence_write_failures` | `none` |
| `snapshot_lines` | `20` |

## 3. Per target

| target | launched | tests | pass | fail | skip | cancel | todo | summary | node rc | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `snapshot` | yes | 41 | **41** | 0 | 0 | 0 | 0 | complete | `0` | **`green`** |
| `compare` | yes | 36 | 34 | **2** | 0 | 0 | 0 | complete (`1..36`) | `1` | `failed` |

`compare` now reaches the end of its file: `# tests 36`, `# suites 0`, `# pass 34`, `# fail 2`,
`# cancelled 0`, `# skipped 0`, `# todo 0`, `# duration_ms 281.039379`. Nothing was withheld and no
number here is inferred — the summary is complete and was parsed as such (`tap_summary_complete=yes`).

## 4. The two `compare` failures

Both are assertion failures on a file/CLI error code; the raw record for this launch carries no OOM
event, no `oom_kill`, no `max` event and no timeout, and that record does not by itself exclude a
resource influence on the run (see the narrowing at the end of this section).

1. `not ok 31 - a file above the 1 MiB cap is refused, and one at the cap is read`
   — `…/tests/compare-cli.test.mjs:661` (assertion at `:679`), `deepStrictEqual`,
   expected `{ error: { code: 'INPUT_JSON_INVALID' } }`, actual `{ error: { code: 'INPUT_READ_FAILED' } }`.

2. `not ok 33 - two well-formed JSON files reach the real reader and are compared`
   — `…/tests/compare-cli.test.mjs:691` (assertion at `:707`), `strictEqual`, `3 !== 0`
   (expected exit `0`, got `3`, the usage/reader-side code).

**Static correction — what the stub does and does not make false.** My first reading of the block these
two items sit in said "real reader, not a fake `io`". That is wrong for **this** measured batch.
`makeIo` at `…/tests/compare-cli.test.mjs:46-48` supplies a **default `readFile` that throws**, and the
"real reader" cases at `:635-709` in the bytes this batch ran never replaced that stand-in. So those
cases do create real temp files, but the CLI under test never reached the real reader: it called the
throwing stub.

Two different consequences follow, and they must not be merged:

- **Items 31 and 33 are not false positives.** They fail, and the failure is real: the case was
  written to exercise the real reader, was **shadowed by the throwing stub**, and reported the stub's
  error (`INPUT_READ_FAILED`) or the stub-induced exit (`3`) instead of what a real reader would give.
  A test that fails because its own harness blocked the path it meant to test is a genuine defect in
  the test — not a phantom.
- **The false positives are elsewhere in the same block**: refusal cases that happened to **pass**
  because the throwing stub produced exactly the refusal they asserted. Those `ok` lines say nothing
  about the behaviour they name, so a green there was bought with the stub, not with the code under
  test.

This is a static diagnosis of the file as it was when this batch hashed it (`5f3759f4…`); it is **not**
a re-measurement, and the counts in §3 stand as measured.

Resource wording, narrowed: the raw record is an **assertion failure** — no OOM event, no `oom_kill`,
no `max` event and no timeout for this launch. That is what was recorded; it does not generally
exclude a resource influence on the run, and I am not claiming one either.

The TAP gives the pair `(expected, actual)` for each item and that is all this record measured; no
library call was made outside the runner, no file was edited, and no re-run was performed.

## 5. Envelope, gate, resources

| field | launch 1 `snapshot` | launch 2 `compare` |
|---|---|---|
| `acc_envelope_check` | `pass` (9/9 `acc_verify_*` ok) | `pass` (9/9 ok) |
| `memory.max` / swap / `pids.max` | `402653184` / `0` / `32` | `402653184` / `0` / `32` |
| `cpu.max` / `Type` | `50000 100000` / `exec` | `50000 100000` / `exec` |
| unit `MemoryMax`/`SwapMax`/`TasksMax` | `402653184` / `0` / `32` | `402653184` / `0` / `32` |
| runtime (resolved µs) | `120000000` | `120000000` |
| heap option | `--max-old-space-size=192` | `--max-old-space-size=192` |
| `acc_gate_memavailable_kib` | `1054928` ≥ `819200` pass | `1014316` ≥ `819200` pass |
| `acc_memory_peak` | `72658944` | `37507072` |
| `memory.events` oom / oom_kill / max | `0` / `0` / `0` | `0` / `0` / `0` |
| `cpu.stat` | `usage_usec 399306`, `nr_periods 10`, `nr_throttled 6`, `throttled_usec 230390` | `usage_usec 281161`, `nr_periods 6`, `nr_throttled 5`, `throttled_usec 459874` |
| TAP lines / duration | `256` / `426.596869` ms | `268` / `281.039379` ms |
| `acc_sandbox_rc` / `acc_raw_exit` / `acc_node_rc` | `0` / `0` / `0` | `1` / `1` / `1` |
| unit record | `Deactivated successfully`, `401ms`, `69.2M` | `status=1/FAILURE`, `exit-code` |

`nr_throttled` is non-zero on both launches (`6` periods / `230390` µs; `5` / `459874` µs), so CPU
quota throttling occurred and is recorded as a value. The three `memory.events` counters being `0`
means only that those three counts were zero; it does not establish that no limit was reached
(`pids.max` has no event counter read here). `acc_capacity_attribution=none-claimed`. Both launches
**completed on their own** — no timeout, no kill; the failures are assertion failures, not resource
events.

## 6. Selected inputs across the four batches

Every batch hashed the same 20 selected entries (2 targets + 16 inputs + `run.sh` + `payload.sh`);
each launch's before/after sets equalled its batch snapshot (`hash_status=ok`, 20/20/20 both).

| file | batch 1 | recheck 1 | recheck 2 | recheck 3 |
|---|---|---|---|---|
| `tests/snapshot-diff.test.js` | `e317bb19…` | `27be92bc…` | `27be92bc…` | `27be92bc…` |
| `tests/compare-cli.test.mjs` | `d17b26f3…` | `d17b26f3…` | `1208c244…` | **`5f3759f4…`** |
| `src/compare-cli.js` | `24e005d4…` | `24e005d4…` | `24e005d4…` | **`92934a08…`** |

Between recheck 2 and recheck 3 exactly these two lines changed; the other 18 are byte-identical.
`samples` are one per file state, and no batch is a controlled repeat of another; the earlier batches
differed in other ways (see `2026-11-07-…-recheck-2.md` §6 for the comparability bounds, which are
unchanged and still apply). This is a witness over 20 named files, not a closure over the tree, and
the record makes no causal claim linking the source change to the change in outcome.

## 7. Terminal state

| field | launch 1 | launch 2 |
|---|---|---|
| `terminal_query_rc` | `0` | `0` |
| `terminal_state` | `not-found` | `not-found` |
| `main_pid` | `0` | `0` |
| `confirmation` | `notfound-settled` | `notfound-settled` |
| `stop_attempted` / `stop_rc` | `no` / `not-attempted` | `no` / `not-attempted` |

Nothing was stopped by the launcher; both units exited on their own and were then gone.

## 8. Raw paths

```
experiments/acceptance/snapshot-compare-unit-split/runs/20261106T163127Z-snapshot-compare-unit-split-488717-23398/
├── summary.txt, status.txt, snapshot.txt
├── 1-snapshot/{argv.txt, hashes-before.txt, hashes-after.txt, unit.log, systemd-run.rc,
│               journal.txt, terminal-query.txt, terminal-query.err, status.txt, out/node-tap.log}
└── 2-compare/{same set, out/node-tap.log holds all 36 items}
```

Earlier batches: `…-486898-24774/`, `…-487390-2117/`, `…-488033-2162/`.

## 9. Non-claims

- Not a green batch (`exit 11`); `compare` failed 2 of 36, so this is a real measured failure.
- `36` is the count this run reported, not a claim about the file's total across versions (the file
  grew from 687 to 783 lines between batches).
- `snapshot`'s green is this run on these bytes at this budget: not coverage, not closure.
- No causal claim: `compare` improved from "stopped at item 26 with no summary" to "36 items, 2
  failures", on changed test **and** source bytes, and the 2 remaining failures are not attributed.
- Zero memory event counters and passing gates are not host memory health.
- No fix, no retry, no edit to any of the 20 selected inputs by this author.
