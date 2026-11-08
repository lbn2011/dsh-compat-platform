# Trusted extraction — isolated execution design

> Date: 2026-11-09 · Status: **draft, reviewed on 2026-11-09; not implemented or executed**
>
> **[Decided] User direction (2026-11-09):** design a separately disclosed trusted-extraction path (D-B) after the inert dependency-shape entry and diagnose baseline projection. This task produces a design document, not permission to execute a target.
>
> **[Decided] Existing constraints:** preserve inert analyzers, keep production profiles and port 3080 untouched, retain failed evidence, and commit development in bounded increments. No automatic installation or repair.
>
> **[Review status]** The recommendations below were reviewed on 2026-11-09 against the installed build; the remaining `[Pending]` items are listed in section 7 and are not decided by that review. “Trusted” means an explicitly selected execution target; it is not a sandbox guarantee or a certification.
>
> **[Decided 2026-11-09, after review]** The three review items were assessed against the installed build (sections 9 and 9.4). Outcome: fixture-only first version **conditionally approved with a tighter target allowlist**; isolation policy **approved as a design, with five hard gates before the first launch**; official lifecycle observation **approved, revised upward by the second pass** — `@deepseek-ai/dsh-app-boot` exports per-entry outcomes (`active` / import-failed / activation-failed / pending-for-services / disabled), so v0 reports those instead of "not observed", while still claiming no business readiness.

## 1. Requirement and scope

Address G8 in [the P2 gap review](2026-11-09-p2-gap-review.md): record what happens when a specifically selected configuration is evaluated through a reviewed DSH execution surface. Do not infer loadability from inert YAML counts, service-name declarations, successful export, or a process exit code.

The proposed first delivery is a **fixture-only isolated profile-execution experiment**, producing a private receipt and a text-free public summary. The report describes observations at a pinned runtime and input selection, not a universal `loadable: true` property. Arbitrary user profiles, identity matching (D-A/G9), dependency satisfaction, repair, browser integration and package installation remain outside this increment.

“Read-only” applies to production inputs and recommendations. Evaluated code may write inside disposable scratch space and may attempt other effects; claiming that the execution itself is inert would be false.

## 2. Current state and reusable assets

### 2.1 Evidence-backed execution chain

Read-only source inspection found this chain in the upstream mirror (not a claim about the installed build):

```text
.cache/upstream/vendor/loader/src/config/entry.ts:213 Entry.init()
  -> :225 Entry._init()
  -> :228 parent.tree.import(options.name)
       .cache/upstream/vendor/loader/src/config/tree.ts:113 EntryTree.import()
         :114-115 cordis: builtin lookup
         :122-129 internal importer / relative import / resolver + dynamic import
  -> :233 loader.unwrapExports(moduleNamespace)
  -> :234 _patchContext([])
  -> :236 registry.plugin(plugin, options.config, getOuterStack)
```

**Critical pitfall:** `Entry._init()` catches an import exception, logs it and returns at lines 229–232. `Entry.init()` also attaches a catch to the fiber await at line 219. A resolved `init()` call or process exit 0 therefore does not establish successful import, activation or readiness. Log prose is not an acceptable machine-readable substitute.

**Confirmed in the installed build (2026-11-09 review).** `/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js:568-593` shows the same shape: `init()` attaches `this.fiber?.await().catch(() => {})`, and `_init()` awaits `parent.tree.import(...)` inside a `try` whose `catch` only calls `ctx.logger.error(error); return;` — so on import failure no fiber is created and no structured event is emitted. Two further constraints from the same review: `FiberState` is a `const enum` and is **not** among the runtime exports of `@deepseek-ai/cordis` (`lib/index.js:1901`), so plain JavaScript cannot import it; and `Fiber.await()` (`lib/index.js:727-731`) only drains `inertia` and rethrows `_error`, then returns the fiber — it does not imply `ACTIVE`.

**But the loader is not the only surface (2026-11-09, second pass).** `@deepseek-ai/dsh-app-boot` publishes an exported, structured view of the same facts, so a failed import is recoverable **without** parsing log text: `inactiveEntries(ctx, importNow)` classifies each entry as `failed` (with `phase: 'failed to import'` and the original error recovered by `importFailure(entry)`, which re-runs `tree.import` and reads Node's module cache) or `pending` (with the list of unprovided injected service names); `captureStartupComposition(ctx)` returns up to 256 `{id, module, version, state, source, missing[]}` rows; `auditStartupEntries` raises a `StartupError` carrying those rows. See section 9.2 for line references and section 9.3 for what this changes.

The mirror's extension signatures must be reconciled against the exact installed artifact before use. Private loader methods in this chain are explanatory evidence, not approved adapter APIs.

### 2.2 Existing assets and limits

| Asset | Evidence | Reuse / limitation |
| --- | --- | --- |
| Isolated export orchestration | `experiments/profile-export-fixture/run-export.mjs:30-48`, `:52-78` | Private receipt, fixed stages, protected home and closed refusals are useful precedents; do not import this experiment as a product runtime dependency. |
| Export observation discipline | Same file, lines 10–13 | A candidate observation is not published until capture and evaluation agree. Reuse this separation. |
| Bounded runner | `projects/dsh-compat-platform/scripts/diagnose-batch/payload.sh:31-38` | Known resource limits and readback style; not proof that its mount layout safely confines executed plugins. |
| Inert dependency summary | [dependency-shape acceptance](../testing/2026-11-09-dependency-shape.md) | Counts shapes only; must never start this executor implicitly. |
| Baseline projection | [diagnose provenance acceptance](../testing/2026-11-09-diagnose-provenance.md) | Copies stated baseline fields. It does not authenticate inputs or supply an execution receipt format. |

The existing minimal GUI carrier experiment is not a supported production profile launcher. The proposed executor should use the official `dsh` profile launch path; do not substitute a fresh Cordis context and call that equivalent profile execution.

## 3. Gap table

| ID | Current | Required |
| --- | --- | --- |
| D1 | Inert document inspection | Explicit disclosure before code evaluation, with a target-bound request |
| D2 | Exit/signal and export observations | Separate phase observations; no inference from exit 0 |
| D3 | Selected hashes and resource limits | Minimal filesystem visibility, no credentials or network, verified teardown |
| D4 | Caller-supplied baseline strings | Distinguish requested, measured and target-reported data |
| D5 | Logs may contain paths, config and exceptions | Private bounded capture and a closed text-free projection |
| D6 | No reviewed lifecycle observation adapter | Fail closed when a supported signal is missing; never parse logger text |
| D7 | Existing report formats cover different evidence | Separate versioned receipt; no automatic insertion into diagnose or admission lanes |

## 4. Proposed design

### 4.1 Explicit request and launch ownership (D1, D4)

**[Pending — recommended]** Use a two-step plan/run interface. Planning is inert and produces a disclosure manifest. Execution accepts that exact manifest digest and a caller acknowledgment. A boolean `trusted: true` alone is insufficient. An acknowledgment is not OS permission and cannot override a host policy denial.

Manifest fields are closed own data properties (reject accessors, symbols and unknown keys):

| Field | Meaning |
| --- | --- |
| `requestVersion` | Proposed `trusted-extraction-request/0.1-draft.1` |
| `targetId` | Allowlisted synthetic fixture ID in v0; never an arbitrary command |
| `requestedPhase` | Explicit maximum phase; no automatic escalation |
| `runtimeSelection` | Exact DSH/Node artifact selection; private resolved paths and hashes |
| `inputSelection` | Immutable staged profile, package and observer artifact hashes |
| `policyId` | Versioned confinement and limits policy |
| `disclosureDigest` | Digest binding all above facts and code-execution warning |

Any input, runtime, policy or phase change invalidates the acknowledgment. Plan and run must not silently install dependencies, fetch packages, discover production profiles, or consult the user's home. Use fixed argv construction, not caller shell fragments.

### 4.2 Phases and claims (D2, D6)

| Phase | Observation required | Must not imply |
| --- | --- | --- |
| `resolve` | Reviewed resolver reports the selected target was located | Import success or absence of resolver side effects |
| `import` | Adapter observes module evaluation completed | Plugin validity, activation or service availability |
| `activate` | Official lifecycle signal for the selected entry | Dependencies globally satisfied or runtime health |
| `settle` | Defined readiness condition within a fixed deadline | Future health or complete profile inventory |
| `cleanup` | Teardown outcome plus supervisor process-tree confirmation | Undoing external effects |

Per-phase status: proposed `not-requested | not-observed | observed | failed | interrupted`. `observed` requires a stage-specific signal; absence remains `not-observed`, including disabled entries and missing instrumentation. Store the deepest observed phase, not an invented successful suffix.

**Observation surface confirmed in the installed build (2026-11-09, second pass — supersedes an earlier, narrower finding).** A first pass concluded that `resolve` and `import` could not be distinguished. That was true of the loader's own events, but `@deepseek-ai/dsh-app-boot` exports the information a supervisor needs, so v0 may report **per-entry outcomes** rather than an unqualified "not-observed". The mapping v0 should use:

| Reported observation | Source (exported) | Not claimed |
| --- | --- | --- |
| selected entry reached `active` | `captureStartupComposition(ctx)` row `state === 'active'`, cross-checked with an observed `internal/status` transition | services the plugin needs are obtainable outside the isolated environment |
| entry's module never loaded (import failed) | `inactiveEntries(ctx)` outcome `kind:'failed'` with `phase:'failed to import'`; original error via `importFailure(entry)` | why the module failed beyond the recorded error classification |
| entry loaded but not activated | outcome `kind:'failed'` with a fiber error from `fiber.await()` | business readiness |
| entry waiting for services | outcome `kind:'pending'` with `missing[]` names | whether those services exist anywhere in the real profile |
| entry intentionally disabled | `pluginState` state `'disabled'` | whether disabling was intended |
| root reached ready | `ctx.fiber.state === 2 && ctx.get('loader') !== undefined` (as `runProfile` checks before `appReady.commit()`) | that every entry is healthy |

Three consequences for the receipt: the per-entry `state`/`outcome` words are a closed set (`pending | loading | active | failed | disposed | unloading | disabled`, plus `kind: 'failed' | 'pending'`), so they can be projected text-free; the error object must never be published (it carries paths and possibly config); and `missing[]` service names are identity data subject to the D-A decision, so the public projection keeps only their count unless identity is explicitly opted in.

Because `FiberState` is a `const enum` absent from the runtime export list, the adapter must compare the numeric state it reads against constants it defines itself, and must refuse rather than guess if the shape is unexpected. `Loader.await()` drains pending work with `Promise.allSettled` (`cordis-plugin-loader/lib/index.js:229-236`), so a resolved await means "settled", never "succeeded".

**[Pending — recommended]** v0 requests isolated fixture profile execution and observes only the lifecycle facts supported by a reviewed adapter. Independent resolve-only/import-only modes remain unavailable unless the official surface actually separates them. Reject unsupported phase combinations before launch rather than execute a deeper phase to answer a shallower question.

A fixture's own marker demonstrates fixture code reached a point, not a trusted lifecycle result for arbitrary plugins. Observer events originate inside the execution environment and are not cryptographic attestation against a malicious target. Supervisor facts (exit, capture lengths, termination) remain separately attributed.

### 4.3 Isolation policy (D3)

**[Pending — recommended]** v0 runs serially under the existing acceptance lock, with:

- `MemoryMax=384 MiB`, swap 0, `TasksMax=32`, CPU 50% of one core, outer wall limit 120 seconds, Node heap 192 MiB; one `MemAvailable >= 819200 KiB` gate.
- Verified cgroup and timer readback **before** any target workload. Missing enforcement means refusal, not best-effort fallback.
- A new mount namespace with only a reviewed runtime tree, staged synthetic profile/dependencies, minimal OS libraries/devices and bounded scratch mounts. **Do not reuse `--ro-bind / /`**: read-only host access still exposes credentials and unrelated private files.
- Separate `HOME`, `DSH_HOME`, temporary/cache/config directories, and an empty environment plus an explicit allowlist. No production home, repository root, host `/proc`, Unix sockets, SSH agent, cloud credentials, service manager socket or browser-session cookie in the child.
- Separate PID/IPC/UTS and network namespaces; no host networking, egress, DNS or mounted IPC sockets. No GUI listener is needed. If a selected profile requires network, refuse that profile under this policy.
- An unprivileged execution identity, dropped capabilities, no privilege escalation, and a reviewed executable/helper inventory. The privileged supervisor is outside the target namespace; the target cannot alter resource settings.
- Size-limited private stdout/stderr capture (proposed 1 MiB each), bounded event receipt, bounded scratch space (proposed 64 MiB), finite phase deadlines inside the outer deadline. Stop and mark incomplete at a capture limit; do not report a truncated capture as complete.

The precise OS mounts, unprivileged identity and availability of namespace controls remain implementation gates, not assumptions. Confinement is defense in depth for reviewed code, **not** support for executing hostile code safely.

**Five hard gates added by the 2026-11-09 review.** Each is a refusal condition, not a best-effort check; none has been verified yet:

1. **Exact mount list.** The implementation must enumerate every mount (runtime tree, staged profile, package directory, OS libraries, devices, scratch) with its mode, and refuse if any other path is visible. "Minimal runtime tree" is not enough to build from.
2. **Identity and namespace verification inside the child.** The child itself reports its uid/gid, capabilities, mount table, and network/IPC/PID namespace identity before any plugin code runs; the supervisor compares that against the policy and aborts on mismatch.
3. **Evidence-directory isolation.** The child must be unable to write the supervisor's manifest, receipt, hash records or verdict files; those live outside its writable mounts. Target-written JSON is input to be validated, never the verdict.
4. **Time-budget reserve.** The 120-second outer limit must reserve time for kill, reaping and terminal readback; per-phase deadlines must expire earlier than the outer limit so a hung phase is recorded as `interrupted` rather than truncating the whole run.
5. **Isolation acceptance with sentinels.** Before any fixture runs, a dedicated non-sensitive sentinel check must demonstrate that the child cannot read host sentinel files, cannot reach a controlled host socket or network endpoint, and cannot leave descendant processes after termination. Real secrets must never be used as probes.

If any gate cannot be demonstrated on this host, the increment stops at the design; it does not fall back to a weaker boundary.

The supervisor owns artifacts, readback and teardown. A target-writable ready file cannot determine the run verdict. Target output is untrusted; validate it before projecting it. Protect supervisor manifests from child writes.

### 4.4 Result and failure protocol (D2, D4, D5)

Proposed receipt version: `trusted-extraction-receipt/0.1-draft.1`. No existing envelope schema changes in this increment.

| Field | Source and invariant |
| --- | --- |
| `status` | Supervisor: `refused`, `completed`, `failed`, or `incomplete`; completed is protocol completion, not loadability |
| `executionStarted` | Supervisor launch observation; refusal before launch is false |
| `requestDigest`, `policyId` | Validated plan; not copied from child output |
| `runtime` | Supervisor-measured versions/artifact selection; unknown commit stays null |
| `inputWitness` | Private staged selection hashes; includes `closureEstablished: false` unless a separate closure check exists |
| `process` | Exit code or signal, mutually exclusive where observed; timeout separate; no fabricated zero |
| `capture` | Actual byte counts and completeness per stream; no content in public summary |
| `phases` | Fixed ordered records with status, observer source and closed reason code |
| `entries` | Per-entry outcomes from the exported settlement snapshot: closed state word, required flag, omission counts; identity fields (`id`, `module`, `version`, `source`, `missing[]` names) stay private |
| `cleanup` | Supervisor termination/readback; unknown or residual processes prevent a green verdict |
| `certification` | Literal false |
| `correlation` | Literal `not-established` |
| `notDerived` | At least `dependencyResolution`, `configurationCompatibility`, `productionLoadability`, `runtimeHealth`, `inventoryCompleteness` |
| `limitations` | Fixed codes covering isolated environment, selected inputs not closure, observer trust and no production claim |

Public projection exposes only closed words, booleans, counts and opaque run-local references. Paths, module/service names, user config, exceptions and captured streams remain private with restrictive permissions. Content hashes may reveal equality; keep target/input hashes private by default. Identity opt-in D-A is separate and not implicitly granted by D-B.

Closed refusal families: `REQUEST_INVALID`, `ACKNOWLEDGMENT_MISMATCH`, `INPUT_CHANGED`, `TARGET_NOT_ALLOWED`, `PHASE_UNSUPPORTED`, `OBSERVER_UNAVAILABLE`, `RUNTIME_UNVERIFIED`, `ISOLATION_UNAVAILABLE`, `RESOURCE_GATE_FAILED`, `ARTIFACT_WRITE_FAILED`. Post-launch failures use distinct codes such as `PHASE_FAILED`, `DEADLINE_EXCEEDED`, `CAPTURE_LIMIT`, `OBSERVER_RESULT_INVALID`, `CLEANUP_UNCONFIRMED`. Never emit raw error messages publicly.

CLI numeric exits remain **[Pending]** until this receipt is reviewed. Do not reuse diagnose's exit table merely because both tools emit JSON. Invalid output or inability to persist evidence must never return success. No automatic retry after a non-green run.

### 4.5 No automatic consumer coupling (D7)

Keep the executor out of analyzer imports and existing CLI code paths. Inert summarizers may later consume the new receipt through a separate strict reader. They may not execute its request, import a target module, or silently convert it to runtime/admission evidence. GUI display and snapshot comparison require their own subsequent consumer design.

## 5. Data attribution and consistency

1. Requested phase comes from the acknowledged manifest; observed phase comes from the reviewed adapter. They may differ and must remain distinct.
2. Runtime artifact hashes are supervisor measurements. A package version string alone is not a source revision or dependency closure.
3. Process exit 0 with a failed/missing import signal is not import success. Preserve both facts without replacing one with the other.
4. A service declaration is not service availability. A mapping-shaped `inject` is not a resolved dependency graph.
5. An isolated result applies only to the staged fixture, environment, runtime and execution policy. Network denial or omitted production services can cause legitimate isolated failures; report that limitation, not a universal incompatibility.
6. Capture failure, observer truncation or teardown uncertainty produces incomplete evidence, even if a preceding phase was observed.

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Import executes arbitrary top-level code | Explicit phase disclosure, fixture allowlist, isolated process, no production target |
| Loader swallows an exception | Structured lifecycle signal; exit status never substitutes for it |
| Read-only filesystem mistaken for confidentiality | Minimal allowlisted mounts, no host-root bind, clean environment |
| Target spoofs markers or writes verdict files | Separate supervisor-owned records; attribute child claims; no hostile-target attestation claim |
| Lazy import changes dependencies after validation | Immutable staged inputs; selected witness not advertised as closure |
| Cleanup hangs or leaves descendants | Whole-unit termination, finite grace period inside wall cap, terminal readback; no green on uncertainty |
| Logs leak secrets or exhaust storage | Private byte-capped capture, text-free projection, bounded scratch |
| Source mirror differs from installed runtime | Pin artifact versions/hashes and review exact public APIs before adapter implementation |

## 7. Review decisions and implementation gates

| Item | Status / recommended lean |
| --- | --- |
| Separate code-executing path from inert analyzers | **[Decided]** Direction accepted; this document does not authorize execution |
| First target scope | **[Decided 2026-11-09]** Synthetic fixtures only, fixed allowlist with a per-fixture manifest; no arbitrary profile path, package name or command. Conditional on the isolation gates below. |
| Launch mechanism | **[Pending]** Official DSH profile path. Runtime pin resolved 2026-11-09: launching through `@deepseek-ai/dsh` resolves the nested `@deepseek-ai/cordis` **4.1.0** and `@deepseek-ai/cordis-plugin-loader` **1.1.0**, not the global `4.0.5`. |
| Phase independence | **[Revised 2026-11-09]** `resolve`/`import` are not separate *phases*, but per-entry outcomes are exported (`inactiveEntries`, `captureStartupComposition`), so v0 reports entry-level words plus the `prepare`-time observer instead of a four-phase sequence. |
| Isolation policy | **[Conditionally approved]** Minimal mounts + unprivileged identity + no network; the five hard gates in §4.3 must be demonstrated before the first launch, and refusal — not degradation — is the failure mode. |
| Public disclosure | **[Pending]** Text-free projection; private identity and raw captures. |
| Integration into diagnose/GUI | **[Pending]** Defer; new standalone receipt first. |
| CLI exits and per-phase deadlines | **[Pending]** Freeze after adapter feasibility review, before executing any fixture; the outer 120 s budget must reserve kill/reap/readback time. |

No high-cost runtime fact is guessed here. If public lifecycle signals cannot establish the requested phase, the next task is to document that missing surface or propose an upstream extension—not to call private methods or scrape logs.

## 8. Landing and verification plan

Proposed new files (not created by this design):

```text
packages/runtime/src/trusted-extraction-request.js   inert manifest validation
packages/runtime/src/trusted-extraction-receipt.js   inert receipt validation/projection
packages/runtime/src/trusted-extraction-supervisor.js process ownership and evidence
packages/runtime/src/trusted-extraction-adapter.js   reviewed official lifecycle signals
packages/runtime/tests/                             pure and isolated fixture tests
scripts/trusted-extraction-batch/                   reviewed bounded launcher
examples/trusted-extraction/                       synthetic targets only
```

Implementation order:

1. Review pending decisions; record exact runtime/artifact pin and supported launch/observation APIs. No workload yet.
2. Implement pure request/receipt validation and projection; test closed keys, missing/partial evidence, secret sentinels, and no execution on import.
3. Review supervisor confinement and its refusal paths before any target launch. Verify child cannot read host sentinels or reach host sockets/network and cannot write supervisor artifacts.
4. Run one separately authorized serial fixture batch: successful observed phase, import throw, activation throw, missing service/not-settled, disabled entry, timeout, capture overflow, malformed observer event and teardown failure. Phase success assertions require positive structured signals.
5. On failure, preserve raw evidence, stop and review. Revised bytes require a separately recorded rerun, not a retry loop.
6. Record hashes/resources/terminal state and non-claims, then commit the reviewed slice. No browser or production-loadability acceptance is implied.

Acceptance requires refusal before target execution for changed manifests, unsupported phases, missing observer, missing enforcement and insufficient memory. Partial runs must retain completed observations but never upgrade missing stages. Only a final record with confirmed cleanup can be green.

## 9. Review record (2026-11-09)

Review of the three requested items — fixture-only first version, isolation policy, official lifecycle observation — performed by reading source and the installed build only. No fixture was launched, no namespace probe was run, no test executed, and nothing was installed.

### 9.1 Verdicts

| Item | Verdict | Basis |
| --- | --- | --- |
| Fixture-only first version | **Conditionally approved** | Right size, but it needs a fixed per-fixture allowlist with hashed inputs, per-scenario staged acceptance, and no "fixture-only" exemption from resource limits — a timing-out or output-flooding fixture still affects the host. |
| Isolation policy | **Design approved, implementation not yet demonstrated** | The design already refuses host-root binds and requires separate home/env/netns; it lacks the five concrete gates now listed in §4.3. Confinement remains defense in depth, not a hostile-code sandbox. |
| Official lifecycle observation | **Approved (revised upward in §9.4)** | `internal/status` and `Fiber.state` exist and are supported-looking; `Fiber.await()` does not mean `ACTIVE`; a failed import produces no fiber. However `@deepseek-ai/dsh-app-boot` exports `inactiveEntries`, `captureStartupComposition` and `auditStartupEntries`, which report per-entry outcomes including "failed to import" and "pending for services" without log scraping — so v0 reports entry outcomes, not four phases. |

### 9.2 Evidence read during the review

| Claim | Evidence |
| --- | --- |
| Import failure yields a log line and returns, creating no fiber | `/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js:580-593` (`_init` try/catch → `ctx.logger.error(error); return;`) |
| `init()` swallows fiber startup rejection | same file `:568-579` (`this.fiber?.await().catch(() => {}).finally(...)`) |
| `Fiber.await()` does not imply `ACTIVE` | `/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js:727-731` (`while (this.inertia) await this.inertia; if (this._error) throw this._error; return this;`) |
| State transitions emit `internal/status` | same file `:592`; types at `lib/types/events.d.ts:206` |
| `FiberState` is not a runtime export | same file `:1901` export list; the enum is declared `const enum` in `lib/types/fiber.d.ts:67` |
| Two Cordis versions are present on this host | `/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/cordis/package.json:4` = `4.0.5`; `/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/package.json:4` = `4.1.0`; `@deepseek-ai/dsh` is `0.2.2-rc.1` |
| Upstream mirror matches the installed shape | `.cache/upstream/vendor/loader/src/config/entry.ts:213-237`; `.cache/upstream/vendor/cordis/src/fiber.ts:748-760` |

### 9.3 Consequences for the next task

1. Pin the runtime: record which Cordis/loader copy the official profile launch path actually resolves, with version and artifact hash, before any adapter code is written. **Done for version selection: launching through `@deepseek-ai/dsh` resolves `@deepseek-ai/cordis` 4.1.0 and `@deepseek-ai/cordis-plugin-loader` 1.1.0 from the installation's nested `node_modules`; the global 4.0.5 is not what the CLI uses.** Artifact hashes and a recorded resolution receipt remain to be produced.
2. Establish, and document, a supported way to register the observer **before** the selected entry starts, plus how an observer associates an `internal/status` event with the selected entry's fiber. **Resolved in §9.4: `boot()` runs its `prepare` callback after `ctx.plugin(Loader)` and before `mountRootInclude`, and `loader.locate(fiber)` maps a fiber back to its entry id.**
3. Turn §4.3's five gates into checks that fail closed, and demonstrate them with non-sensitive sentinels before the first fixture launch.
4. Do not start loader execution until steps 1–3 are done. A tool that runs but cannot say what it observed is worse than no tool.

### 9.4 Second pass: the exported entry-outcome surface (2026-11-09)

A targeted read of `@deepseek-ai/dsh-app-boot` (version `0.2.2-rc.1`, `lib/index.js`) found that the loader's swallowed exception is **recoverable through exported functions**, which changes the lifecycle verdict.

| Capability | Implementation | Consequence for the design |
| --- | --- | --- |
| Observer registration before entries mount | `boot(binName, absoluteConfigPath, patches, prepare, bareModuleBaseUrl)` at `:5259`: `new Context()` → `ctx.plugin(Loader)` → `await prepare?.(ctx)` → `mountRootInclude(...)`. JSDoc: "optional host setup run after Loader installation and before any config-tree entry mounts". | A controlled launcher can pass its own `prepare` that registers the observer, then mounts `PluginPackages`; no private API and no race with entry startup. |
| Per-entry state vocabulary | `stateName()` maps `0..5` to `pending/loading/active/failed/disposed/unloading`; `pluginState()` adds `disabled` and returns `{id, module, version, state, source, missing[]}` (missing only while `pending`). | Closed words suitable for a text-free projection; `id`/`module`/`version`/`source` are identity data and stay private by default. |
| Bulk snapshot | `captureStartupComposition(ctx)` returns `{plugins[≤256], services[≤256], omittedPlugins, omittedServices}`; rows are sorted with active last. | One call gives the whole tree's state plus service-ownership observations; omission counts must be surfaced, never silently dropped. |
| Failure classification | `inactiveEntries(ctx, importNow)` yields `kind:'failed'` with `phase:'failed to import'` or a fiber error, and `kind:'pending'` with `missing[]`. | Distinguishes "module never imported" from "imported but not activated" from "waiting for services" — the distinction an earlier pass thought impossible. |
| Original import error | `importFailure(entry)` re-runs `entry.parent.tree.import(...)` and returns the cached rejection. | The supervisor can classify the failure privately; the error text must never be published. |
| Startup policy result | `auditStartupEntries(ctx, binName, warn)` throws `StartupError` with `{id, module, required, fiberState, outcome}` per failure, and warns about optional ones. | Gives a policy-level verdict (required entries) separate from the per-entry snapshot. |
| Loader settlement semantics | `Loader.await()` at `cordis-plugin-loader/lib/index.js:229-236` drains `getTasks()` with `Promise.allSettled`; `getTasks()` returns `entry._initTask || entry.fiber?.inertia`. | A resolved await means settled, never succeeded — the receipt must not translate it into success. |
| Overlay insertion of the observer | `loadOverlayPatches(binName, file)` parses a `--patch` YAML list of id-targeted overrides and `insert` lists, path-anchoring relative names; a missing named overlay throws. | A second supported route: mount the observer as an inserted entry via an official overlay file instead of the `prepare` hook. |

**Limits that remain.** These are post-settle snapshots and policy checks, not per-phase timestamps; v0 must state "state observed at settlement", not "phase order observed". `pluginState` reads `entry.fiber?.state`, `entry.disabled` and `entry.options.*` — loader internals, so the adapter needs a version pin and a shape check, and must refuse if a future build changes them. `captureStartupComposition` caps rows at 256 with omission counts. None of this proves business readiness, and none of it replaces the isolation gates.

## Appendix A. File and line quick reference

Paths below are workspace-root-relative; mirror files are read-only research references.

| Context | Location |
| --- | --- |
| P2 execution-path requirement | `projects/dsh-compat-platform/docs/requirements-and-design/2026-11-09-p2-gap-review.md:15-17,92-94` |
| G8 and identity constraint G9 | `projects/dsh-compat-platform/docs/requirements-and-design/2026-11-09-p2-gap-review.md:46-47` |
| Import and plugin registration; swallowed import exception | `.cache/upstream/vendor/loader/src/config/entry.ts:213-237` (`Entry.init`, `Entry._init`) |
| Installed loader with the same behaviour | `/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js:568-593` |
| Builtins, internal and native import paths | `.cache/upstream/vendor/loader/src/config/tree.ts:113-130` (`EntryTree.import`) |
| Fiber lifecycle state and `await()` | `.cache/upstream/vendor/cordis/src/fiber.ts:147-154,748-760`; installed `…/@deepseek-ai/cordis/lib/index.js:592,727-731,1901` |
| Private export receipt, protected home and stage/refusal vocabulary | `experiments/profile-export-fixture/run-export.mjs:10-13,30-78` |
| Existing resource limit constants | `projects/dsh-compat-platform/scripts/diagnose-batch/payload.sh:31-38` |

This document reports source inspection only. No new test, profile execution, isolation verification or loadability result was produced while writing it or while reviewing it.
