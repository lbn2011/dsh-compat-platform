# Dependency-declaration-shape summary — design

**Status:** implemented and executed (two bounded rounds, both green, 2026-11-09).
**Command:** `dsh-compat-dependency-shape <file>`
**Record:** [`../testing/2026-11-09-dependency-shape.md`](../testing/2026-11-09-dependency-shape.md)

## 1. Requirement

A profile dump written by the DSH CLI lists entries, and an entry may declare `inject`. Answering
"does this export declare dependencies, and in which of the shapes the type allows" is useful on its
own — but it was rejected as an addition to the existing `profile-dump` summary, because that
summary deliberately has no per-row windows for anything but key counting, and because folding a
dependency word list into a row window invites reading a *declaration* as a *resolution*.

So this is a separate, read-only entry with its own output vocabulary, its own `notDerived` list and
its own `limitations` list. It reads one text file and prints one JSON document. It never touches a
host, never installs anything, and never resolves a dependency.

## 2. Why not a lane, and why not merged

The unified diagnostics envelope (`dsh-compat-diagnose`) has three lanes fixed in
`combined-report.js` (`static`, `runtime`, `admission`) and a profile input that is carried as a
summary, not as a lane. This command is the same kind of artifact as `dsh-compat-profile-dump`:
its output can be *handed to* a diagnostics run as the profile input, but it is not a lane, not a
score, and not a fourth channel. Nothing about the envelope's key set or exit mapping changes.

## 3. What the type permits

`Inject<M = Dict> = (keyof M)[] | { [K in keyof M]?: M[K] }`
(`.cache/upstream/vendor/cordis/src/registry.ts:19`), and `EntryOptions.inject?: Inject | null`
(`.cache/upstream/vendor/loader/src/config/entry.ts:6-22`). So an `inject` value is legal in exactly
four shapes — absent, `null`, a sequence of service keys, a mapping of service key to config — and
anything else is not a shape the loader declares.

## 4. Output

One document, fixed key order:

```
dependencyShapeSummary  "dependency-shape-summary/0.1-draft.1"
input{bytes,lines}      measured, never caller-supplied
inventory               "present" | "empty" | "none"
root                    "sequence" | "other" | "unknown"
counts                  18 counters, or null
diagnostics[]           {ordinal,code,line} — closed codes, no text
diagnosticsTruncated    boolean
completeness            "unknown"          (never upgraded)
runtimeValidation       "not-performed"
notDerived              6 names            (the five observation facts + dependencyResolution)
limitations             9 fixed codes
certification           false
```

`counts` is `null` exactly when `inventory` is `"none"`: a refused document has no inventory to
count, and `0` there would read as "no dependencies declared".

### 4.1 The words, and nothing but the words

`inject` is projected onto `absent` / `null` / `sequence` / `mapping` / `other`. Sequence items are
projected onto `name` / `tagged` / `non-scalar`. **No service name, no key and no mapping value is
ever emitted**, and the CLI output is asserted free of the fixture's sentinel identifiers.

This is the deliberate narrowness: the useful question at this boundary is "did the row declare the
field, and in a shape the type allows", which needs no text. Emitting names would turn this artifact
into a dependency *inventory* that it cannot justify — the row set's completeness is unknown, and
`inject` says what an entry asks for, not what it receives.

### 4.2 Two invariants, stated so a consumer can check them

1. `rowsWithInject === injectNull + injectSequence + injectMapping + injectOther`
2. `injectSequenceItems === injectNames + injectTaggedItems + injectNonScalarItems`

Both are asserted on every fixture, in the test file and in the `.d.ts` doc comment.

## 5. Diagnostics and exit codes

Closed code set: the profile-dump refusal names are reused verbatim (`ROOT_NOT_SEQUENCE`,
`ENTRY_NOT_MAPPING`, `UNSUPPORTED_TAG`, `TAG_KEY_PRESENT`, `ALIAS_PRESENT`, `ANCHOR_PRESENT`,
`MERGE_KEY`, `DEPTH_LIMIT`, `NODE_LIMIT`, `ENTRY_LIMIT`, `PARSE_ERROR`, `MULTI_DOCUMENT`,
`UNEXPECTED_WARNING`, `RESOURCE_EXHAUSTION_UNCAUGHT`, `EMPTY_INPUT`, `EMPTY_INVENTORY`, plus the
`INPUT_*` reader codes) so a document is not judged by two vocabularies. Two attention codes are
this command's own: `INJECT_SHAPE_NOT_MODELLED` (the field is present in a shape the union does not
declare) and `INJECT_ITEM_NOT_A_NAME` (a sequence item that is neither a literal string nor a tagged
scalar). `JS_EXPRESSION_NOT_EVALUATED` stays informational, as in `profile-dump`.

| Exit | Meaning |
| --- | --- |
| `0` | the document was read and summarised, and no diagnostic was raised |
| `1` | summary produced, at least one attention diagnostic |
| `2` | nothing usable: read, parse, structure or limit refusal |
| `5` | internal failure, including a stdout write that could not be completed |
| `64` | usage |

## 6. Trust boundary

Same fence as `profile-dump.js`, restated because it is the whole safety story: text in, closed
vocabulary out, `yaml` the only import, `parseAllDocuments` with `schema: 'core'`,
`resolveKnownTags: false`, `merge: false`, `uniqueKeys: true`, `customTags: [JS_TAG_DEF]`; `!!js`
stays an opaque scalar and is counted, never evaluated; tags, anchors, aliases, merge keys and
tagged keys are refused rather than resolved; `YAMLError.message` is never surfaced because it
embeds a source excerpt; the byte/line caps apply before parsing and the depth/node/entry caps
afterwards, with an escaping `RangeError` reported as `RESOURCE_EXHAUSTION_UNCAUGHT`.

## 7. Duplication is deliberate, and pinned

The parse prologue and the safety walk are a second copy of the ones in `profile-dump.js` rather
than an extracted shared module: extracting them would have changed the bytes of a module whose
numbers are already recorded, for no gain in safety. To stop the two copies drifting apart, the
suite cross-checks them — for every refusal fixture, both summarisers must agree on `ok` and on the
refusal-code list — and the divergence is visible as a test failure rather than as a silent
difference in what two commands call malformed.

## 8. Verification plan, and what it does not establish

`scripts/dependency-shape-batch/` runs one file under a 384 MiB / swap 0 / 32 tasks / 50 % CPU /
120 s unit with a 192 MiB heap: the static contract of the command, the shipped example as a real
process, the test file, and a two-point `yaml` manifest. See the record for the measured figures.

Not established, and not attempted: that a real profile was exported, that any plugin loaded, that
any dependency resolved, that the `yaml` install is intact, or that the package suite as a whole is
green. `certification` stays `false` and `completeness` stays `"unknown"` — including for a document
where every row carries an `inject`, because the row set itself is what is unknown.

## 9. Decisions worth re-reading later

1. **Separate entry, not a `profile-dump` row window** — a dependency word inside a row window reads
   as a resolution; a separate artifact with its own `notDerived` cannot be quoted that way.
2. **No names emitted** — names would make it an inventory without a completeness proof.
3. **Reused refusal codes** — one malformed-document vocabulary across the two summarisers.
4. **No `maxRows` limit** — this artifact has no row window by design; its limit table says so.
5. **`null` kept as its own word** — `inject: null` is a legal, deliberate value and is not the same
   observation as a missing key.
