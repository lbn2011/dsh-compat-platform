# P2 gap review — read-only dependency and configuration diagnostics

**Status:** review only. No code was changed by this document, and it contains no new
measurements — every claim below points at a record that already exists.
**Date:** 2026-11-09
**Scope:** `docs/requirements-and-design/2026-11-04-platform-next-roadmap-dev-plan.md` §3 P2, read
against what this repository can actually show.

## 1. What P2 asks for

> First increment: explicit declarations + supported runtime receipts + explicit profile inventory
> export -> one report with source kind, baseline, severity, confidence/limitations and actionable
> explanation. Capture snapshots and differences without labelling absent data as disappearance.
>
> Next increment: dependency/loadability and configuration mismatch analysis using reviewed official
> surfaces. Trusted configuration extraction can execute imports or initialize profiles; it is not
> interchangeable with inert JSON analysis and requires a separately disclosed path.
>
> Gate: at least one real conflict and one missing-evidence scenario produce correct, attributable
> findings; a clean static report never implies activation or runtime health. Suggestions remain
> read-only.

## 2. What exists, and where the evidence is

| Artifact | What it establishes | Record |
| --- | --- | --- |
| `dsh-compat-diagnose` (envelope over four explicit inputs) | one document with per-source kind, outcome, issues, actionable `nextSteps`, fixed `limitations` | `docs/testing/2026-11-08-unified-diagnostics.md` (49/49) |
| real-validator wiring of that envelope | the four lanes driven by the real spec grammars, six CLI cases `0/0/2/1/2/2` | `docs/testing/2026-11-08-diagnose-spec-wiring.md` |
| `dsh-compat-profile-dump` `0.2-draft.1` | profile inventory shape: capped row window + guard lists, counts only | `docs/testing/2026-11-08-profile-dump-rows.md` (81/81; retained captures 3/3) |
| `dsh-compat-dependency-shape` `0.1-draft.1` | how many rows declare `inject`, of which of the four legal shapes, how large — names never emitted | `docs/testing/2026-11-09-dependency-shape.md` (37/37 twice) |
| `dsh-compat-compare` | snapshot comparison that marks absent/invalid as incomparable, never as disappearance | `docs/testing/2026-11-07-snapshot-compare-unit-split-recheck-4.md` (41/41, 36/36) |
| read-only GUI host route | one envelope, rendered as text, with the claim block before any data | `docs/testing/2026-11-08-read-only-diagnostics-gui.md` (15/15, seven HTTP checks) |
| admission lane | per-case admission diagnosis with a closed finding set | `packages/analyzer/README.md` §11.9 |

## 3. Gaps

| # | P2 clause | State | Verdict |
| --- | --- | --- | --- |
| G1 | "source kind" | `SOURCE_BY_NAME` maps every slot to `profile-input` / `static-input` / `runtime-input` / `admission-input` (`src/diagnose-internal.js:58-63`) | closed |
| G2 | "severity" | findings carry `severity: 'error' \| 'warning'` (`src/analyze.js:417,532,553,582`) and are sorted by it | closed |
| G3 | "confidence/limitations" — limitations half | every report carries a fixed limitation list plus per-summary `limitations`/`notDerived` | closed |
| G4 | "confidence" — the word itself | no confidence vocabulary exists anywhere in `src/`. Nothing is scored, graded or averaged | **open, inert** |
| G5 | "baseline" | the runtime receipt summary carries `baseline {commit, node}` and rides inside `channels.runtime.result.summary`; admission documents carry `baseline.commit`, and the admission CLI states explicitly that the document's own baseline is **not** reflected in its summary (`src/admission-cli.js:178,308`). There is no uniform per-source baseline projection in the envelope | **open, inert** |
| G6 | "snapshots and differences" without labelling absence as disappearance | `compareCombinedReports` reports changes per channel and marks missing/invalid/errored channels incomparable | closed |
| G7 | dependency **declaration** analysis | `dsh-compat-dependency-shape`: four legal `inject` shapes, item kinds, sizes; no names, no resolution claim | closed |
| G8 | **loadability** analysis | first increment delivered: a fixture-only observation path that boots a synthetic profile inside a boundary and records per-entry states and failure phases. It is not a loadability verdict for any real plugin — it runs code, stays out of every inert envelope, and says `certification: false`. See `docs/testing/2026-11-09-trusted-extraction.md` | **fixture-only first version done 2026-11-09; real-profile analysis still out of scope** |
| G9 | **configuration mismatch** analysis | **closed as far as this boundary allows (2026-11-10).** Two halves were separated and each got an answer. *Identity*: correspondence `0.2-draft.1` lets a caller assert which row is which plugin and has that assertion checked against both documents, so relating rows to declarations no longer requires inventing anything. *Values*: automatic comparison against a profile is refused by decision **D-D** — no tool in this repository reads a `config:` value out of a profile — so an automatic "mismatch" verdict from a profile is deliberately **not implemented**, not pending. What exists instead is `dsh-compat-config-check`, an author-side checker where the caller supplies the instance document and the declared `configSchema`. The artifacts keep saying so (`CONFIG_VALUES_NOT_INSPECTED`, `CONFIG_VALUES_NOT_COMPARED`, `NO_CONFIGURATION_VALUE_IS_EVER_EMITTED`) | **closed by decision** — automatic profile-side value comparison would need a new disclosure decision with its own leak tests, and it has not been taken |

## 4. Gate assessment

- **A real conflict produces an attributable finding.** `RESOURCE_CONFLICT` and
  `DUPLICATE_PLUGIN_ID` are produced by the static lane over explicit declarations, with the
  conflicting labels named in `summary.declarations`; `fixtures/with-conflict.json` and
  `fixtures/duplicate-optional.json` pin them in the analyzer suite, and the contract is described
  in `docs/requirements-and-design/2026-10-31-compat-platform-requirements.md`.
- **A missing-evidence scenario produces an attributable finding.** Three shapes are pinned:
  an unreadable document (`INPUT_JSON_INVALID`, lane `invalid`, `result: null`), an absent source
  (`outcome: 'unknown'`, never `clear`), and an under-reported admission document
  (`ADMISSION_COVERAGE_UNKNOWN`).
- **A clean static report never implies activation or runtime health.** `certification` is a
  literal `false`, `correlation` is the literal `'not-established'`, `runtimeValidation` is
  `'not-performed'` in the profile summary, and the limitation lists carry
  `CERTIFICATION_NOT_CLAIMED`, `CORRELATION_NOT_ESTABLISHED`, `NO_LOADABILITY_OR_ACTIVATION_OBSERVED`.
  The GUI prints the two literals above its first data element.
- **Suggestions stay read-only.** `nextSteps` are fixed strings naming the next *input* to supply;
  no step writes, installs, repairs or re-runs anything.

So the gate is met as written. What is missing is two named fields and one whole analysis that the
boundary currently forbids.

## 5. Recommended next increment

1. **G5 — uniform per-source baseline projection.** Additive, verifiable, and it closes a clause
   the envelope currently half-meets: one bounded block per provided source carrying only what the
   input document already states (a commit string that is either 40 lowercase hex or the literal
   `not-recorded`, a node version string, and whether the field was present), with the same
   own-property discipline as the rest of the reader. Nothing is derived, nothing is cross-checked
   between sources.
2. **G4 — a defined confidence vocabulary, in the same shape change.** Only if it can be tied to
   something already recorded (for example the receipt's `evidenceTier` word); otherwise a
   "confidence" number would be an invented score, which this project has refused elsewhere.
3. **G9 is closed by decision, not by implementation (2026-11-10).** It must not be faked by
   matching on order or position: two documents listing entries in the same order is a coincidence,
   not an identity. Identity is now assertable (correspondence `0.2-draft.1`); value comparison against
   a profile is refused by D-D, and the caller-supplied checker is the only route. Reopening it means
   making a new disclosure decision, which is the user's, not this review's.

## 6. Decisions this review cannot make

- **D-A — identity disclosure.** Allow an opt-in mode in which a profile inventory emits entry
  `id`/`name` text (still never config values), disclosed in the artifact's own fields, so that
  rows and declarations can be matched. Cost: the D7 leak surface the current design deliberately
  closed, and a shape bump for both artifacts.
- **D-B — trusted extraction path.** Allow a separate, explicitly disclosed command that initialises
  a profile or executes imports to answer loadability questions. Cost: it is no longer inert
  analysis; it needs its own sandbox envelope, its own refusal vocabulary and its own non-claims.
- **D-C — envelope version.** G5/G4 change the diagnose envelope's key set. Either bump it to
  `dsh-compat-diagnose/0.2-draft.1` (and update the GUI's closed field list, the exit mapper and the
  runners), or keep `0.1-draft.1` frozen and put the baseline projection in a separate command.

  **Decided 2026-11-09: bump to `0.2-draft.1`.** Implemented as the per-source `provenance`
  projection (G4/G5); the GUI field list, the exit mapper, the declarations file and the host page
  were updated with it. Evidence: `docs/testing/2026-11-09-diagnose-provenance.md` (three bounded
  rounds, all green). D-B stays open and is the next slice.

## 7. What this review does not claim

It is not a maturity score, a completion percentage or a certification. It restates existing
records against one roadmap paragraph; the records themselves remain the evidence, and none of them
is additive with another.
