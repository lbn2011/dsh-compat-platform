# snapshot-compare unit slice, split — recheck 4

**Status: RUN ONCE — BATCH GREEN. `snapshot` 41/41, `compare` 36/36, `acceptance_exit=0`.**

Fifth authorised batch of `experiments/acceptance/snapshot-compare-unit-split/`, and the first that
finished green. The four earlier batches and their failures are preserved, not rewritten:
`2026-11-06-…-unit-split.md` §10 (assertion failure; `compare` never ran),
`2026-11-07-…-recheck.md` (module-level `return`, `compare` failed at load),
`2026-11-07-…-recheck-2.md` (runtime ceiling at 120 s, TAP stopped at item 26, no summary), and
`2026-11-07-…-recheck-3.md` (36 items, 2 failures — genuine failures of cases **masked by the test's
throwing `readFile` stand-in**; separately, refusal cases in the same block passed accidentally
because that stand-in produced the refusal they asserted).

## 1. Invocation and what changed since recheck 3

```
bash experiments/acceptance/snapshot-compare-unit-split/run.sh
```

One file changed in the selected set, authored by someone else and frozen (dfdf) before the GO: the
test gained `makeRealReaderIo`, which removes the throwing `readFile` stand-in, and the five reader
cases now use it; the well-formed case keeps its `compare` mock. **No runtime/source change** — the
production module is untouched. No edit by this author, no pre-check, no retry, one invocation.

## 2. Batch

| field | value |
|---|---|
| batch | `20261106T163553Z-snapshot-compare-unit-split-489359-18294` |
| `acceptance_exit` | **0** |
| `batch_verdict` | **`green`** |
| `stop_reason` | `none` |
| `green_count` | **2 of 2** |
| `evidence_write_failures` | `none` |
| `snapshot_lines` | `20` |

## 3. Per target

| target | launched | tests | pass | fail | skip | cancel | todo | summary | node rc | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `snapshot` | yes | 41 | **41** | 0 | 0 | 0 | 0 | complete | `0` | **`green`** |
| `compare` | yes | 36 | **36** | 0 | 0 | 0 | 0 | complete | `0` | **`green`** |

Both launches produced a full six-field TAP summary, were parsed as complete
(`tap_summary_complete=yes`), and exited `0`; `systemd_run_rc=0` for both. The batch therefore ran
both targets to the end — the `snapshot` target did not have to be followed by a stop this time.

## 4. Envelope, gate, resources

| field | launch 1 `snapshot` | launch 2 `compare` |
|---|---|---|
| `acc_envelope_check` | `pass` (9/9 `acc_verify_*` ok) | `pass` (9/9 ok) |
| `memory.max` / swap / `pids.max` | `402653184` / `0` / `32` | `402653184` / `0` / `32` |
| `cpu.max` / `Type` | `50000 100000` / `exec` | `50000 100000` / `exec` |
| unit `MemoryMax`/`SwapMax`/`TasksMax` | `402653184` / `0` / `32` | `402653184` / `0` / `32` |
| runtime (resolved µs) | `120000000` | `120000000` |
| heap option | `--max-old-space-size=192` | `--max-old-space-size=192` |
| `acc_gate_memavailable_kib` | `950628` ≥ `819200` pass | `959504` ≥ `819200` pass |
| `acc_memory_peak` | `50925568` | `42369024` |
| `memory.events` oom / oom_kill / max | `0` / `0` / `0` | `0` / `0` / `0` |
| `cpu.stat` | `usage_usec 352115`, `nr_periods 7`, `nr_throttled 6`, `throttled_usec 363480` | `usage_usec 276314`, `nr_periods 6`, `nr_throttled 5`, `throttled_usec 285168` |
| TAP lines / duration | `256` / `400.663538` ms | `226` / `294.985422` ms |
| `acc_sandbox_rc` / `acc_raw_exit` / `acc_node_rc` | `0` / `0` / `0` (`complete-summary-observed`) | `0` / `0` / `0` (`complete-summary-observed`) |
| unit record | `Deactivated successfully` | `Deactivated successfully` |

`nr_throttled` is non-zero on both launches (`6` periods / `363480` µs; `5` / `285168` µs), so CPU
quota throttling occurred during a green run and is recorded as a value — throttling is not by itself
a failure and no outcome here is attributed to it. The three `memory.events` counters being `0`
means only that those three counts were zero; `pids.max` has no event counter read here, and nothing
in this table establishes that no limit was ever approached. `acc_capacity_attribution=none-claimed`.

## 5. Selected inputs across the five batches

Every batch hashed the same 20 entries (2 targets + 16 inputs + `run.sh` + `payload.sh`); each
launch's before/after sets equalled its batch snapshot (`hash_status=ok`, 20/20/20 both).

| file | b1 | r1 | r2 | r3 | r4 |
|---|---|---|---|---|---|
| `tests/snapshot-diff.test.js` | `e317bb19…` | `27be92bc…` | `27be92bc…` | `27be92bc…` | `27be92bc…` |
| `tests/compare-cli.test.mjs` | `d17b26f3…` | `d17b26f3…` | `1208c244…` | `5f3759f4…` | **`1c9d472f…`** |
| `src/compare-cli.js` | `24e005d4…` | `24e005d4…` | `24e005d4…` | `92934a08…` | `92934a08…` |

Exactly one selected hash-list **entry** changed between recheck 3 and recheck 4, corresponding to the
test file; the production module is unchanged from recheck 3. The entry is a digest over the whole
file, so it does not say how much inside that file changed — the test did gain a helper and several
new call sites. What this slice has is **one sample per complete selected snapshot** (per
batch: one batch snapshot, one before/after pair per launch), not one sample per file state — the same
digest does recur across batches (`27be92bc…` in four of them, `92934a08…` in two), so repeated
observation of a digest is a by-product of the batches, **not a designed stability study** and not a
repeatability claim. Batches differ in file state, and the floor has been a single `819200` KiB
throughout. This is a witness over 20 named files, not a closure over the tree. No causal claim is
made linking the injection fix to the green outcome; the two facts are that the only changed selected
hash-list entry is the test file's and that the previously-failing cases now report `ok`.

## 6. Terminal state

| field | launch 1 | launch 2 |
|---|---|---|
| `terminal_query_rc` | `0` | `0` |
| `terminal_state` | `not-found` | `not-found` |
| `main_pid` | `0` | `0` |
| `confirmation` | `notfound-settled` | `notfound-settled` |
| `stop_attempted` | `no` | `no` |

Both units ran to completion and were gone afterwards (`Deactivated successfully`); the launcher
stopped nothing.

## 7. Raw paths

```
experiments/acceptance/snapshot-compare-unit-split/runs/20261106T163553Z-snapshot-compare-unit-split-489359-18294/
├── summary.txt, status.txt, snapshot.txt
├── 1-snapshot/{argv.txt, hashes-before.txt, hashes-after.txt, unit.log, systemd-run.rc,
│               journal.txt, terminal-query.txt, terminal-query.err, status.txt, out/node-tap.log}
└── 2-compare/{same set, out/node-tap.log holds all 36 items}
```

Earlier batches: `…-486898-24774/`, `…-487390-2117/`, `…-488033-2162/`, `…-488717-23398/`.

## 8. Non-claims

- Green is this batch, on these 20 selected bytes, at this budget: **not** coverage, **not** a
  closure over the package or the tree, and **not** a statement that the earlier failures were
  caused by the injection bug — that is the diagnosis offered in recheck 3 §4, and it is static.
- The 41 and 36 are two separate per-target counts; no suite total is claimed, and neither number
  says anything about versions of these files outside this batch.
- Non-zero `nr_throttled` on a green run shows throttling and success coexist; it is not evidence
  about headroom, and zero `memory.events` counters are not host memory health.
- No fix, no retry, no edit to any of the 20 selected inputs by this author.
