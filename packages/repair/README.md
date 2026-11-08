# `dsh-compat-repair` — typed plans, a preview, and an apply confined to one directory

This package carries "approved repair" from a description to a single, receipted write.
It can describe a change to one boolean field on one entry of an entry-list profile,
render what that change would look like, take a digest-bound approval record, and then —
only inside a directory the caller names — perform the write and report what it observed.

Nothing here authenticates an approver, resolves anything, or loads a profile. The
package has no network and no subprocess code.

Status: `0.0.0-draft.1`. Five modules, forty-two tests, zero dependencies.

## What is here

| File | What it is |
| --- | --- |
| `src/repair-plan.js` | `repair-plan/0.1-draft.1` schema, closed key sets, one-element operation vocabulary, validator, canonical digest. |
| `src/repair-preview.js` | Reads a plan and a document's **text** in memory, verifies the precondition digest, renders a two-line diff, and says whether the postcondition digest would follow. Never writes. |
| `src/repair-approval.js` | `repair-approval/0.1-draft.1`: a digest-bound approval for one exact plan, `allow`/`deny`, expiry, nine closed issue codes. Validates bytes; verifies no identity. |
| `src/repair-apply.js` | The pure decision (`decideApply`) and the frozen receipt (`repair-receipt/0.1-draft.1`, thirteen closed keys, ten reason codes, six limitations). Writes nothing. |
| `src/fixture-applier.js` | **The only module that writes.** Refuses any path outside the fixture root it was given, copies the file before writing, writes, then re-reads to see what actually landed. `restoreFixture` puts the copy back. |
| `tests/repair.test.js` | Schema closure, vocabulary width, stale refusal, unknown operation, preview text; asserts the pure modules export no writer and the applier is the only writer. |
| `tests/repair-apply.test.js` | 17 tests: approval schema, expiry, denial, digest binding, stale plan, confinement, applied, partial, recovery. |
| `../../examples/repair/` | A synthetic three-entry profile, one plan against it, `preview.mjs` (prints the preview), and `four-paths.mjs` (expired / denied / partial / recovery on a temporary copy). |

## The plan shape

```json
{
  "planVersion": "repair-plan/0.1-draft.1",
  "operation": {
    "kind": "set-entry-flag",
    "entryIndex": 1,
    "field": "disabled",
    "value": true
  },
  "precondition": {
    "documentSha256": "<64 lowercase hex characters>",
    "revision": "caller-supplied label"
  },
  "expectedPostcondition": {
    "documentSha256": "<64 lowercase hex characters>",
    "entryIndex": 1,
    "field": "disabled",
    "value": true
  }
}
```

Every member is closed: an extra key is refused, a missing key is refused, and the
postcondition must describe the same entry, field and value as the operation. The
vocabulary is deliberately one element wide — `set-entry-flag` on `disabled`, with a
boolean value. Widening it is a design change, not a configuration choice.

`precondition.revision` is carried and displayed, **never verified**: nothing in this
package can reach a document's history, so trusting it would be a claim the code cannot
support.

## The preview verdicts

| Verdict | Meaning |
| --- | --- |
| `ready` | The document matches the precondition digest, the edit is expressible, and the resulting text matches the postcondition digest. |
| `stale` | The document's current digest is not the one the plan was computed against. Stop; re-plan against the document in hand. |
| `mismatch` | The edit was expressible but the resulting text does not hash to the postcondition. The plan is wrong about its own effect. |
| `refused` | The plan is invalid, the entry is missing, the field value is not a literal, or the record is outside the accepted subset. |

The accepted document subset is small on purpose: `- key: value` opens a record,
`  key: value` members follow, values are literal scalars. Anything else — nested
mappings, tagged or quoted values, flow collections — is refused with its own code
rather than silently widened.

## What this package does **not** establish

- That any repair is safe, correct, approved, or desirable.
- That a plan came from a trusted author: a digest pins bytes, not authority.
- That the profile it names is loadable, or that the field it sets has the effect a
  reader might assume.
- That anything beyond one document changed. `restoreFixture` rewrites one file from the
  byte copy taken before the write; it is not a rollback of anything else, and no receipt
  claims that.
- That an approval came from a person: a caller who can write the approval file can
  approve anything, so the receipt prints `approver: <label as written>` and never
  "verified".

## The apply path

`decideApply` refuses before any byte is written unless the plan validates, the approval
validates, the approval names **this** plan digest, the approval has not lapsed, the
decision is `allow`, and the preview says `ready` against the document in hand. Then
`applyApproved` copies the file to `<name>.before`, writes the exact text the preview
showed, re-reads the file, and returns

- `applied` when the observed digest equals the postcondition,
- `partial` when it does not — a real state, with both digests in the receipt,
- `refused` for every failure before the write, with `wrote: false`.

`examples/repair/four-paths.mjs` demonstrates all four outcomes on a temporary copy and
exits non-zero unless the four receipts are distinguishable and the two refusals left the
document untouched.

## Running it

```bash
cd projects/dsh-compat-platform/packages/repair
node --test --test-concurrency=1 "tests/*.test.js"

cd ../..
node examples/repair/preview.mjs
```

The bounded batch that produced the recorded numbers is
`projects/dsh-compat-platform/scripts/repair-plan-batch/`, and its evidence lives in
`docs/testing/2026-11-09-repair-plan.md`.
