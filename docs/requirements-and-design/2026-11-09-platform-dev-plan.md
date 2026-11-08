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
| U1 | Configuration mismatch (gap G9) | needs an identity decision: rows and declarations currently share no attributable key | one whole analysis stays impossible |
| U2 | Failure-phase honesty | import-vs-activation is read by re-importing the module, which runs side effects twice | a reviewer may read the phase word as a clean observation |
| U3 | Gate 4 (time budget) | only arithmetic; no fixture has ever been killed | the one failure path most likely in practice is untested |
| U4 | Network denial | rests on `--unshare-net`, not on an observed refusal from the child | a reader may think the child proved it |
| U5 | Admission validator import path | spec exports only `.`, `./schema`, `./package.json`; consumers reach `validateAdmissionEvidence` by file path | every consumer hard-codes a sibling layout |
| U6 | P4 approved repair | requirement exists, nothing typed or previewable | the platform can only describe, never correct |
| U7 | P5 matrix and packaging | single pinned baseline, private packages, no tarball installation check | no defensible support claim |

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

### S6 — Second host version and matrix  *(blocked on a user decision)*

- Choose the second host version from intended users, not from what happens to be installed.
- Probe package-specific peers and semantics; record which of the four repos was tested against which
  host and Node version.

Gate: two host versions with separate records, no compatibility claim beyond what ran.

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
