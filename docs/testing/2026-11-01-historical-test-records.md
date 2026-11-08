# Historical test records — dsh-compat-platform (backfilled)

Date of backfill: 2026-11-01 (Asia/Shanghai). Status: documentation only.

This file backfills the execution evidence produced while this project was being
accepted and then re-run under bounded envelopes. It records the past: every row
describes a code snapshot from 2026-10-31 or 2026-11-01, and **no run was repeated for
this documentation backfill** — every number below is transcribed from the retained
reports listed in §5, not reproduced. §7 records which later real-host stages did *not*
cover this package, so that their silence is not mistaken for coverage. Failures,
refusals and deviations are kept alongside the passes.

## 1. How to read this record — three numbers that are easy to confuse

| Number | What it actually covers |
|---|---|
| **59** | This project's own analyzer suite alone (`analyze` + `cli` + `runtime-evidence`), run by the Lead at first-slice acceptance. |
| **167** | A **combined** workload: analyzer tests **plus** `evidence-cli.test.mjs` **plus** the coexistence orchestrator test (`experiments/dsh-live-lab/coexistence/test/orchestrator.test.mjs`). **Not** the analyzer alone. |
| **54** | A **real host** run's assertion count inside three coexistence cases — a host baseline, not a protocol innovation and not this package's unit suite. |

Evidence tiers differ across the table below; they are never interchangeable.

## 2. Evidence ledger

| # | Date/time (Asia/Shanghai) | What ran | Verdict | Counts | Exit | Caps requested → observed | Tier |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-31 (plan date; run time not retained) | Analyzer suite + CLI fixtures with the real protocol validator | PASS | 59 tests / 59 pass; clean fixture 0, conflict fixture 1 | not recorded | none (no envelope) | unit/static |
| 2 | 2026-10-31 (plan date; run time not retained) | Three-repository integration (protocol + kit + analyzer) | PASS | 7 / 7 | not recorded | none | cross-repo unit |
| 3 | 2026-11-01 | `runtime-evidence.test.js` attempt | **REFUSED** (preflight) | 0 tests executed | suite N/A | envelope 768M verified, gate FAILED | — |
| 4 | 2026-11-01T20:14+08:00 | Five-file enveloped launch | **FAILED at preflight** | no unit created, no Node | not observed | not observed | — |
| 5 | 2026-11-01T12:07:00Z | Five-file enveloped run #1 | **FAIL** | 167 tests / 166 pass / **1 fail** | 1 | 768M → 805306368; peak 59.8 MiB | bounded unit |
| 6 | 2026-11-01T12:17:06Z | Five-file bounded rerun | PASS | 167 / 167 | 0 | 768M → verified; peak 66.7 MiB, pids 23/32 | bounded unit |
| 7 | 2026-11-01T12:28:42Z | Coexistence envelope run | **NOTRUN** (refused) | 0 of 3 cases | 64 | 1536M/1024 heap **requested only** | — |
| 8 | 2026-11-01T13:15:09Z | Real 3-plugin coexistence | PASS, 3 cases | 54 assertions (19/17/18), 0 failed | 0 | 1536M → 1610612736; peak 193.5 MiB | **real host** |
| 9 | 2026-11-01T13:22:24Z | `evidence-cli` over #8's evidence JSON | PASS | 3 cases, 54 assertions, `certification:false` | 0 | 768M → verified; RSS 16.9 MB | read-only parse |

### Row 1 — first-slice analyzer acceptance

Lead independently ran the 59-test suite and exercised the **actual** protocol
validator through the CLI: clean fixture exit 0, conflict fixture exit 1. Operational
detail worth keeping: relative validator file arguments require a leading `./`, or
Node interprets them as package specifiers. The selected validator executes **trusted
code**, not sandboxed code. Determinism assumes a deterministic validator, and
invalid-input positions are order-sensitive.

### Rows 3–4 — two refusals that cost a launch

Row 3: the envelope itself was exact (`Type=exec`, `RuntimeMaxSec=2min`,
`memory.max=805306368`, `swap=0`, `pids=32`, `cpu.max=50000 100000`), but the memory
gate failed — eight consecutive one-second samples of `MemAvailable` read
1047, 1011, 1022, 1027, 1023, 1009, 1032, 1010 MiB against a 1200 MiB gate,
`failed_samples=8/8`. **Zero tests executed**; the `result: success` lines authenticate
only the probe units. An earlier flapping window (1025–1313 MiB) contained one sample
above threshold and was correctly *not* treated as a pass.

Row 4: the single authorized launch was consumed by a helper-path defect —
`launch.sh` line 7 resolved one directory short, so `lib/common.sh` was never sourced
and `is_uint` was an unknown command; the memory-gate test collapsed to a refusal even
though the sample was fine (1299 MiB ≥ 1200). No unit was created, no Node ran, and the
envelope was never observed. It also discloses defects in its own earlier pre-flight
capture blocks, which are marked **not evidence**.

### Row 5 → row 6 — one real failure, then the pass

Row 5 is a genuine red: `tests/evidence-cli.test.mjs:407` (assertion at `:410`) failed
with `false !== true` after `runInjected(['--receipt','x.json'])`. Mechanism from
`src/evidence-cli.js`: `:353 if (args.length > 1) return usageError(io, ERROR_TEXT.USAGE_EXTRA)`
ran first, so `:358 if (target.startsWith('-')) … USAGE_OPTION` was unreachable for two
arguments; `USAGE_EXTRA`'s text contains no "unknown option". No source was modified and
no rerun was made in that attempt.

The fix then landed as a pure predicate `isUnsupportedOption(argument)` evaluated
**before** the multi-path arity check, in the same file (`:353`/`:358` region),
sha256 `75b0c267e5c889420cacb45820d12b0f8067b49c18e8c0e1994b2cc1103128be`,
with `--help`/`-h` deliberately still "understood". Row 6 is the rerun that passed
167/167 under a verified envelope.

Envelope accounting for row 6: `Type=exec`, `RuntimeMaxUSec=120000000`, service runtime
**4.271 s**, `memory.peak` 66.7 MiB of 768 MiB, `pids.peak` 23 of 32, `oom_kill 0`,
`acc_node_rc=0`. An in-capsule probe measured a **total** heap limit of 432 MiB against
a requested old-space cap of 384 MiB — different quantities, and the probe does not
measure every child's heap.

### Rows 7–9 — the real coexistence evidence

Row 7 never ran: the envelope refused itself on a single unmocked sample,
`memory: available=1153MiB gate=1700MiB`, `ENVELOPE_EXIT_CODE=64`,
`reason=preflight:memory_below_gate:1153<1700`, receipt `workload_evidence=none`. The
limits exist only as requested literals (`type=exec memory_max=1536M swap=0 tasks=32
runtime_max_sec=120 node_heap_mb=1024`) because no unit ever existed. Zero of the three
cases may be claimed passed or failed.

Row 8 is the real host run: gate sample 1800 MiB ≥ 1700, `envelope_verified=yes`,
`memory_max=1610612736`, `memory_peak=202956800` (≈193.5 MiB), `pids_peak=22`,
`workload_rc=0`, one writable bind for evidence, root read-only, private namespaces.
Three cases exercised real Loader/Cordis fibres and the real tools registry:
`same-name-conflict`, `dependency-unload`, `stale-cleanup`.

**Read row 8 for exactly what it is:** 54 assertions across three cases (19/17/18) that
describe the host's **existing native behaviour used as the baseline** — not a new
protocol guarantee, not evidence about any future coexistence design, and not this
package's unit suite.

Row 9 parses row 8's `coexistence-evidence.json` (sha256 `95334ead…cfd99`, identical
before and after) with the read-only `evidence-cli`: `valid:true`, `issues:[]`, cases
`same-name-conflict/dependency-unload/stale-cleanup` all `passed`, `assertionCount`
19/17/18 = 54, failed 0, **`certification:false`**, baseline commit `ce7073d5…`, node
`v24.21.0`. That `certification:false` is the honest headline: passing cases are not a
compatibility certification.

## 3. Deviations and incidents retained

- **Row 9 deviation (disclosed):** one stray host `node -e '0'` probe — an unbounded,
  host-side probe outside the envelope — plus one extra `MemAvailable` read preceded
  the run. The gate sample of record was 2056 MiB ≥ 1200.
- **Row 3 deviation (disclosed):** a pre-flight capture rework whose v1–v4 blocks were
  discarded as non-evidence (bad cgroup path from a dropped `.slice`, mangled `awk`,
  empty readings inside a compound loop); the gate was ultimately measured on the
  global host counter.
- **Row 5 → 6:** the failing assertion was neither deleted nor softened; the defect was
  fixed and re-run once, and both the red and the green are retained.
- **Launch accounting:** single-launch discipline was enforced throughout — row 4
  consumed its one authorized launch on a preflight bug and did **not** self-authorize
  a retry; row 6 was "one launch only, no retry, no malformed launch consumed".
- **No envelope in rows 1–2:** first-slice acceptance ran unbounded by design; do not
  attribute cgroup caps to it.

## 4. Provenance gaps (do not invent these)

- **Code revision at rows 1–2, 3, 5, 6: NOT RECORDED.** No commit was captured for the
  analyzer at those runs. Only row 8/9 record a revision, and it is the **host
  build-checkout baseline** `ce7073d51254c26cd63b22a60835b8f948deb447`, not a revision
  of this package. This project's own repository has an initialized but commit-less git
  history (`git rev-parse --verify HEAD` → "Needed a single revision") and the parent
  workspace tracks no file under `projects/`, so no analyzer result can be pinned to a
  revision or attributed to the current tree. **Two limits on that inference:** (a) the
  unborn HEAD explains only why no commit was available at run time; it does not establish
  that no per-file source digest was ever computed or kept elsewhere — a missing recorded
  revision is a gap in this record, not a finding that all source hashes are absent;
  (b) digests of today's files are not run-time digests and must never be backfilled into
  these rows, and a commit existing in an enclosing repository does not retroactively pin
  a run whose tree state was never captured.
- **Per-file sha256 was captured only in specific runs:** `evidence-cli.js`
  `75b0c267…3128be`, `analyze.test.js` `9813109a…53812`, `cli.test.js`
  `1e62f3c4…4732`, `runtime-evidence.test.js` `56ef991f…9d67`,
  `evidence-cli.test.mjs` `92414f12…674`, `orchestrator.test.mjs` `d449091b…1efb`,
  `unit-analyzer-tests.sh` `8893836b…1d1f`. Row 6's report attests the payload and all
  five test files were sha256-identical before and after — it does not restate the
  digests.
- **Exit codes for rows 1–2: not recorded.** Wall time and memory peak for rows 1–2: not
  recorded (no envelope).
- **Two different memory gates** apply and must not be merged: 1200 MiB for the analyzer
  unit envelope, 1700 MiB for the coexistence envelope.

## 5. Links to the original reports

Relative from this file; every target is in the **parent workspace**, outside this
repository — traceability only, not portable with this package.

- [First-slice plan §7](../../../../docs/requirements-and-design/2026-10-31-first-slice-dev-plan.md) — rows 1–2.
- [Runtime evidence, first attempt (pre-flight refused)](../../../../experiments/acceptance/reports/runtime-evidence-first.md) — row 3.
- [evidence-cli argv precedence, launch failed at preflight](../../../../experiments/acceptance/reports/analyzer-evidence-cli-argv-20261101T121407Z-analyzer5-11512-3642.md) — row 4.
- [Unit envelope receipt 12:07Z](../../../../experiments/acceptance/reports/unit-envelope-20261101T120700Z-receipt.md) — row 5.
- [Analyzer + coexistence five-file rerun (167/167)](../../../../experiments/acceptance/reports/analyzer-coexistence-five-file-rerun-20261101T121706Z-analyzer5-rerun-13943.md) — row 6.
- [Coexistence envelope NOTRUN](../../../../experiments/acceptance/reports/envelope-coexistence-notrun-20261101T122842Z-23738.md) — row 7.
- [Real coexistence receipt + evidence](../../../../experiments/acceptance/reports/20261101T131509Z-coexistence-63072-19485/receipt.txt) — row 8.
- [evidence-cli acceptance, 3 cases / 54 assertions / certification:false](../../../../experiments/acceptance/reports/20261101T132224Z-evidence-cli-68973-4208/report.md) — row 9.
- [Coexistence fixture README (what each case asserts, and its gaps)](../../../../experiments/dsh-live-lab/coexistence/README.md) — the semantics and limits behind row 8.
- [This project's requirements](../requirements-and-design/2026-10-31-compat-platform-requirements.md) — the accepted static-slice contract.

## 6. Checklist for future test records (mandatory)

Any subagent that executes tests for this repository must write its outcome into a new
dated file under `docs/testing/` and satisfy every item below. The Lead reviews it
before the result is cited.

1. **Outcome first.** `PASS`, `FAIL`, `REFUSED` or `NOTRUN` before any narrative.
   Written-but-unexecuted cases are `NOTRUN`, never pass.
2. **Never replace red with green.** Append attempts; never edit an older row. Row 5's
   failure stays visible next to row 6's pass.
3. **Name the exact workload.** List every test file; if the count is a **combined**
   workload (analyzer + evidence-cli + orchestrator), say so and never label it
   "analyzer 167". Keep 59 / 167 / 54 apart.
4. **Timestamps with time zone.** ISO 8601 with offset, plus the transient unit name.
5. **Exact commands, verbatim**, including `./` on relative validator paths and every
   bwrap/env flag. Unknown from evidence → "not retained", never reconstructed.
6. **Caps requested vs observed**, read from the unit/cgroup: `memory.max`,
   `memory.swap.max`, `pids.max`, `cpu.max`, `RuntimeMaxUSec`, Node heap cap; plus
   peak memory, pids peak and `oom_kill`. State the gate used (1200 vs 1700 MiB) and the
   single sample with its value and time.
7. **Code revision at run time**, or per-file sha256 when there is no commit. If not
   captured, say so — the row is unpinnable and cannot be attributed to current files.
8. **Counts and exit codes:** tests, pass, fail, skipped, cancelled, `acc_node_rc`,
   `systemd-run` rc. Keep refunds and preflight aborts on separate lines.
9. **Raw logs retained, by path**; otherwise mark "summary only".
10. **Scope and tier:** unit/static versus bounded-unit versus real-host, and what each
    does *not* prove. A passing case list is never a certification — carry
    `certification:false` forward explicitly.
11. **Deviations disclosed:** stray host probes, extra memory samples, retries, budget
    changes, discarded capture blocks, and refusals with literal codes/text.
12. **Refusals separate from failures:** a memory-gate refusal is `REFUSED` with
    `reason=` and exit 64-type accounting, not a test failure and not a pass.
13. **No cross-attribution:** a host baseline result does not certify this package, and
    no old result certifies newer code.

## 7. Appended later — what the subsequent real-host stages did *not* cover

Appended 2026-11-01 so that later host activity is not silently read as coverage of this
package. Between 16:45 and 18:10 on 2026-11-01 the parent workspace ran several real-host
stages (a driver guard run, two kit-generated-plugin lifecycle runs, two official-CLI
launcher-readiness runs, and four agent-guard rounds). **None of them executed this
package's suites**: `analyze.test.js`, `cli.test.js`, `runtime-evidence.test.js`,
`evidence-cli.test.mjs` and the coexistence orchestrator test were not re-run, and the
three-plugin coexistence fixture was not re-staged.

Consequences to keep straight:

- **Rows 1–9 above remain the entire ledger.** Row 6's 167/167 is the latest *recorded*
  state of the combined workload — not a current claim about the present tree, and not
  something the later host stages corroborate.
- **Row 8 is still the only real-host row.** The later launcher/lifecycle stages use
  different packages and a different profile; they neither repeat nor strengthen the
  54-assertion host baseline, and `certification:false` from row 9 still stands.
- **The two memory gates are unchanged** (1200 MiB analyzer envelope, 1700 MiB
  coexistence envelope). Later stages used their own gates (≥1700 for the launcher and
  the kit lifecycle); those numbers must not be grafted onto rows 3–9.
- **One adjacent artifact names a different project, not this one.** The kit's 17:08
  preparation validated a *generated declaration* through
  `projects/dsh-compat-spec/src/index.js` `validateDeclaration` (`valid:true`,
  `issues:[]`). That is the protocol package, invoked as a library inside a bounded unit —
  it is not an analyzer run, not an `evidence-cli` run, and not evidence for any row here.

Unchanged gaps: rows 1–2 still have no exit code, no envelope and no revision; rows 3, 4
and 7 are still refusals rather than results; and no row may be attributed to the current
tree (§4).
