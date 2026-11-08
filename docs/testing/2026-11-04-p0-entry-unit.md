# 2026-11-04 — P0 entry-unit (platform analyzer lane record)

STATUS: **RAN ONCE — FAILED.** 66 tests in the unit: 65 pass, 1 fail, 0 skipped,
0 cancelled, 0 todo; unit exit 1. The single failure is in **this** lane's target,
`projects/dsh-compat-platform/packages/analyzer/tests/admission-cli.test.mjs:905`.
No retry, no fix, no second launch; the failure is recorded as it happened.

Raw evidence: `experiments/acceptance/p0-entry-unit/runs/20261104T155634Z-p0-entry-unit-407485-22066/`
— `argv.txt`, `hashes-before.txt`, `unit.log`, `systemd-run.rc`, `journal.txt`,
`hashes-after.txt`, `status.txt`.

Slice contract and process disclosures:
`experiments/acceptance/p0-entry-unit/README.md`.

## Unit

`p0-entry-unit-20261104T155634Z-407485.service` — one transient
`systemd-run --wait --pipe --collect` invocation, `Type=exec`. The same unit ran
all three targets; this record covers only what the analyzer contributes to it.
systemd's report: `Finished with result: exit-code`, `Main processes terminated
with: code=exited, status=1/FAILURE`, service runtime 1.038 s, CPU time 434 ms,
memory peak 68.5 M (swap 0 B).

## Command (executed verbatim)

```
systemd-run --wait --pipe --collect --unit=p0-entry-unit-20261104T155634Z-407485 \
  --property=Type=exec \
  --property=MemoryMax=768M --property=MemorySwapMax=0 \
  --property=TasksMax=32 --property=RuntimeMaxSec=120 \
  --property=CPUQuota=50% \
  --property=WorkingDirectory=/root/dsh-ecosystem-spec/experiments/acceptance/p0-entry-unit \
  -- /bin/bash /root/dsh-ecosystem-spec/experiments/acceptance/p0-entry-unit/payload.sh p0-entry-unit-20261104T155634Z-407485
```

Inside the unit, one serial invocation (quoted from `unit.log`):

```
acc_workload_argv=node --test --test-concurrency=1 \
  /root/dsh-ecosystem-spec/projects/dsh-agent-test-driver/tests/acceptance.test.js \
  /root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer/tests/admission-cli.test.mjs \
  /root/dsh-ecosystem-spec/experiments/p0-acceptance-integration.test.mjs
```

## Observed envelope (readback, not requested caps)

| Field | Readback |
| --- | --- |
| cgroup path | `/system.slice/p0-entry-unit-20261104T155634Z-407485.service` |
| `memory.max` | `805306368` |
| `memory.swap.max` | `0` |
| `pids.max` | `32` |
| `cpu.max` | `50000 100000` |
| unit `Type` | `exec` |
| `RuntimeMaxUSec` | `2min` → resolved `120000000` µs |
| `MemAvailable` gate | `1681544 KiB` vs required `1228800 KiB` → pass (sampled once) |
| node heap cap | `--max-old-space-size=384` |

Post-run counters: `memory.peak=71917568`, `memory.current` final `36827136`,
`pids.peak=20`, `memory.events.local` all `0` (no `high`, no `max`, no OOM).

## Workload (this lane's share)

`projects/dsh-compat-platform/packages/analyzer/tests/admission-cli.test.mjs` —
CLI contracts: argument parsing, exit codes, diagnostic and wrapper-issue codes,
and error paths, driven through `main()`. Two groups: a **seam** group with
`readFile`/`loadModule` injected, and a **real-path** group that omits both sinks
so the default loader and the real `readEvidenceFile` execute.

What the run established, per the log:

- The real-path group ran for real: `✔ the DEFAULT loader really imports the
  file: URL named on the command line` passed, and the canonical-grammar group
  executed (its three cases appear in the log at lines 91–93, one passing).
- The absence-dependent case passed: the real reader was called for a path that
  must not exist, and it does not.
- No test skipped: `skipped 0`, `todo 0`, `cancelled 0` — so a missing canonical
  spec did not silently shrink the suite.

This runner records only the aggregate totals (66/65/1/0); per-file counts are
not printed by this invocation and are not reconstructed here. The failing-test
section names exactly one test, and it is in this target.

## The failure

```
✖ the canonical grammar calls an unreported optional case unknown coverage — exit 1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual   'ADMISSION_CASE_REFUSED'
  - expected 'ADMISSION_COVERAGE_UNKNOWN'
    at projects/dsh-compat-platform/packages/analyzer/tests/admission-cli.test.mjs:921:12
```

What passed before that line, in the same test (`admission-cli.test.mjs:905`):
exit code `1`, `printed.valid === true`, and
`printed.summary.coverage.unknown === ['admission-visibility']`. Only the
**first finding's code** differed; assertions at lines 922–923 were never
reached.

Read-only diagnosis (no fix, no re-run):

- The document under test is a full-coverage canonical document with the single
  optional case `admission-visibility` omitted.
- `findingsFor()` in `src/admission-diagnostics.js:454-478` emits findings for
  **reported cases first**, in summary order, and appends `coverage.unknown`
  findings afterwards. So `findings[0]` is whatever non-passing reported case
  comes first.
- The observed `ADMISSION_CASE_REFUSED` therefore means the canonical grammar
  reported at least one case with status `refused` for this document; the
  coverage finding for the omitted optional case exists, but not at index 0.
- That is consistent with the summary: `coverage.unknown` correctly listed the
  omitted id, and the platform's own consistency check
  (`src/admission-diagnostics.js:409-411`) forbids an id from being listed in
  both `present` and `unknown`, so the refused case is a *different* reported
  case, not the omitted one.

Which side is authoritative — the canonical grammar's refusal for that case, or
the test's assumption that the omitted-case finding is the only one and comes
first — is a Lead decision. This record does not settle it, and nothing was
edited to make the test pass.

Consequences that stay on the record: the P0 slice is **not accepted**; the
sample is a **single** unit run, so it says nothing about flakiness; and the
failure is reproducible-unknown, because a retry is exactly what this protocol
forbids.

## Hashes (before == after)

`hash_status=identical`: 23 selected inputs hashed individually before and after
the unit, no `hashes-diff.txt` produced. Full list and digests:
`hashes-before.txt` (byte-identical to `hashes-after.txt`).

This lane's share, with digests:

- `.../src/admission-cli.js` — `5e179352d6c25cacc33daf28baae8e75b94ba63af797f33d49f9ab428172746c`
- `.../src/admission-diagnostics.js` — `7485f7240026bd53d2dca97a24ecf56ca17b503a29485e39495285ba83d475ad`
- `.../src/evidence-cli.js` — `75b0c267e5c889420cacb45820d12b0f8067b49c18e8c0e1994b2cc1103128be`
- `.../src/runtime-evidence.js` — `a332d17893db1817afe16bafe2ec62738106fe63db417886351831ecab964253`
- `.../src/index.js` — `c14c0811a608f2eb37103144eba6322e33f831038ff638ba699acbaa9138ca1a`
- `.../src/analyze.js` — `b2248b5b0905636f4bf92fecd9686ad478bc5fa499e7264667548ef18585e52c`
- `.../src/report.js` — `860025c11563d861041bf63a44ce7e4d1884dd0acfaf6496f20cb97797241364`
- `.../src/exit-codes.js` — `17b812bb34b33b7e5ce82ba0f1c8b9c82ff6b2a0899aed09598d41c3b693e371`
- `.../src/index.d.ts` — `39d7d52e6f311363a3c7b1a78441ca35bac8c9f921b8d52f9e1070dee062eaa1`
- `.../src/admission-diagnostics.d.ts` — `33309590df133343c723df9c539e3d4ae5eeb70226b2e1307d140d963fdc6c55`
- `.../package.json` — `86d202d48a9d169767509c5c5e2cdea5e8468de1f452dc2fe9b790df1bb97995`
- `.../tests/admission-cli.test.mjs` — `4845f0b854bc802425e9680431ce09253e6952fdf6e4d869a674a827bf74ee50`

Selected witness, **not** a closure: `src/cli.js`, `src/evidence-diagnostics.js`,
node builtins and `tests/helpers/*` stay outside it, so a change there would not
be caught by the pair.

## Disclosure kept (lane-relevant)

- **Scope expanded during preparation:** this lane's author widened the hashed
  surface to `src/index.d.ts`. The Lead **accepted** it, so the file is
  legitimately inside the witness — and the fact that it was an in-flight scope
  change stays disclosed rather than absorbed silently.
- The driver-lane author **violated the "no commands" rule** while preparing the
  shared slice: read-only `cat`, `wc` and `grep` outside the envelope, plus a
  later read-only `ls -la`. None produced acceptance evidence, but they were
  commands, so no record may claim the lane was prepared without command
  execution.
- The preparing author of the slice also ran one read-only `pwd && ls`; disclosed
  for the same reason.
- The historical artifact read by the integration target is an **input**, not new
  runtime evidence; this unit did not re-run the loader that produced it.
- The export-map check in the integration target is an ESM symlink into a temp
  `node_modules` — **not** a packed or installed package, and not evidence about
  installation.
- No real Loader, host boot, plugin runtime or browser was exercised; no build,
  install or network step ran. Tests wrote only under `/tmp` and cleaned their
  own temp roots.

## Verdict

**NOT ACCEPTED — FAILED.** One assertion in this target's canonical-grammar case
(`admission-cli.test.mjs:921`) disagrees with the observed finding code. The unit
is a single run, it was not retried, and no source, test or runner was edited
after the result.
