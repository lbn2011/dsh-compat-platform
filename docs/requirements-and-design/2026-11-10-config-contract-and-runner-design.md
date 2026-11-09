# Configuration contracts and shared bounded runners

Date: 2026-11-10. Status: design in progress; no implementation or dependency installation authorized by this document alone.

> **Decided by the user (2026-11-10):** extend the declaration protocol with a configuration contract; extract a shared bounded-runner core and migrate existing maintained runners; commit throughout development.
> **Confirmed semantics:** full JSON Schema 2020-12 with self-contained references, including dynamic references; explicitly enumerated format assertions, unknown formats refused; new declaration revision requires a contract while old declarations remain supported; diagnostic output may disclose configuration key paths, never values. Missing configuration, old declarations without a contract, and opaque expressions are not checked; no defaults or coercion. Exit 2 for incomplete checking, 1 for actual mismatch, 0 only when all requested checks complete without mismatch.

## 1. Requirement

Implement a separate configuration-checking path bound to explicit caller-asserted correspondence. Do not reinterpret the existing profile summary or correspondence command as configuration validators. Migrate the maintained bounded launchers to common safety machinery without rewriting historical evidence.

## 2. Current state and evidence

- `../../../dsh-compat-spec/src/index.js:13,43-48,377-437` fixes one legacy revision and four closed root fields. `validateDeclaration` currently rejects future revisions and additional fields.
- `../../../dsh-compat-spec/docs/DEVELOPMENT.md:17-18,24-30,49-50` requires a zero-dependency, import-free core and code-generated schema. A full schema engine must not be silently introduced into that core.
- `2026-11-09-correspondence-design.md:74-80,109-111` excludes configuration-value comparison and identity disclosure. New key-path disclosure belongs only to the new command.
- `../../packages/analyzer/src/correspondence.js` checks a declarations array but does not establish spec conformance; its first matching declaration is not an ambiguity policy suitable for configuration checking.
- `../../scripts/correspondence-batch/run.sh:180-304` provides a reference for one launch, terminal confirmation, selected-input hash comparison and evidence-write precedence.
- `../../scripts/trusted-extraction-batch/run.sh:30-52` merely records hash drift and terminal state rather than failing on them. Migration must explicitly strengthen these gates, not claim behavioral equivalence.

## 3. Gaps

| ID | Current | Required |
| --- | --- | --- |
| D1 | Only legacy declaration revision | Explicit revision dispatch and mandatory new-revision contract |
| D2 | No schema engine | Full chosen dialect, offline resolution and enumerated formats |
| D3 | Text-free shape summaries | Separate path-aware checking with no value disclosure |
| D4 | First-match declaration lookup | Validated and unambiguous correspondence target |
| D5 | Repeated runner implementations | Shared lifecycle, readback, evidence, hash and TAP primitives |
| D6 | Unequal safety checks | Fail-closed gates and preserved workload-specific isolation |

## 4. Proposed implementation

### 4.1 Protocol (D1–D4)

New revision: `0.2.0-draft.1`, with required root `configSchema` (boolean or object); keep explicit legacy validation semantics. `PROTOCOL_VERSION`, `PluginDeclaration`, `declarationTemplate()` and `declarationJsonSchema()` remain legacy. Add `CONFIG_SCHEMA_PROTOCOL_VERSION`, `SUPPORTED_PROTOCOL_VERSIONS`, `ConfigPluginDeclaration` / `SupportedPluginDeclaration`, and explicit `declarationJsonSchemaForVersion(version)`. Separate declaration-envelope validation from full embedded-schema validation; neither success may be described as the other. Implementation is under review and has not yet been tested.

A new platform command consumes the original supplied profile text, declaration text and digest-bound correspondence. Validate the declarations and reject ambiguous declaration identities. Use bounded parsing and schema compilation/evaluation; never evaluate YAML expressions. A missing configuration is not an empty object. Preserve absent, null and expression-backed configurations as different cases.

Output uses fixed codes and escaped configuration key paths only. Never forward validator messages, schema values, enum candidates, offending values or exception text. Paths are an explicitly approved disclosure and can themselves contain sensitive names; documentation must state this.

Candidate to qualify: `@hyperjump/json-schema@1.18.0` with explicit peer `@hyperjump/browser@1.6.0`, in a separate platform checker package, not the pure spec package. Source review supports URI-bearing dynamic references and embedded resources; this is not executed conformance evidence. Ajv 8.20.0 was not selected because its dynamic-reference implementation rejects non-fragment references.

**User-confirmed format list:** date-time, date, time, duration, email, idn-email, hostname, idn-hostname, ipv4, ipv6, uri, uri-reference, iri, iri-reference, uuid, uri-template, json-pointer, relative-json-pointer, regex. Use the full formats module, not formats-lite. Unknown formats must be rejected during schema-aware admission, including unused definitions: the candidate engine otherwise accepts unknown formats. Do not scan objects inside const/default/examples as schemas.

Candidate offline mechanism: import the 2020-12 dialect and its local metaschemas, remove the browser's http/https/file URI-scheme plugins before handling supplied schemas, then register only admitted local resources. Fresh confined subprocesses prevent shared global registry state between checks. A schema URI is an identifier, not permission to fetch. Qualification must test dynamic scope, embedded URI references, unresolved references, unknown formats, immutable instances and value-safe errors. No dependency has been installed yet.

**Qualification hold, reproduction and user decision (2026-11-10):** tagged Hyperjump `lib/schema.js` recursively interprets identifier keywords in data literals, with `const`/`enum` comparison consequences suggested by source and [upstream PR 125](https://github.com/hyperjump-io/json-schema/pull/125). A bounded reproduction has now been executed: 14 of 22 fixed cases reproduced while the scalar and dynamic-reference controls stayed correct (`docs/testing/2026-11-10-config-engine-reproduction.md`). SchemaSafe 1.3.0 is not a drop-in replacement: tagged sources omit four selected formats and expose URI/anchor/output-pointer limitations. The user selected bounded reproduction first, then a separately reviewed minimal patch proposal if reproduced. Reproduction has not authorised a third-party patch, a semantic restriction or production promotion. Acquisition is not engine qualification: no conformance result exists.

Research references: [tagged dialect implementation](https://github.com/hyperjump-io/json-schema/blob/v1.18.0/draft-2020-12/dynamicRef.js), [tagged format implementation](https://github.com/hyperjump-io/json-schema/blob/v1.18.0/draft-2020-12/format.js), [browser cache and retrieval](https://github.com/hyperjump-io/browser/blob/v1.6.0/lib/browser/browser.js).

### 4.2 Runner core (D5–D6)

Current maintained scope is twelve launcher/payload pairs, not five:

- Platform: profile-dump-batch, diagnose-batch, dependency-shape-batch, correspondence-batch, repair-plan-batch, diagnose-real-wiring, diagnostics-gui-run, profile-dump-retained-export, profile-dump-install, package-install, trusted-extraction-batch.
- Spec: spec-test-batch.

Shared primitives: one launch, shared nonblocking lock, exact effective resource readback, one memory gate, mandatory evidence writes, terminal confirmation, immutable selected-input hashes, strict singleton TAP summary parsing. Preserve special workload exit codes as explicit policy instead of mapping all unknown codes to success.

Implementation choice after read-only review: maintain the canonical core in platform `scripts/bounded-runner/` and a pinned, byte-identical vendored copy in spec `scripts/bounded-runner/`. Synchronization is an explicit maintainer operation, never a runtime sibling lookup or network fetch. A manifest records the core ABI/version, upstream revision and relative file digests; each repository verifies its own copy. The manifest is included in run hashes but does not hash itself.

Core boundaries: `common.sh` (strict parsers and evidence helpers), `policy.sh` (bounds and unit-family registry), `host.sh` (lock, one launch, hashes, journal, terminal confirmation and verdict precedence), and `envelope.sh` (effective limits, memory gate, peaks). Keep workload-specific commands and sandbox policies in each payload; do not introduce eval-based command strings.

Every transitively sourced control file and its manifest must enter the before/after hashes. Distinguish runner-control closure from workload/dependency closure. Migration order: profile-dump and spec pilots; diagnose/dependency-shape/correspondence/repair; real wiring and retained captures; GUI; acquisition and packaging; trusted extraction with its safety uplift explicitly recorded.

Keep workload modes separate: inert tests, HTTP carrier with host networking, offline package installation, online pinned acquisition, and trusted fixture execution. Do not rerun the YAML installer against its existing target. Do not modify retained historical scripts or claim new hashes were measured in old rounds.

## 5. Data provenance

Identity remains caller-asserted and bound to supplied text digests, not discovered from order or module names. Schema rules come from the author-supplied contract. Matching a contract does not prove host acceptance, readiness, capability satisfaction or loadability. Certification remains false.

Runner records must identify wrapper/core/policy hashes, requested and effective limits, original substep exits, final verdict, terminal readback, measured peaks, failures and process deviations. A successful source audit is not execution evidence.

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Engine supports only part of the chosen dialect | Verify official implementation limits; test dynamic-reference cases; refuse unsupported required vocabularies |
| Schema compilation, recursion or regex exhausts resources | Isolate compilation and evaluation with verified memory/CPU/deadline limits; timeout is not mismatch |
| External reference fetch | Register only supplied resources and enforce deny-by-default external resolution |
| Error output leaks values | Closed projection of errors; sentinel tests including schema literals and input values |
| Shared core change invalidates many consumers | Version core, hash dependencies, migrate and measure each wrapper serially |
| Historical evidence overwritten | Append later-change notes and create fresh records; retain every failed round |
| Installation or trusted workloads get weaker isolation | Explicit mode-specific policies and negative tests before real fixture execution |

## 7. Pending decisions and investigations

1. Engine: Hyperjump 1.18.0/browser 1.6.0 acquired from a reviewed lock (12 packages, all MIT); the identifier-in-literal defect is reproduced (14/22 cases). Executed conformance and any patch remain pending; the installed tree is a disposable artifact directory, not a dependency of this repository.
2. Format set: the nineteen names in §4.1 are user-confirmed. Unknown required vocabularies must refuse; ordinary unknown annotation keywords must not gain executable semantics. Detailed admission tests remain pending.
3. Core distribution: selected pinned identical repository-local copies after architecture review (§4.2); manifest ABI and sync/check implementation remain to be specified.
4. Schema envelope API and revision dispatch: specified in §4.1 and implemented for review; legacy/generated-schema regression verification remains pending.

## 8. Landing and staged commits

1. Commit researched design/inventory with pending items explicitly marked.
2. Implement pure protocol version dispatch, types and vectors; preserve legacy vectors.
3. Implement separately contained schema checker and path-safe output; record dependency acquisition.
4. Implement shared core with negative harness tests; migrate simple runners, then integration/acquisition runners, then explicitly uplift trusted extraction.
5. Execute reviewed workloads serially under hard limits; delegate each acceptance record to a subagent, Lead reviews it.
6. Commit and push each reviewed slice in its owning repository, preserving old records. Do not mark the goal complete until protocol/checker and all twelve migrations are verified.

> **Migration status (2026-11-10):** all twelve pairs are migrated to core `c8123de`. Eleven were executed under the envelope and passed; `profile-dump-install` refused by design because its target already exists, so its migrated success path is unverified. Records: `docs/testing/2026-11-10-runner-migration-simple-suites.md`, `…-complex-suites.md`, `…-install-suites.md` (platform) and `projects/dsh-compat-spec/docs/testing/2026-11-10-config-contract-runner-pilot.md`. The configuration checker is **not** implemented; only the protocol revision and the engine reproduction exist.

## Appendix A. Quick reference

| Concern | Location |
| --- | --- |
| Legacy protocol dispatch | spec `src/index.js:377-437`, `validateDeclaration` |
| Pure-core rule | spec `docs/DEVELOPMENT.md:49-50` |
| Existing confidentiality promise | platform correspondence design §4–5 |
| Launcher verdict precedence | platform `scripts/correspondence-batch/run.sh:268-304` |
| Weak launcher needing uplift | platform `scripts/trusted-extraction-batch/run.sh:30-52` |
