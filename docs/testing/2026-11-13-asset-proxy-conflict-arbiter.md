# C3 asset proxy and A3 conflict arbiter — implementation and verification record

Date: 2026-11-13. Repo: `projects/dsh-compat-platform`. Packages:
`packages/asset-proxy` (C3), `packages/conflict-arbiter` (A3).

**State: GREEN — both capabilities verified in one bounded round each.** C3
`asset-proxy-batch`: `acceptance_exit=0`, `tap_tests=65 tap_pass=65 tap_fail=0`.
A3 `conflict-arbiter-batch`: `acceptance_exit=0`, `tap_tests=55 tap_pass=55
tap_fail=0`. One earlier A3 attempt exited 70 because the generated payload called
a function name that only existed in the C3 copy — a slice defect, fixed, recorded
in §7.2; it never reached the tests.

## 1. What the two packages answer

| Question | Package | Answer shape |
| --- | --- | --- |
| How does a plugin's declared browser asset reach the boot page? | `asset-proxy` | rows pushed into the host's own `IndexInjection` table, from a warm cache |
| What happens to a plugin that failed because it duplicated a service? | `conflict-arbiter` | a record plus, at most, a real `setPluginEnabled(entryId, false)`; `isolate` returns a scope and claims no repair |

Both are independent host plugins: one entry each, `inject` declared, zero
dependencies, no import of another package in this repository.

## 2. Upstream facts these packages are built on

### 2.1 The injection event takes a table and appends

`@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts:30-33` declares

```
'webserver/index-inject'(table: IndexInjection[], peer: PeerScope): void
```

so a listener receives the table and pushes rows onto it. Real listeners do
exactly that (`dsh-client-ui-theme/lib/index.js:204`, `dsh-client-modules/lib/index.js:628`,
`dsh-client-shortcuts/lib/index.js:14`). The emit is synchronous and happens on
every index render (`dsh-host-webserver/lib/index.js:648`).

### 2.2 `IndexInjection` has six kinds and none of them is a stylesheet link

`dsh-host-webserver/lib/types/injections.d.ts` allows `global`, `script`,
`script-src`, `script-preload`, `style` and `html`. Consequences taken as design
constraints rather than worked around:

* a `.js`/`.mjs` asset becomes `{ kind: 'script-src', placement, src }`;
* a `.css` asset becomes `{ kind: 'html', placement: 'head', html: '<link rel="stylesheet" href="…">' }`;
* this plugin never emits `script` or `style` rows, i.e. never inline text, so it
  cannot break a deployment's inline-content policy — and it emits no CSP header
  of its own (`NO_CSP_HEADER_IS_EMITTED_BY_THIS_PLUGIN`).

### 2.3 `dsh.client.assets` is not a host field

`dsh-package-manifest/lib/types/types.d.ts:82-95` gives
`DshClientManifest = { platform, inject?, immediately?, external? }` — no `assets`.
A grep for `"assets"` across installed `package.json` files finds only `files`
arrays. So `dsh.client.assets` is **our proposed extension**, declared as the
limitation `ASSETS_FIELD_IS_A_PROPOSED_EXTENSION_NOT_A_HOST_FEATURE`: a plugin
carrying it is inert without this plugin installed.

### 2.4 `ctx.isolate()` cannot re-scope a fiber that already failed

`cordis/lib/types/context.d.ts:79-83` returns a **child context**; only plugins
loaded below it resolve the isolated name against the new label. `PluginManager.reload`
is private, and a disable→enable cycle reloads in the profile scope. So the
`isolate` strategy is implemented as `needs-isolated-loader` plus an exposed
`createIsolateScope(serviceName)`; no repair is claimed.

### 2.5 The failure text is only reachable through the inventory

`Fiber._error` is private; `PluginInfo.diagnostic` is the public statement. The
fibers in `internal/status` say *when* to look, not *which* entry failed
(`THE_FAILING_FIBER_IS_IDENTIFIED_THROUGH_THE_INVENTORY_NOT_THE_EVENT`).

### 2.6 `dsh.conflicts` is not a host field either

Same status as 2.3: `DshManifest` has `manifestVersion`, `bundle`, `profile`,
`client`. The arbiter reads `dsh.conflicts.strategy` from the failing entry's own
manifest and states `CONFLICT_POLICY_IS_DECLARED_BY_THE_PLUGIN_THAT_LOSES_AND_IS_UNVERIFIED`.

## 3. C3 asset proxy

### 3.1 Declaration reading

| Rule | Code |
| --- | --- |
| neither array nor `{scripts, styles}` record | `ASSETS_NOT_ARRAY_OR_OBJECT` |
| record with a key other than `scripts`/`styles` | `ASSETS_UNKNOWN_KEY` |
| `scripts`/`styles` not an array | `ASSETS_LIST_NOT_ARRAY` |
| entry not a string / empty / > 2048 chars | `ASSET_NOT_STRING` / `ASSET_EMPTY` / `ASSET_TOO_LONG` |
| has a scheme (`https:`, `data:`) | `ASSET_SCHEME_NOT_ALLOWED` |
| protocol-relative (`//host/x`) | `ASSET_PROTOCOL_RELATIVE` |
| not root-relative (`assets/x.js`) | `ASSET_NOT_ROOT_RELATIVE` |
| control characters | `ASSET_CONTROL_CHARACTER` |
| `"`, `'`, `<`, `>`, backtick, backslash | `ASSET_UNSAFE_CHARACTER` |
| extension does not imply a kind | `ASSET_EXTENSION_UNKNOWN` |
| more than 32 assets in one plugin | `ASSET_LIMIT_EXCEEDED` (once) |

One bad entry does not discard the others, and nothing is dropped silently: each
refusal becomes an issue naming the plugin and the index. The scheme check runs
first so `https://…` reports the real reason instead of "not root-relative".

### 3.2 Rows and ordering

Rows are keyed `kind + '\0' + src`, deduped keeping the first, and sorted by
plugin entry id in UTF-16 code-unit order (`compareText`, not `localeCompare`, so
the page does not depend on the host locale). A path declared by two plugins loads
once and is reported with `reason: 'DUPLICATE_ASSET_EMITTED_ONCE'`. The same path
in two kinds is not a duplicate.

### 3.3 Warm cache, not I/O on the render path

`plugin-manager/changed` schedules a single-flight refresh; `webserver/index-inject`
pushes the cached rows. A cold table renders **without** our rows and records
`CACHE_COLD_AT_FIRST_INJECT` once — a late row beats a slow index. A failed
inventory read keeps the previous rows, because a failed read is not evidence that
every plugin was removed. Disabled plugins are skipped and recorded as
`skipped-disabled`.

### 3.4 Two defects found by the tests

1. `refresh()` cleared the issue list, erasing `CACHE_COLD_AT_FIRST_INJECT` — a
   fact about a render that already happened. Fixed by carrying cold reports
   across the clear.
2. `recordIssue(code, detail)` spread `...detail` after `code`, so a detail with
   its own `code` replaced the service's vocabulary. Fixed by renaming the nested
   field to `reason` at both call sites.

Also: `plugins()` now sorts by id (a report that reorders itself between reads is
hard to diff), and the test fake's `provide` now throws the cordis message
`service "<name>" has been registered at <root>` instead of overwriting silently.

## 4. A3 conflict arbiter

### 4.1 Classification

| Diagnostic text | Kind |
| --- | --- |
| `service "X" has been registered at <Y>` | `duplicate-service` (`service`, `existingOwner`) |
| `property "X" is already declared as T` | `property-conflict` (`service`, `declaredAs`) |
| anything else, or no message | `unclassified` / `MESSAGE_ABSENT` |

ANSI is stripped first. `isArbitrable(undefined)` returns `false` — a predicate is
asked about data that may be missing; `false` is an answer, a `TypeError` is not
(that was a defect the tests caught).

### 4.2 Strategy table

| Strategy | Action | Effect |
| --- | --- | --- |
| `report-only` (default) | `report` | record + event only |
| `disable-later` | `disable-entry` | real `setPluginEnabled(entryId, false)` |
| `isolate` | `needs-isolated-loader` | `createIsolateScope(service)` returns a child context; no repair claimed |

Refusals: `ENTRY_NOT_ADDRESSABLE`, `ARBITER_DOES_NOT_DISABLE_ITSELF`,
`ENTRY_IS_READ_ONLY`, `STRATEGY_NEEDS_ISOLATED_LOADER`. An unknown strategy is
**refused, not coerced** — a plugin that asked for something unimplemented must
not silently receive a different action.

### 4.3 Ordering, idempotence, evidence

A decision is keyed by `entryId` + digest of the diagnostic, so the same failure is
decided once across passes while a changed message is a new fact. Records are
bounded by `maxDecisions` (default 200) keeping the most recent. `inspect()` is
single-flight. The diagnostic is stored as `{digest: sha256[0..32], length}` only —
the raw text never enters a record. `disable-later` treats
`application: 'applied' | 'restart-required'` as applied and
`'failed' | 'overridden' | 'cancelled'` as not applied; a thrown management call is
`DISABLE_FAILED`, never success.

## 5. Unit evidence

| Suite | Cases | Result |
| --- | --- | --- |
| `packages/asset-proxy/tests/asset-declaration.test.js` | 22 | pass |
| `packages/asset-proxy/tests/asset-rows.test.js` | 13 | pass |
| `packages/asset-proxy/tests/asset-proxy.test.js` | 30 | pass |
| `packages/conflict-arbiter/tests/failure-classify.test.js` | 10 | pass |
| `packages/conflict-arbiter/tests/arbiter-policy.test.js` | 17 | pass |
| `packages/conflict-arbiter/tests/conflict-arbiter.test.js` | 28 | pass |

Run with `TMPDIR=/root/kit-scratch/tmp node --test --test-concurrency=1 "<file>"`,
one file at a time. These are local runs — **not** bounded rounds, and therefore
not acceptance evidence for this repository's standard.

## 6. Static contracts, run outside the envelope

Both contracts were extracted from their payload and executed directly
(`node /root/kit-scratch/tmp/{asset,arbiter}-contract.mjs` with `EXPECT_PKG_DIR`
and `EXPECT_EXPORTS`), 33 checks each, both `static_contract=pass` /
`static_contract_failures=none`. They check manifest name/type/zero dependencies,
every export target exists, the `dsh` entry id and `inject` list, that no source
file imports a non-builtin specifier, and the product facts above (proposed-extension
limitation present, refusals, row kinds, ordering, cold table, classification,
strategy actions, digest length, constants).

Running them outside the envelope is a smoke check of the contract body, not a
substitute for the bounded round.

## 7. Bounded verification

### 7.1 C3 — `asset-proxy-batch`, one round, green

```
TMPDIR=/root/kit-scratch/tmp bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/asset-proxy-batch/run.sh
```

Run directory `/data/dsh-ecosystem-test-artifacts/runs/20261112T165533Z-asset-proxy-batch-1734563-9496`.

| Fact | Value | Read from |
| --- | --- | --- |
| acceptance exit | `0` | `status.txt` |
| phase / terminal | `completed` / `terminal_ok=yes` | `status.txt` |
| launch rc / hash rc / write failures | `0` / `0` / `0` | `status.txt` |
| TAP totals | `tap_tests=65 tap_pass=65 tap_fail=0 tap_cancelled=0 tap_skipped=0 tap_todo=0` | `tap-summary.txt` |
| TAP verdict | `tests_exit=0 tap_check_rc=0 verdict=pass` | `tap-verdict.txt` |
| static contract | `acc_static_contract=pass` (33 checks) | `static-verdict.txt` |
| memory peak | `37048320` B (35.3 MiB), `measured` | `peaks.txt` |
| pid peak | `16`, `measured` | `peaks.txt` |
| closure | `control_files=8 selected_workload_files=10` | `selection.txt` |
| control / selected inputs | identical before and after | `control-before.txt` vs `-after.txt`, `selected-before.txt` vs `-after.txt` |
| envelope | `MemoryMax=384M MemorySwapMax=0 TasksMax=32 CPUQuota=50% RuntimeMaxSec=120` | `argv.txt` |
| workload | `workdir=…/packages/asset-proxy test_glob=tests/*.test.js` | `workload.txt` |

No yaml snapshot exists for this slice (the package has no `yaml` dependency), so
there are no `yaml-manifest-*.txt` files to compare.

### 7.2 A3 — `conflict-arbiter-batch`, green after one slice defect

First attempt (`/data/dsh-ecosystem-test-artifacts/runs/20261112T165548Z-conflict-arbiter-batch-1734778-18358`)
exited **70** with `launch_rc=127`; `unit.log` shows
`payload.sh: line 207: asset_proxy_payload: command not found`. The payload was
generated from the C3 copy and only the *definition* was renamed, not the
invocation. Fixed with `sed -i 's/^asset_proxy_payload$/conflict_arbiter_payload/'`
in `scripts/conflict-arbiter-batch/payload.sh`; `bash -n` clean; no product file
touched.

Green round: `/data/dsh-ecosystem-test-artifacts/runs/20261112T165629Z-conflict-arbiter-batch-1735040-4382`.

| Fact | Value | Read from |
| --- | --- | --- |
| acceptance exit | `0` | `status.txt` |
| phase / terminal | `completed` / `terminal_ok=yes` | `status.txt` |
| launch rc / hash rc / write failures | `0` / `0` / `0` | `status.txt` |
| TAP totals | `tap_tests=55 tap_pass=55 tap_fail=0 tap_cancelled=0 tap_skipped=0 tap_todo=0` | `tap-summary.txt` |
| TAP verdict | `tests_exit=0 tap_check_rc=0 verdict=pass` | `tap-verdict.txt` |
| static contract | `acc_static_contract=pass` (33 checks) | `static-verdict.txt` |
| memory peak | `36790272` B (35.1 MiB), `measured` | `peaks.txt` |
| pid peak | `16`, `measured` | `peaks.txt` |
| closure | `control_files=8 selected_workload_files=10` | `selection.txt` |
| control / selected inputs | identical before and after | the four snapshot files |
| envelope / workload | same fixed values as 7.1; `workdir=…/packages/conflict-arbiter` | `argv.txt`, `workload.txt` |

### 7.3 Name-level evidence, not totals

Each declared case was matched against the TAP `# Subtest:` headers by exact name:

| Package | Declared | Matched | Missing | TAP headers | Suites (`describe`) |
| --- | --- | --- | --- | --- | --- |
| `asset-proxy` | 65 (22 + 13 + 30) | 65 | **0** | 87 | 22 (7 + 5 + 10) |
| `conflict-arbiter` | 55 (10 + 17 + 28) | 55 | **0** | 75 | 20 (3 + 6 + 11) |

`87 = 65 + 22` and `75 = 55 + 20`: the headers beyond the declared cases are the
suite names, which is why the header count exceeds `tap_tests` by exactly the
number of `describe()` blocks. The declared totals equal `tap_tests` in both runs,
so no file silently failed to load.

### 7.4 Authorisation trail

`asset-proxy-batch` and `conflict-arbiter-batch` were added to
`scripts/bounded-runner/policy.sh:25` `br_prefix_allowed` by the captain; this
worker did not edit `policy.sh`. `scripts/bounded-runner/core.manifest` was then
regenerated (header `bounded-runner/1 source-review-unreleased`; policy.sh digest
`8c5ba8daa59796ab92797cffbd5dde5fe10546d1f93a65dba3acafb5a4baefc8`, the other four
unchanged: `common.sh b99d70e8…`, `host.sh 08a12b13…`, `envelope.sh 3c6cff41…`,
`tap.sh bae622fb…`), and both control closures returned 0 with
`control_files=8` before either run. The shared `.acceptance.lock` had no holder
(`fuser` rc=1) and no bounded scopes were active before the first run.

## 8. What no version of this record establishes

* that a real page rendered these rows, or that any declared asset exists or loads;
* that the host reads `dsh.client.assets` or `dsh.conflicts` — it does not;
* that disabling an entry repairs an already-failed fiber — it does not;
* that `ctx.isolate()` can re-scope a failed fiber — it cannot;
* that any of C1–C11 is prevented — prevention is A2's static pre-check, before
  install.
