# combined-report unit slice — recheck 3 (workload executed, 8 of 83 failed)

**Status: RUN ONCE — WORKLOAD EXECUTED, FAILED.** The fourth authorised attempt is the
first in which the capacity gate passed and node actually ran. One invocation, no retry,
no repair.

Predecessors, all kept as measured:
[`2026-11-06-combined-report-unit.md`](./2026-11-06-combined-report-unit.md) (refused),
[`2026-11-06-combined-report-unit-recheck.md`](./2026-11-06-combined-report-unit-recheck.md)
(refused), [`2026-11-06-combined-report-unit-recheck-2.md`](./2026-11-06-combined-report-unit-recheck-2.md)
(refused). None supersedes another.

## 1. Invocation

`bash experiments/acceptance/combined-report-unit/run.sh` — exactly once, after the operator
reported having freed memory. No pretest, no `bash -n`, no extra `node`, no capacity polling,
no automatic retry. `run.sh` and `payload.sh` were not edited before or after this launch;
their sha256 values are the same as in all three refused attempts (§5).

## 2. Identity and outcome

| field | value |
|---|---|
| run id | `20261106T132504Z-combined-report-unit-472520-21317` |
| unit | `combined-report-unit-20261106T132504Z-472520` |
| `systemd_run_rc` (raw unit) | `1` |
| `acc_sandbox_rc` (bwrap) | `1` |
| `acc_node_rc` | `1` |
| `acceptance_exit` | `1` |
| `evidence_write_failures` | `none` |
| `hash_status` | `identical` (17 rows before, 17 after) |
| terminal state | `not-found` / `inactive` / `dead` / `MainPID=0`, `stop_attempted=no`, `terminal_ok=yes` |

`acc_exit_basis=sandbox_rc`: the workload's own failure was preserved verbatim rather than
re-mapped, and the TAP summary was complete, so no write-failure code (73) outranked it.

## 3. Gate and envelope

| field | value |
|---|---|
| `acc_gate_memavailable_kib` | `1576044` |
| `acc_gate_required_kib` | `1228800` |
| `acc_gate` | `pass` (≈347 MiB of headroom) |
| `acc_cgroup_memory_max` / `_swap_max` / `_pids_max` / `_cpu_max` | `805306368` / `0` / `32` / `50000 100000` |
| `acc_unit_type` | `exec` |
| `acc_unit_runtime_max` | `2min` |
| `acc_runtime_usec_numeric` / `_resolved` | `<unavailable>` / `120000000` |
| `acc_capture_ok` | `yes` |

Node argv, verbatim:

```
/www/server/nodejs/v24.21.0/bin/node --max-old-space-size=384 --test --test-reporter=tap \
  --test-concurrency=1 \
  …/packages/analyzer/tests/combined-report.test.js \
  …/packages/analyzer/tests/combined-cli.test.mjs \
  …/experiments/combined-report-integration.test.mjs
```

## 4. Actual TAP counts

| field | value |
|---|---|
| `acc_tap_tests` | **83** |
| `acc_tap_pass` | **75** |
| `acc_tap_fail` | **8** |
| `acc_tap_skipped` / `_cancelled` | `0` / `0` |
| `acc_tap_summary_complete` | `yes` (`acc_tap_summary_note=none`) |
| `acc_tap_bytes` | `22031` |
| `acc_workload_wall_ms` | `1028` |

Node's own footer: `1..83`, `# tests 83`, `# suites 0`, `# pass 75`, `# fail 8`,
`# cancelled 0`, `# skipped 0`, `# todo 0`, `# duration_ms 644.176751`.

## 5. Selected hashes and resources

17 rows before and after, `identical`. Counted by reading `hashes-before.txt` (17 lines) with
file tools, **not** by `wc -l`. Scripts unchanged from the three refusals:

| file | sha256 |
|---|---|
| `run.sh` | `54a74059be832df1edf8b081b6622f628ae81936fea2743753104054d89b4e6e` |
| `payload.sh` | `a9a917dce2b5945aba70284faee270351de65d67dadfa3cc73bc9a133229c781` |

`acc_memory_peak=69328896`, `acc_memory_current_final=29151232`, `acc_memory_swap_peak=0`,
`acc_pids_peak=16`, all `memory.events` zero. `acc_cpu_stat`: `nr_periods 12`, `nr_throttled 7`,
`throttled_usec 380500` — the 50 % quota did bind, which is recorded rather than explained.

The list remains a selected witness, not a closure.

## 6. The eight failures, as reported

| # | test file : line | assertion | expected → actual |
|---|---|---|---|
| 8 | `experiments/combined-report-integration.test.mjs:342` | exit code, real CLI over explicit files | `0` → `3` |
| 10 | `experiments/combined-report-integration.test.mjs:428` | exit code, invalid admission document | `2` → `3` |
| 13 | `…/analyzer/tests/combined-cli.test.mjs:154` | missing lane ⇒ attention | `1` → `3` |
| 14 | `…/analyzer/tests/combined-cli.test.mjs:179` | unreadable document ⇒ invalid | `2` → `3` |
| 20 | `…/analyzer/tests/combined-cli.test.mjs:305` | bare specifier ⇒ OK | `0` → `1` |
| 23 | `…/analyzer/tests/combined-cli.test.mjs:357` | attention ⇒ 1 / lane error ⇒ 4 | `1` → `3` |
| 38 | `…/analyzer/tests/combined-cli.test.mjs:583` | stderr matches `/output failure/` | no match |
| 59 | `…/analyzer/tests/combined-report.test.js:299` | malformed entry ⇒ `invalid` | `'invalid'` → `'clear'` |

All other 75 passed, including both bounded-reader cases, the sink-failure ladder, the exit
code precedence tests and the whole admission lane.

## 7. Localisation (read-only; nothing was changed and nothing was re-run)

**A. `file:` validator specifiers are mis-resolved — the strongest candidate for #8 and #10.**
`src/combined-cli.js:201-213` classifies a `file:` specifier as path-like, then does
`pathToFileURL(isAbsolute(specifier) ? specifier : resolve(process.cwd(), specifier))`.
`path.isAbsolute('file:///root/…')` is **false**, so the URL string is treated as a relative
path: the result becomes `file:///root/dsh-ecosystem-spec/file%3A/root/…`. That import fails,
`loadLaneValidator` returns `{ ok: false }` (`:326-334`), and `exitCodeForReport` returns
`COMBINED_EXIT_CODES.USAGE` (`:358`) — the `3` seen in both integration failures, which pass
exactly such URLs (`DECLARATION_VALIDATOR_URL` / `ADMISSION_VALIDATOR_URL`, built with
`new URL(..., import.meta.url).href` at `:83-90`). The CLI's own usage text at `:162`
promises `file:` URLs are loaded as files, so the code contradicts its documented contract.
Not confirmed by execution — this is a code-path reading, and I did not run anything to
prove it.

**B. Fixtures name validators they do not provide — #13, #14, #23.** These call
`main(argv, io)` with `modules: {}` (or omitted, defaulting to `{}`) while still passing
`--declaration-validator /v/dec.mjs`. `makeIo`'s `loadModule` (`combined-cli.test.mjs:100-109`)
throws when the map has no entry, so the load fails and the CLI returns 3. The passing tests
next to them supply a resolver function instead (`:134-136`). Under the CLI's own contract
(`:177`: "3 usage, or validator load/use failure") the observed 3 is the specified behaviour;
the fixtures are inconsistent with the contract they assert.

**C. #20 asserts a code the contract forbids.** With only `--static` supplied, runtime and
admission are absent, and `:375` returns `ATTENTION` for any absent lane — the same rule the
passing test at `:661` ("the exit code is 1 when a lane needs attention or is absent")
confirms. Expecting `OK` for a one-lane invocation contradicts both.

**D. #38 expects retired wording.** The CLI now emits
`combined-cli: writing the report failed; completeness of the written bytes is not claimed.`
while the test matches `/output failure/`. A wording drift between test and source, not a
behavioural difference — the exit code 5 assertion in the same test passed.

**E. #59 is unlocalised.** The test loops seven malformed entry shapes and asserts `invalid`
for each; at least one is classified `clear`. The assertion does not say which shape failed
and the TAP output does not name it; I did not bisect, so the responsible shape is **unknown**.

## 8. What this run shows and does not show

- **Shows:** the slice runs end to end on this host — gate, envelope, sandbox, node, TAP
  capture, hash comparison and terminal settlement all worked; 75 of 83 assertions pass; the
  eight failures are reproducible statement-level disagreements with exact expected/actual
  values.
- **Does not show:** that the three target files are correct or incorrect as a whole; that
  the library is broken (7 of 8 failures are plausibly test-side or contract-side, one is
  unlocalised); anything about other slices, the host in general, or the Loader.
- The workload's `unit.log` carries no `dsh:` warning lines in this run; that says nothing
  about any other run and is not a host-health claim.

## 9. Non-claims

Not realLoader evidence, not Loader acceptance, not a certification, not a dependency
closure, not coverage, not global host health. No fix was attempted, no failing test was
skipped or loosened, and no second invocation was made to "see if it reproduces".

## 10. Next step

A further attempt needs a **new** explicit single-attempt GO. The three candidate repairs
(A: `resolveModuleTarget` should pass a `file:` specifier through unchanged; B/C: fixture and
expectation corrections; D: message text) are each a code or test edit and therefore out of
scope for this record — they are reported, not applied.

> **Later attempt (link only):** the repairs above were then made by others and a fifth
> authorised single invocation followed. It was refused at the same capacity gate
> (`1186032 < 1228800` KiB) before the workload started, so **none of the eight failures in
> §6 was re-observed**. See
> [`2026-11-06-combined-report-unit-recheck-4.md`](./2026-11-06-combined-report-unit-recheck-4.md)
> (run `20261106T133937Z-combined-report-unit-473037-1938`). This record's 75/83 remains the
> only executed measurement, and it describes the pre-repair bytes.
