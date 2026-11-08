# Compatibility platform — Requirements and delivery plan

Date: 2026-10-31. Status: documentation and skeleton only.

> **[Decided, 2026-10-31]** Independent local repository for Forge-like diagnostics, optional shared coordination and explicitly approved remediation. Reuse the existing DSH GUI and official services. This phase does not implement, install, launch or publish the platform.

## 1. Objective

Explain plugin-combination failures using identified evidence; preview bounded repair operations and execute them only with appropriate authority. Add managed coordination only for explicit multi-plugin consumers. Do not promise universal compatibility or same-process security isolation.

## 2. Current state and gaps

| ID | Source-backed current behavior | Required increment |
|---|---|---|
| D1 | Official configuration exports and runtime inspection exist | Normalize evidence and add cross-plugin findings rather than reimplement Loader |
| D2 | Schema export imports modules and may initialize profiles | Separate zero-execution static analysis from authorized isolated deep checks |
| D3 | Native effects own registrations | Optional managed-claim coordination with pre-admission and failure receipts |
| D4 | Native approval and plugin management exist | Approval-bound repair plan, stale-input rejection and verified recovery |
| D5 | Changes may require restart | Preserve actual application status; never equate saved with active |

Official pin: `ce7073d51254c26cd63b22a60835b8f948deb447` (0.2.2-alpha.2). Forge reference: mkiea/dsh-forge commit `b509f7c255169a2e27888b1adc0ead5b5ec31f04`. The official experimental forge package instead concerns PR/MR code-host operations and is not this analysis reference.

## 3. Functional requirements

### 3.1 Analysis (D1, D2)

Pipeline: identified inputs → evidence normalization → deterministic rules → findings → optional plan. Reuse official configuration and inventory outputs where available. Missing observations mean unknown, not safe. Schema collection is not activation evidence: imports and lazy builders can execute code even when apply and `!!js` evaluation are absent. Run deep inspections only in explicitly selected isolated profiles/processes; do not implicitly inspect an untrusted package by importing it.

Do not adopt Forge's expression-evaluating `node:vm` scan fallback or independent HTTP-server mode. New GUI views add findings, comparison and preview rather than duplicating the native inventory or Skill Hub. Client registration signatures remain unverified until implementation review.

### 3.2 Optional coordinator (D3)

Implement as an ordinary Cordis service with declared injection and native effect ownership. Per-service `isolate(name, label?)` is not a sandbox. Coordinate only claims routed through this service; no global interception or monkey patch. Required missing coordination rejects activation. Unknown cleanup outcomes retain diagnostics; timeout cannot forcibly terminate a hung fiber. Do not replace host registrations with a second global registry.

### 3.3 Approved repair (D4, D5)

Pipeline: plan → preview → explicit approval → revalidate → backup → bounded action → verify → receipt/recovery. Bind the approval to target and exact operation digest. Recheck actual inputs immediately before mutation. If the native operation has no compatible atomic compare-and-set, document the race limitation and refuse any operation whose required precondition cannot be enforced safely.

Use native plugin-manager operations for actions it owns, native version gates and native approvals for agent-side operations. Design operator GUI authority separately; do not manufacture an open turn or treat every click as approval. Separate configuration, install, script execution and restart permissions. No arbitrary shell strings from findings. A receipt records applied/restart-required/failed/cancelled/unknown outcomes as appropriate. Recovery must not overwrite later user edits or promise reversal of package scripts and external effects.

## 4. Conceptual data and dependencies

| Entity | Fields | Authority |
|---|---|---|
| Snapshot | target, host version, source kind, input digests, observed time | Collector plus actual host outputs |
| Finding | rule, affected entities, evidence class, confidence, references | Deterministic rule over snapshot |
| Repair plan | target, operations, expected hashes/revision, approvals, recovery limits | Planner; not an execution grant |
| Receipt | approval reference, operation results, application status, verification | Executor and verifier |

Consume protocol contracts from dsh-compat-spec and applicable helpers from dsh-plugin-kit using explicit versions. Neither protocol nor kit depends on this platform. Do not use sibling path imports or the original research checkout as runtime dependencies. Wire schemas and registry revision semantics are still pending.

## 5. Delivery and acceptance

- [x] Establish documentation and empty analyzer/runtime/host/client/fixture/test directories.
- [ ] P0: agree first target version and read-only evidence adapters.
- [x] P1: static analysis and CLI/JSON output; no imports of analyzed plugins. **Static slice accepted** — Lead independently ran 59 tests and clean/conflict CLI fixtures with the actual protocol validator (exit 0/1). The explicitly selected validator and its dependencies execute trusted code; they are not sandboxed. Determinism requires a deterministic validator. Implemented as `packages/analyzer/` (`dsh-compat-platform@0.0.0`): finding codes `INVALID_DECLARATION`, `DUPLICATE_PLUGIN_ID`, `RESOURCE_CONFLICT`, `MISSING_CAPABILITY` (a duplicate-provider code was removed: an optional requirement is a requirement, never a provider); `evidenceLevel: "static-declaration"`; validator injected explicitly (`analyze(input, { validateDeclaration })`, CLI `--validator <path>`); the input envelope is exactly `{ declarations, availableCapabilities }` with raw declarations (no `{value}` wrapper, no caller-supplied index); `availableCapabilities` is required and typed, `[]` is an explicit empty set and there is no unknown-availability state; a resource conflict requires the complete `[kind, name, scope]` tuple to be identical; invalid declarations suppress all dependency findings. Output is byte-deterministic for identical input and independent of declaration order **for valid input only** — reordering input that mixes valid and invalid declarations changes the reported positions, which is documented and tested rather than promised away. No repair path and no host/environment access exist in this stage. See [the analyzer README](../../packages/analyzer/README.md).
- [ ] P2: isolated schema/runtime observations, cross-plugin fixtures and source-labelled unknown states.
- [ ] P3: minimal managed claims only if the pilot needs them; test concurrent admissions, cleanup errors, timeouts and late writes.
- [ ] P4: approved narrow repair, stale-plan and concurrent-edit rejection, honest application/recovery receipts.
- [ ] P5: GUI integration and separately approved installation/upgrade operations.

Acceptance includes denial tests, changed-plan reapproval, no unauthorized writes, independent postcondition reads, actual Loader/profile composition and browser checks for UI. Tests of the old prototype do not certify this new platform.

## 6. Risks and pending decisions

| Risk | Mitigation |
|---|---|
| Analyzer executes hostile code | Pure static tier; explicit isolated deep tier |
| False positive causes destructive repair | Evidence/confidence, preview, narrow operations and fail-closed authority |
| Native API lacks desired transaction | Capability-check and refuse unsupported guarantees |
| Too much scope | Ship read-only analysis before coordinator and mutation |
| Unmanaged plugins bypass coordination | State guarantee boundary in every relevant report |

**[Pending]** License, npm scope, first host version, pilot plugin combination, GUI authority model and measurable performance budgets. Recommendation: first release read-only; no arbitrary upgrades, automatic restart or compatibility exemptions.

## 7. Layout

`packages/analyzer/`, `packages/runtime/`, `packages/host/` and `packages/client/` reserve implementation roles, not published package names. `fixtures/` and `tests/` reserve isolated scenarios. No active server or executable package exists yet.

## Appendix A. Sources

- [Schema export: execution and profile-write caveats, lines 1–47](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/apps/cli/src/dump-config-schema.ts#L1-L47).
- [PluginManager.change application status, lines 1260–1285](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/boot/plugin-manager/src/index.ts#L1260-L1285).
- [Native fail-closed approval semantics, lines 5–33](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/docs/subsystems/approval.md#L5-L33).
- [Forge evaluator and parser](https://github.com/mkiea/dsh-forge/blob/b509f7c255169a2e27888b1adc0ead5b5ec31f04/core/composition.js).
- [Official effects teardown](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/vendor/cordis/src/fiber.ts#L712-L745).
