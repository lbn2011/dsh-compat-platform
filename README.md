# dsh-compat-platform

Planned DSH plugin analysis, optional managed coordination and explicitly approved remediation. Reuse official DSH services and the existing GUI rather than another Loader, registry, skill manager or HTTP server.

## Start here

[Requirements and delivery plan](docs/requirements-and-design/2026-10-31-compat-platform-requirements.md) defines evidence tiers, approval boundaries and staged acceptance.

- [`packages/analyzer/`](packages/analyzer/README.md): **First-slice static analyzer accepted under stated limits** — `dsh-compat-platform@0.0.0`, zero-dependency ESM analyzer plus the `dsh-compat-analyze` CLI. Lead independently passed 59 tests and exercised clean/conflicting fixtures with the actual protocol validator (exit 0/1). This accepts the static slice only, not runtime compatibility. See its [README](packages/analyzer/README.md) for real commands, scope and limits.
- `packages/runtime/`: future optional managed coordination.
- [`packages/host/`](packages/host/README.md): **read-only diagnostics host route, executed under limits** — `dsh-compat-diagnostics-ui`, a zero-dependency host plugin serving one envelope file on two exact routes. Three bounded rounds (2026-11-08 and 2026-11-09), latest green (16/16 package tests, seven HTTP assertions, and a "Baseline per source" section the envelope`s `provenance` array populates). Display only: no plugin is loaded, no browser rendered the page, `certification` stays `false`. `packages/client/`: still future work — a native client surface needs a bundle and build step this repository does not have.
- `fixtures/` and `tests/`: future isolated integration scenarios (the analyzer keeps its own fixtures under `packages/analyzer/fixtures/`).

## Current capability index (2026-11-08)

State as of this date, based on files present in this checkout. "Available" means the code and its built-in tests exist; it does not certify runtime compatibility of any plugin.

| Capability | State | Entry point |
| --- | --- | --- |
| Static declaration analysis | available — accepted first slice (2026-10-31) | `dsh-compat-analyze`; [`packages/analyzer/`](packages/analyzer/README.md) |
| Admission diagnostics | available | `dsh-compat-admission` |
| Combined report | available | `dsh-compat-report` |
| Snapshot comparison | available | `dsh-compat-compare` |
| Profile dump summary | available — `0.2-draft.1` shape: row window + guard lists, one file `81/81`, three retained captures replayed `3/3` (2026-11-09) | `dsh-compat-profile-dump`; [`docs/testing/2026-11-08-profile-dump-rows.md`](docs/testing/2026-11-08-profile-dump-rows.md) |
| Repair plan, preview, approval and confined apply | `repair-plan/0.1-draft.1` + `repair-receipt/0.1-draft.1`: closed schemas, one-element vocabulary (`set-entry-flag` on `disabled`), stale refusal, text-only preview, digest-bound approval, write-then-verify with `applied`/`partial`, restore from the pre-write copy; 42/42 tests, two green rounds, expired/denied/partial/recovery demonstrated on a temporary copy, example fixture byte-identical before/after (2026-11-09); **writes only inside a caller-named fixture directory** | `packages/repair`; docs/testing/2026-11-09-repair-plan.md, docs/testing/2026-11-09-repair-apply.md |
| Trusted extraction (fixture-only) | available — synthetic fixture observed inside a bwrap boundary: 5 phases, 4 entry outcomes (import vs activation failure), observed network refusal, kill path on a wedged target, 29/29 tests, four green rounds (2026-11-09); executes code, not a loadability verdict | `packages/runtime`; docs/testing/2026-11-09-trusted-extraction.md, …-failure-paths.md |
| Packaging install (S5) | `npm pack` + install into a consumer directory with no sibling checkout: 5 tarballs (four packages + `yaml@2.9.1`), every documented subpath resolves by package specifier, 24 probe checks, a missing dependency fails loudly with `ERR_MODULE_NOT_FOUND`; ten bounded invocations, two consecutive green rounds on the final bytes (2026-11-09); **nothing is published** and the tarball `files` list is not audited | `scripts/package-install`; docs/testing/2026-11-09-package-install.md || Dependency-shape summary | available — `0.1-draft.1`: `inject` shape counted, names never emitted; one file `37/37` plus the shipped example checked as a process (2026-11-09) | `dsh-compat-dependency-shape`; [`docs/testing/2026-11-09-dependency-shape.md`](docs/testing/2026-11-09-dependency-shape.md) |
| Correspondence check | `profile-correspondence/0.1-draft.1` → `correspondence-summary/0.1-draft.1`: a caller-asserted `entryId`→`pluginId` mapping bound to both documents by sha256, resolved against the dump and the declarations; three findings only, no id/name/config text ever emitted; `43/43` tests, two green rounds on identical inputs, shipped example exit 1 with one `CORRESPONDENCE_PLUGIN_NOT_DECLARED`, stale bindings exit 2 with `CORRESPONDENCE_STALE` (2026-11-09); **an assertion, not an observation** — nothing is loaded | `dsh-compat-correspondence`; docs/testing/2026-11-09-correspondence.md |
| Unified read-only diagnostics | available — `0.2-draft.1` envelope with a per-source baseline projection; 54/54 analyzer tests, wiring six cases + 6/6, GUI 16/16 + HTTP checks (2026-11-09); not full-suite | `dsh-compat-diagnose`; `dsh-compat-platform/diagnose`; [`packages/analyzer/README.md` §13](packages/analyzer/README.md); [`docs/testing/2026-11-09-diagnose-provenance.md`](docs/testing/2026-11-09-diagnose-provenance.md) |
| Read-only diagnostics GUI (host route) | available — three bounded rounds, third green (16/16 tests, seven HTTP checks, baseline section); not browser-rendered | [`packages/host/`](packages/host/README.md); [`docs/testing/2026-11-08-read-only-diagnostics-gui.md`](docs/testing/2026-11-08-read-only-diagnostics-gui.md) |
| Shared bounded runner | `bounded-runner/1`: one `Type=exec` unit with 384 MiB / swap 0 / 32 tasks / 50 % CPU / 120 s, an invocation ownership receipt, verified terminal state, control-closure and selected-input hashing, strict six-field TAP and one exit vocabulary; all twelve maintained launcher/payload pairs migrated (2026-11-10), eleven executed green under the envelope, `profile-dump-install` refused by design because its target already exists — its migrated success path is unverified. Mock-qualified only against a fake manager; **not** host acceptance | `scripts/bounded-runner`; docs/testing/2026-11-10-bounded-runner-core.md, …-runner-migration-simple-suites.md, …-complex-suites.md, …-install-suites.md |
| Config contract revision | `0.2.0-draft.1` requires an own `configSchema` whose outer shape is a boolean or plain record; legacy `0.1.0-draft.1` unchanged and still the default; schema keywords, references, formats and values are **not** evaluated here; spec suite `105/105` in one bounded round (2026-11-10) | `dsh-compat-spec/spec/declaration-protocol.md`; projects/dsh-compat-spec/docs/testing/2026-11-10-config-contract-runner-pilot.md |
| JSON Schema engine (under review) | Hyperjump `1.18.0` + `browser 1.6.0` acquired from a reviewed lock (11 packages, all MIT, no install hooks; `uuid@14.0.3` declares pack-phase hooks that `--ignore-scripts` suppressed); the identifier-in-literal defect is **reproduced** — 14 of 22 fixed cases diverge while the scalar and dynamic-ref controls stay correct. No patch, no conformance claim, **no checker is implemented** | docs/testing/2026-11-10-config-engine-reproduction.md |
| `packages/client/` | not implemented (empty package directory) | — |
| Real profile-export acceptance | experimental, **not** a package capability: one authorised batch (`20261107T062654Z-profile-export-real-512194-18141`) ran green on 2026-11-07 | [measured record](docs/testing/2026-11-07-profile-export-real.md); [batch summary](../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/summary.txt) |

The profile-export result is a controlled-fixture `--dump-config` observation, not a shipped feature: it does not establish plugin loadability, dependency satisfaction, authentication or compatibility.

Raw run artifacts behind these records are kept on the maintainer's machine and excluded from Git; [docs/testing/runs/README.md](docs/testing/runs/README.md) explains the mapping and why a clone cannot download them. Links in the records that point into `experiments/` therefore do not resolve in a standalone checkout.

Consume versioned contracts from dsh-compat-spec and helpers from dsh-plugin-kit. These are independent repositories; no dependency on sibling paths or the original research checkout.

## Prefer supported proof types

This platform is one evidence source among several. Where this platform is not available or not trusted, use a supported proof type that fits the task:

| Task | Supported proof |
| --- | --- |
| Validate a plugin declaration | The protocol repository's validator; this platform only consumes it via injection. |
| Inspect skills / skill providers | DSH Web GUI → 设置 →「技能」 (skill hub). |
| Architecture overview of the running system | Official DSH configuration exports and host inventory. |

A clean static report is never a substitute for a runtime or activation proof.

## Status and limits

First-slice static analyzer reviewed, 2026-10-31: pure static declaration analysis (library and CLI, 59 built-in tests independently passed; real protocol-validator CLI integration passed). This is not a certification of any plugin combination. Since then the platform has added read-only diagnostics (YAML profile summary, one unified entry, a host route serving an envelope), each accepted only on its own bounded evidence. Still absent: executable runtime and client packages, remote, release, compatibility certification and any running server. Nothing installed into DSH. No browser has rendered the host route's page, and no plugin is loaded by any of these packages.

Analyzer-specific limits, stated so they cannot be misread as safety guarantees: it never executes the analyzed plugins, never reads a DSH profile, never scans the user's environment, never repairs anything and writes no files. Declarations are inspected as inert JSON; validity is decided solely by the caller-injected validator, so the report is only as good as that validator and the supplied availability list. That availability list is `input.availableCapabilities`, which is required and typed: there is no "unknown availability" state, and an omitted or malformed field is refused with a `TypeError` rather than being read as permissive or permissive-unknown. `[]` is an explicit empty set, so every required capability is then reported as missing. `evidenceLevel` is always `static-declaration`: no runtime health, no activation proof and no cross-version certification. Fixture and test validators in this repository are documented test doubles, not protocol implementations. The inspected host source is 0.2.2-alpha.2 at ce7073d51254c26cd63b22a60835b8f948deb447; runtime support is not established. License, npm scope and GUI approval design remain pending; no reuse license is granted here. No Forge code was copied, and its compatibility has not been execution-tested by this repository.
