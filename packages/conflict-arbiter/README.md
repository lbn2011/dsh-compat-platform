# dsh-compat-conflict-arbiter (A3)

Arbitrates a plugin that **already failed** to load, according to the strategy
that plugin declared — and refuses to pretend it can repair what it cannot.

## Why this plugin exists

When two plugins provide the same service, cordis throws from `reflect.provide`:

```
service "catalog" has been registered at <shop-plugin>
```

The second plugin's fiber goes to `FAILED` and stays there. There is no public
per-entry reload (`PluginManager.reload` is private), so nothing can silently
re-run the loser in a better scope. What *is* possible is to notice the failure,
read what the plugin asked for, and act within the public management API — or say
plainly that the requested action belongs to a loader this plugin does not own.

## How a failure is observed

| Step | Detail |
| --- | --- |
| Signal | `internal/status(fiber, oldState)` |
| Trigger | only a transition **into** `FiberState.FAILED` (`3`), never a repeat |
| Evidence | `PluginInfo.diagnostic`, the inventory's own statement of failure |
| Text handling | ANSI stripped, classified, then **digested** — the message is never stored |

`Fiber._error` is private, so the failure text is reachable only through the
inventory. The fiber in the event tells us *when* to look, not *which* entry
failed (`THE_FAILING_FIBER_IS_IDENTIFIED_THROUGH_THE_INVENTORY_NOT_THE_EVENT`).
One pass also runs at attach time, because a plugin can fail during the
composition that is loading this service.

Classification reads the host's real messages:

| Text | Kind | Fields |
| --- | --- | --- |
| `service "X" has been registered at <Y>` | `duplicate-service` | `service: X`, `existingOwner: Y` |
| `property "X" is already declared as T` | `property-conflict` | `service: X`, `declaredAs: T` |
| anything else | `unclassified` | reported, never forced into a kind |

## The declared policy

```json
{ "dsh": { "conflicts": { "strategy": "disable-later", "service": "catalog" } } }
```

Also a **proposed extension**: the host does not read `dsh.conflicts`. Only the
failing entry's own manifest is read.

| Strategy | Action | What actually happens |
| --- | --- | --- |
| `report-only` (default) | `report` | a record and an event; nothing is changed |
| `disable-later` | `disable-entry` | `pluginManager.setPluginEnabled(entryId, false)` |
| `isolate` | `needs-isolated-loader` | an isolated child context is created and returned; **no repair is claimed** |

Refusals, each with its own code:

* `ENTRY_NOT_ADDRESSABLE` — the entry has no `entryId`;
* `ARBITER_DOES_NOT_DISABLE_ITSELF` — disabling ourselves would end the only
  reporter and punish the arbiter for doing its job;
* `ENTRY_IS_READ_ONLY` — `readOnlyReason` marks entries a profile control cannot
  modify; asking anyway produces an error nobody can act on;
* `STRATEGY_NEEDS_ISOLATED_LOADER` — `ctx.isolate()` returns a child context that
  only affects plugins loaded **below** it (`cordis/lib/types/context.d.ts:79-83`);
  it cannot re-scope a fiber that already failed. A loader must load the loser
  inside the returned scope for the strategy to mean anything.

An unknown strategy is **refused, not coerced** to the default: a plugin that
asked for something we do not implement must not silently get a different action.

## Ordering and idempotence

A decision is keyed by `entryId` + digest of the diagnostic, so the same failure
is decided once even across repeated passes; a changed message is a new fact.
Records are bounded by `maxDecisions` (default 200). `inspect()` is single-flight.

`disable-later` trusts `ChangeResult.application`: `applied` and
`restart-required` count as applied, `failed` / `overridden` / `cancelled` do not,
and a thrown management call is `DISABLE_FAILED` — never success.

## What it does not do

* does not prevent a conflict — it runs after the failure
  (`ARBITRATION_RUNS_AFTER_A_FAILURE_AND_CANNOT_PREVENT_ONE`);
* cannot make a disabled entry take effect on the already-loaded fiber
  (`A_DISABLE_APPLIES_TO_THE_ENTRY_NOT_TO_THE_ALREADY_LOADED_FIBER`);
* does not verify the plugin's claim about itself
  (`CONFLICT_POLICY_IS_DECLARED_BY_THE_PLUGIN_THAT_LOSES_AND_IS_UNVERIFIED`);
* prevention belongs to the static pre-check (A2) before install
  (`PREVENTION_BELONGS_TO_A_STATIC_PRE_CHECK_BEFORE_INSTALL`).

## Configuration

```yaml
- id: dsh-compat:conflict-arbiter
  name: dsh-compat-conflict-arbiter
  config:
    defaultStrategy: report-only   # report-only | disable-later | isolate
    maxDecisions: 200
    selfEntryId: dsh-compat:conflict-arbiter
```

`selfEntryId` is what lets the arbiter recognise itself and refuse. Unknown keys
and out-of-vocabulary strategies are refused with a `TypeError`.

## Events

| Event | Payload |
| --- | --- |
| `dsh-compat/conflict-arbitrated` | one record: entry, digest, classification, strategy, action, codes, `applied` |

## Tests

```
TMPDIR=/root/kit-scratch/tmp node --test --test-concurrency=1 "tests/*.test.js"
```

55 cases: `tests/failure-classify.test.js` (10), `tests/arbiter-policy.test.js` (17),
`tests/conflict-arbiter.test.js` (28). Bounded verification runs through
`scripts/conflict-arbiter-batch/`.
