# snapshot-compare unit slice, split — recheck 2

**Status: RUN ONCE — STOPPED AT LAUNCH 2. `snapshot` GREEN (41/41); `compare` reached the unit's
120 s runtime limit and was killed with no TAP summary.**

Third authorised batch of `experiments/acceptance/snapshot-compare-unit-split/`. The two earlier
batches and their failures are preserved, not rewritten:
`2026-11-06-snapshot-compare-unit-split.md` §10 (assertion failure, `compare` not run) and
`2026-11-07-snapshot-compare-unit-split-recheck.md` (module-level `return`, `compare` failed at
load). This record adds, it does not replace.

## 1. Invocation and the one code change

```
bash experiments/acceptance/snapshot-compare-unit-split/run.sh
```

Between recheck 1 and this batch exactly one selected file changed: another author deleted one
surplus closing brace in `projects/dsh-compat-platform/packages/analyzer/tests/compare-cli.test.mjs`
(Lead-authorised, single line). The runner, payload and every other selected input are
byte-identical. No edit by this author; no retry; no extra pre-check.

## 2. Batch

| field | value |
|---|---|
| batch | `20261106T162151Z-snapshot-compare-unit-split-488033-2162` |
| `acceptance_exit` | **11** |
| `batch_verdict` | `stopped` |
| `stop_reason` | `incomplete:compare` |
| `green_count` | **1** |
| `evidence_write_failures` | `none` |
| `snapshot_lines` | `20` |

## 3. Per target

| target | launched | TAP counts | node rc | unit result | verdict |
|---|---|---|---|---|---|
| `snapshot` | yes | 41 tests / 41 pass / 0 fail / 0 skip / 0 cancel / 0 todo | `0` | `status=0/SUCCESS`, `946ms` | **`green`** |
| `compare` | yes | **unknown** — no summary block, no plan line | `<missing>` | **`timeout`**, `2min 64ms`, `killed 15/TERM` | `incomplete` |

`compare` printed 25 `ok` and 1 `not ok` before the TAP stream stopped mid-file; the six summary
fields never appeared, so its counts are **unknown, not 0**, and its `status.txt` records
`<missing>` for `acc_exit`, `node_rc` and every `tap_*` rather than substituting a number. The
runner's verdict follows its own rule: no complete summary ⇒ `incomplete`, never green.

## 4. What happened to `compare`

- The unit hit its `RuntimeMaxSec=120` ceiling: journal `Service reached runtime time limit.
  Stopping.`, `Failed with result 'timeout'`; unit log `Main processes terminated with:
  code=killed, status=15/TERM`, `Service runtime: 2min 64ms`, `CPU time consumed: 213ms`,
  `Memory peak: 38.5M (swap: 0B)`. The caps behaved as written; the workload was stopped, not
  completed.
- Last TAP item: `not ok 26 - a stream that has failed refuses later writes without touching it`
  at `…/tests/compare-cli.test.mjs:495`, `code: ERR_ASSERTION`, `operator: 'rejects'`, expected the
  rejection to match `/already failed/`, actual message `'Error: event boom'`. That is an **error-message
  assertion failure**, nothing more: the rejection did happen and its text did not match the expected
  pattern. The stack passes through `stream.write` (`:443`) → `src/compare-cli.js:237` →
  `sinkWrite` (`:531`) → test body (`:499`).
- After item 26 the stream produced nothing further — no `# Subtest:` header, no further item, no
  summary — and the process stayed alive until the 120 s limit. **Attribution, stated precisely:**
  item 26 is *not* where a pending write could be left uncovered. The test runner emits item 26's
  result and moves on; the shape that could leave a pending sink write is the **late-callback case
  that follows it** (the block starting at `compare-cli.test.mjs:505`), which never reported — it has
  no `ok`/`not ok` line in the TAP at all, so it is the point where output stops rather than a case
  that failed. That reading is static: I did not instrument pending work, did not dump stacks at the
  kill, did not re-run, and did not modify any file, so *why* the late-callback case never reported
  remains unproven.

## 5. Envelope, gate, resources

| field | launch 1 `snapshot` | launch 2 `compare` |
|---|---|---|
| `acc_envelope_check` | `pass` (9/9 `acc_verify_*` ok) | `pass` (9/9 ok, logged before the workload) |
| `memory.max` / swap / `pids.max` | `402653184` / `0` / `32` | `402653184` / `0` / `32` |
| `cpu.max` / `Type` | `50000 100000` / `exec` | `50000 100000` / `exec` |
| unit `MemoryMax`/`SwapMax`/`TasksMax` | `402653184` / `0` / `32` | `402653184` / `0` / `32` |
| runtime (resolved µs) | `120000000` | `120000000` |
| heap option | `--max-old-space-size=192` | `--max-old-space-size=192` |
| `acc_gate_memavailable_kib` | `990576` ≥ `819200` pass | `987084` ≥ `819200` pass |
| `acc_memory_peak` | `55746560` | not emitted (killed before the tail printed) |
| `memory.events` oom / oom_kill / max | `0` / `0` / `0` | not emitted |
| `cpu.stat` | `usage_usec 352618`, `nr_periods 10`, `nr_throttled 4`, `throttled_usec 335674` | not emitted |
| TAP lines / duration | `256` / `648.537078` ms | `185` lines, no duration line |
| `acc_sandbox_rc` / `acc_raw_exit` / `acc_node_rc` | `0` / `0` / `0` (`complete-summary-observed`) | not emitted |
| unit record | `status=0/SUCCESS`, `946ms`, `354ms`, `53.1M` | `timeout`, `2min 64ms`, `213ms`, `38.5M` |

Read precisely: `nr_throttled` is non-zero on launch 1 (`4` periods, `335674` µs throttled), so CPU
quota throttling **did** occur there and is recorded as a value, not as an absence. The three
`memory.events` counters being `0` say only that those three counts were zero in that run; they do
not establish that no limit was ever reached — `pids.max` has no event counter read here.

Two separate statements about launch 2's termination, kept apart on purpose:

- **Runtime fact, observed.** The unit was stopped by its own `RuntimeMaxSec=120` ceiling: journal
  `Service reached runtime time limit. Stopping.` and `Failed with result 'timeout'`; unit log
  `Main processes terminated with: code=killed, status=15/TERM`, `Service runtime: 2min 64ms`. So
  `compare`'s termination **is** attributed to the runtime ceiling — systemd said so, and this record
  does not deny it.
- **Unproven, and left unproven.** *Why* the workload had not finished when that ceiling arrived
  (the static reading — an uncovered pending write in the late-callback case at
  `compare-cli.test.mjs:505` — is consistent with the silence but not demonstrated by it) is **not**
  established: item 26 itself is an error-message assertion failure, not the pending point; the run
  carries no instrumentation of pending work, no stack dump at the kill, and was not repeated.

`acc_capacity_attribution=none-claimed` applies to **memory and CPU headroom only** — those are the
pressures whose consumption the batch measured and did not attribute. It is not a claim that the
timeout had no cause.

## 6. Selected inputs across the three batches

Every batch hashed the same 20 selected entries (2 targets + 16 inputs + `run.sh` + `payload.sh`);
each launch's before/after sets equalled its batch snapshot (`hash_status=ok`, 20 lines each side).

| file | batch 1 (11-06) | recheck 1 (11-07a) | recheck 2 (11-07b) |
|---|---|---|---|
| `tests/snapshot-diff.test.js` | `e317bb19…` | `27be92bc…` | `27be92bc…` |
| `tests/compare-cli.test.mjs` | `d17b26f3…` | `d17b26f3…` | **`1208c244…`** |

Only one line changed between recheck 1 and recheck 2 — the `compare-cli.test.mjs` digest — matching
the single-brace deletion. The other 19 entries are unchanged across the last two batches. This is a
witness over 20 named files, not a closure over the tree.

**Correction to an earlier version of this paragraph.** It said `compare` "behaved differently in
three batches on three different file states". That is wrong on two counts and is retracted here:

- `compare` **was not launched in batch 1** (the `snapshot` target failed first and the batch
  stopped), so `compare` has **two** observations, not three: a load failure at
  `d17b26f3…` (recheck 1) and a runtime-ceiling stop at `1208c244…` (recheck 2).
- The digest `d17b26f3…` is **the same in batch 1 and recheck 1**; it changes only in recheck 2. So
  across these three batches `compare-cli.test.mjs` changed **once**, and
  `snapshot-diff.test.js` also changed **once**.

Each of the two changed targets therefore has exactly one before/after pair, and the two pairs are
not contemporaneous: the `snapshot` change sits between batch 1 and recheck 1, the `compare` change
between recheck 1 and recheck 2.

**Comparability caveat (read this before comparing any two rows).** Both target tests appear in this
table with their own digests — `tests/snapshot-diff.test.js` (the `snapshot` target) and
`tests/compare-cli.test.mjs` (the `compare` target) — and each digest is specific to the batch on
that row. Three bounds apply, and **the caps are not one of them**:

(a) **The complete selected snapshot differs between batches** — batch 1 differs from recheck 1 in
`snapshot-diff.test.js`, recheck 2 differs from recheck 1 in `compare-cli.test.mjs` — so each batch
measured a different tree and no batch is a controlled repeat of another.

(b) **No stability study was designed.** The batches were authorised as single executions, not as
sampling, so no file state has a deliberate repeat. One accidental repeat exists and is reported as
two observations, not as corroboration: `tests/snapshot-diff.test.js` at `27be92bc…` gave 41/41 in
recheck 1 **and** 41/41 in recheck 2 — two runs, two agreements, nothing more. The `compare` target
has **no** repeat at either digest: `d17b26f3…` was measured once (recheck 1, load failure) and
`1208c244…` once (recheck 2, runtime-ceiling stop), and it was not launched at all in batch 1.

(c) **Capacity was fixed and identical across all three batches** — 384 MiB, swap 0, `TasksMax=32`,
`CPUQuota=50%`, `Type=exec`, 120 s, heap 192, and a **single `819200` KiB gate** — so no row differs
from another by budget. (An earlier draft of this paragraph wrongly imported a `1228800` KiB gate
from the `combined-report` slice; that floor was never used by any `snapshot-compare-unit-split`
batch, and the per-launch gates are `969012` / `1102976` / `1073144` / `990576` / `987084` KiB, all
above the same `819200` floor.)

What the table supports is per-run identity of the 20 selected bytes at the moment of that run; it
does not support a trend, a regression claim, or "the same slice improved/worsened".

## 7. Terminal state

Both launches: `terminal_query_rc=0`, `load_state=not-found`, `active_state=inactive`,
`sub_state=dead`, `main_pid=0`, `confirmation=notfound-settled`, `stop_attempted=no`
(`stop_rc=not-attempted`), both confirmation reads `not-read`/`<missing>`. Nothing was stopped by the
launcher — launch 2 ended because systemd enforced the runtime ceiling.

## 8. Raw paths

```
experiments/acceptance/snapshot-compare-unit-split/runs/20261106T162151Z-snapshot-compare-unit-split-488033-2162/
├── summary.txt, status.txt, snapshot.txt
├── 1-snapshot/{argv.txt, hashes-before.txt, hashes-after.txt, unit.log, systemd-run.rc,
│               journal.txt, terminal-query.txt, terminal-query.err, status.txt, out/node-tap.log}
└── 2-compare/{same set; unit.log ends at the timeout notice; out/node-tap.log ends at item 26}
```

Earlier batches: `…/20261106T160945Z-…-486898-24774/`, `…/20261106T161838Z-…-487390-2117/`.

## 9. Non-claims

- Not a green batch (`exit 11`); `compare` was **stopped by its own time limit**, which is neither a
  pass nor an assertion failure.
- `compare` has no measured test count. `26` is the number of TAP items *started*, not the size of
  the file's suite, and not "26 tests failed".
- `snapshot`'s green is this run on these bytes at this budget: not coverage, not closure, not proof
  about the target in general.
- Timeout ≠ hang proven: the process was alive at the 120 s ceiling; why it produced no further
  output is unexplained here.
- Not comparable to the `combined-report` slice (different budget, targets, and its runs predate the
  lower gate).
- Zero memory event counters and a passing gate are not host memory health.
- No fix, no retry, and no edit to any of the 20 selected inputs by this author; documentation
  (this record, earlier records, slice `README.md`) was written in parallel.
