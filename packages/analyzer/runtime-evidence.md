# Runtime coexistence evidence — intake, validation and summary

`src/runtime-evidence.js` validates and summarizes a JSON document that some
**other process** reports having produced by running real hosts. It is a separate
lane from the static declaration analysis in `src/analyze.js`: it derives nothing
from author declarations, and the static analysis derives nothing from it.

- Added by this change: `src/runtime-evidence.js`, `tests/runtime-evidence.test.js`,
  this document.
- **Not** wired in yet: `src/index.js`, `src/cli.js`, `package.json` and
  `src/analyze.js` are untouched, so the new module is reachable only by direct
  path import. Existing static behaviour is unchanged.
- **NOT RUN:** the new suite has not been executed. Nothing in this document is a
  claim that these tests pass; it describes what they assert.

## What it does, and what it refuses to do

Accepted: an already-parsed JSON value. Two outcomes only.

| Outcome | Shape |
| --- | --- |
| Accepted | `{ valid: true, issues: [], summary: {...} }` |
| Refused | `{ valid: false, issues: [{ code, path, message }], summary: null }` |

The function is pure: it never mutates its argument and never reads a file, the
network or the environment. It contains no `eval`, no Function constructor, no
dynamic or static module import, and no subprocess: the module is import-free by
construction and a test asserts that over its own source.

Its supported input is **plain parsed JSON** — the output of `JSON.parse`, whose
properties are all own *data* properties. Within that contract the function is
total: validation **and** summary construction run inside one guarded region, so
any structural problem or any failed read becomes a refusal rather than an
exception escaping to the caller. Two things are deliberately *not* claimed, and
the code does not rest on them:

- it does **not** claim the value cannot run code — a getter runs on property
  access and a `Proxy` runs its traps; reading a non-JSON object can therefore
  execute operator-supplied code. See "Hostile values" below;
- it does **not** promise termination for hostile JavaScript. A trap that never
  returns will not return, and nothing here can change that.

Invalid input **fails closed**: `summary` is `null`. A summary of half-understood
evidence would be indistinguishable from a summary of full evidence, so it is
never produced.

### Hostile values: what "no dynamic execution" covers

"No dynamic execution" is a statement about **this module**, not about the value
it is handed. The module evaluates and imports nothing; it can still be *made* to
run code by an object that executes on read.

- Own accessor descriptors (getters/setters) are refused **structurally**, on the
  descriptor, without being invoked — at the root object, `baseline`, each case,
  each assertion, and each array element position. A getter is never called, so a
  getter that would throw (or would answer once and throw on the second read) is
  simply not asked.
- If a read still throws — a `Proxy`, or a stateful value the structural check
  cannot see — the whole document is refused, including when the throw happens
  while the summary is being built. Both phases share one guard because both read
  the document.
- The thrown value is **never inspected**: no `instanceof`, no `.name`, no
  `.message`, no string coercion, no `String(error)`. Describing it would run
  attacker-chosen code, so the refusal carries one fixed message. The diagnostic
  detail that a benign run would give is the price of not touching the value.
- This is **not a sandbox**. A `Proxy` runs code in `get`, `ownKeys`,
  `getOwnPropertyDescriptor`, `getPrototypeOf` and `has` before any check here
  sees anything; side effects and non-termination in such code are outside what a
  pure validator can prevent, and are not claimed to be prevented.

## Schema (exact, and closed)

```jsonc
{
  "schemaVersion": "coexistence-evidence/0.1",
  "baseline": { "commit": "<40 hex>", "node": "v24.21.0" },
  "cases": [
    {
      "id": "same-name-conflict" | "dependency-unload" | "stale-cleanup",
      "status": "passed" | "failed" | "not-run",
      "evidenceTier": "real-host",
      "assertions": [{ "id": "<non-empty string>", "passed": true }],
      "limitations": ["<non-empty string>"]
    }
  ],
  "limitations": ["<non-empty string>"]
}
```

Every object is **closed**: object fields, case fields and assertion fields are
exactly the ones above. Any extra key is `UNEXPECTED_FIELD`. This is deliberate —
a field this validator does not know about is a claim that would otherwise travel
into the summary unread, and silent drift is worse than a refusal.

## Rules enforced

- `schemaVersion` must equal `coexistence-evidence/0.1` exactly; another revision
  is refused rather than reinterpreted.
- `baseline.commit` must be a **full** 40-character hexadecimal git object name
  (either case, preserved verbatim). An abbreviation is refused.
- `baseline.node` must be a non-empty string; an unknown runtime version is not a
  supported state.
- All three case ids must appear, each **exactly once**. A missing case is never
  read as passed, failed or skipped; two copies of one case are never merged and
  never resolved by an implicit "last one wins".
- `status` and its own assertions must agree:
  - `passed` → at least one assertion, and every assertion `true`;
  - `failed` → at least one assertion, and at least one `false`. A failing
    outcome is always expressible as a recorded failed assertion, so there is no
    assertion-less `failed` exception: the runner is expected to record the
    assertion that failed;
  - `not-run` → zero assertions.
- Assertion ids are non-empty strings and unique **within their case**; two
  assertions sharing an id would make `assertionCount` ambiguous.
- Types are strict, never coerced: `"true"` is not `true`, `1` is not a status.
- Arrays must be **dense** (no holes) and values JSON-representable: a hole would
  silently shrink a count.
- `limitations` entries (both levels) are non-empty strings.

## Issue codes

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Not a plain object. |
| `NOT_INSPECTABLE` | A read threw, or an object/array position holds an own accessor descriptor instead of data. One closed refusal with a fixed message; the thrown value is never inspected. |
| `UNEXPECTED_FIELD` | A field outside the closed schema. |
| `MISSING_FIELD` | A required field is absent. |
| `WRONG_TYPE` | Wrong JSON type at that path. |
| `SPARSE_ARRAY` | Array hole; not JSON. |
| `EMPTY_STRING` | Present but empty/whitespace-only. |
| `INVALID_SCHEMA_VERSION` | Revision other than `coexistence-evidence/0.1`. |
| `INVALID_COMMIT` | Not 40 hexadecimal characters. |
| `UNKNOWN_CASE_ID` | Case id outside the three defined cases. |
| `DUPLICATE_CASE_ID` | Same case reported twice. |
| `MISSING_CASE_ID` | One of the three cases absent. |
| `INVALID_STATUS` | Status outside the three defined values. |
| `EVIDENCE_TIER_NOT_SUPPORTED` | Tier other than `real-host`. |
| `INVALID_ASSERTION_ID` | Assertion id not a non-empty string. |
| `DUPLICATE_ASSERTION_ID` | Two assertions in one case share an id. |
| `STATUS_ASSERTION_MISMATCH` | Status contradicts its own assertions. |

Codes are stable identifiers; a new rule gets a new code, never a reused name.

## Summary

```jsonc
{
  "cases": [
    {
      "id": "same-name-conflict",
      "status": "passed",
      "evidenceTier": "real-host",
      "assertionCount": 2,
      "failedAssertionCount": 0,
      "limitations": ["..."]
    }
  ],
  "baseline": { "commit": "...", "node": "..." },
  "limitations": ["..."],
  "certification": false
}
```

Cases are emitted in canonical order (`same-name-conflict`, `dependency-unload`,
`stale-cleanup`) regardless of the reporter's order, so summaries are comparable
byte for byte. The result and its nested arrays are frozen.

## Trust boundary: the tier is a claim, not a fact

`evidenceTier` arrives **inside the document being validated**. It is a string
copied from a receipt this module cannot see, sign, timestamp or replay. There is
no key material, no signature check, no host handshake and no re-execution here,
and a pure validator has no way to tell a genuine receipt from a hand-written
JSON file. Therefore:

- **`certification` is always `false`.** Not sometimes, not conditionally.
- An accepted `"real-host"` tier is echoed as *what the document claims*. It is
  never described as authenticated, verified or attested.
- A limitation string in the document asserting "independently verified" is
  carried through as reported text and changes nothing; a document cannot certify
  itself.
- A valid summary does **not** upgrade the static declaration analysis, does not
  widen it, and is not a general compatibility guarantee for any runtime, host,
  version or plugin pair. It says one thing only: *this evidence document is well
  formed and internally consistent.* Whether the runs it describes ever happened
  is outside what any pure function can establish.
- Nothing here repairs, installs, loads, activates or patches a plugin.

Read a summary as: "these three cases were reported, with these self-reported
outcomes and these self-reported limitations" — never as "these plugins coexist".

## Usage

```js
import { summarizeRuntimeEvidence } from './packages/analyzer/src/runtime-evidence.js';

const result = summarizeRuntimeEvidence(JSON.parse(text));
if (!result.valid) {
  // Fail closed. Print result.issues; do not summarize, do not guess.
} else {
  // result.summary.certification === false, always.
}
```

The source of `text` is untrusted by default. Parsing it is inert; running the
producer of `text` is a separate, operator-owned decision outside this package.

## What the tests assert

`tests/runtime-evidence.test.js` (never executed as part of this change) covers:

- a valid mixed document (one `passed`, one `failed`, one `not-run`) and its
  counts, canonical case order, frozen results, exact summary shape;
- order-independence of the summary and determinism across repeated calls, with
  the input left unmutated;
- missing, duplicate and unknown cases, and a non-array case list;
- contradictions: `passed` with zero assertions, `passed` with a false assertion,
  `failed` with all-true assertions, `failed` with zero assertions, `not-run`
  carrying assertions;
- sparse case/assertion/limitation arrays, extra fields at all four levels,
  missing required fields, wrong types, wrong schema version, abbreviated or
  non-hex commits, empty/whitespace `node`, unknown evidence tier, duplicate
  assertion ids;
- an uninspectable document failing closed rather than throwing: a throwing
  getter; an own getter that answers once and would throw on the second read
  (refused on its descriptor, never invoked); a value that throws only on the
  second read through a proxy whose descriptors look like data (which pins down
  that the summary build sits inside the same guard); and a hostile proxy thrown
  from a read, where the refusal message is fixed and the thrown value is never
  touched;
- non-authentication: `certification` is `false` for every status combination,
  a self-declared "authenticated" limitation changes nothing, an unsupported tier
  is refused rather than upgraded, and the summary contains no compatibility,
  verified, certified or guarantee wording;
- static source hygiene: the module is import-free and contains no execution,
  filesystem, network or process primitive.

## Known limits

- Not exported from `src/index.js` and not used by the CLI yet: reaching it
  requires the direct path above.
- No authentication, signature, nonce or timestamp verification is possible or
  attempted; `certification` is permanently `false`.
- No cross-check against the static analysis: a document and a declaration batch
  are independent inputs, and no field connects them.
- Only `coexistence-evidence/0.1` is understood. A newer revision is refused, not
  best-effort parsed.
- Not a sandbox: reading a non-JSON object can run getters or proxy traps, and a
  trap that loops is not interrupted. The guarantees are narrower — accessors are
  refused without being invoked, unreadable input becomes one closed refusal, and
  thrown values are never inspected.
- Intended input is `JSON.parse` output. Passing live JavaScript objects works for
  plain data, and fails closed otherwise, but is not the contracted use.
