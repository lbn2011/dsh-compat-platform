# Profile dump summary — read-only diagnostic design

> Version: v1.0-draft　　Date: 2026-11-08　　Related modules: `packages/analyzer`, `dsh-compat-spec`
>
> **[Decided, 2026-11-08]** — recorded from the authorising instructions for this round:
> - **Input format**: support the YAML that `dsh --profile <name> --dump-config` writes to stdout. Do **not** invent a new snapshot format, do **not** add CLI aliases for it.
> - **Parser**: a mature YAML parser at an exactly pinned version — `yaml: "2.9.1"` — not a hand-written parser.
> - **Output**: a **safe summary only** — ordinals, line numbers, counts and fixed codes. No ids, no names, no origin labels, no configuration key names, no values, no `!!js` expression text, no error messages.
> - **Document model**: parse the dump as **one document containing one sequence**. Do not split on the `# == ` comment lines, and do not report source/layer grouping in this version.
> - **No evaluation**: never call `toJS()`, `toJSON()` or `parse()`. `!!js` values stay opaque.
> - **Read path**: reuse the bounded-read semantics already implemented in `packages/analyzer/src/evidence-cli.js` rather than writing a second reader.
> - **Untouched**: the combined-report lanes, `dsh-compat-spec`, `dsh-plugin-kit`, `dsh-agent-test-driver`, and every `combined-*`/`snapshot-*`/`admission-*` code path.

## 1. Objective

`dsh --profile <name> --dump-config` is the only way a user can show what a profile actually
composes. Today that output can only be read by eye: the platform has four CLIs and none of them
accept it, and the closest lane (`--static`) deliberately takes a *declaration document*, which is a
different artefact.

This round adds **one** read-only command, `dsh-compat-profile-dump`, that answers a deliberately
narrow question:

> Does this dump parse, what is its coarse shape, and which structural facts should a reader stop
> and look at?

It is not a loader, not a validator, and not a compatibility verdict. It cannot say whether a
plugin would load, whether a `config` block matches its plugin's schema, or what a `!!js`
expression would evaluate to.

## 2. Current state (evidence-backed)

### 2.1 Existing entry points

```
dsh-compat-analyze   → src/cli.js            --validator <m> <manifest.json |->
dsh-compat-report    → src/combined-cli.js   --static/--runtime/--admission + validators
dsh-compat-compare   → src/compare-cli.js    --before <snap> --after <snap>
dsh-compat-admission → src/admission-cli.js  <document.json> --validator <m>
```

Declared in `packages/analyzer/package.json` (`bin`, `exports`; every library export carries a
`types` entry, e.g. `./snapshot-diff` → `./src/snapshot-diff.d.ts`).

`--static` consumes a **declaration document** (`src/combined-cli.js`), not the output of
`dsh-compat-analyze`; the two are parallel, not chained. As analysed, before this round, nothing in
the package read YAML and `packages/analyzer/package.json` had `"dependencies": {}`; this round adds
exactly one pinned dependency, `yaml: "2.9.1"`, and no other (§4.1).

### 2.2 What the export actually is

```
dsh --profile <name> --dump-config                 // apps/cli/src/args.ts:171
  └─ runDumpConfig()                               // apps/cli/src/dump-config.ts:37-48
       └─ renderConfigDump()                       // packages/boot/app-boot/src/index.ts:631
            └─ groupedDump()                       // packages/boot/app-boot/src/index.ts:697-725
                 └─ yaml.dump(group, { schema: entryListSchema, noRefs: true })   // :707
```

- Output goes to `process.stdout.write` (`apps/cli/src/dump-config.ts:47`); there is no output file.
- `groupedDump` prefixes each contiguous run with one `# == <label>` comment line (`index.ts:706`),
  where the label is an origin name, or `<origin>, patched by <paths>` (`index.ts:714-716`).
- **The whole export is still a single YAML document.** Comments do not delimit documents, so a
  root-level analysis sees one sequence whose items are the rows of every group concatenated.
- `groupedDump` with no composed entries returns `lines.join('\n') + '\n'` over an empty array —
  i.e. a single newline (`index.ts:722`). An empty export therefore parses as an **empty document**,
  not as an empty sequence, and not as an error.
- `noRefs: true` (`index.ts:707`) means a genuine dump contains no anchors and no aliases.
- `entryListSchema` = `yaml.JSON_SCHEMA.extend(JsExpr)` (`build-checkout/vendor/include/src/index.ts:23`),
  where `JsExpr` maps `tag:yaml.org,2002:js` to `{ __jsExpr: text }` (`.../cordis-plugin-include/src/index.ts:9-16`).
  The expression is **rendered, not evaluated**; a fixture states this explicitly in
  `profiles/script-probe/cordis.patch.yml:4-8`.

### 2.3 What an entry may contain

`EntryOptions` (`build-checkout/vendor/loader/src/config/entry.ts:10-23`):

| Field | Type | Note |
|---|---|---|
| `id` | `string` | stable id inside the containing entry tree |
| `name` | `string` | module specifier imported by the entry tree |
| `config` | `any` | arbitrary plugin configuration |
| `group` | `boolean \| null` | marks a nested group whose `config` is itself an `EntryOptions[]` |
| `disabled` | `boolean \| null` | prevents this entry and descendants from running |
| `inject` | `Inject \| null` | service requirements / intercept config |

`EntryGroup.create()` takes `Omit<EntryOptions, 'id'>` and calls `this.tree.ensureId(options)`
(`build-checkout/vendor/loader/src/config/group.ts:20-22`), so **an entry may legitimately have no
id in the file**: the id is assigned at load time. A dump that lacks `id` on some row is therefore
not, by itself, a defect.

### 2.4 Reusable asset: the bounded reader

`readEvidenceFile()` (`packages/analyzer/src/evidence-cli.js:182-242`) already implements exactly the
read semantics a new command needs:

- `openSync(path, O_RDONLY | O_NONBLOCK)`, then `fstatSync` on the **opened descriptor** (no path race);
- refuses non-regular files and anything above `MAX_EVIDENCE_BYTES = 1024 * 1024` (`:68`);
- reads to the cap, then probes **one extra byte** so a file exactly at the cap is accepted only if it
  ends there;
- decodes with `new TextDecoder('utf-8', { fatal: true })` (BOM consumed, invalid bytes refused);
- drops OS error text entirely, surfacing only its own fixed messages (`ERROR_TEXT`).

Dependency check for reuse: `src/evidence-cli.js:56-60` imports only `node:fs`, `node:path`,
`node:url` and `./runtime-evidence.js`; `src/runtime-evidence.js` has no imports of its own. The
module executes only under `isDirectInvocation()` (`:426-455`), so importing it has no side effects.
Reuse therefore costs three Node built-ins plus one dependency-free sibling module — no host packages,
no network, no new tree.

## 3. Gaps

| # | Gap | Current | Required here |
|---|---|---|---|
| D1 | No consumer for the export | four CLIs, none reads YAML | one command that reads a dump file |
| D2 | No YAML capability at all | `dependencies: {}` | one pinned dependency: `yaml@2.9.1` |
| D3 | No structural summary | — | counts, depth, ordinal/line located diagnostics |
| D4 | `!!js` has no representation outside DSH | unknown tag to any plain parser | recognised as **opaque text**, never evaluated, never printed |
| D5 | No policy for unexpected YAML features | — | anchors, aliases, merge keys, tag keys, unknown tags are refused, not tolerated |
| D6 | Empty exports are ambiguous | empty file, comment-only file and `[]` all differ | one explicit `empty` inventory state, explicitly **not** "healthy" |
| D7 | No multi-document policy | — | more than one document is refused |
| D8 | Bounded reads are duplicated if re-implemented | one reader exists | reuse it; do not fork it |

## 4. Design

### 4.1 Shape of the command (D1, D2, D8)

```
dsh-compat-profile-dump <file>
```

- exactly one explicitly named path; no stdin, no directory scan, no glob, no default path;
- reads through `readEvidenceFile()` (D8), so the 1 MiB and UTF-8 rules are the existing ones;
- attempts exactly one JSON document write on stdout — the only stdout output; if that single
  write fails the command exits `5` and does **not** retry, because there is never a second
  document;
- writes nothing, imports nothing from the input, spawns nothing, opens no socket.

Package changes: `dependencies: { "yaml": "2.9.1" }` (exact, no range), one `bin` entry, one
`exports` entry with a `types` sibling, mirroring the existing library entries.

### 4.2 Parse pipeline

```
text ──▶ limits: bytes / lines                        (before parsing)
     ──▶ parseAllDocuments(text, { version: '1.2', schema: 'core',
                                   resolveKnownTags: false, merge: false,
                                   uniqueKeys: true, prettyErrors: false })
     ──▶ document count: 0 → empty ; >1 → refuse      (explicit, not from the library)
     ──▶ stream errors: any → refuse, codes + lines only
     ──▶ stream warnings: every remaining one → refuse
     ──▶ root shape: sequence of mappings
     ──▶ iterative walk: counts, depth, tag allowlist, id/name types, duplicate ids
     ──▶ summary object ──▶ JSON on stdout
```

Notes that matter:

- **`parseAllDocuments`, never `parseDocument`.** `MULTIPLE_DOCS` is added by `parseDocument` only
  and is conditioned on `logLevel !== 'silent'`; relying on it would make multi-document input
  depend on a logging option. Counting the returned array is unconditional.
- **Never `parse()`, never `toJS()`, never `toJSON()`.** `parse()` is the only entry point that logs
  to the console, and `toJS()` is the only one that resolves aliases and expands them.
- **Never `logLevel: 'silent'`** — in this library that option also suppresses real errors.
- `resolveKnownTags: false` keeps `!!timestamp`, `!!binary`, `!!omap`, `!!pairs`, `!!set` from being
  silently resolved into ordinary values, so the tag allowlist in §4.3 sees them.
- `merge: false` is the YAML 1.2 default and is set explicitly so a future default change cannot
  turn `<<` into a silent merge.
- `uniqueKeys: true` is the library default (`resolve-block-map.ts`, `mapIncludes(...)` →
  `DUPLICATE_KEY`) and is set explicitly for the same reason.
- **An empty stream is an empty *array*, not a null document.** For whitespace-only or comment-only
  input, `parseAllDocuments` returns `Object.assign([], { empty: true }, composer.streamInfo())`
  (`v2.9.1` `public-api.ts`) — an empty array carrying the stream's own `errors` and `warnings`.
  Those two properties are read explicitly (with `documents[0]` used only when there is exactly one
  document); reading `documents[0]` alone would turn a clean empty export into a refusal and would
  drop a stream-level `%directive` error entirely. `'\n'` — exactly what `groupedDump` writes for an
  empty export — reaches this path.

### 4.3 Tag policy (D4, D5)

Every scalar and collection node is checked against a **closed allowlist**:

| Accepted | Meaning |
|---|---|
| no tag | implicit resolution under `core` |
| `tag:yaml.org,2002:str` / `null` / `bool` / `int` / `float` | explicit scalar tags the dump can legitimately contain |
| `tag:yaml.org,2002:map` / `seq` | explicit collection tags |
| `tag:yaml.org,2002:js` on a **scalar** | the DSH expression form; kept opaque |

Everything else is refused with `UNSUPPORTED_TAG`, including `!!python/*`, `!!timestamp`, `!!binary`,
`!!omap`, `!!pairs`, `!!set`, local `!foo`, and any `tag:yaml.org,2002:js` attached to a **collection**
(which no dump produces). A tag on a **mapping key** is refused as `TAG_KEY_PRESENT`.

A `!!js` scalar is never read: the walk records only its ordinal and line. Its `value` is not
compared, hashed, counted per character or copied into the output.

`!!js` is not recognised by matching warnings to positions. A **local opaque scalar resolver** is
registered as a custom tag: a plain object shaped like the `ScalarTag` type
(`{ tag: JS_TAG, identify: () => false, resolve: (value) => value }` — required `tag` and
`resolve(value, onError, options)`; no `kind`, since `yaml@2.9.1` exposes only the `ScalarTag` /
`CollectionTag` *types*, not a `Tag` constructor), so the library never emits a `TAG_RESOLVE_FAILED`
warning for `!!js` and this module never has to
*infer* that a tag existed — an inference that goes wrong for block scalars whose tag and value sit
on different lines. Everything about a tag is decided from `node.tag`, which the composer always
records.

Warning handling is therefore uniform and conservative: **every** warning still present on the
stream is refused as `UNEXPECTED_WARNING`. Each is classified into a fixed word pair — `UNRESOLVED_TAG`
or `OTHER_WARNING` — taken from the warning's `code`, never its `message` (messages embed source
excerpts — see §4.6). No warning is ever matched to a `!!js` position or otherwise silently accepted.

### 4.4 Document, empty and multi-document policy (D6, D7)

| Input | Result | Exit |
|---|---|---|
| 0 bytes | `EMPTY_INPUT` diagnostic, `inventory: "empty"` | 0 |
| whitespace / comments only | empty stream (an empty array carrying stream `errors`/`warnings`); `contents === null` → `EMPTY_INVENTORY`, `inventory: "empty"` **only when the stream reported no error and no warning** | 0 |
| stream with a bad `%directive` (even on otherwise-empty input) | the directive's error/warning is on that same stream → refused as `PARSE_ERROR` or `UNEXPECTED_WARNING` | 2 |
| `[]` | `inventory: "empty"` (empty sequence) | 0 |
| one document, sequence | `inventory: "present"` | 0 or 1 |
| two or more documents | `MULTI_DOCUMENT` refusal, counts only | 2 |

An empty inventory is reported as empty and nothing more. It is **not** "healthy", **not** "no
plugins", and **not** "configuration is fine": `completeness` stays `"unknown"` in every case,
because a dump only reflects what the composing host chose to print.

### 4.5 Limits — and what each one actually bounds (D3)

Two different kinds, deliberately not conflated in either the output or the documentation:

| Limit | Where it acts | Bounds |
|---|---|---|
| `maxBytes` 1048576 | **before** parsing (the reader) | how much text can enter the process |
| `maxLines` 20000 | **before** parsing (counted on the decoded text) | pathological line counts, cheaply |
| `maxDepth` 32 | **after** parsing, during the walk | how deep a structure this command will describe |
| `maxNodes` 20000 | after parsing | total node budget for the walk |
| `maxEntries` 5000 | after parsing | top-level entry budget |
| `maxDiagnostics` 64 | while collecting | output size; sets `diagnosticsTruncated` |
| `maxRows` 64 | while collecting | size of the row **window**; sets `rowsTruncated`, never `counts.entries` |

The last five are **policy limits on what this command will report**. They do **not** bound the
parser's own resource use, and this document does not claim they do. Parsing cost is bounded only by
`maxBytes` and by the process envelope the command is run inside.

`yaml@2.9.1` has no parse-time depth option (confirmed against `src/options.ts`). It does convert a
stack overflow during *composing* a collection into a document error:
`compose-node.ts` wraps `composeCollection` in `try/catch` and emits
`onError(token, 'RESOURCE_EXHAUSTION', message)`. That is a **recovery path, not a guarantee**: it
covers the compose recursion, not the lexer/parser, and a `RangeError` that escapes is caught by
this command and reported as `RESOURCE_EXHAUSTION_UNCAUGHT` with exit 2.

### 4.6 Output contract

Exactly these keys, no others:

```json
{
  "profileDumpSummary": "profile-dump-summary/0.2-draft.1",
  "input": { "bytes": 812, "lines": 23 },
  "documents": 1,
  "inventory": "present",
  "root": "sequence",
  "counts": {
    "entries": 2, "entryGroups": 0,
    "entriesWithId": 2, "entriesWithName": 2, "entriesWithConfig": 2, "entriesDisabled": 0,
    "jsScalars": 2, "distinctTags": 2, "nodes": 14, "scalars": 11, "maxDepth": 4
  },
  "rows": [
    { "index": 1, "line": 2, "keyCount": 3, "idKind": "string", "nameKind": "string",
      "group": "absent", "disabled": "absent", "config": "mapping",
      "configKeyCount": 2, "unmodelledKeyCount": 0 },
    { "index": 2, "line": 9, "keyCount": 4, "idKind": "string", "nameKind": "string",
      "group": "false", "disabled": "true", "config": "mapping",
      "configKeyCount": 1, "unmodelledKeyCount": 1 }
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

The version string is `0.2-draft.1` because `rows`, `rowsTruncated`, `notDerived` and `limitations`
were added, and a closed-key-set consumer must be able to tell the two shapes apart from the
version alone. The counters are unchanged by that addition.

`rows` is a **capped display window** over `counts.entries`, never a second inventory:
`counts.entries` stays authoritative, the window holds at most `maxRows` entries, `rowsTruncated`
says when it is short, and `rows` is `null` exactly where `counts` is `null` — a refused document
must not look like a document with no entries. Each row is `{index, line, keyCount, idKind,
nameKind, group, disabled, config, configKeyCount, unmodelledKeyCount}` in that fixed order, where
`index` is 1-based, `idKind`/`nameKind` ∈ `absent|string|non-string`, `group`/`disabled` ∈
`absent|true|false|null|other`, `config` ∈ `absent|mapping|not-mapping`, and `configKeyCount` is a
number only when `config` is a mapping. The flag words are kept apart deliberately:
`disabled: "false"` is a setting, `disabled: "null"` is the legal "not set" form `EntryOptions`
declares (`boolean | null`), and `disabled: "other"` is a value this reader did not model — one
boolean would make a legal form, a setting and a typo indistinguishable.

`notDerived` (the five names from `NOT_DERIVED`,
`experiments/profile-export-fixture/observation.mjs`) and `limitations` (shaped like
`COMBINED_REPORT_LIMITATIONS`) are the guards on that window; both are per-summary copies so a
consumer may adapt its own copy without affecting the next. This is the landing point the
structured-profile-input boundary design asks for: process facts unchanged, rows opaque, row text
absent, `completeness` still `unknown`, `certification` still `false`.

Rules:

- `diagnostics[].ordinal` is the 1-based position of the top-level row the diagnostic belongs to, or
  `null` for document-level facts; `line` is a 1-based line number. Both are numbers.
- `code` is always one of the closed set exported as `PROFILE_DUMP_CODES`. No message text, ever.
- `detail`, when present, is a fixed word from a closed set — `JS_COLLECTION` / `CORE_NOT_ALLOWED` /
  `EXTERNAL` (tag refusals), `UNRESOLVED_TAG` / `OTHER_WARNING` (warning refusals), `DUPLICATE_KEY` /
  `PARSE_FAILURE` (parse errors) — never the tag text and never the library's message.
- The `1`-vs-`0` exit decision comes from an internal `entryDiagnostics` **counter**, not from the
  capped `diagnostics` list: the counter is incremented **before** the `maxDiagnostics` cap, so an
  entry-level problem in row 500 still yields exit `1` even when 64 informational diagnostics already
  filled the list.
- **No** id, name, origin label, `# ==` text, config key, value, expression text, or path appears in
  any field. `distinctTags` is a count, not a list.
- A **refusal** returns the same envelope with `inventory: "none"`, the refusal code(s), and no
  counts that could be mistaken for a complete inventory (`counts` is `null`).
- Diagnostics are capped at `maxDiagnostics`; when the cap is hit, `diagnosticsTruncated` is `true`
  and the result is *not* presented as complete.

### 4.7 Exit codes

| Code | Meaning |
|---|---|
| `0` | parsed; no entry-level diagnostics (`!!js` presence alone stays 0) |
| `1` | parsed, but at least one **entry-level** diagnostic (field type, duplicate id) |
| `2` | unusable: read failure, non-UTF-8, over limits, parse error, unknown tag, anchors/aliases, merge key, tag key, multi-document, root shape, walk limits |
| `5` | internal failure, including stdout write failure |
| `64` | usage error (missing/extra arguments, unknown flag) |

`2` and `1` are deliberately different: "cannot be read at all" must not be confused with "read fine,
look at row 7".

### 4.8 Entry-level checks, and what is explicitly not checked

Per top-level row (all located by ordinal):

| Check | Rule | Code | Exit |
|---|---|---|---|
| row is a mapping | required | `ENTRY_NOT_MAPPING` | 2 |
| `id` present | must be a literal string scalar | `ENTRY_ID_NOT_STRING` | 1 |
| `name` present | must be a literal string scalar | `ENTRY_NAME_NOT_STRING` | 1 |
| `id` non-empty and repeated | duplicate among top-level rows | `DUPLICATE_ID` | 1 |
| `!js` scalar anywhere | recorded only | `JS_EXPRESSION_NOT_EVALUATED` | 0 |

Explicit **non**-checks, stated because silence otherwise reads as approval:

- a **missing** `id` or `name` is not an error — `ensureId()` assigns ids at load time
  (`vendor/loader/src/config/group.ts:20-22`);
- `config` is never descended into as if it held entries — a nested group's `config` is
  `EntryOptions[]`, but this version does not analyse nested entries at all
  (`NESTED_ENTRIES_NOT_ANALYZED`);
- an `id` appearing **inside** a `config` block is never treated as a second plugin id;
- nothing here is a Loader validation result. Every code names an **observation about the document**.

## 5. Data sources

| Output field | Source |
|---|---|
| `input.bytes`, `input.lines` | the summariser measures these itself: `summarizeProfileDumpText(text)` takes **exactly one argument** (the decoded text) and computes `Buffer.byteLength(text, 'utf8')`, so a stripped BOM is not counted; newline count over that same text. No caller-supplied byte count is accepted — otherwise a caller could claim 0 bytes for a huge document and walk past the cap |
| `documents` | `parseAllDocuments(...).length` |
| `root` | node class of `doc.contents` (`sequence` / `mapping` / `scalar` / `null`) |
| `counts.entries` | number of items in the root sequence |
| `counts.entryGroups` | rows whose `group` is `true` |
| `counts.entriesWith{Id,Name,Config}` | presence of those keys on a row (`EntryOptions`, `vendor/loader/src/config/entry.ts:12-22`) |
| `counts.entriesDisabled` | rows whose `disabled` is `true` |
| `counts.jsScalars` / `distinctTags` | walk over scalar nodes' `tag` |
| `counts.nodes` / `maxDepth` | iterative walk |
| `rows[]` | first `maxRows` members of the root sequence, in file order; each is `buildRow(row, index, line)` over the same pairs `checkEntries` already visits, so a row can never describe a node the checks did not see |
| `rows[].line` | node `range[0]` of the row mapping, mapped through the same newline offsets as diagnostics |
| `rows[].unmodelledKeyCount` | keys outside `MODELLED_KEYS` (`id`, `name`, `config`, `group`, `disabled`) — counted, never named |
| `rowsTruncated` | true when the root sequence holds more members than `maxRows`; false when `rows` is `null` |
| `notDerived` / `limitations` | fixed lists copied per summary from `PROFILE_DUMP_NOT_DERIVED` / `PROFILE_DUMP_LIMITATIONS` |
| `diagnostics[].line` | node `range[0]` mapped to a line via newline offsets of the input text |

## 6. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Depth limits read as parse protection | post-walk limits cannot prevent parse-time exhaustion | §4.5 states the split; README repeats it; the command runs under the batch envelope |
| `RESOURCE_EXHAUSTION` read as a guarantee | it covers compose recursion only | documented as recovery, plus `catch (RangeError)` → `RESOURCE_EXHAUSTION_UNCAUGHT` |
| Error text leaking source | `YAMLError.message` is appended with a source excerpt by `prettifyError` | only `code`, `pos`/`linePos` and counts leave the module; `prettyErrors: false`; a test asserts no message text reaches stdout |
| Warning classification too clever | matching warnings to `!!js` scalars by position could mis-match | not done: a local opaque resolver pre-empts `!!js` warnings, and **every** remaining warning is refused, never matched or accepted |
| New dependency changes the package's posture | platform is currently dependency-free | exact pin `2.9.1`, one dependency, no transitive dependencies, ISC licence, no install scripts |
| Layer information lost | not splitting on `# == ` means "which layer is this row from" is unanswerable | not claimed anywhere; the reader is told the summary is flat |
| Summary is fingerprintable | `bytes`/`lines` can confirm "is this my file" | acceptable: no content, no hash; documented |

## 7. Open items

1. **[Decided, limited validation, 2026-11-08] `yaml@2.9.1` under Node 24** — `engines` declares
   `>= 14.6`. A bounded single-file run under Node 24 executed only this lane's own
   `tests/profile-dump.test.js` and passed `65/65` (`0` fail); record:
   [`docs/testing/2026-11-08-profile-dump.md`](../testing/2026-11-08-profile-dump.md). This is
   limited validation of **one file on one Node version** — not a full-suite run, and not
   host-integration, cross-version or packaging certification. Boundaries still **Pending**: a real
   `dsh --dump-config` export end to end, hostile/non-UTF-8/over-limit inputs, and `yaml` across
   Node versions.
2. **[Decided, 2026-11-08] warning handling** — no warning-to-scalar matching. A local opaque
   `!!js` scalar resolver removes the library's `TAG_RESOLVE_FAILED` noise, and any remaining
   warning is refused as `UNEXPECTED_WARNING`. The earlier "position matching" fallback is dropped.
3. **[Pending] line mapping** — computed from newline offsets over the retained text; no `LineCounter`
   dependency. Revisit only if offsets ever disagree with the library's own positions.

## 8. Implementation outline

```
dsh-compat-profile-dump <file>            // packages/analyzer/src/profile-dump-cli.js
  ├─ readEvidenceFile(path)               // src/evidence-cli.js:182-242 (reused, unchanged)
  ├─ summarizeProfileDumpText(text)       // src/profile-dump.js  (new, pure)
  │    ├─ line/byte limits
  │    ├─ parseAllDocuments (yaml@2.9.1)
  │    ├─ document count / errors / warnings
  │    ├─ root shape
  │    └─ iterative walk → counts, diagnostics
  └─ one JSON document on stdout, exit code per §4.7
```

New/changed files:

| File | Kind | Responsibility |
|---|---|---|
| `packages/analyzer/src/profile-dump.js` | new | pure text → summary; owns limits, codes, policy |
| `packages/analyzer/src/profile-dump.d.ts` | new | types for the library surface |
| `packages/analyzer/src/profile-dump-cli.js` | new | argv, read, print, exit codes, internal-failure path |
| `packages/analyzer/tests/profile-dump.test.js` | new | unit tests over the pure API, CLI tests, privacy assertions |
| `packages/analyzer/package.json` | edit | `dependencies.yaml` → `yaml: "2.9.1"`, one `bin`, one `exports` |
| `packages/analyzer/README.md` | edit | one section: contract, exit codes, limits, non-claims |

Not touched: `combined-report.js`, `combined-cli.js`, `snapshot-diff.js`, `compare-cli.js`,
`admission-*`, `evidence-cli.js`, `dsh-compat-spec`, `dsh-plugin-kit`, `dsh-agent-test-driver`.

## Appendix A: quick reference

| Item | Location |
|---|---|
| Export command | `apps/cli/src/args.ts:171` → `apps/cli/src/dump-config.ts:37-48` |
| Grouped dump | `packages/boot/app-boot/src/index.ts:697-725` (label `:706`, dump `:707`, empty `:722`) |
| Entry schema | `build-checkout/vendor/loader/src/config/entry.ts:10-23` |
| Anonymous id assignment | `build-checkout/vendor/loader/src/config/group.ts:20-22` |
| `!!js` tag definition | `build-checkout/vendor/include/src/index.ts:23`, `cordis-plugin-include/src/index.ts:9-16` |
| Bounded reader | `packages/analyzer/src/evidence-cli.js:182-242`, cap at `:68` |
| CLI import chain | `packages/analyzer/src/evidence-cli.js:56-60` → `./runtime-evidence.js` (no imports) |
| Library error codes | `yaml@2.9.1` `src/errors.ts` (`ErrorCode` closed union, `code`/`pos`/`linePos`) |
| Stack-overflow recovery | `yaml@2.9.1` `src/compose/compose-node.ts` (`RESOURCE_EXHAUSTION`) |
| Duplicate-key detection | `yaml@2.9.1` `src/compose/resolve-block-map.ts` (`DUPLICATE_KEY`) |
