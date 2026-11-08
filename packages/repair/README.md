# `dsh-compat-repair` — typed plans, a preview, and no way to apply anything

This package is the inert half of "approved repair". It can describe a change to one
boolean field on one entry of an entry-list profile, and it can render what that change
would look like. It cannot make the change: there is no apply function, no writer, no
CLI that touches a file, and no network or subprocess code anywhere in it.

Status: `0.0.0-draft.1`. Two modules, twenty-five tests, zero dependencies.

## What is here

| File | What it is |
| --- | --- |
| `src/repair-plan.js` | `repair-plan/0.1-draft.1` schema, closed key sets, one-element operation vocabulary, validator, canonical digest. |
| `src/repair-preview.js` | Reads a plan and a document's **text** in memory, verifies the precondition digest, renders a two-line diff, and says whether the postcondition digest would follow. Never writes. |
| `tests/repair.test.js` | 25 pure tests: schema closure, vocabulary width, stale refusal, unknown operation, preview text, no-writer assertions. |
| `../../examples/repair/` | A synthetic three-entry profile, one plan against it, and `preview.mjs`, which prints the preview. |

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
- That anything was changed. This delivery has no apply path; the string
  `nothing was written; no apply path exists` is printed by every preview.

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
