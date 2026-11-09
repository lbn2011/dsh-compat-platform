# Hyperjump literal reproduction — PREPARED, NOT EXECUTED

Only [cases.mjs](cases.mjs) and this README are provided. No runner, patch,
installation, execution, tests, Node invocation, syntax check or commit was performed.
No observed reproduction or conformance result exists. Do not execute this preparation
until a separate safety-reviewed offline envelope and dependency acquisition have been
approved. The earlier acquisition qualification hold is not lifted by these files.

## Future invocation contract (not execution authorization)

The module accepts exactly three positional arguments:

```text
cases.mjs ABSOLUTE_INSTALLED_PACKAGE_BASE CLOSED_CASE_ID ABSOLUTE_EXTERNAL_NEW_OUTPUT
```

The base is a directory containing `node_modules`, not a module/fixture filename.
A `createRequire` resolver anchored in that explicit base resolves only the fixed
published specifiers `@hyperjump/json-schema/draft-2020-12` and `@hyperjump/browser`.
Before dependency imports, package metadata must identify exactly
`@hyperjump/json-schema@1.18.0` and `@hyperjump/browser@1.6.0`; resolved entry points
must match their published layouts and real package roots must stay inside the base.
The browser resolved from the validator entry must be the same resolved browser.
No user-supplied schema, instance, import specifier or fixture module is accepted.
Version strings/layout checks are NOT authenticity, integrity or transitive-lock review.
A trusted immutable installed tree, ordinary Node resolution (no custom loaders,
conditions, preload hooks or symlink-preservation flags), and verified package bytes
are prerequisites for the future envelope.

The module removes browser `http`, `https` and `file` scheme plugins before importing
the dialect, and again after dialect initialization, before registering a probe schema.
The dialect's packaged metaschemas initialize normally. All probe schemas/instances
are tiny fixed in-memory fixtures. The embedded-resource control is registered in
memory; it needs no retrieval. Reserved `.invalid` names are identifiers, not an egress
policy. These API guards are NOT an OS network/filesystem sandbox; imported packages
are executable code and are trusted only after separate acquisition review.

Run ONE case per fresh process, serially, only in the future approved envelope.
`main(argv)` is exported for deliberate invocation and refuses a second call within
one module instance. Import alone builds the fixtures and exports the frozen case ID
list; it neither imports Hyperjump nor runs a case. Do not use an in-process runner,
module-cache tricks, concurrency, or reuse of validator registries. No runner is supplied.

The output parent must already exist and be a trusted, run-owned external directory.
Its real path must be outside both this checkout and the installed dependency base.
Output creation is exclusive (`wx`, mode `0600`), never overwrite; existing final
symlinks also fail. No directory creation, deletion or cleanup is attempted. Parent
path races are not defended against: the external envelope must exclude other writers.
The report is at most 1024 bytes and contains no exception text, stack, instance,
schema, dependency path, resource URI or validator error detail. Generic failure
stdout is a fixed single-line code only. Dependency/runtime logging, crashes and
resource consumption must be bounded/redacted independently by the envelope.

## Closed cases and exact standard expectations

Every root declares JSON Schema draft 2020-12 and uses a fixed retrieval identifier.
For each of `const` and singleton `enum`, these literal objects are tested:

| Case ID middle component | Literal value |
| --- | --- |
| `anchor` | `{ "$anchor": "literal" }` |
| `id` | `{ "$id": "https://repro.invalid/literal" }` |
| `schema-known` | `{ "$schema": "https://json-schema.org/draft/2020-12/schema" }` |
| `schema-unknown` | `{ "$schema": "https://repro.invalid/unknown-dialect" }` |

The 16 exact IDs are:

```text
const-anchor-equal          const-anchor-different
const-id-equal              const-id-different
const-schema-known-equal    const-schema-known-different
const-schema-unknown-equal  const-schema-unknown-different
enum-anchor-equal           enum-anchor-different
enum-id-equal               enum-id-different
enum-schema-known-equal     enum-schema-known-different
enum-schema-unknown-equal   enum-schema-unknown-different
```

For EVERY `equal` case, the instance is a distinct deep copy of the complete literal
object and expected validity is **true**. For EVERY `different` case, the instance is
`{}` and expected validity is **false**. Object members are ordinary data here: they
must participate in equality, not create identifiers/anchors or select a dialect.
An unknown `$schema` inside such a literal is legal data, not an unknown schema dialect.
The known-dialect cases are useful contrasts, not a prediction that every case fails.

The remaining six exact IDs are:

| Case ID | Schema / instance | Expected validity |
| --- | --- | --- |
| `scalar-equal` | `const: 7`; instance `7` | **true** (control) |
| `scalar-different` | `const: 7`; instance `8` | **false** (control) |
| `default-schema-unknown` | `default: { "$schema": "https://repro.invalid/unknown-dialect" }`; instance `null` | **true** |
| `examples-schema-unknown` | `examples: [{ "$schema": "https://repro.invalid/unknown-dialect" }]`; instance `null` | **true** |
| `dynamic-uri-integer` | Embedded resource described below; instance `7` | **true** (control) |
| `dynamic-uri-string` | Same schema; instance `"not-an-integer"` | **false** (control) |

`default` and `examples` are annotations, not assertions; their values need not match
the instance, and `$schema` inside their data does not select a dialect. No case should
throw. Expected outcomes are standard-derived, not copied from the engine under test.

The dynamic control root has `$defs.embedded` with `$id` equal to
`https://repro.invalid/embedded`, `$dynamicAnchor: "node"`, and `type: "integer"`.
The root's `$dynamicRef` is `https://repro.invalid/embedded#node` (URI-bearing,
not fragment-only). There is no overriding dynamic anchor in scope, so resolution
applies the embedded integer schema. This is an embedded-resource/URI-reference
control, NOT comprehensive dynamic-scope recursion or override qualification.

## Evidence interpretation

The report has only `case`, `expected: {valid: boolean}`, `actual` and `status`.
`actual` is `{valid: boolean}` or `{error: FIXED_CODE}`. The closed engine-stage codes
are `REGISTER_ERROR`, `COMPILE_ERROR`, `VALIDATE_ERROR`, `RESULT_SHAPE_ERROR`.
Setup/import failures use `SETUP_ERROR` and `not-evaluated`, never `reproduced`.
If a report cannot be written, stdout carries only `SETUP_ERROR` or `OUTPUT_ERROR`;
invalid arguments use `ARGUMENT_ERROR`, unexpected outer failures `INTERNAL_ERROR`.

- A candidate mismatch (wrong validity OR engine-stage error) is `reproduced`;
  this means the case's expected behavior was not observed, **not success/conformance**.
  The fixed stage code deliberately does not prove the underlying cause. Review controls,
  trusted bytes and environment before attributing it to the source-derived defect.
- A control mismatch is `control-mismatch`, not candidate reproduction evidence.
  Controls must be reviewed before accepting any candidate result.
- A matching outcome is `not-reproduced`, including matching controls; it is not a
  broad conformance or safety claim and must not be labeled engine acceptance.
- Exit `0`: report written with matching validity only. Exit `2`: report written with
  mismatch (including control mismatch). Exit `64`: bad arguments/repeated call.
  Exit `70`: setup/internal failure. Exit `74`: output failure. A killed process or
  absent report is incomplete evidence, never a match or automatic reproduction.

## Separate envelope still required

No internal timeout can interrupt synchronous dependency work. The future envelope
MUST impose an external whole-process wall timeout, memory/swap/PID/CPU limits,
offline network isolation, minimal read-only mounts, isolated environment without
credentials/preloads, one fresh process per case, serial scheduling, bounded log/output
storage, exclusive external run directory, immutable input/dependency hashes before
and after, and reliable process-tree termination/status evidence. It must distinguish
timeout/crash/no-report from engine-stage errors. Tiny fixtures and a 1024-byte report
bound do not bound dependency behavior. No automatic retries, patching, production
promotion, transitive-dependency approval or semantic restrictions are authorized here.

## Sources and rationale

- [JSON Schema 2020-12 validation: enum §6.1.2 and const §6.1.3](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.1.2): JSON value equality, not schema interpretation of literal members.
- [Validation: default §9.2](https://json-schema.org/draft/2020-12/json-schema-validation#section-9.2) and [examples §9.5](https://json-schema.org/draft/2020-12/json-schema-validation#section-9.5): annotation values, not subschema locations.
- [Core: $dynamicRef §8.2.3.2](https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.2) and [embedded schema resources §8.2.4](https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.4): URI reference resolution and embedded-resource semantics.
- [Hyperjump 1.18.0 schema processing](https://github.com/hyperjump-io/json-schema/blob/v1.18.0/lib/schema.js): `processSchema` recursively visits all object members/arrays, processes identifiers/anchors, and consults dialect keywords even for literal objects; this is the source-derived hypothesis, not execution evidence.
- [Upstream PR 125](https://github.com/hyperjump-io/json-schema/pull/125): related literal-handling report; not an applied patch or dependency pin.
- [Exact draft entry](https://github.com/hyperjump-io/json-schema/blob/v1.18.0/draft-2020-12/index.js), [public API](https://github.com/hyperjump-io/json-schema/blob/v1.18.0/lib/index.js), and [package exports/version](https://github.com/hyperjump-io/json-schema/blob/v1.18.0/package.json).
- [Browser 1.6.0 scheme APIs](https://github.com/hyperjump-io/browser/blob/v1.6.0/lib/index.js), [cache/embedded retrieval](https://github.com/hyperjump-io/browser/blob/v1.6.0/lib/browser/browser.js), and [package exports/version](https://github.com/hyperjump-io/browser/blob/v1.6.0/package.json).

This preparation does not establish that the files parse, dependencies are acquired,
all error paths work, the engine is conformant, or any defect has been reproduced.
