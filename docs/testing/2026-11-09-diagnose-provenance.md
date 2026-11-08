# Unified diagnostics envelope `0.2-draft.1` — per-source baseline projection

Status: **executed, three bounded rounds across three runners, all green.**

The envelope moved from `dsh-compat-diagnose/0.1-draft.1` to `dsh-compat-diagnose/0.2-draft.1`.
The only semantic addition is one top-level `provenance` array: four frozen entries, fixed source
order, each `{source, baselineState, commit, node}`. Every lane block inside `combinedReport` is
unchanged, byte for byte.

## 0. Scope and non-claims

What these rounds establish:

- the envelope carries `provenance` in the fixed order, with the four closed words;
- `diagnoseExitCode` accepts that projection and refuses a malformed one;
- the analyzer suite, the real-validator wiring suite and the host GUI suite all pass on these
  bytes, and the GUI serves the projection over HTTP.

What they do **not** establish, and must never be quoted as:

1. **No host ran.** No plugin was loaded, no profile booted, no session observed. Nothing here is
   evidence about a real machine.
2. **No browser rendered the page.** No browser binary exists on this machine; the GUI evidence is
   HTTP-level and unit-level only.
3. **`certification` stays `false` and `correlation` stays `not-established`.** A baseline is a
   string copied from a document. It is not authenticated, not checked against a checkout, and not
   compared across sources.
4. **`recorded` is not "verified".** It says this envelope could read the two fields the receipt
   happens to carry. The runtime receipt's own limitations still apply unchanged.
5. **These are three runners, not the full package suite.** Each runner selects a small hashed
   input set; nothing here is a closure over the repository.
6. **No exit code changed.** The bump is shape-only; `0/1/2/3/4/5` keep their meanings.

## 1. What changed

| File | Change |
| --- | --- |
| `packages/analyzer/src/diagnose-internal.js` | version bump; `PROVENANCE_BASELINE_STATES`, `PROVENANCE_KEYS`; `provenanceEntry`, `buildProvenance`; `provenance` in the assembled envelope; new limitation `BASELINE_IS_READ_FROM_THE_SUMMARY_ONLY` |
| `packages/analyzer/src/diagnose.js` | re-exports the two new constants; `readProvenance(report)` shape gate inside `diagnoseExitCode` |
| `packages/analyzer/src/diagnose.d.ts` | version literal, `DiagnoseProvenanceEntry`, `ProvenanceBaselineState`, the two constants, `provenance` on `DiagnoseReport` |
| `packages/analyzer/tests/diagnose.test.js` | the seam stub now carries the projection the assembler emits; five new tests (four words, `recorded` copying, `not-readable` vs `not-reflected`, ten refusal shapes) |
| `packages/host/src/envelope.js` | `provenance` joins the inspected fields; a non-array is `{field: 'provenance'}` |
| `packages/host/src/page.js` | "Baseline per source" section, one card per entry, `commit`/`node` only for `recorded` |
| `packages/host/tests/gui.test.js` | fixture bumped to the 0.2 shape; one new page test |

Nothing else was touched: `combined-report.js`, `profile-dump.js`, the CLI argv, every exit code
and all three runner scripts are unchanged, so the runners' own bytes are the ones already
recorded for the slices that introduced them.

## 2. Round 1 — analyzer batch (`scripts/diagnose-batch/run.sh`)

Run directory: `/data/dsh-ecosystem-test-artifacts/runs/20261108T180217Z-diagnose-batch-860259-11864`

| Field | Value |
| --- | --- |
| `acceptance_exit` / `payload_rc` | `0` / `0` |
| TAP | `tests=54 pass=54 fail=0 cancelled=0 skipped=0 todo=0` |
| TAP field shapes | all six `ok` |
| `selected_inputs` | `12` |
| `hashes` | `identical` |
| yaml manifest snapshot | `identical` (233 files, two-point) |
| `envelope_mismatch` | `none` |
| `mem_available_kib` | `1250024` (threshold `819200`) |
| `memory_peak` / `pids_peak` | `42127360` B / `16` |
| terminal | `load_state=not-found`, `active_state=inactive`, `sub_state=dead`, `main_pid=0`, `confirmation=settled` |
| `write_failures` | `0` |

The suite grew from 49 to 54 tests: five new cases pin the projection.

## 3. Round 2 — real-validator wiring (`scripts/diagnose-real-wiring/run.sh`)

Run directory: `/data/dsh-ecosystem-test-artifacts/runs/20261108T180225Z-diagnose-real-wiring-860510-27886`

| Field | Value |
| --- | --- |
| `acceptance_exit` | `0` |
| six CLI cases | `case_failures=none` (exits `0/0/2/1/2/2` unchanged) |
| selected test file | `tests/diagnose-spec-wiring.test.js`, `exit=0`, `tap_tests=6 tap_pass=6 tap_fail=0` |
| `selected_inputs` | `19` |
| `hashes` | `identical` |
| yaml manifest snapshot | `identical` |
| `mem_available_kib` | `1212472` |
| `memory_peak` / `pids_peak` | `33738752` B / `16` |
| terminal | settled, `main_pid=0` |

This round matters because it is the only one that feeds **real spec validators** through the
envelope: the admission example still produces `attention`, the bare-declaration case still
produces `invalid`, and the added top-level field changed none of it.

## 4. Round 3 — host GUI (`scripts/diagnostics-gui-run/run.sh`)

Run directory: `/data/dsh-ecosystem-test-artifacts/runs/20261108T175819Z-diagnostics-gui-859535-9924`

| Field | Value |
| --- | --- |
| `acceptance_exit` | `0` |
| envelope step | `acc_envelope_verdict=pass` |
| carrier step | `acc_carrier_verdict=pass`, `acc_origin=http://127.0.0.1:40595` |
| refusal step | `acc_refusal_verdict=pass` (both routes answer `503 ENVELOPE_UNREADABLE`) |
| page | `200 text/html; charset=utf-8`, 10633 B, both literals present |
| envelope route | `200 application/json; charset=utf-8`, 7169 B, body sha256 == file sha256 (`8b2832462b9c7cdfec56a0188c8d84fdb257a7f384c0ce7f066ef67d17e3782d`) |
| selected package test file | `tests/gui.test.js`, `exit=0`, `tap_tests=16 tap_pass=16 tap_fail=0` |
| `selected_inputs` | `16` |
| `hashes` | `identical` |
| yaml manifest snapshot | `identical` |
| `mem_available_kib` | `1290520` |
| `memory_peak` / `pids_peak` | `49508352` B / `27` |
| terminal | settled, `main_pid=0` |

The served envelope was the one produced in the same run by the CLI from the shipped examples, so
the page and the JSON route were exercised against a document this repository actually emits,
including the `provenance` entries the page now renders.

## 5. Deviations

1. **Two local, unenveloped `node --test` runs** were made while repairing the suite
   (`tests/diagnose.test.js`, and `tests/gui.test.js` after the fixture bump). They produced no
   evidence, are not counted as rounds, and are recorded here only because they happened.
2. **The declarations file changed after the first green batch.**
   `src/diagnose.d.ts` was updated to describe the new fields *after* the first batch round
   (`20261108T175442Z-diagnose-batch-858672-31191`, also 54/54). Because `.d.ts` is one of the
   batch's and the wiring runner's selected inputs, both runners were run again afterwards, and
   only the later rounds (§2, §3) are quoted above. The first green round is kept here so the
   sequence is not hidden: **54/54, exit 0, `memory_peak=46243840`, `pids_peak=16`,
   `mem_available_kib=1264772`**.
3. **README files were edited after the rounds.** `packages/analyzer/README.md` and
   `packages/host/README.md` are documentation; neither is a selected input of any runner. Their
   content describes the measured numbers, so they cannot be part of the measurement.
4. **No `chmod` was needed:** all three runner scripts were already `755`.
5. **The GUI round was not repeated** after the `.d.ts` change, because `.d.ts` is not among its
   sixteen selected inputs and no host byte changed after it.

## 6. Files and hashes at run time

| Path | sha256 |
| --- | --- |
| `packages/analyzer/src/diagnose-internal.js` | `7ed2e2a16e28a22d041615b6028385d3108f5e55930f3e58c65a5cad9c09fa83` |
| `packages/analyzer/src/diagnose.js` | `a8dd242813067aefb1bdd0bf8196e684d0b35b1a01ac3326095500246bce449f` |
| `packages/analyzer/src/diagnose.d.ts` | `5c3911523ce89606ec4d175112c9b5eb32ff0d25d7ce7584ed2348c401375165` |
| `packages/analyzer/src/diagnose-cli.js` | `033fec2f41f470b7037e3a1ec958b7d28ab23f3a06e0e90d7f9ea0bc05d222f1` |
| `packages/analyzer/tests/diagnose.test.js` | `3af5b42e78d7df98e86e491e1f8d2e7740b18bc9df562cb075e4cba4703da061` |
| `packages/host/src/envelope.js` | `d1f27ca7fe8a9421f467b1e69bbf4f80ebd460729fa709d7d7944e9d24c261fe` |
| `packages/host/src/page.js` | `121deb7e6d3bf36d6c29f02b4a743342dfd9de39b5e39051a8a5ed0c0ac7e342` |
| `packages/host/tests/gui.test.js` | `01d083cf26d66add8a18eb3fe3b3711e01ec3eceb2c73bc93f4f32d574d2da89` |

## 7. Reproduce

```bash
cd /root/dsh-ecosystem-spec/projects/dsh-compat-platform
bash scripts/diagnose-batch/run.sh          # analyzer suite, bounded
bash scripts/diagnose-real-wiring/run.sh    # six CLI cases + wiring suite, bounded
bash scripts/diagnostics-gui-run/run.sh     # envelope, page, refusal path, host suite, bounded
```

Each script prints its own `run_dir` under `/data/dsh-ecosystem-test-artifacts/runs/` and exits
`0` only when every verdict it owns is `pass`.

## 8. Later shape changes

None. This is the current envelope shape.
