# Unified read-only diagnostics — `dsh-compat-diagnose` design

> Version: v1.0-draft　　Date: 2026-11-08　　Related modules: `packages/analyzer`, `dsh-compat-spec`
>
> **[Decided, 2026-11-08]** — recorded from the authorising instructions for this round:
> - **Shape**: one new read-only entry, `dsh-compat-diagnose`, that takes **one exported profile dump and up to three explicitly named lane documents**. No scanning, no auto-export, no host access.
> - **Lanes are reused, not re-implemented**: the static/admission/runtime judgements stay in `buildCombinedReport`; the profile judgement stays in `summarizeProfileDumpText`. This round adds orchestration and an envelope, not analysis.
> - **Exit codes count provided sources only.** An absent or never-named source never yields attention. This is a deliberate divergence from `combinedReportExitCode`, which maps an absent lane to attention.
> - **Failure isolation**: a source that cannot be read, is not JSON, or whose validator will not load becomes a `provided` block with a fixed issue code. Other sources keep their results. If every named lane fails, the embedded combined report is **kept**, not nulled.
> - **`combinedReport` is null only when no lane was named at all.**
> - **The profile block stays a safe summary.** Counts, limits, fixed codes and its own fixed diagnostics; no dump text, no plugin ids, no `!!js` expression text. The whole envelope may otherwise carry names and paths from the lane documents and says so.
> - **No new dependencies**, no root-index change, no change to the existing lanes, their schemas or `snapshot-diff`.
> - **This round delivers sources only**: implementation, directed test source and this document. **Nothing is executed** — no `node --test`, no `bash -n`, no subprocess.
>
> *Status as of 2026-11-08, later than the decision above:* the test file has since been run once
> (single file, scope-bounded). See §9 and the testing record; the decision text is left unedited
> because it records what was authorised for that round.

## 1. Objective

The platform now has five CLIs and four judgement modules, and a user who wants to know "what does
my setup look like" has to run three or four of them by hand, keep their outputs apart, and
reconcile exit codes that were never meant to be combined. Two of those exit tables actively
disagree about absence: a lane nobody asked about is *attention* to `combinedReportExitCode`
(`packages/analyzer/src/combined-report.js:534`) and *nothing at all* to a user.

This round adds **one** command that answers a single narrow question:

> Given the sources I explicitly named, what did each one establish, what can I not conclude across
> them, and what is the next read-only thing to look at?

It is an orchestrator with an envelope, not a sixth analyser. It cannot establish that the sources
describe the same host, that a plugin would load, that a `config` block conforms to a schema, or
what any `!!js` expression evaluates to.

## 2. Current state (evidence-backed)

### 2.1 Existing entry points and where a fourth source would have to go

```
dsh-compat-analyze   → src/cli.js             --validator <m> <manifest.json |->
dsh-compat-report    → src/combined-cli.js    --static/--runtime/--admission + validators
dsh-compat-compare   → src/compare-cli.js     --before <snap> --after <snap>
dsh-compat-admission → src/admission-cli.js   <document.json> --validator <m>
dsh-compat-profile-dump → src/profile-dump-cli.js <dump.yml>
```

The combined report is a three-lane container:

```
buildCombinedReport(input, options)              // combined-report.js:496
  ├─ readPresence(input)                         // :189   closed key set, accessors refused
  ├─ staticChannel(value, validateDeclaration)   // :306   requires a validator, else VALIDATOR_MISSING
  ├─ runtimeChannel(value)                       // :378   summarizeRuntimeEvidence
  └─ admissionChannel(value, validateAdmission)  // :428   requires a validator
```

`readPresence` is the load-bearing fact for this design: it accepts **exactly** the three own keys
`static`, `runtime` and `admission`, refuses accessor properties, and throws
`INPUT_EMPTY_TYPE_ERROR` when none is present (`combined-report.js:189-208`). A fourth `profile`
key inside that input throws `INPUT_KEY_TYPE_ERROR`. **The profile therefore cannot ride inside the
combined-report input**; it has to be a sibling block in a new envelope.

A second fact shapes the CLI: `combined-cli.js` accepts only its own five flags and writes its own
JSON plus a stderr summary line (`combined-cli.js:237`, `:545`). Calling its `main()` as
orchestration would mean parsing its output and inventing a second exit table on top of it.

### 2.2 Existing reuse seams

| Seam | Location | Reused as-is |
| --- | --- | --- |
| `readEvidenceFile` — bounded, regular-file-only, strict UTF-8, 1 MiB | `evidence-cli.js:182` | ✅ read path for all four sources |
| `streamSink` — awaited sink for stdout/stderr | `combined-cli.js:455` | ✅ no new stream plumbing |
| `sameEntryPoint` — direct-invocation guard | `combined-cli.js:745` | ✅ imported modules never self-execute |
| `buildCombinedReport` — the library, synchronous | `combined-report.js:496` | ✅ called unchanged |
| `summarizeProfileDumpText` — safe summary, returns one even on refusal | `profile-dump.js:526` | ✅ called unchanged |
| `COMBINED_REPORT_LIMITATIONS` — five fixed codes | `combined-report.js:114` | ✅ republished, not re-spelled |

`loadLaneValidator` (`combined-cli.js:339`) and its `VALIDATOR_EXPORT_BY_LANE` table are **not
exported**. See D4.

### 2.3 Existing exit tables

| Table | Where | Absence means |
| --- | --- | --- |
| `COMBINED_EXIT_CODES` 0/1/2/3/4/5, precedence 5>3>4>2>1>0 | `combined-cli.js:102` | attention |
| `combinedReportExitCode` 0/1/2/4 | `combined-report.js:534` | attention |
| `PROFILE_DUMP_EXIT` 0/1/2/5/64 | `profile-dump.d.ts` | n/a (single input) |

None of them can be reused verbatim: the first two count absence as a finding, and the third uses
`64` for usage while the combined CLI uses `3`.

## 3. Difference table

| # | Difference | Today | This round |
| --- | --- | --- | --- |
| D1 | Entry point count | A user runs 3–4 CLIs and reconciles them by hand | One command, one envelope, one exit code |
| D2 | Profile in a combined view | Impossible: `readPresence` refuses a fourth key (`combined-report.js:189-208`) | Sibling `profile` block beside the untouched `combinedReport` |
| D3 | Absence in the exit code | `combinedReportExitCode` and `exitCodeForReport` (`combined-cli.js:372`) both map absent → attention | Only `provided` blocks count; absent never yields 1 |
| D4 | Validator import | `loadLaneValidator` is module-private (`combined-cli.js:339`) | Copied (~40 lines) with the basis recorded, and covered on this path by a test |
| D5 | Failure input | Combined CLI builds failures internally in `run()` | Public builder takes payloads only; the failure vocabulary is an internal CLI path |
| D6 | All-lanes-failed | `run()` patches a builder skeleton (`combined-cli.js:537`) | Same idea, but the public envelope guarantees the lanes survive and documents the skeleton |
| D7 | Next steps | None in any CLI | Fixed closed code table, read-only advice, at most one per source |

## 4. Technical approach

### 4.1 Envelope and the two-builder split (D2, D5)

```
diagnose.d.ts / diagnose.js                     (public: payloads only)
      │
      ├─ buildDiagnoseReport(input, options)    → buildFromPayloads
      ├─ diagnoseExitCode(report)               → 0|1|2|3|4, shape-checked
      │
diagnose-internal.js                            (NOT in package exports)
      │
      ├─ buildFromPayloads(input, options)      allowFailure: false
      └─ buildFromOutcomes(outcomes, options)   allowFailure: true   ← only diagnose-cli.js
            │
            └─ assemble() → { diagnoseVersion, certification:false, correlation:'not-established',
                              profile, combinedReport, nextSteps, limitations }
```

`diagnose-internal.js` exists for one reason: the CLI has to carry *its own I/O outcome* into the
envelope, and a library caller must not be able to do the same. Two entry functions over one
assembler is the smallest shape that keeps that true, and `package.json` `exports` omits the internal
module so `import 'dsh-compat-platform/diagnose-internal'` fails.

`buildDiagnoseReport` accepts `{ text }` for the profile and `{ document }` for a lane, and nothing
else. Passing `failure` anywhere on the public path is a fixed `TypeError`.

**Presence is own-key presence.** Both builders read with `Reflect.ownKeys` plus property
descriptors: non-enumerable own keys are seen (so a lane cannot be written down and silently
ignored), symbols and accessors are refused, and a plain-record check (prototype must be
`Object.prototype` or `null`) keeps a `Date` or class instance from being read as a bag of lanes.
An own key holding `null`/`undefined` is **malformed**, not absent: writing the key down is a
request, and answering it with silence is the failure mode this contract exists to prevent.

A lane whose payload is `undefined` is likewise **not** skipped — it is a named lane with an
unusable document, so it reaches the library and comes back `invalid`. Whether that happens is
decided by the library's own `readLaneEntry` (`combined-report.js:237`), not by a second opinion here.

### 4.2 Exit mapping (D3)

Before walking the blocks, `diagnoseExitCode` **re-checks the envelope it was handed**: the
documented `diagnoseVersion`, `certification === false`, `correlation === 'not-established'`, an
array `nextSteps`, and the presence of the `profile` own property. When `combinedReport` is not
`null`, `channels` must be a plain object and `static`/`runtime`/`admission` must each be **own**
properties; a missing, `null` or `undefined` channel is a shape violation, not an `absent` block.

This is deliberate duplication of the assembler's `blockFor` (`diagnose-internal.js:439-444`),
which substitutes an absent block for a missing lane. That substitution is right when reading a
report the assembler just built and wrong at this entry: a truncated or hand-edited report would
otherwise read as "nobody asked about that source" and could exit `0`. Only
`combinedReport === null` — the documented "no lane was named" — lets the three lanes be absent
without looking at `channels`. An `absent` block must carry exactly `outcome: 'unknown'`;
a missing or different outcome is refused rather than discarded.

A shape violation throws a fixed `TypeError`; there is **no dedicated exit code** for a malformed
report (in particular nothing numbered `72`). The CLI maps that throw to `5`, its own internal
failure. This is a shape check, not a brand or provenance check: a report that satisfies the
documented shape is accepted no matter who built it.

Then it walks the four blocks and ignores every `absent` one:

```
VALIDATOR_LOAD_FAILED present → 3
else any provided:error      → 4
else any provided:invalid    → 2     (an `unknown` provided block counts here: named, established nothing)
else any provided:attention  → 1
else                          → 0
```

`5` is never returned by the mapper: it does no I/O. The CLI adds `5` for a serialization failure, a
failing sink, or an assembler throw. This keeps the documented precedence `5 > 3 > 4 > 2 > 1 > 0`
true of both layers without a second table.

The mapper shape-checks `state` (`absent`/`provided`) and `outcome`
(`unknown`/`clear`/`attention`/`invalid`/`error`) before mapping, so a typo cannot be skipped into
`0`. It is not a brand or provenance check, and the design does not pretend one exists: the library
freezes its outer object but brands nothing.

> ⚠️ `VALIDATOR_LOAD_FAILED` is recognized by its **issue code**, not by a parallel boolean. A flag
> beside the report could disagree with it; the code cannot.

### 4.3 The profile block (D2)

`profileBlock` mirrors the channel shape (`state`, `source`, `outcome`, `issues`) and adds the two
fields only a summary has (`summary`, `entryDiagnostics`). Three cases:

- read failed → `invalid` + `INPUT_READ_FAILED`, `summary: null` (nothing was decoded);
- summarized, `ok: false` → `invalid` + `PROFILE_UNUSABLE`, **`summary` kept**;
- summarized, `entryDiagnostics > 0` → `attention` + `PROFILE_ENTRY_DIAGNOSTICS`;
- otherwise → `clear`.

The refusal case is the one worth stating: `summarizeProfileDumpText` builds a full summary even
when it refuses, carrying the fixed reason codes and the measured byte/line counts. Replacing that
with a bare `PROFILE_UNUSABLE` would delete the only explanation a reader can act on. The counter
comes from `result.entryDiagnostics` (computed while parsing), not from the capped `diagnostics`
list, so a long list cannot hide the fact.

### 4.4 All-lanes-failed (D6)

When lanes were named and every one of them failed before the library could be called, there is no
usable builder input. Returning `null` would erase the fact that three lanes were requested. So the
assembler builds the **same schema** itself: the library's fixed version, `certification: false`,
`correlation: 'not-established'`, `limitations` copied from `COMBINED_REPORT_LIMITATIONS`
(`combined-report.js:114`), each named lane `provided` with `invalid`/`error` and its fixed code,
each unnamed lane `absent`.

This is the one place the embedded report is *not* the library's output, so `diagnose.d.ts` and §13.2
of the package README both say so. Shape alone cannot distinguish the two, which is exactly why it
is written down rather than inferred.

### 4.5 Validator import (D4)

Two maps, two purposes, and they are easy to confuse:

- `VALIDATOR_EXPORT_BY_LANE` — lane name → the **export name** a caller's module must provide;
- `OPTION_FOR_LANE` — lane name → the **option name** the assembler documents
  (`validateDeclaration`, `validateAdmissionEvidence`), which is the only key its closed
  `OPTION_KEYS` accepts (`diagnose-internal.js:171`).

The CLI collects loaded validators by lane; passing that object straight through made every
successfully loaded validator an unknown option and turned every `--static`/`--admission` success
into an internal failure (`5`). The second map is the single meeting point of the two
vocabularies, and the real-file tests assert the success paths do not return `5`.

`VALIDATOR_EXPORT_BY_LANE`, `OPTION_FOR_LANE` and `resolveModuleTarget` are copied from
`combined-cli.js:96`, `:209`, `:339`, because `loadLaneValidator` is module-private. The
alternatives were worse:

- **export it from `combined-cli.js`** — widens the public surface of a reviewed 779-line CLI for one
  consumer, and makes a previously internal helper part of the API contract;
- **refactor it into a shared module** — a cross-cutting edit to a reviewed file for 40 lines of
  logic, in a round whose stated scope is "no large edits to `combined-cli.js`".

The copy is a recorded decision, not an oversight: the comment at the table says so, and
`tests/diagnose.test.js` covers the fixed-export behaviour on this path (missing export → usage-level
failure, not a silent pass).

**Ordering is a trust property.** Validators are imported in phase 2, only for lanes that were read
*and* whose text parsed as JSON in phase 1. The gate is "parsed", not "valid": a **read failure** or
a **JSON syntax failure** never imports the module named for that lane, so a mistyped path or broken
JSON stays a read/parse failure instead of becoming a usage failure. A document that **parsed but
fails its schema** is a different case and still needs its validator — the validator is what
establishes the schema verdict, so skipping the import there would replace "the document is invalid"
with "no validator was available", a weaker and misleading code.

### 4.6 Next steps (D7)

`nextSteps` holds at most one step per source in `DIAGNOSE_SOURCES` order, from a closed vocabulary
of 17 codes (4 sources × 4 non-clear outcomes, plus `SOURCE_NOT_PROVIDED`). The text is selected by
the **issue code the block already recorded**, so a read failure, a JSON failure and an unloadable
validator each get their own sentence rather than a shared "check the file". Nothing from a document,
an error object or the filesystem is interpolated: no path, no id, no message from a thrown error.

An absent source still gets `SOURCE_NOT_PROVIDED` — "you did not name this" is useful to read — and
it never moves the exit code.

### 4.7 Output and failure discipline (D5)

```
phase 1  read every named file            → {text}|{document}|{failure}
phase 2  import validators for parsed lanes only
phase 3  assemble                         → throw ⇒ 5
phase 4  serialize → write stdout → summarize stderr → diagnoseExitCode
```

A usage problem emits one `{"error":{"code":"USAGE"}}` line on stdout before help on stderr, so a
consumer never parses help text as a report. `--help` is the only path that exits `0` without a
report, and it writes nothing to stdout. Every sink write is awaited through `streamSink`, so a
synchronous throw, a rejected promise and a callback-reported error all end in `5`.

> ⚠️ Not detected: an error a stream emits **after** its write callback has already succeeded. This
> is the same limitation the combined CLI accepts (`combined-cli.js:418-455`), and it is recorded
> rather than papered over.

## 5. Data sources

1. **【Decided】Profile input**: the dump text exactly as `dsh --profile <name> --dump-config` writes
   it, read through `readEvidenceFile` and summarized by `summarizeProfileDumpText`. Never parsed here.
2. **【Decided】Lane documents**: already-parsed JSON chosen by the caller. This module never splits
   text, never re-serializes, and never repairs a document.
3. **【Decided】Lane results**: whatever `buildCombinedReport` returns, by reference. No post-filtering,
   no re-ranking, no field rewriting — a deep-equality test pins this against a direct library call.
4. **【Decided】`source` values**: fixed slot labels (`profile-input`, `static-input`,
   `runtime-input`, `admission-input`). A file path is never substituted, so the envelope cannot be
   read as provenance.
5. **【Decided】`limitations`**: `COMBINED_REPORT_LIMITATIONS` first (library order, unmodified), then
   `PROFILE_BLOCK_IS_A_SUMMARY_NOT_A_DUMP` and `NO_CROSS_SOURCE_IDENTITY`.
6. **【Pending】Dump identity**: which command, on which host, against which commit produced a given
   dump is still not carried. The envelope says `correlation: not-established` rather than guessing.

## 6. Impact and risks

| Risk | Note | Handling |
| --- | --- | --- |
| A reader treats a clean envelope as a health verdict | The envelope aggregates four weak signals | `certification: false`, `correlation: not-established`, two added limitation codes, and §13.5 in the README state it |
| Envelope leaks document content into logs | Lane results may embed ids and paths | stderr carries counts only; no path, no document text, no exception text; a test asserts a secret path in a thrown error never reaches stderr |
| Validator copy drifts from `combined-cli.js` | Two ~40-line copies of the same import logic | Copy is documented at the table; the fixed-export path is tested here; neither copy is a schema owner |
| `{document: undefined}` read as absent | Would silently drop a requested lane | Explicit test: the lane stays `provided` and comes back `invalid` |
| All-failed envelope mistaken for library output | Same shape, different producer | Documented in `diagnose.d.ts`, README §13.2 and design §4.4 |
| Mixed-failure exit codes disagree with combined CLI | Deliberate divergence on absence | Documented in §3 D3 and README §13.3. The divergence is **narrow**: it is about the contribution of *absent* sources only — they add nothing here, while `combinedReportExitCode` maps them to attention. It is **not** a global severity ordering between the two commands: this envelope can be stricter for other reasons (a named lane whose validator fails to load contributes `3`; internal, serialization and output failures surface as `5`, while usage and validator-load failures use `3`), and the mapping is not designed or claimed to be monotonic across mixed cases |
| Stream error after a successful write is missed | Same as the combined CLI | Stated in the CLI header and §4.7 rather than claimed away |
| Status read as "fully verified" | Exactly one test file has run, with a narrow harness | README §13.7 and the platform index point at the testing record; the run is **one file**, `main()` integration against real temporary files plus a synthetic validator loaded by dynamic `import()` — not a CLI subprocess, not a real protocol validator, not a host, and not the package suite. See [testing record](../testing/2026-11-08-unified-diagnostics.md) |

## 7. Open questions

1. **【Decided】Does an unrequested source move the exit code?** No. Only `provided` blocks count.
2. **【Decided】Does the profile live inside the combined-report input?** No — `readPresence` refuses a
   fourth key; it is a sibling block.
3. **【Decided】Does the public builder accept failures?** No. Payloads only; the CLI uses the
   package-internal assembler.
4. **【Decided】Does the profile block keep its summary when the dump is refused?** Yes.
5. **【Pending】Should a next execution carry dump identity** (command, host, commit)? Not in this
   round; the envelope deliberately stops at `not-established`. Tilt: add it only when a host export
   is itself in scope, and then as its own reviewed field rather than an inference.
6. **【Pending】Should `nextSteps` ever name a *lane combination*?** It does not today; every step is
   per-source, because a cross-source step would imply a correlation the envelope denies.

## 8. Landing plan

```
diagnose-cli.js  (bin dsh-compat-diagnose)
  └─ diagnose.js (public: payloads + exit mapper)
       └─ diagnose-internal.js (private assembler)
            ├─ buildCombinedReport        combined-report.js:496
            └─ summarizeProfileDumpText   profile-dump.js:526
```

| File | Status | Responsibility |
| --- | --- | --- |
| `packages/analyzer/src/diagnose-internal.js` | new | Restricted assembler: presence, failure vocabulary, skeleton, next steps |
| `packages/analyzer/src/diagnose.js` | new | Public payload-only builder and shape-checked exit mapper |
| `packages/analyzer/src/diagnose.d.ts` | new | Envelope types; no failure input, `summary` preserved on refusal |
| `packages/analyzer/src/diagnose-cli.js` | new | Flag parsing, bounded reads, validator import ordering, output, exit 0–5 |
| `packages/analyzer/tests/diagnose.test.js` | new | One test file, decision-level: real-assembler envelopes; `main()` integration driven with real temporary files; a **synthetic** validator module loaded through dynamic `import()`; sinks captured only; a bad-JSON "no import" sentinel; envelope-shape refusals. It is **not** a CLI-subprocess test, **not** a real protocol validator, **not** a host run, and **not** the full suite |
| `packages/analyzer/package.json` | edited | `dsh-compat-diagnose` bin; `./diagnose`, `./diagnose-cli` exports; internal module **not** exported |
| `packages/analyzer/README.md` | edited | New §13 with contract, exit table, non-claims and the status pointer (single-file run, scope stated; links the testing record) |
| `projects/dsh-compat-platform/README.md` | edited | Capability-index rows for this entry and the profile dump |
| `docs/requirements-and-design/2026-11-08-unified-diagnostics-design.md` | new | This document |

## 9. Execution status

The earlier "written, never run" status has expired and is corrected here. The single test file
`packages/analyzer/tests/diagnose.test.js` has been executed:

- **First run (one file):** 48 cases, **40 pass / 8 fail**.
- **After test-only corrections:** sequence-root fixtures, informational `!!js` expectations,
  the three required runtime cases, shared absence text, invalid-declaration classification,
  and validator option-name assertions were aligned with the existing contracts. A separate
  non-string entry-id attention case was added. The authorized second run passed **49/49**;
  the implementation and runner were unchanged between runs.

Scope stays deliberately narrow, and the counts are not a package-level claim: `main()` integration
against **real temporary files**, plus a **synthetic** validator module loaded by dynamic `import()`.
No CLI subprocess, no real protocol validator, no host, no full suite. Evidence and the per-case
breakdown live in [the testing record](../testing/2026-11-08-unified-diagnostics.md).

## Appendix A: key files and line numbers

| Content | Location |
| --- | --- |
| Closed input key set, absence rule | `packages/analyzer/src/combined-report.js:189-208` |
| Lane entry reader (`{document: undefined}` → invalid) | `packages/analyzer/src/combined-report.js:237` |
| Static lane requires a validator | `packages/analyzer/src/combined-report.js:306` |
| Runtime lane | `packages/analyzer/src/combined-report.js:378` |
| Admission lane | `packages/analyzer/src/combined-report.js:428` |
| Library builder (synchronous) | `packages/analyzer/src/combined-report.js:496` |
| Absent → attention (divergence source) | `packages/analyzer/src/combined-report.js:534` |
| Fixed limitation list | `packages/analyzer/src/combined-report.js:114` |
| Fixed validator export table | `packages/analyzer/src/combined-cli.js:96` |
| CLI exit table, precedence | `packages/analyzer/src/combined-cli.js:102` |
| Specifier resolution | `packages/analyzer/src/combined-cli.js:209` |
| Private validator import (why copied) | `packages/analyzer/src/combined-cli.js:339` |
| Skeleton channels precedent | `packages/analyzer/src/combined-cli.js:537` |
| Awaited sink | `packages/analyzer/src/combined-cli.js:455` |
| Direct-invocation guard | `packages/analyzer/src/combined-cli.js:745` |
| Bounded reader | `packages/analyzer/src/evidence-cli.js:182` |
| Safe profile summary (returns one on refusal) | `packages/analyzer/src/profile-dump.js:526` |
| `!!js` diagnostic shape (no ordinal) | `packages/analyzer/src/profile-dump.js:327-342` |
| Envelope | `packages/analyzer/src/diagnose-internal.js` |
| Public facade | `packages/analyzer/src/diagnose.js` |
| CLI | `packages/analyzer/src/diagnose-cli.js` |
