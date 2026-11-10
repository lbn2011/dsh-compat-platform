# dsh-compat-platform

`dsh-compat-platform@0.0.0` — deterministic static declaration analysis for
combinations of DSH plugins, without executing the analyzed plugins.

It answers exactly one question:

> Given these author-authored plugin declarations and this list of capabilities
> the caller says are available, which *visible declaration conflicts* exist?

The library does **not** install, load, activate, patch or repair plugins, and
performs no filesystem, network or host access itself. The CLI reads the explicitly
supplied JSON file (or stdin) and imports the explicitly selected trusted validator.
That validator and its dependencies execute with process privileges; they are not
sandboxed, and their side effects are outside these guarantees.

This package contains **three lanes that are deliberately not merged**: the static
declaration analyzer described here, the runtime-evidence summarizer (`node
src/evidence-cli.js`, documented in `evidence-cli.md`), and — added last — the
admission-document diagnoser `dsh-compat-admission` described in **§11**. Each lane
has its own inputs, its own output vocabulary and its own exit table. See §11.9 for
what is verified and what is **written but not yet run**.

## Snapshot comparison — bounded acceptance passed (2026-11-07)

The `dsh-compat-compare --before FILE --after FILE` entry and typed
`dsh-compat-platform/snapshot-diff` subpath compare explicit combined-report
snapshots structurally; they do not load validators, scan a host, infer repaired
findings or authenticate source aliases.

The [accepted batch](<../../docs/testing/2026-11-07-snapshot-compare-unit-split-recheck-4.md>) passed the snapshot target **41/41** and CLI target **36/36**, with no skipped tests. Two separate serial units used 384 MiB memory each, swap 0, CPU 50%, 32 tasks and a 120-second ceiling. Earlier assertion, test-module syntax, timeout and reader-injection failures remain in the linked records. The CLI now refuses a second in-flight stream write without overwriting the first. Real-reader cases exercise temporary files; separate real-library cases intentionally supply document text. This is bounded module/CLI evidence, not host integration, cross-version compatibility, packaging or publication certification.

`compareCombinedReports(before, after)` validates the bounded JSON envelope and
reports per-channel changes without echoing nested payloads. Missing, invalid
or errored channels are incomparable, not repaired. Object key order is ignored;
array order is significant. Exit 0 means comparable unchanged structures, not
healthy plugins; 1 means changes or incomparability, 2 unusable snapshot shapes,
3 CLI usage/read/JSON failure, and 5 internal/output failure.

See the [snapshot comparison plan](<../../../../docs/requirements-and-design/2026-11-06-snapshot-comparison-dev-plan.md>).
Existing commands and their exit contracts are unchanged.

## Combined report entry — bounded acceptance passed (2026-11-06)

The new `dsh-compat-report` entry and `dsh-compat-platform/combined-report`
subpath present these lanes side by side. The corrected bytes passed one serial split batch: report library **34/34**, CLI **40/40**, integration **11/11**, with no skipped tests. See the [split acceptance record](<../../docs/testing/2026-11-06-combined-report-unit-split.md>). These are separate target results under 384 MiB per-unit limits, not host or cross-version certification. The [earlier 75/83 failure](<../../docs/testing/2026-11-06-combined-report-unit-recheck-3.md>) and intervening capacity refusals remain preserved; this is not a rerun under the original budget.
Existing commands and their exit codes are unchanged; the existing test-script
`.js` glob does not cover the new CLI's `.mjs` tests.

`buildCombinedReport(input, options)` accepts optional `static`, `runtime` and
`admission` entries, with at least one supplied. Each entry is `{ source,
document }`; validators are explicit `validateDeclaration` and
`validateAdmissionEvidence` options. Sources are public labels, not verified
identities. Results retain lane payloads and limitations, always report
`certification: false` and `correlation: 'not-established'`, and do not merge
findings into a compatibility score. Missing lanes remain unknown.

The CLI accepts `--static FILE`, `--runtime FILE`, `--admission FILE`, with
`--declaration-validator MODULE` required for static and
`--admission-validator MODULE` required for admission. It reads explicit regular
files only (1 MiB each, strict UTF-8), not stdin, directories or host profiles.
All supplied files are read before selected validators are imported. Failed
inputs preserve other channels; JSON output goes to stdout. There is no output
file option or repair operation.

Its new exit table is 0 for all three lanes clear, 1 for attention or missing
lanes, 2 for invalid input, 3 for usage/module loading failure, 4 for lane errors,
and 5 for internal/output failure; precedence is 5 > 3 > 4 > 2 > 1 > 0. Zero
is not certification. Explicit validator modules execute with process privileges
and can have side effects. Lane payloads retain caller-provided content; reports
are not automatically redacted. No cross-input identity or run correlation is
inferred.

See the [development and acceptance plan](<../../../../docs/requirements-and-design/2026-11-06-combined-report-dev-plan.md>).


- Package root: `projects/dsh-compat-platform/packages/analyzer/` (the directory
  name is repository layout; the package name is `dsh-compat-platform`).
- Private (`"private": true`), ESM. **One runtime dependency**: `yaml`, pinned to `2.9.1`,
  used only by `dsh-compat-profile-dump`. Everything else in this package runs on Node built-ins.
  (Earlier revisions of this section said "zero runtime dependencies"; that was true until the
  profile-dump command was added, and it remains true of the analysis, report and comparison
  lanes.)
- Node.js `>= 24.9.0` (declared in `engines`). Verified on `v24.21.0`.
- No `license` field: no license has been granted for this repository yet.

---

## 1. Scope

### In scope

| Capability | Detail |
| --- | --- |
| Deterministic finding derivation | With the same deterministic validator, identical JSON input produces identical output; valid batches are declaration-order independent (see §9 for the invalid-input limit). A stateful or nondeterministic injected validator voids this guarantee. |
| Declaration validation | Delegated **entirely** to an injected validator. This package re-implements no protocol rule. |
| Finding codes | `INVALID_DECLARATION`, `DUPLICATE_PLUGIN_ID`, `RESOURCE_CONFLICT`, `MISSING_CAPABILITY`. |
| Fail-closed behaviour | A validator failure, a contract violation, or an invalid declaration blocks dependency reasoning instead of degrading into a clean report. |
| Library + CLI | `analyze()` for embedding, `dsh-compat-analyze` for scripts. |

### Out of scope (by construction, not by omission)

- **No plugin execution.** No `import()`/`require()` of analyzed plugins, no
  `eval`, no `new Function`, no `!!js/...` config patching. Declarations are JSON
  *data*; a string like `"!!js/patch.js"` is never interpreted.
- **No runtime health, no activation proof, no cross-version certification.**
  `evidenceLevel` is always `"static-declaration"`.
- **No host or profile access.** No reading of `~/.dsh`, device pages, settings or
  the user's environment.
- **No repair.** There is no fixed. Warnings and errors describe declarations; they
  are not applied to them.
- **No implicit validator.** There is no bundled fallback. If you do not inject a
  validator, `analyze()` throws and the CLI exits `3`.
- **No silent capability inference.** `required`/`optional` lists in declarations
  are *promises*, never evidence of availability. In particular an `optional`
  entry is a *requirement* the plugin can live without; it is never read as a
  claim that the plugin **provides** that capability.

---

## 2. The trust boundary, stated once

```
                 ┌──────────────────────────────────────────────┐
  manifest JSON  │  dsh-compat-analyze / analyze()              │  report JSON
  (inert data) ─▶│  ─ reads text only                           │─▶ (stdout / value)
                 │  ─ NEVER executes the plugins being analyzed │
                 └───────────────┬──────────────────────────────┘
                                 │ imports exactly once
                                 ▼
                 the validator YOU name with --validator <path>
                 (executed in this process, with your privileges)
```

`--validator` is an **explicit code-execution** argument. Point it at code you
trust — normally the released `dsh-compat-spec` package. This repository does not
vendor, resolve or prefer any particular validator, and it never falls back to a
weaker one.

The validator contract is the cross-repository protocol:

```js
validateDeclaration(value) -> { valid: boolean, issues: [{ code, path, message }] }
```

`this` package's tests use test doubles (`tests/helpers/*.mjs`), clearly marked
as such, so that the suite is hermetic. `tests/helpers/spec-validator.mjs` is the
tier-2 harness: it resolves the *real* `dsh-compat-spec` package by its published
specifier and fails loudly (exit `3`) if it cannot be resolved — it will not
degrade.

---

## 3. Install-free usage (works in this checkout today)

There is no published artifact and no install step. Run the CLI directly with
Node, from this package directory:

```console
$ cd projects/dsh-compat-platform/packages/analyzer

$ node src/cli.js --validator ./tests/helpers/fake-validator.js fixtures/clean.json
{
  "evidenceLevel": "static-declaration",
  "findings": [],
  "limitations": [ ... ],
  "summary": {
    "reportVersion": "0.1.0-draft.1",
    "protocolVersion": "0.1.0-draft.1",
    "declarations": { "total": 2, "valid": 2, "invalid": 0 },
    "availableCapabilities": 1,
    "analysisComplete": true
  }
}
$ echo $?
0
```

> `./tests/helpers/fake-validator.js` is a **test double**, used here so the
> command runs without any dependency. In real use, pass your trusted
> `dsh-compat-spec` validator (see §4).

The script is also directly executable (`chmod 755` is already set):

```console
$ ./src/cli.js --validator ./tests/helpers/fake-validator.js fixtures/with-conflict.json >/tmp/report.json
$ echo $?      # 1 — error-severity findings
$ jq '.findings[].code' /tmp/report.json
"DUPLICATE_PLUGIN_ID"
"MISSING_CAPABILITY"
"RESOURCE_CONFLICT"
```

Running the test suite (Node's built-in runner; no test framework is installed):

```console
$ node --test "tests/*.test.js"
# 59 tests, 59 pass
```

`package.json` also declares this exact command as `scripts.test`, so `npm test`
runs the same suite wherever npm is available. In the environment this was
verified in, `npm` was not on `PATH` (the installed entry point is a broken
symlink), so the suite was executed directly with `node --test`; `npm test` was
therefore not executed here. That is an environment limitation, not a repo
defect.

The glob must be quoted: Node 24 does not accept a bare directory argument
(`node --test tests/` fails with `MODULE_NOT_FOUND`).

---

## 4. CLI

```
dsh-compat-analyze --validator <path> [--export <name>] [--capability <name>]... <manifest.json|->
```

| Flag | Meaning |
| --- | --- |
| `--validator <path>` | **Required.** ESM file (or bare specifier) exporting the validator. Its code runs in this process. |
| `--export <name>` | Which exported binding to use; dotted paths allowed. Default `validateDeclaration`. |
| `--capability <name>` | Repeatable convenience for manifests that omit `availableCapabilities`. Supplying both is a usage error (`3`). |
| `--help` | Usage to **stderr**, exit `0`. |
| `<manifest.json>` or `-` | Manifest path, or `-` for stdin. Exactly one is accepted. |

Passing a trusted `dsh-compat-spec` validator, once that package is resolvable to
the caller:

```console
$ node src/cli.js --validator dsh-compat-spec fixtures/clean.json
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Analysis ran; no `error`-severity finding (warnings/info may exist). |
| `1` | Analysis ran; at least one `error`-severity finding. |
| `2` | Manifest unreadable, not JSON, or not a valid analysis envelope (e.g. missing/malformed `availableCapabilities`, extra field). No report is printed. |
| `3` | Usage error, or the validator could not be loaded/exported. |
| `4` | The validator threw; analysis failed closed. No report is printed. |
| `5` | Internal failure. |

`--help` is the only path that exits `0` without analyzing anything.

---

## 5. Library

```js
import { analyze, formatReportJson, exitCodeFor } from './packages/analyzer/src/index.js';
import { validateDeclaration } from 'dsh-compat-spec'; // your trusted validator

const report = analyze(
  {
    declarations: [declarationA, declarationB], // raw declarations, verbatim
    availableCapabilities: ['svc:catalog'],     // REQUIRED; [] means none available
  },
  { validateDeclaration },                      // injected, never imported by us
);

console.log(formatReportJson(report));
process.exitCode = exitCodeFor(report);
```

`analyze(input, options)` is pure: it does not read files, spawn processes, use
the network or mutate its input (frozen inputs are accepted). Returned reports and
their arrays are frozen.

- `input`: `{ declarations, availableCapabilities }` — **exactly** these two
  fields. Any other field (`declaredCapabilities`, `availableCapabilitiesSource`,
  ...) is a `TypeError`. `availableCapabilities` is **required**.
- `availableCapabilities`: an array of non-empty, **already-trimmed** strings.
  A non-array, a non-string entry, an empty or whitespace-only entry, or an entry
  with leading/trailing whitespace is a `TypeError`. `[]` is an explicit **empty
  set**: every `required` capability in every declaration is then reported as
  missing. The list is deduplicated and sorted internally; order is not
  significant. **There is no "unknown availability" state** — an omitted field is
  refused rather than interpreted permissively.
- `options.validateDeclaration`: required function. It is the only accepted
  option key; anything else is a `TypeError`.
- Throws `TypeError` for an unusable input envelope or a missing validator.
- Throws `AnalyzerError` with `code: 'ANALYZER_VALIDATOR_THREW'` and
  `declarationIndex` (the declaration's position in `input.declarations`) when the
  validator throws.

### Declarations

`input.declarations` is an array of **raw declaration values**, in the protocol's
fixed shape. Each element is handed to the injected validator **unchanged**:

- there is **no `{ value }` wrapper** — a wrapper is not unwrapped, it is passed
  through and rejected by the validator like any other malformed value;
- there is **no caller-supplied `declarationIndex`** — rejection messages name the
  element's position in `input.declarations`, which is the only index that exists.

This package never re-implements protocol validation rules: everything a
declaration must satisfy is decided by the validator you inject.

---

## 6. Report format

```jsonc
{
  "evidenceLevel": "static-declaration",
  "findings": [
    {
      "code": "RESOURCE_CONFLICT",
      "severity": "warning",
      "pluginIds": ["store-a", "store-b"],
      "resource": { "kind": "service", "name": "store", "scope": "shared" },
      "message": "..."
    }
  ],
  "limitations": [{ "code": "NO_ACTIVATION_AUTHORITY", "message": "..." }],
  "summary": {
    "reportVersion": "0.1.0-draft.1",
    "protocolVersion": "0.1.0-draft.1",
    "declarations": { "total": 4, "valid": 4, "invalid": 0 },
    "availableCapabilities": 1,
    "analysisComplete": true
  }
}
```

Ordering is total and independent of input order: findings sort by
`severity` (`error` < `warning` < `info`), then `code`, `pluginIds`,
`resource`, `message`; limitations sort by `code`. String comparison is UTF-16
code-unit order — no locale is consulted.

### Findings

| Code | Severity | Trigger |
| --- | --- | --- |
| `INVALID_DECLARATION` | `error` | The validator rejected the declaration, lacked a readable `plugin.id`, or broke its own contract. **Blocks all other findings.** |
| `DUPLICATE_PLUGIN_ID` | `error` | One plugin id declared more than once; static analysis cannot pick an authoritative declaration. |
| `RESOURCE_CONFLICT` | `warning` | Two or more **different** plugins declare the identical `[kind, name, scope]` tuple. Differing `scope`, differing `kind` or differing `name` is **not** a conflict; a single plugin re-claiming its own tuple is not one either. |
| `MISSING_CAPABILITY` | `error` | A `required` capability is absent from the caller-supplied `availableCapabilities` set. |

Optional requirements are never reported: an unfulfilled optional requirement is
the anticipated fallback, not a defect, and it never implies the declaring
plugin *provides* that capability.

Only `error`-severity findings affect the exit code.

### Limitations (always emitted)

| Code | Why |
| --- | --- |
| `NO_ACTIVATION_AUTHORITY` | Declarations are author claims; no host was asked whether it accepted or ran anything. |
| `MISSING_OBSERVATIONS_ARE_UNKNOWN` | An empty finding list means "no visible conflict", not "compatible". |
| `SCOPE_LABEL_IS_NOT_CORDIS_SCOPE` | `scope` is an author-declared static label — an arbitrary non-empty string, not a closed `plugin`/`shared` enum — and not an observed Cordis scope or isolation guarantee. No host matching semantics are applied. |
| `VALIDATOR_DECIDES_DECLARATION_VALIDITY` | A different or outdated validator changes which declarations are trusted. |
| `PARTIAL_EVIDENCE_UNDER_INVALID_DECLARATIONS` | Only when analysis failed closed (a declaration was rejected, or was accepted without a readable `plugin.id`). |

---

## 7. Input format

```json
{
  "declarations": [
    {
      "schemaVersion": "0.1.0-draft.1",
      "plugin": { "id": "catalog-core", "version": "1.2.0" },
      "capabilities": { "required": [], "optional": ["svc:telemetry"] },
      "resources": [{ "kind": "service", "name": "catalog", "scope": "shared" }]
    }
  ],
  "availableCapabilities": ["svc:catalog"]
}
```

- `declarations` — required array of **raw** declarations. Each element is passed
  to the validator verbatim.
- `availableCapabilities` — required array of capability names the caller
  declares available. `[]` means "none are available".

No other field is accepted. In particular there is no `declaredCapabilities` and
no `availableCapabilitiesSource`: availability comes from one place only.

### Availability is never assumed

| Situation | Effect |
| --- | --- |
| `availableCapabilities: [...]` | Only these names count. |
| `availableCapabilities: []` | Explicit empty set: **every** `required` capability produces an `error` finding. |
| Field omitted, or not an array of trimmed non-empty strings | `TypeError` (library) / exit `2` (CLI). Analysis does not run, so no report can over- or under-state anything. |

`availableCapabilities` is declarative input, not an observation this package
makes: if you pass an incomplete list, a `MISSING_CAPABILITY` finding over-states
the problem rather than under-stating it.

---

## 8. Fixtures

All are relative to `packages/analyzer/`.

| File | Exits | Demonstrates |
| --- | --- | --- |
| `fixtures/clean.json` | `0` | Two plugins, one shared service, satisfied requirement. |
| `fixtures/with-conflict.json` | `1` | Duplicate id, missing capability, cross-plugin conflict on an identical `[kind, name, scope]` tuple. |
| `fixtures/with-conflict-reordered.json` | `1` | The same declarations in a different order ⇒ **byte-identical** report. |
| `fixtures/scope-labels.json` | `0` | Same kind+name under different scope labels ⇒ **no** conflict. |
| `fixtures/duplicate-optional.json` | `0` | Several plugins sharing an `optional` requirement ⇒ no finding. |
| `fixtures/invalid-declaration.json` | `1` | Invalid `scope` ⇒ `INVALID_DECLARATION`, all dependency findings suppressed. |
| `fixtures/malformed.json` | `2` | Not JSON. |

```console
$ for f in clean with-conflict scope-labels duplicate-optional invalid-declaration; do
    node src/cli.js --validator ./tests/helpers/fake-validator.js fixtures/$f.json >/dev/null
    echo "$f → exit $?"
  done
clean → exit 0
with-conflict → exit 1
scope-labels → exit 0
duplicate-optional → exit 0
invalid-declaration → exit 1
$ node src/cli.js --validator ./tests/helpers/fake-validator.js fixtures/malformed.json
# stderr: "manifest is not valid JSON: ..."  → exit 2
```

---

## 9. Guarantees enforced by the suite

`node --test "tests/*.test.js"` covers, among others:

- byte-identical output across runs, and across reordered declarations **for valid
  input**;
- the documented limit that reordering input which mixes valid and invalid
  declarations is *not* order-invariant (rejection messages name positions) — so
  the promise is deliberately narrowed to valid input rather than overclaimed;
- identical output regardless of working directory;
- each declaration reaches the validator by identity (no wrapper, no clone, no
  injected index);
- `availableCapabilities` is required and strictly typed (array / string /
  trimmed / non-empty), and `[]` is treated as the explicit empty set;
- a resource conflict requires the complete `[kind, name, scope]` tuple; differing
  scopes and internal duplicate tuples produce no finding;
- `optional` requirements never produce findings and are never read as providers;
- invalid declarations and validator contract violations fail closed;
- a throwing validator aborts analysis;
- malformed JSON, unreadable manifests, unknown flags, missing `--validator` all
  fail with distinct exit codes and **no** report on stdout;
- executable-looking declaration content (`"!!js/patch.js"`, `$ref` URLs, function
  source strings) is treated as inert data;
- `src/analyze.js` is import-free and contains no `eval`, `new Function`,
  `import()`, `require`, filesystem, network or process access (asserted over its
  own source);
- the CLI creates and modifies no files.

> The admission lane (§11) is tested by `tests/admission-cli.test.mjs`, a **`.mjs`**
> file that the `tests/*.test.js` glob above does not match. It therefore never
> joins this run and does not contribute to any count quoted for it; run it
> explicitly with `node --test tests/admission-cli.test.mjs`.

---

## 10. Known limits right now

- **Not published, not installable.** `private: true`, version `0.0.0`, no
  registry artifact, no install command was run.
- **No `dsh-compat-spec` dependency by design.** The pairing is by the documented
  contract only. The default test path therefore uses test doubles; a run against
  the real protocol validator requires that package to be resolvable by the caller.
- **Static only.** No runtime probes, no activation checks, no version-matrix
  certification, no repair.
- **Complements, not replaces,** the plugin compatibility design's other evidence
  tiers; a clean report is the absence of visible declaration conflicts and
  nothing more.
- **Static CLI `file:` defect (found, not fixed).** `src/cli.js` classifies a
  `file:` specifier as path-like and then pushes it through
  `resolve(process.cwd(), …)` (`src/cli.js:129-131`), turning
  `file:///tmp/v.mjs` into `<cwd>/file:/tmp/v.mjs`. Its own doc comment at
  `src/cli.js:118-120` promises such a URL is "loaded as a file", so the
  documented behaviour does not hold. The admission CLI in §11 returns `file:`
  URLs unchanged instead of copying the defect; `src/cli.js` is left as-is because
  a changing lane may not alter the accepted static entry point. Recorded here so
  the inconsistency is visible rather than inherited silently.

---

## 11. Admission lane: `dsh-compat-admission`

A **local, read-only** entry point that answers one question:

> Given one reported `admission-evidence/0.1-draft.1` document, what does it
> actually observe — and is it complete?

It is the presentation half of the P0 acceptance interface: the protocol owns the
grammar, the catalog and the issue codes; this package owns the diagnostic *view*.
Nothing here changes the protocol, adds a case id, or certifies anything.

### 11.1 Invocation

```console
$ node src/admission-cli.js --validator <module> [--export <name>] <document.json>
# or, after install, the same command as: dsh-compat-admission …
```

- `<document.json>` — exactly one explicit path to a regular UTF-8 JSON file of at
  most 1 MiB. `-` (stdin), directories, special files, extra paths, globs and any
  default path are refused.
- `--validator <module>` — **required**. `./`, `../`, an absolute path and a `file:`
  URL are loaded as files; anything else is a bare specifier resolved by Node.
- `--export <name>` — which binding to use; dotted paths allowed. Default
  `validateAdmissionEvidence`.
- `--help` — usage on **stderr**, nothing on stdout.

### 11.2 Output

stdout carries exactly one JSON document: the canonical
`diagnoseAdmissionEvidence` result, unchanged —

```json
{
  "valid": true,
  "certification": false,
  "issues": [],
  "findings": [{ "code": "…", "caseId": "…", "status": "…", "message": "…" }],
  "summary": { "…": "passed through by reference" }
}
```

Field order is fixed; `summary` is present only when the result has one. The
document's own `baseline` is **never** reflected — a summary does not carry one,
and printing it would imply an authentication this lane does not perform.
`certification` is always `false`.

### 11.3 Exit codes (this command only — a closed table)

| Code | Meaning |
| --- | --- |
| `0` | Accepted; no `failed`/`not-run` case and `coverage.unknown` empty. **A `refused` case is the expected outcome of its own case: it produces a finding and still exits `0`.** |
| `1` | Accepted, but a finding reports a `failed` case, a `not-run` case or unknown coverage. The full diagnosis is printed. |
| `2` | The validator **rejected** the document (protocol issue codes). Nothing about a plugin was established. |
| `3` | Usage error; document unreadable / non-UTF-8 / over the cap / not JSON; or the `--validator` module could not be loaded or did not export a function. |
| `4` | The validator broke the §6.6 contract: it threw, returned a thenable, or returned a malformed/inconsistent result. "The validator did not answer" — **not** a verdict about the document. |
| `5` | Unexpected internal failure, including a failure to serialize or write the result. |

`2` and `4` are separated by the issue vocabulary the diagnostics layer already
returns: a wrapper refusal carries a `WRAPPER_ISSUE_CODES` member, a protocol
refusal carries the protocol's own codes (which never include `VALIDATOR_*`).
Neither catalogue is copied into this CLI. This table is **not** `EXIT_CODES`
(static lane) and not `EVIDENCE_EXIT_CODES` (runtime-evidence lane); the numbers
coincide by habit, not by reference.

### 11.4 Trust boundary

`--validator` is an **explicit code-execution argument**: the named module and its
whole dependency graph run in this process with this process's privileges. This is
not a sandbox. What the entry point does guarantee is its own discipline:

- it imports **nothing** from the document — the document is `JSON.parse`d data and
  is never evaluated, resolved or imported;
- it loads exactly **one** module besides Node built-ins and two fixed local
  modules (`./admission-diagnostics.js`, `./evidence-cli.js`);
- it never imports a plugin, a host, a driver package root or an experiment runner;
- it never reads an environment variable, never scans, never reads stdin;
- it writes **no** file — output is one stdout document plus, on a non-zero
  outcome, one fixed stderr line. No OS message, path, document content, module
  specifier or stack trace is ever interpolated into **that line**. The promise is
  about errors this command catches and formats; it cannot stop the module you
  named from printing, writing or exiting on its own;
- the document is read **before** the `--validator` module is imported, so a
  mistyped path, a read refusal, a non-JSON file or a usage error never executes
  *that* module. This is not "no code has run": the static imports of this file
  (Node built-ins, `./admission-diagnostics.js`, `./evidence-cli.js`) were already
  evaluated at load time, as for any ES module. The ordering guarantee covers the
  explicitly selected module — the only non-fixed code this entry point adds.

The systemd/bwrap resource policy (memory, swap, tasks, CPU, wall clock) is **not**
part of this command or of the SDK; it stays in the experiment runner
(`experiments/acceptance/admission-loader-real/run.sh`), which is where a bounded
run belongs.

### 11.5 Library surface

```js
import { diagnoseAdmissionEvidence, DIAGNOSTIC_CODES } from 'dsh-compat-platform';
// or the narrow subpath:
import { diagnoseAdmissionEvidence } from 'dsh-compat-platform/admission-diagnostics';
```

`diagnoseAdmissionEvidence(value, { validateAdmissionEvidence })` stays pure: no IO,
no clock, no randomness, no host calls, and deterministic exactly when the injected
validator is. The CLI is a thin wrapper around it, so an embedding caller and the
command cannot disagree. The command itself is also import-safe
(`dsh-compat-platform/admission-cli`): importing it executes nothing, and
`main(argv, io)` returns a code instead of exiting, with the reader, the module
loader and both sinks injectable.

### 11.6 What this does **not** assert

- Not a certification. `certification` is `false` everywhere.
- Not proof of activation, runtime health or cross-version compatibility.
- Metadata consistency does not authenticate evidence: a document that *claims* a
  baseline is not thereby attached to that baseline.
- It does not merge with, upgrade or contradict static analysis; the lanes never
  read each other's output.
- A `refused` case is coordinator success. It is reported, never promoted to a
  failure.

### 11.7 Ownership

| Concern | Owner |
| --- | --- |
| Grammar, case/assertion catalog, issue codes, `validateAdmissionEvidence` | `dsh-compat-spec` (protocol) |
| Observation and projection of caller-evaluated assertions | `dsh-agent-test-driver` (`./admission-evidence`) |
| Diagnostic presentation (this CLI, findings, exit mapping) | `dsh-compat-platform` (this package) |
| Author-facing primitives | the kit |

### 11.8 Reuse by the isolated runner

`experiments/acceptance/admission-loader-real/run.sh` remains the only place a
bounded, sandboxed run happens, and it stays the regression consumer. Because the
diagnosis is reachable as a plain function (`§11.5`), that runner can adopt it
without adopting the CLI: it already holds the parsed document in memory and needs
no path, no reader and no second process. Nothing in the runner, its hashes or its
byte-identical-output claims needs to move for that to become possible.

### 11.9 Verification status

- **Executed once, in an isolated unit run: `66/66` tests pass, `0` fail, `0` skip.**
  That is the whole P0 entry batch — **66 tests across three test files**, not a
  count for this CLI alone (`tests/admission-cli.test.mjs` contributes 30 of them:
  26 seam tests + 4 real-path tests). The record is
  [`docs/testing/2026-11-05-p0-entry-recheck.md`](../../docs/testing/2026-11-05-p0-entry-recheck.md).
- **Earlier record preserved:** the first run of the same batch was `65/66` with one
  failure, caused by the exit-1 test expecting the unknown-coverage finding before
  the reported-case finding. Test-only fix; production, protocol, catalog and exit
  semantics were not touched. Both records stand; neither is retracted.
- The numbers quoted in §9 belong to the static lane's accepted run and are not
  evidence about this one.
- Run it explicitly: `node --test tests/admission-cli.test.mjs`.
- **Zero skips, by construction.** The suite has no conditional-skip branch. Its
  four real-path tests omit the injected loader and reader and drive the actual
  canonical `validateAdmissionEvidence`, imported by direct file URL from
  `<repo>/projects/dsh-compat-spec/src/admission-evidence.js`. If that file is
  missing or does not export the validator, `loadCanonicalSpec()` throws and those
  tests FAIL. A missing checkout is an error of this batch; substituting a stub
  would make the tests vacuous, which is the same rule
  `tests/helpers/spec-validator.mjs` states for the static lane.
- **What this batch does not establish.** No host was started or installed, nothing
  was packed or published as an installable artifact, and no type check was run.
  The validator you name on the command line is **trusted code executed in this
  process, not a sandbox** (`§11.4`): passing the suite says nothing about the
  safety of a module someone else wrote.
- `src/admission-diagnostics.js` and its `.d.ts` are unchanged by this lane; the
  admission CLI adds files and export slots only.

---

## 12. Profile dump summary — `dsh-compat-profile-dump`

A read-only reader for the YAML that `dsh --profile <name> --dump-config` writes to stdout. Its
bounds apply to the **input** (1 MiB, 20000 lines) and to its own walk, not to everything the
parser may allocate. It answers one narrow question: *does this export parse, how is it shaped,
and which structural facts deserve a second look?* It is not a loader and not a compatibility
verdict.

```console
$ dsh-compat-profile-dump ~/dump.yml        # after npm install; or: node src/profile-dump-cli.js ~/dump.yml
```

Exactly one explicitly named regular file. No stdin, no globs, no default path. stdout carries
one JSON document — on success, on refusal, and on usage errors; usage text goes to stderr. The
one exception is a failure of that stdout write itself: the process then exits `5` with no
document delivered, because a write that failed cannot be repeated into a working one. This is
the package's first runtime dependency: `yaml`, pinned to `2.9.1`.

### 12.1 What it reads

The export is **one document containing one sequence**. `groupedDump`
(`packages/boot/app-boot/src/index.ts:697-725`) prefixes each contiguous run with a
`# == <origin>` comment line, but comments do not delimit YAML documents, so every group's rows
become items of a single root sequence. This command reports that flat sequence and does not
claim which layer a row came from.

An **empty export is empty, not healthy**: with no rows, `groupedDump` returns a single newline
(`index.ts:724`), which parses as an empty document. Empty input, comment-only input and `[]` are
all reported as `"inventory": "empty"` and nothing more. `completeness` stays `"unknown"` in every
outcome, because a dump only reflects what the composing host chose to print.

Whitespace-only or comment-only text composes to **no document at all** (`yaml` returns an empty,
`empty: true` array carrying the stream's own `errors`/`warnings`). That stream is reported as
`"inventory": "empty"` **only when it carries no error and no warning**. A stream-level problem on
that same stream — an unsupported `%YAML` directive, for example — is refused instead: a stream
error becomes `PARSE_ERROR` (exit `2`), and a stream warning becomes `UNEXPECTED_WARNING` (exit
`2`). "No rows" and "the stream itself is broken" are therefore kept apart.

### 12.2 Output

```json
{
  "profileDumpSummary": "profile-dump-summary/0.3-draft.1",
  "input": { "bytes": 812, "lines": 23 },
  "documents": 1,
  "inventory": "present",
  "root": "sequence",
  "identityDisclosed": false,
  "counts": {
    "entries": 2, "entryGroups": 0,
    "entriesWithId": 2, "entriesWithName": 2, "entriesWithConfig": 2, "entriesDisabled": 0,
    "jsScalars": 2, "distinctTags": 2, "nodes": 14, "scalars": 11, "maxDepth": 4
  },
  "rows": [
    { "index": 1, "line": 2, "keyCount": 3, "idKind": "string", "nameKind": "string",
      "group": "absent", "disabled": "absent", "config": "mapping",
      "configKeyCount": 2, "unmodelledKeyCount": 0, "id": null, "name": null },
    { "index": 2, "line": 9, "keyCount": 4, "idKind": "string", "nameKind": "string",
      "group": "false", "disabled": "true", "config": "mapping",
      "configKeyCount": 1, "unmodelledKeyCount": 1, "id": null, "name": null }
  ],
  "rowsTruncated": false,
  "limits": { "maxBytes": 1048576, "maxLines": 20000, "maxDepth": 32,
              "maxNodes": 20000, "maxEntries": 5000, "maxDiagnostics": 64, "maxRows": 64 },
  "diagnostics": [ { "ordinal": 2, "code": "JS_EXPRESSION_NOT_EVALUATED", "line": 9, "detail": null } ],
  "diagnosticsTruncated": false,
  "completeness": "unknown",
  "runtimeValidation": "not-performed",
  "certification": false,
  "notDerived": ["declarations", "availableCapabilities", "resources", "activation", "loadability"],
  "limitations": [
    "ROW_IS_NOT_A_DECLARATION", "ROW_SET_COMPLETENESS_UNKNOWN",
    "NO_DEPENDENCY_CLOSURE_ESTABLISHED", "NO_LOADABILITY_OR_ACTIVATION_OBSERVED",
    "ROW_SKIPS_UNMODELLED_KEYS", "CONFIG_VALUES_NOT_INSPECTED",
    "CERTIFICATION_NOT_CLAIMED", "INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX"
  ]
}
```

`rows` is a **capped display window** over `counts.entries`, not a second inventory:
`counts.entries` stays authoritative, `rows` holds at most `maxRows` (64) of them, and
`rowsTruncated` says when the window is short. `rows` is `null` exactly where `counts` is `null`,
so a refused document never looks like a document with no entries.

Each row carries **position, line, and closed words only**: `index` (1-based), `line`, `keyCount`,
`idKind` / `nameKind` (`absent` | `string` | `non-string`), `group` / `disabled`
(`absent` | `true` | `false` | `null` | `other`), `config` (`absent` | `mapping` | `not-mapping`),
`configKeyCount` (only when `config` is a mapping, `null` otherwise) and `unmodelledKeyCount`.
The pairs are kept apart on purpose: `disabled: "false"` is a setting, `disabled: "null"` is the
legal "not set" form `EntryOptions` declares (`boolean | null`,
`vendor/loader/src/config/entry.ts:8-24`), `disabled: "other"` is a value this reader did not
model, and collapsing them into one boolean would make a legal form, a setting and a typo
indistinguishable. `config` key names are **counted, never copied** — the
same rule the diagnostics already follow — so `plugin.id` inside a `config` block stays arbitrary
text and is never read as a pointer to anything.

`notDerived` and `limitations` are the guards on that window. The five `notDerived` names are
copied verbatim from the accepted export observation record
(`NOT_DERIVED`, `experiments/profile-export-fixture/observation.mjs`); `limitations` is a fixed
list shaped like `COMBINED_REPORT_LIMITATIONS`. Both are **per-summary copies**, so a consumer may
adapt its own copy without editing what the next consumer sees.

**No document content is ever emitted.** No id, name, origin label, `# ==` text, configuration
key, value, `!!js` expression text, path or parser message appears in any field. `distinctTags`
is a count, not a list. Diagnostics carry an ordinal (1-based top-level row, or `null`), a 1-based
line, a code from a closed set, and a `detail` from a closed set of *classes* — `JS_COLLECTION`,
`CORE_NOT_ALLOWED`, `EXTERNAL` for tags, `UNRESOLVED_TAG` / `OTHER_WARNING` for warnings — never
the tag itself. A local tag (`!SECRET_TAG`) or a verbatim tag (`!<https://…>`) is operator text
inside the document, so it is classified, not quoted. Parser messages are never read:
`YAMLError.message` is assembled together with a source excerpt, so only `code` and `pos` are used.

A refusal returns the same envelope with `"inventory": "none"`, `"counts": null` and
`"rows": null`, so a partial walk can never be mistaken for a complete inventory.

### 12.3 What is checked, and what deliberately is not

| Check | Rule | Code | Exit |
| --- | --- | --- | --- |
| row is a mapping | required | `ENTRY_NOT_MAPPING` | 2 |
| `id` / `name` | when present, must be a literal string scalar | `ENTRY_ID_NOT_STRING` / `ENTRY_NAME_NOT_STRING` | 1 |
| `id` repeated | only non-empty, top-level ids are compared | `DUPLICATE_ID` | 1 |
| `!!js` scalar anywhere | recorded, never evaluated | `JS_EXPRESSION_NOT_EVALUATED` | 0 |
| anchor / alias | refused | `ANCHOR_PRESENT` / `ALIAS_PRESENT` | 2 |
| merge key `<<` | refused (never merged) | `MERGE_KEY` | 2 |
| unknown or vendor tag | refused against a closed allowlist | `UNSUPPORTED_TAG` | 2 |
| tag on a mapping key | refused | `TAG_KEY_PRESENT` | 2 |
| more than one document | refused by document count | `MULTI_DOCUMENT` | 2 |

Only `id` and `name` are type-checked. `config`, `group` and `disabled` are counted, and the
safety walk still descends through `config` looking for tags, aliases and size — but no entry
semantics are inferred there, and no claim is made that the remaining metadata fields were
validated.

`MODELLED_KEYS` is `id`, `name`, `config`, `group`, `disabled`. `EntryOptions` declares a sixth
serialisable field, `inject?: Inject | null`
(`vendor/loader/src/config/entry.ts:8-24`, and §2.3 of the design doc lists it), and this reader
deliberately does **not** model it: its value is a union of an array of service names and an
intercept configuration object, so a closed word for it would need its own review. A row that
carries `inject` therefore reports it in `unmodelledKeyCount` like any other unmodelled key —
counted, never named, never interpreted. That is a known limit of the row vocabulary, not a
judgement that `inject` is foreign to `EntryOptions`.

An **absent** `id` or `name` is not an error in this version. `EntryGroup.create()` accepts
`Omit<EntryOptions, 'id'>` and calls `tree.ensureId(options)` (`vendor/loader/src/config/group.ts:20-22`),
which is evidence about `id` only; it says nothing about when a missing `name` is legal. Because
that shape was not verified here, a missing `name` is not diagnosed at all — a deliberate gap in
a deliberately partial check, not an assertion that every row is a valid Loader entry. A `group`
row's `config` is an `EntryOptions[]`, but nested entries are **not analysed**: they are traversed
for safety only, and an `id` inside a `config` block is never treated as a plugin id.

### 12.4 Exit codes

| Code | Meaning |
| --- | --- |
| `0` | parsed; no entry-level diagnostic (a `!!js` scalar alone stays `0`) |
| `1` | parsed, but at least one entry-level diagnostic |
| `2` | unusable: read failure, not UTF-8, over limits, parse error (including a bad stream directive on an empty stream), unexpected tag, anchor/alias, merge key, tagged key, multiple documents, wrong root shape |
| `5` | internal failure, including a failed stdout write |
| `64` | usage error |

`2` and `1` are different on purpose: "cannot be read at all" must not be confused with "read
fine, look at row 7".

### 12.5 Limits, and what they do not bound

`maxBytes` (1048576) and `maxLines` (20000) act **before** parsing. `maxDepth` (32),
`maxNodes` (20000), `maxEntries` (5000), `maxDiagnostics` (64) and `maxRows` (64) act **after**
parsing, during the walk — they bound what this command will *describe*, not what the parser will
consume. `maxRows` caps the row window only; `counts.entries` still reports the full count and
`rowsTruncated` marks the window.
`yaml@2.9.1` has no parse-time depth option. Its `RESOURCE_EXHAUSTION` recovery wraps the compose
recursion only (`src/compose/compose-node.ts`); a `RangeError` that escapes is caught and reported
as `RESOURCE_EXHAUSTION_UNCAUGHT`. These are recovery paths, **not guarantees** that the process
cannot fail, and they say nothing about other consumers of the same library.

`maxDiagnostics` caps the list, not the count: `diagnosticsTruncated` marks the cap, and the exit
code is decided by a separate counter that keeps counting past it. A refused document never
returns a partial walk as if it were complete (`counts` is `null`, `inventory` is `"none"`).

### 12.6 What this command does **not** establish

- that any listed plugin would load, or that its dependencies resolve;
- that a `config` block conforms to its plugin's schema — `config` is not validated against any
  plugin schema (its tags, aliases and size are still examined by the safety walk);
- what any `!!js` expression evaluates to — it is never evaluated and never emitted;
- that the dump is complete, authoritative, or produced by a particular host version;
- anything about provenance, authentication or certification;
- that a clean summary means the profile is healthy. `completeness` is always `"unknown"`;
- that `rows` is the row set. It is a capped window over the counters, and the row set's own
  completeness cannot be established from a dump: denied bundles contribute no row and skipped
  bundles arrive as free-form stderr (`limitations`: `ROW_SET_COMPLETENESS_UNKNOWN`);
- that a row is a declaration, or that `config` holds declarations. A row is shape facts about a
  dump line (`limitations`: `ROW_IS_NOT_A_DECLARATION`, `ROW_SKIPS_UNMODELLED_KEYS`), and the
  `notDerived` list names what no consumer may read out of it.

### 12.7 Verification status

- **The authorized second isolated run under Node 24 passed: on the `0.1-draft.1` bytes, this
  lane's single test file `tests/profile-dump.test.js` passed `65/65`, `0` fail.** That is **one
  file**, not the whole
  suite, and it is not host integration, cross-version or packaging certification. `yaml@2.9.1`
  ran under Node 24 for this file only. The record is
  [`docs/testing/2026-11-08-profile-dump.md`](../../docs/testing/2026-11-08-profile-dump.md).
- **Earlier record preserved:** the first bounded run of the same file was `65` cases with `1`
  failure — a `!!python/object:...` case expected `EXTERNAL`, but `!!` expands to the
  `tag:yaml.org,2002:` namespace and is classified `CORE_NOT_ALLOWED`. The fix was to the test
  assertion and its description only; the implementation was **not** changed to suit the test.
  Both records stand; neither is retracted.
- **A separate bounded replay of retained captures passed (2026-11-08).** The committed CLI
  was run once per sample against three historical `stdout.bin` captures — `333`, `162` and
  `568` bytes — produced earlier by a real CLI over a synthetic fixture home. All three
  reproduced the pre-fixed summary shape and counters: exit `0`, empty stderr, `verdict=pass`,
  `3/3`. This is not a re-export on this host, adds **no** test cases (`65/65`, the count for
  those bytes, is unchanged and these three samples are not "68 tests"), and says nothing about export
  completeness, plugin loadability or hostile hosts. The record is
  [`docs/testing/2026-11-08-profile-dump-retained-export.md`](../../docs/testing/2026-11-08-profile-dump-retained-export.md).
- **The `0.2-draft.1` shape was verified on 2026-11-09 in four bounded rounds of this lane's
  runner, plus one carrier round, all under the same envelope.** This lane's single test file
  passed `78/78` (`0` fail) on the row-window and
  guard-list cases, then `81/81` after three process-level cases were added (the shipped
  `examples/diagnose/profile.yml` read from disk, a partial failure exiting `1`, a refusal
  exiting `2`); between those two, an intermediate round was `80/81` because one new assertion
  demanded the wrong `ordinal`. The same three retained captures were replayed against the
  row-carrying shape, `3/3`, `verdict=pass`, and the diagnostics carrier was re-run once
  (`49/49`) because it embeds the summary untouched. `81/81` supersedes `78/78` only as *the
  count for the current bytes*, and neither supersedes `65/65` as a claim about earlier bytes; no
  run is retracted and no counts are additive. Still one file, still not the whole suite. Record:
  [`docs/testing/2026-11-08-profile-dump-rows.md`](../../docs/testing/2026-11-08-profile-dump-rows.md).
- **Boundaries still pending:** a fresh host-export-to-diagnostic run, production-scale profile
  coverage, hostile-host behavior, cross-Node-version behavior, and host compatibility. Non-UTF-8 and over-limit files
  were tested through the CLI's imported `main`; only the valid-file case also exercised a real
  CLI subprocess. Stream failure tests cover the specific fake sinks and Node Writable case in
  this file, not every possible stream implementation. Any future execution on this machine
  must use a separately reviewed resource envelope; the recorded batch is not authorization
  for an unbounded rerun.


## 13. Unified diagnostics — `dsh-compat-diagnose` (one file executed: 49/49)

One read-only envelope over **one exported profile dump** and **up to three explicitly
named lane documents**. It is an orchestration surface, not a fourth analysis lane: every
judgement it prints comes from the modules and validators named below.

```bash
# after install
dsh-compat-diagnose --profile dump.yml \
  --static decls.json --declaration-validator ./validator.js \
  --runtime runtime.json \
  --admission admission.json --admission-validator ./admission-validator.js

# in this checkout, without installing
node src/diagnose-cli.js --profile dump.yml
```

### 13.1 What it reads

| flag | input | who decides |
| --- | --- | --- |
| `--profile` | one exported profile dump (YAML text) | `summarizeProfileDumpText` (§12) |
| `--static` + `--declaration-validator` | one analyzer input document — a JSON object `{ declarations, availableCapabilities }`, not a bare declaration | `buildCombinedReport` + the named validator |
| `--runtime` | one parsed JSON document | `summarizeRuntimeEvidence` |
| `--admission` + `--admission-validator` | one parsed JSON document | `buildCombinedReport` + the named validator |

At least one flag is required; each may be given at most once; `--profile` is optional and a
lane's validator flag is required exactly when its lane is named. No positional argument, no `-`
(stdin), no directory scan, no environment lookup and no output path exist on this surface.
Every file goes through the shared bounded reader: a regular file of at most `1048576` bytes,
decoded as strict UTF-8. Read failures, non-JSON documents and unloadable validators each become
a **`provided`** block with a fixed issue code — one source's failure never discards another's
result, and when every named lane fails the embedded combined report still carries them.

### 13.2 Output

```json
{
  "diagnoseVersion": "dsh-compat-diagnose/0.2-draft.1",
  "certification": false,
  "correlation": "not-established",
  "profile": { "state": "provided", "source": "profile-input", "outcome": "clear",
               "issues": [], "summary": { "documents": 1, "...": "..." }, "entryDiagnostics": 0 },
  "combinedReport": { "reportVersion": "combined-report/0.1-draft.1", "channels": { "...": "..." } },
  "provenance": [
    { "source": "profile-input", "baselineState": "not-reflected", "commit": null, "node": null },
    { "source": "static-input", "baselineState": "not-provided", "commit": null, "node": null },
    { "source": "runtime-input", "baselineState": "recorded", "commit": "0000000000000000000000000000000000000000", "node": "v24.21.0" },
    { "source": "admission-input", "baselineState": "not-provided", "commit": null, "node": null }
  ],
  "nextSteps": [ { "code": "RUNTIME_ATTENTION", "source": "runtime", "message": "..." } ],
  "limitations": ["...", "PROFILE_BLOCK_IS_A_SUMMARY_NOT_A_DUMP", "NO_CROSS_SOURCE_IDENTITY"]
}
```

- `source` is a **fixed slot label** (`profile-input`, `static-input`, …), never a file path and
  never provenance evidence. Naming sources together establishes no identity between them.
- Successful lanes retain the library's `result` verbatim. The wrapper may add failed-source
  channels or construct the all-failed skeleton while retaining the existing combined-report
  schema. The envelope as a whole **may contain plugin ids, capability names,
  resource tuples and paths taken from the input documents** — it is not a redacted document.
  The profile block is the exception: counts, limits, fixed diagnostics, fixed codes, no dump
  text and no plugin ids. A refused dump still keeps that summary rather than a bare code.
- `combinedReport` is `null` **only** when no lane was named. If lanes were named and all of them
  failed before the builder, this module assembles the same schema itself: fixed version and
  flags, the library's own fixed `limitations` list, each named lane `provided` with a degraded
  outcome. That is stated here because a reader cannot tell the two apart by shape alone.
- `nextSteps` carries at most one fixed-code, fixed-text step per source — read-only advice that
  names the recorded cause. A source nobody named gets `SOURCE_NOT_PROVIDED`, which never moves
  the exit code.
- `provenance` is one entry per source, always four, always in the fixed source order
  (`source`, `baselineState`, `commit`, `node`). It reports **what this envelope could read
  about a baseline**, and nothing else: no entry is compared with another, no commit is checked
  against a checkout, and no entry is filled in from a neighbour.

  | `baselineState` | Meaning |
  | --- | --- |
  | `recorded` | The lane's own summary carries a baseline this envelope can copy verbatim: a 40-character commit and a non-empty node version. Today only the runtime receipt does. |
  | `not-reflected` | The lane was read and summarised, but its summary carries no baseline field at all. `profile`, `static` and `admission` are always this word when usable. It points upstream; it never says the document had no baseline. |
  | `not-provided` | No document was named for that source. |
  | `not-readable` | The document was named but produced no usable result, so any baseline it carried is unavailable. |

  `commit` and `node` are non-null **exactly** when the word is `recorded`; every other word
  carries two nulls. There is deliberately no `unknown` word — an unreadable baseline is
  `not-readable`, and a fifth word meaning the same thing invites a reader to treat one of the
  two as "probably fine". The envelope also adds the limitation
  `BASELINE_IS_READ_FROM_THE_SUMMARY_ONLY`, so the projection cannot be quoted without it.

### 13.3 Exit codes (closed table)

| code | meaning |
| --- | --- |
| `0` | every **requested** source is clear |
| `1` | at least one requested source needs attention |
| `2` | at least one requested source is invalid or unusable |
| `3` | usage problem, or a validator that could not be loaded or used |
| `4` | a requested source produced no verdict after a usable document was accepted |
| `5` | internal, serialization or output failure |

Precedence `5 > 3 > 4 > 2 > 1 > 0`. A usage problem still emits one `{"error":{"code":"USAGE"}}`
line on stdout before the help text on stderr, so a consumer never parses help as a report.
`--help` is the one path that exits `0` without a report and writes nothing to stdout.

**Absence is not a finding.** Unlike `combinedReportExitCode` (which counts an absent lane as
attention), a source nobody named produces an `absent` block with outcome `unknown` and does not
move the code. Presence is decided by the input's own keys — there is no separate `requested`
list that could disagree with the data. An own key holding `null`/`undefined` is refused as
malformed rather than read as absence.

### 13.4 Trust boundary

- The profile text is summarized as inert text; no plugin, host, driver root or profile is
  imported, evaluated or executed, and no `!!js` value is ever evaluated.
- The two validator flags import a module **into the CLI process** with the caller's privileges.
  That is an explicit selection, not a sandbox — only point them at trusted code. The fixed
  export name is `validateDeclaration` / `validateAdmissionEvidence`; there is no `--export` flag.
- A lane's validator is imported only **after** that lane's JSON parsed. A read failure or
  invalid JSON syntax therefore does not trigger that lane's module import. Parsed JSON that
  violates the document schema still requires the validator and does not have this guarantee.

### 13.5 What this command does **not** establish

- that the sources describe the same host, build, commit or session — `correlation` is
  `not-established` and nothing is merged across lanes;
- that any plugin would load, activate or interoperate, that its `config` conforms to a schema,
  or what any `!!js` expression evaluates to (§12.6 applies unchanged to the profile block);
- that a dump is complete or authoritative, or that a clean envelope means a healthy profile;
- anything certified: `certification` is always `false`.

### 13.6 Library surface

```js
import { buildDiagnoseReport, diagnoseExitCode } from 'dsh-compat-platform/diagnose';

const report = buildDiagnoseReport(
  { profile: { text }, static: { document } },     // real payloads only
  { validateDeclaration },                          // passed through unchanged
);
diagnoseExitCode(report); // 0 | 1 | 2 | 3 | 4
```

The public builder accepts **payloads only** — `{ text }` for the profile, `{ document }` for a
lane. It has no failure input: the failure vocabulary (`INPUT_READ_FAILED`, `INPUT_JSON_INVALID`,
`VALIDATOR_LOAD_FAILED`) is an *output* type, and only the CLI can record one, through the
package-internal assembler that `package.json` `exports` does not expose. Options are validated
up front whatever sources were named, so the same arguments never mean different things across
invocations. Note the two vocabularies on the CLI path: lane names (`static`, `admission`) are
mapped to the assembler's option names (`validateDeclaration`, `validateAdmissionEvidence`) in
one place, because the assembler accepts only its own option keys.

`diagnoseExitCode` re-checks the envelope rather than trusting it: the documented
`diagnoseVersion`, `certification` and `correlation`, an array `nextSteps`, the presence of
`profile`, a `provenance` array of exactly four entries in the fixed source order with closed
keys and closed words (`recorded` carrying a 40-character commit and a non-empty node; every
other word carrying two nulls), and — when `combinedReport` is not `null` — a plain `channels`
object carrying all three lanes as **own** properties. The projection is validated for shape
only: it is deliberately not cross-checked against the blocks, because a second derivation of
the same fact is a second thing that can disagree. A missing or `null` channel throws; it is never filled in as
`absent`, because a truncated report must not read as "nobody asked". Only
`combinedReport === null` makes the three lanes absent, and an `absent` block must carry exactly
`outcome: 'unknown'`. A shape violation is a fixed `TypeError` surfaced by the CLI as `5`; there
is no separate "bad report" exit code. It is a shape check, not a provenance or brand check.

### 13.7 Verification status

- **`0.2-draft.1` (the `provenance` projection), executed 2026-11-09 in three bounded rounds,
  all green.** `tests/diagnose.test.js` is **54/54** in its own transient `systemd-run` unit
  (384 MiB, swap 0, 32 tasks, 50% CPU, 120 s ceiling), with `memory_peak=42127360` B,
  `pids_peak=16`, `mem_available_kib=1250024` and a settled unit (`MainPID=0`). The
  real-validator wiring runner stayed green over the same bump: six CLI cases
  (`0/0/2/1/2/2`, `case_failures=none`) plus its own suite `6/6`. The host GUI runner served the
  bumped envelope over HTTP (`200` page, `200` verbatim JSON, `405`, `403`, `404`, and the
  `503 ENVELOPE_UNREADABLE` path) with `16/16` package tests. Numbers, hashes and the five
  deviations are in [the record](../../docs/testing/2026-11-09-diagnose-provenance.md).
  **These are three runners, not the full package suite, and no host ran.**
  The bump is shape-only: **no exit code changed.**
- **`0.1-draft.1` (the shape before the projection), executed 2026-11-08 in two bounded rounds.**
- **Executed in two separately authorized bounded rounds.** Each run of `tests/diagnose.test.js`
  used its own transient `systemd-run` unit (384 MiB, swap 0, 32 tasks, 50% CPU, 120 s ceiling),
  with effective limits checked through cgroup and systemd readbacks before the workload:
  - **round 1:** 48 cases, **40 pass / 8 fail**, exit `72`. The eight failures were fixtures and
    expectations that disagreed with the documented contract — a YAML mapping root where the
    summarizer accepts only a sequence root (`ROOT_NOT_SEQUENCE`), a runtime-evidence document
    missing the three fixed `CASE_IDS` or carrying `message` in a closed `assertions` shape, a
    rejected lane asserted as `attention` instead of `invalid`, and a validator read under the
    lane name instead of the assembler's option key.
  - **round 2 (after test-side-only corrections):** **49/49**, exit `0`. Only
    `tests/diagnose.test.js` changed between the rounds; the eleven other selected hashed paths,
    including the source files selected by the batch, are byte-identical. **The eight round-1 failures are preserved in
    the record** — a later 49/49 does not show the implementation is free of bugs.
  - Per-case breakdown, command, argv, hashes and envelope numbers:
    [testing record](../../docs/testing/2026-11-08-unified-diagnostics.md).
- **A fixed defect with no executed evidence.** A validator-wiring defect (lane name vs.
  assembler option key) was found by static reading and corrected **before** the first run. The
  defective form was never executed anywhere, so no artifact shows it or the failure it would
  have produced; what the wiring case establishes is the current mapping only.
- **The modules it orchestrates do have their own records:** the profile summarizer is `81/81` on
  its current `0.2-draft.1` bytes and `65/65` on the earlier shape (§12.7), and the combined
  report has its own bounded acceptance (§ above). Those records do not
  transfer: they say nothing about this file's control flow, its exit mapping or its tests.
- **Scope of the 49/49 — deliberately narrow.** The cases drive `main(argv, io)` in-process with
  injected sinks and real temporary files, and load a **synthetic** validator module by absolute
  path through dynamic `import()`. There is **no CLI subprocess**, **no real protocol
  validator**, **no host** and **no full-suite run**: the workload names
  `tests/diagnose.test.js` explicitly, so the `tests/*.test.js` `tests/*.test.mjs` suite total
  above (§3) does not include it and is not implied to be green.
- **Boundaries still pending:** cross-Node-version behaviour, CLI subprocess behaviour, a real
  protocol validator as the injected dependency, and any host-scale dump. Nothing in this section
  is authorization for an unbounded run, and the recorded two-round batch is not authorization
  for a different envelope.

### 13.8 Real-validator wiring example (executed, 6/6 green)

The 49/49 above loads a **synthetic** validator. A separate example connects this CLI to the
**real** validators from `dsh-compat-spec` (`src/index.js` → `validateDeclaration`,
`src/admission-evidence.js` → `validateAdmissionEvidence`). The suites resolve them through
`tests/helpers/spec-module.mjs`, which prefers the published package specifier
(`dsh-compat-spec`, `dsh-compat-spec/admission-evidence` — the subpath exists in
`dsh-compat-spec` from 2026-11-09, commit `0ea745a`) and falls back to the sibling checkout
because this workspace does not install the package:

- **Runnable example** — [`examples/diagnose/`](../../examples/diagnose/README.md): a synthetic
  `profile.yml`, `runtime-evidence.json`, `admission-evidence.json`, and the copy-paste commands
  with each command's expected exit code. The fixtures are referenced in place, so a sibling
  checkout is required. Nothing there is a host run.
- **Wiring tests** — [`tests/diagnose-spec-wiring.test.js`](tests/diagnose-spec-wiring.test.js):
  `main(argv, io)` against the real validators and real temp files. If neither the package nor
  the sibling checkout can be resolved the suite fails, it does not skip.
- **Runner** — [`scripts/diagnose-real-wiring/`](../../scripts/diagnose-real-wiring/README.md):
  the same envelope as `diagnose-batch`, but the CLI as a real child process, one case per
  invocation — six cases, `0/0/2/1/2/2`, plus one bounded `node --test` run of the wiring file
  (`6/6`). Includes one case that shows `--static` refusing a bare declaration (it takes the
  analyzer input envelope) and one that shows a valid admission document landing on `attention`
  rather than `clear`.
- **Record** — [`docs/testing/2026-11-08-diagnose-spec-wiring.md`](../../docs/testing/2026-11-08-diagnose-spec-wiring.md).

> **Executed once per round, three bounded rounds total; round 3 green.** The measured result is
> that the real validators accept `fixtures/clean.json` and `examples/diagnose/admission-evidence.json`
> and refuse `fixtures/invalid-declaration.json` and `fixtures/clean.json`-as-admission, with the six
> CLI cases at `0/0/2/1/2/2` and the wiring file at `6/6` TAP. That is all it is: no host ran, no
> plugin loaded, `certification` stays `false`, and this is not the full package suite.

## 14. Dependency-shape summary — `dsh-compat-dependency-shape`

A separate, deliberately narrow entry beside §12. `profile-dump` reports a row window whose
fields are the ones `EntryOptions` declares **minus `inject`**, because
`Inject = (keyof M)[] | { [K in keyof M]?: M[K] }` (`vendor/cordis/src/registry.ts:19`) is a
union of a *service-name list* and an *intercept config*: one word inside a row would read as
"this plugin depends on X", which a dump cannot support. This command answers the narrower
question — **how many rows declare `inject`, of which shape, and how large** — and carries its
own `notDerived` and `limitations` so the two artifacts cannot be quoted for each other.

Design: [`docs/requirements-and-design/2026-11-09-dependency-shape-design.md`](../../docs/requirements-and-design/2026-11-09-dependency-shape-design.md).

### 14.1 What it reads

Exactly one explicitly named regular file: a `dsh --profile <name> --dump-config` export, the
same input as §12. No stdin, no flags, no globs, no defaults. The reader is `readEvidenceFile()`
from `evidence-cli.js`, reused unchanged: non-blocking open, `fstat` on the open descriptor,
regular files only, `1048576`-byte cap with a one-byte probe, strict UTF-8.

### 14.2 Output

One JSON document on stdout, always. Counters only — **no id, name, service name, key, value,
origin label or expression text**.

```json
{
  "dependencyShapeSummary": "dependency-shape-summary/0.1-draft.1",
  "input": { "bytes": 947, "lines": 28 },
  "documents": 1,
  "inventory": "present",
  "root": "sequence",
  "counts": {
    "rows": 4,
    "rowsWithInject": 3,
    "injectAbsent": 1,
    "injectNull": 1,
    "injectSequence": 1,
    "injectMapping": 1,
    "injectOther": 0,
    "injectSequenceItems": 2,
    "injectNames": 2,
    "injectTaggedItems": 0,
    "injectNonScalarItems": 0,
    "injectMappingKeys": 1,
    "injectEmptyMappings": 0,
    "jsScalars": 0,
    "distinctTags": 0,
    "nodes": 37,
    "scalars": 28,
    "maxDepth": 5
  },
  "limits": { "maxBytes": 1048576, "maxLines": 20000, "maxDepth": 32,
              "maxNodes": 20000, "maxEntries": 5000, "maxDiagnostics": 64 },
  "diagnostics": [],
  "diagnosticsTruncated": false,
  "completeness": "unknown",
  "runtimeValidation": "not-performed",
  "certification": false,
  "notDerived": ["declarations", "availableCapabilities", "resources",
                 "activation", "loadability", "dependencyResolution"],
  "limitations": ["DEPENDENCY_SHAPE_IS_NOT_RESOLUTION", "INJECT_ITEM_NAMES_NOT_EMITTED",
                  "NO_ROW_WINDOW_IN_THIS_SUMMARY", "ROW_SET_COMPLETENESS_UNKNOWN",
                  "NO_DEPENDENCY_CLOSURE_ESTABLISHED", "NO_LOADABILITY_OR_ACTIVATION_OBSERVED",
                  "CONFIG_VALUES_NOT_INSPECTED", "CERTIFICATION_NOT_CLAIMED",
                  "INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX"]
}
```

`counts` is `null` — never zeros — whenever `inventory` is `none`: a refused document has no
rows, and `0` there would read as "this export declares no dependency", the exact over-read the
command exists to avoid.

Two invariants hold on every `present`/`empty` inventory, and both the suite and the replay
verifier assert them:

```
rowsWithInject === injectNull + injectSequence + injectMapping + injectOther
injectSequenceItems === injectNames + injectTaggedItems + injectNonScalarItems
```

The five `inject` words are `absent`, `null`, `sequence`, `mapping` and `other`. `null` is its
own word because `EntryOptions.inject?: Inject | null` makes it legal and the loader reads it as
"not set"; `absent` stays separate for the reason §12.2 gives. Inside a sequence, an item is a
`name` (a literal string), `tagged` (the opaque `!!js` form, recorded but never read as a value)
or `non-scalar` (anything else, including a nested mapping).

### 14.3 Exit codes (closed table)

| Code | Meaning |
| --- | --- |
| `0` | Parsed; no entry-level diagnostic (an `inject` holding `!!js` alone stays `0`) |
| `1` | Parsed, but at least one entry-level diagnostic: `INJECT_SHAPE_NOT_MODELLED` or `INJECT_ITEM_NOT_A_NAME` |
| `2` | Unusable: read failure, not UTF-8, over limits, parse error, unexpected tag, anchor/alias, merge key, tagged key, multiple documents, wrong root shape, a row that is not a mapping |
| `5` | Internal failure, including a failed stdout write |
| `64` | Usage error |

### 14.4 Trust boundary

The module receives text and imports exactly one thing: `yaml`. It never calls `parse()` or
`toJS()`, never evaluates `!!js`, never resolves an alias or a merge key, never resolves a module
specifier, and never surfaces a parser message (those carry a source excerpt). Refusals match §12
code for code: the parse prologue and the safety walk are a second copy of the ones in
`profile-dump.js`, and `tests/dependency-shape.test.js` cross-checks both modules on a shared
malformed-input corpus so the copies cannot drift apart silently.

### 14.5 What this command does **not** establish

That any declared service is provided, that any dependency is satisfied, that anything would
load or activate, that the row set is complete, or that the export is a valid loader
configuration. `completeness` is always `"unknown"`, `runtimeValidation` always
`"not-performed"`, `certification` always `false`. A row that declares two service names is one
row with two items — not a resolution, not a graph edge and not a compatibility statement.

### 14.6 Verification status

**Executed: two bounded rounds, both green (2026-11-09).** Each round ran
[`scripts/dependency-shape-batch/`](../../scripts/dependency-shape-batch/README.md) once under a
384 MiB / swap 0 / 32 tasks / 50 % CPU / 120 s unit with a 192 MiB heap: `tests/dependency-shape.test.js`
passed `37/37`, the shipped example returned the counters in §14.2 at exit `0`, the static contract
passed, and the `yaml` regular-file manifest was byte-identical before and after. Round 1 peaked at
`85,929,984` B and `23` pids, round 2 at `68,214,784` B and `23` pids. The numbers, both run
directories and the ten selected-input hashes are in
[`docs/testing/2026-11-09-dependency-shape.md`](../../docs/testing/2026-11-09-dependency-shape.md).

Two limits of that evidence: it is this package's own summary checked against its own example and
suite — no real DSH export was read and no host was involved — and this section was edited after the
runs, so the hash of this file at run time is stated in the record rather than being the committed
one.

## 15. Correspondence check — `dsh-compat-correspondence`

### 15.1 What it reads

Three explicitly named regular files, each read once, each hashed:

1. a **correspondence** document — the caller's assertion that entry *X* is plugin *Y*;
2. a **profile dump** — the same shape `dsh-compat-profile-dump` summarises;
3. a **declaration document** — `{ "declarations": [ … ] }`, the shape
   `dsh-compat-spec` validates.

```
dsh-compat-correspondence <correspondence.json> --profile <dump.yml> --declaration <manifest.json>
```

### 15.2 Why this artifact exists

A dump row and a declaration share **no matchable field**. Rows are text-free by construction; a
declaration carries `plugin.id` and `plugin.version` but no module specifier, while an entry's
`name` is exactly a module specifier and `EntryOptions` has no version field. Nothing can be matched
without inventing identity — so the caller states it, and this command checks that the statement is
internally consistent:

- the bindings digest both documents, so an assertion cannot be replayed against different bytes;
- every asserted entry id must resolve to **exactly one** row;
- every asserted plugin id must be declared **exactly once** (or the document reports the duplicate);
- a row that is `disabled` while its plugin declares capabilities is reported.

### 15.3 Output

One JSON document on stdout, `correspondence-summary/0.1-draft.1`:

```json
{
  "correspondenceSummary": "correspondence-summary/0.2-draft.1",
  "identitySource": "caller-asserted-entry-text-verified",
  "bindings": { "profileSha256": "…", "declarationSha256": "…" },
  "pairs": [ { "index": 1, "line": 21, "disabled": "absent", "config": "mapping",
               "keyCount": 3, "unmodelledKeyCount": 0, "pluginDeclared": true,
               "capabilitiesRequired": 1, "capabilitiesOptional": 0,
               "resources": { "tool": 1, "service": 0 }, "findings": [] } ],
  "findings": [],
  "counts": { "pairs": 3, "matched": 3, "refused": 0, "findings": 1 },
  "certification": false,
  "correlation": "not-established",
  "identityDisclosed": false,
  "entryTextVerified": true,
  "notDerived": [ … seven names … ],
  "limitations": [ … eight codes … ]
}
```

No id, name, note or configuration value is ever copied into the output — the assertion goes in, and
only its verdict comes out. `identityDisclosed` is always `false` for this document.

`entryTextVerified` is what changed in `0.2-draft.1`: the dump text is now read **twice** — once by
this module's own line scanner and once by the profile summarizer with identity disclosure switched
on — and the two readings must agree on every row both of them can address. A two-sided
disagreement refuses the document (`CORRESPONDENCE_ENTRY_TEXT_DISAGREES`). A row only one reading
can address stays merely unaddressable, so a legal quoted id does not turn into a hard error. The
pairing is still the caller's assertion: what is verified is that the entry text exists as
asserted, not that the plugin and the entry are the same thing.

### 15.4 Exit codes (closed table)

| Code | Meaning |
| --- | --- |
| `0` | every asserted pair resolved and no finding |
| `1` | at least one finding |
| `2` | refused: stale bindings, malformed correspondence, unreadable profile, entry not found or ambiguous |
| `5` | internal failure, including a failed stdout write |
| `64` | usage error |

### 15.5 What this command does **not** establish

It does not load, import, resolve or execute anything. A correspondence is an assertion, so a green
run means the assertion was well-formed and consistent with these bytes — not that the plugins
exist, load, activate or provide what they declare. Version correspondence is impossible here, the
row set is never proven complete, and configuration values are never read. `certification` stays
`false`.

### 15.6 Verification status

**Executed: three invocations, the last two green on byte-identical inputs (2026-11-09).** Each ran
[`scripts/correspondence-batch/`](../../scripts/correspondence-batch/README.md) under the same
384 MiB / swap 0 / 32 tasks / 50 % CPU / 120 s envelope with a 192 MiB heap. Rounds 2 and 3:
`tests/correspondence.test.js` `43/43`, shipped example exit `1` with exactly one
`CORRESPONDENCE_PLUGIN_NOT_DECLARED`, stale-bindings demo exit `2` with `CORRESPONDENCE_STALE`,
static contract pass, eleven selected inputs identical before and after. Peaks `51,462,144` B / `23`
pids and `51,322,880` B / `23` pids. Round 1 failed at `72` because the runner passed two documents
positionally instead of through `--profile` / `--declaration`; that round is kept in
[`docs/testing/2026-11-09-correspondence.md`](../../docs/testing/2026-11-09-correspondence.md)
at its own numbers. This section was written after the runs, so the run-time hash of this file is
stated in the record.
