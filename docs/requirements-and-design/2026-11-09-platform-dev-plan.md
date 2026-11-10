# Platform — development plan after the fixture-only extraction slice

Date: 2026-11-09 · Status: **planning document, not execution authorization.** Every slice
below needs its own go-ahead, and the ones marked [blocked] need a user decision first.

Companion to the cross-repository roadmap
`docs/requirements-and-design/2026-11-04-platform-next-roadmap-dev-plan.md` (parent repository,
untracked) and to this repository's gap review
`docs/requirements-and-design/2026-11-09-p2-gap-review.md`.

## 1. Where the work actually stands

Verified at the time of writing, by reading the repositories, not by re-running anything:

| Repository | HEAD | Working tree | What it demonstrably contains |
| --- | --- | --- | --- |
| spec | `7740e92` | clean | draft declaration + admission-evidence validators, conformance vectors |
| kit | `97c7ce8` | clean | three host templates, three Skills, CLI; README inventory matches the tree |
| platform | `5c30d80` | clean | analyzer lanes, snapshots, profile dump `0.2-draft.1`, dependency shape `0.1-draft.1`, diagnose `0.2-draft.1`, read-only GUI host route, fixture-only extraction |
| driver | `2676608` | clean | host plugin, policy, provenance, two evidence adapters, README |

Platform evidence worth naming, with the record that carries it:

| Capability | Latest measured | Record |
| --- | --- | --- |
| `profile-dump-summary/0.2-draft.1` | 81/81 tests; three retained captures 3/3 | `docs/testing/2026-11-08-profile-dump-rows.md` |
| `dependency-shape-summary/0.1-draft.1` | 37/37 twice, ten selected inputs | `docs/testing/2026-11-09-dependency-shape.md` |
| `dsh-compat-diagnose/0.2-draft.1` | 54/54 analyzer, wiring 6 cases `0/0/2/1/2/2` + 6/6, GUI 16/16 + seven HTTP checks | `docs/testing/2026-11-09-diagnose-provenance.md` |
| fixture-only extraction | 28/28, two green rounds, gates 1–3 and 5 demonstrated | `docs/testing/2026-11-09-trusted-extraction.md` |

These are four different scopes. They are not additive, and none of them is a certification.

## 2. What is genuinely unfinished

| # | Item | Why it is still open | Cost of leaving it |
| --- | --- | --- | --- |
| U1 | Configuration mismatch (gap G9) | open — blocked on an identity decision (D-A): profile rows and declarations share no attributable key, and no work has been attempted | one whole analysis stays impossible |
| U2 | Failure-phase honesty | mostly addressed — the phase word is still **derived** by re-importing the module (`failurePhase` in `packages/runtime/src/trusted-extraction-adapter.js`), matching what the host's own `inactiveEntries(ctx, importNow = true)` does, and the limitation `FAILURE_PHASE_READ_BY_REIMPORT` stays as a disclosure; what changed: `packages/runtime/tests/reimport-cache.test.js` **measures** that a second `import()` of the same resolved URL does not re-run top-level side effects and that a module which threw rethrows the same error object, so the "side effects run twice" worry did not reproduce on Node 24.21.0. Still open: that is a property of this runtime, not a guarantee about a profile's own semantics | the phase word is derived rather than observed; a reviewer may still read it as a clean observation |
| U3 | Gate 4 (time budget) | closed — the kill path was first shown with a 3 s demo budget (`docs/testing/2026-11-09-trusted-extraction-failure-paths.md`) and then **measured at the shipped 80 s phase budget** in its own slice: two bounded rounds, `status: incomplete`, `cleanup: unconfirmed`, `process.timedOut: true`, `signal: SIGKILL`, wall clock 81 s per round so the 120 s outer limit was never reached, with the executed budget read back from `isolation-policy.js` rather than restated (`docs/testing/2026-11-10-shipped-phase-budget.md`, `scripts/trusted-extraction-hang-budget/`) | — the arithmetic remains asserted as a precondition, which is now a check of a measured fact |
| U4 | Network denial | closed by S1 — the verdict now comes from the child's own connect attempt and errno, via `networkVerdict()` in `packages/runtime/src/isolation-policy.js`; the bounded round observed `ENETUNREACH`; residual: other errno classes are classified but unobserved (record `docs/testing/2026-11-09-trusted-extraction-failure-paths.md`) | only the unobserved errno classes remain argued rather than measured |
| U5 | Admission validator import path | closed by S2 — spec publishes the `./admission-evidence` subpath (commit `0ea745a5`), and the platform resolves the grammar by package name in `packages/analyzer/tests/helpers/spec-module.mjs` (commit `b6594458`); no residual (94/94, four bounded rounds, `projects/dsh-compat-spec/docs/testing/2026-11-09-admission-evidence-export.md`) | nothing left to pay |
| U6 | P4 approved repair | partly closed — S3 delivered repair-plan/0.1-draft.1 with a text-only preview (25/25, commit `5f80b45`); S4 delivered digest-bound approval, a confined apply and receipts on four demonstrated paths (42/42, commit `2e477c2`); what remains: no CLI writes, nothing outside a caller-named fixture directory has been touched, and a backup is not a rollback | repair has still never left a fixture directory |
| U7 | P5 matrix and packaging | mostly closed — S5 installed five tarballs into a consumer directory with no sibling checkout (24 probe checks, a deliberate missing dependency failing loudly with `ERR_MODULE_NOT_FOUND`, `d6e6550`); the tarball `files` list is now audited per package and the audit reports **0 blockers on all five under both the private and the public standard** after `private` was cleared on explicit approval (2026-11-10, records `docs/testing/2026-11-10-release-readiness.md`, `docs/testing/2026-11-10-publishable.md`); what remains: still one pinned host version, versions stay `0.1.0-draft.1`, and nothing has been published | no defensible support claim |

## 3. Slice sequence

Order is chosen so each slice either removes a decision dependency for the next one or closes a
failure path in something already shipped. Small slices first; nothing in this plan needs a new
server, Loader, registry or skill manager.

### S1 — Close the failure paths in the extraction slice  *(no decision needed)*

- Add a **hanging fixture** to `examples/trusted-extraction/` and one bounded round that kills it,
  proving gate 4 dynamically: the supervisor must stop at the phase budget, kill, reap, and write
  `cleanup: 'unconfirmed'` or `'refused'` as appropriate — whichever the code actually does, recorded
  as measured.
- Add a **network-attempt fixture**: the child tries one outbound connect inside the sandbox and
  records the errno. The receipt then says what was observed (`ENETUNREACH`, `ECONNREFUSED`) instead
  of relying on the launcher's inference. Keep `--unshare-net`; this only changes what is claimed.
- Re-state the record's §6 so the network sentence and gate 4 sentence match the new evidence.

Gate: one bounded round with both fixtures; the killed run leaves a receipt whose status and cleanup
words are defensible; the network word is an observed errno or explicitly `not-observed`.
Risk: a hanging fixture must not consume the outer 120 s — the phase budget is 80 s, so the round
needs the kill grace within the outer limit. Mitigation: assert the arithmetic in the payload before
the run, as it already does.

### S2 — Export the admission validator properly  *(spec repo, small)*

- Add `./admission-evidence` to `projects/dsh-compat-spec/package.json` exports (types + default),
  and re-export `validateAdmissionEvidence` from `src/index.js` **or** leave the root surface frozen
  and export only the subpath — decide by reading what the root export list promises.
- Update the platform call sites that use `new URL('../../../../dsh-compat-spec/src/admission-evidence.js', import.meta.url)`
  to the package specifier, keeping the "missing checkout is a failure, never a skip" rule.
- Keep the conformance vectors and package version untouched.

Gate: platform's wiring tests still pass with the package specifier and no sibling path in the
runtime import graph; the spec's own suite is unchanged. This is the only slice in the plan that
touches a second repository, and it is additive.

### S3 — P4 first increment: typed plan, no execution  *(the real next phase)*

Deliver the inert half of approved repair, in the same style as everything else here: a closed
schema, a validator, and a preview — but no apply path yet.

- `packages/repair/src/repair-plan.js`: `repair-plan/0.1-draft.1`, closed key set, operations from a
  **one-element** vocabulary for the first version (proposal: set one boolean field on one entry of
  an isolated fixture profile), `{operation, target, precondition, expectedPostcondition}`, each
  field a closed shape. Refuse anything outside the vocabulary.
- `precondition` carries the exact bytes digest of the file to be changed plus the revision the plan
  was computed against; a mismatch is `PLAN_STALE` and stops before any writer exists.
- `packages/repair/src/repair-preview.js`: renders the diff as text, never writes. Its output is data
  for the GUI later, not a new endpoint.
- No CLI that writes, no apply function. *(Amended 2026-11-09: S4 delivered the apply
  path after all, because the gate for S4 required exercising four apply outcomes. It is a
  library call confined to a caller-named fixture directory — still no CLI that writes, and
  production paths remain out of scope.)*

Gate: pure tests only (plan validation, stale refusal, unknown-operation refusal, preview text);
no file outside the test temp directory is ever written; the record says plainly that no repair has
been applied.

**Status 2026-11-09: done.** `packages/repair` ships `repair-plan/0.1-draft.1` and a preview that
writes nothing; 25 pure tests, two bounded green rounds (fixture byte-identical before and after the
preview), record `docs/testing/2026-11-09-repair-plan.md`. The record states plainly that no repair
has been applied and that no apply path exists. The gate's "no file outside the test temp directory"
is stronger in the delivered code: the package performs no file I/O at all, which a test asserts.

### S4 — P4 second increment: approval and receipts, still on a fixture  *(needs the S3 review)*

- Typed plan → preview → **explicit approval record** (a signed-in user action, represented as a
  digest-bound approval file) → re-validate → apply → receipt → postcondition check.
- Apply only inside an isolated fixture directory. Production paths stay out of scope.
- Exercise the four required paths: expired input, denied approval, partial failure, recovery.

Gate: the four paths each produce a distinct receipt; no mutation occurs before approval; the record
states that backup is not presented as rollback.

**Status 2026-11-09: done.** `packages/repair/src/repair-approval.js`, `repair-apply.js` and
`fixture-applier.js` implement the approval record, the pure decision, the receipt and a
write-then-verify apply that refuses any path outside the fixture root it is handed. The four
paths ran on a temporary copy of `examples/repair/profile.yml` inside two bounded rounds
(42/42 tests, `expired`/`denied` refused with `wrote: false` and an unchanged digest,
`partial` with both digests recorded, `recovery` back to the original digest). Evidence:
`docs/testing/2026-11-09-repair-apply.md`. The S3 limitation
`NO_APPLY_PATH_EXISTS_IN_THIS_DELIVERY` was replaced by
`APPLY_PATH_IS_CONFINED_TO_A_FIXTURE_DIRECTORY`, because an apply path now exists and the old
sentence would be false.

### S5 — P5 packaging verification  *(no publication decision needed)*

- `npm pack` each platform package; install the tarballs into a throwaway consumer directory with no
  sibling paths on disk; run one documented command that exercises the installed surface.
- Record the artifact hashes, the install transcript and what still cannot be claimed (no support
  matrix, no publication).

Gate: install and one bounded invocation succeed from the tarballs alone; a deliberate missing-peer
case is recorded as a failure, not a skip.

**Status 2026-11-09: done.** `scripts/package-install/` packs the four packages plus
`yaml@2.9.1` offline and installs them into a fresh consumer directory that has no sibling
checkout; the probe resolves every documented subpath by package specifier (24 checks) and
the missing-dependency case is a loud `ERR_MODULE_NOT_FOUND` rather than a skip. Ten
invocations under the envelope, the last two green on identical inputs —
`docs/testing/2026-11-09-package-install.md`. Three defects were found in the process, one
of them in shipped code: `packages/host/src/envelope.js` imported the analyzer across a
relative path, which no in-repo test could catch and which made the tarball uninstallable;
the two facts that import added are now checked locally and the host suite stayed green.
*(Amended 2026-11-09: the delivery is stronger than the gate — it also proves the
missing-dependency failure — but nothing is published and `files` is not audited.)*

### S6 — Second host version and matrix  *(blocked on a user decision)*

- Choose the second host version from intended users, not from what happens to be installed.
- Probe package-specific peers and semantics; record which of the four repos was tested against which
  host and Node version.

Gate: two host versions with separate records, no compatibility claim beyond what ran.

**Status 2026-11-10: partly done, still not a two-version matrix.** Option **A** was taken — the
installed `0.2.2-rc.1` became a measured row (runtime receipt byte-identical across four rounds,
fixture observation in the same launch; `docs/testing/2026-11-10-second-baseline.md`). Option **C**
was taken as well: a per-tarball `files` allowlist audit plus the list of decisions a release needs
(`docs/testing/2026-11-10-publish-readiness.md`). Option **B** was taken last and measured the
*published* `0.2.2-alpha.2`: its manifest, and the export surface of the `dsh-app-boot` build it
depends on (`boot` and `auditStartupEntries` both present; `docs/testing/2026-11-10-second-version-baseline.md`).
What was still missing was the actual matrix: no second *installed tree* exists, because that
release's 91 direct dependencies do not install inside a 120 s envelope (measured — the unit was
killed). The link between the two (a commit pin) stays declared only.

**Status 2026-11-10 (later, same day): the behavioural cell is now measured.**
`scripts/second-version-observe` runs this repository's own adapter — unmodified — against both the
installed `0.2.2-rc.1` and a **pinned** `0.2.2-alpha.2` closure, and compares per-entry verdicts.
Two bounded rounds, both `agree=true / differences=0` over four entries, with byte-identical
observations: `include`/`ok` active, `import-throw` failed at import, `activate-throw` failed at
activation. The import-vs-activation split therefore survives the version change, which is the
specific behaviour this repository was built to observe.

Two limits are part of that result, not footnotes. The closure is a **hand-assembled tree** of 339
packages (recursive `npm pack`, no lockfile, no integrity check) because assembling it takes
3 m 26 s against a 120 s envelope; its manifest digest is verified every round so an observation
cannot describe a different runtime than the record names. And agreement on four fixture entries is
not a compatibility claim. `docs/testing/2026-11-10-second-version-observe.md`.

### Blocked items

- **G9 configuration mismatch** stays blocked until the D-A identity decision. The plan does not
  include it, because inventing a match on order or position is exactly the failure this project
  keeps refusing.
- **Real-profile extraction** (turning the fixture path onto a real plugin) stays out of scope: it
  needs a named target, its licence and an explicit permission, and it is the one thing here that
  executes third-party code.

## 4. Decisions this plan cannot make

| ID | Decision | Recommendation | What it changes |
| --- | --- | --- | --- |
| DA-1 | D-A: opt-in identity disclosure (entry `id`/`name` text in an artifact) | **hold** until a pilot needs matching; then scope it to a separate artifact, not to the default summary | would unblock G9 and cost a shape bump plus a new leak surface |
| DA-2 | Failure-phase method: re-import (current) vs "failed, phase unobserved" | keep re-import **with** the existing `FAILURE_PHASE_READ_BY_REIMPORT` limitation unless a reviewer objects | choosing the alternative loses the only phase separation this slice produces |
| DA-3 | P4 first operation | "set one boolean on one entry of a fixture profile" — reversible, observable, no dependencies | decides the whole S3/S4 vocabulary |
| DA-4 | P5 second host version and publication policy | defer until S5 lands; publishing stays a separate user decision | blocks S6 only |

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A repair slice quietly grows an apply path before approval semantics are reviewed | S3 ships a validator and a preview only; `apply` is a separate file that does not exist until S4 is approved |
| A hanging fixture turns into 120 s of dead time per round | phase budget 80 s, kill grace 10 s, readback 20 s, asserted in the payload before the run |
| Matrix work claims compatibility from a single green run | one record per host/Node pair, no roll-up, no percentage |
| Packaging verification is mistaken for a support promise | the record states versioning and publication remain undecided |
| Yet another shape bump forces re-runs of measured artifacts | no bump is proposed in S1–S5; each slice names what it does **not** change |

## 6. What this plan does not claim

It is not a schedule, a completion estimate or a commitment. It contains no dates and no
percentages. Each slice's gate is a thing that either happened in a recorded bounded run or did not;
where a slice cannot be bounded cheaply (S6), it waits for a decision rather than a guess.

## 7. Immediate next step

S1, because it needs no decision and it closes the two failure paths a reviewer is most likely to
question in the slice that just shipped: an untested kill and a network claim that belongs to the
launcher rather than to the child.
