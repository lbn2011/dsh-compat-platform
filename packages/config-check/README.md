# @dsh-compat/config-check

Judges one configuration value against one declared contract schema, and says
`not-checked` when it cannot judge honestly.

This package is **prepared, not measured**: the checker runs and its unit suite
passes, but its batch under the shared bounded runner has not been run yet, and
the engine it depends on is acquired into a disposable artifact directory rather
than installed as a dependency of this repository.

## What it does

```
config-check <schema.json> <instance.json> [--entry-label <word>]
```

- `schema.json` — the contract a declaration carries (`configSchema` in protocol
  revision `0.2.0-draft.1`), a JSON Schema 2020-12 document.
- `instance.json` — the configuration value to judge.

Exit codes: `0` valid, `1` invalid, `2` not checked or refused, `5` internal,
`64` usage.

The engine is looked up as `@hyperjump/json-schema/draft-2020-12` unless
`CONFIG_CHECK_ENGINE_ROOT` names a directory that holds it (the acquired tree's
`node_modules`). Nothing is fetched at run time.

## What a result says

A result is one of three things, and the third is not a pass:

| `schemaStatus` | meaning | exit |
|---|---|---|
| `checked` + `valid: true` | the value satisfies the schema inside the judged subset | 0 |
| `checked` + `valid: false` | it does not; `findings` lists where | 1 |
| `not-checked` | this build declines to judge, with a fixed reason word | 2 |
| `refused` | the schema was not usable at all, with a fixed reason word | 2 |

Each finding carries a **key path** (`config.retries`, `config.items[2].mode`), a
closed keyword word (`maximum`, `enum`, `format`, …) and a summary of what the
schema allowed there — type names, format name, enum size, bounds, whether a
pattern exists, how many properties are declared.

A finding never carries a configuration value, a schema literal, the pattern
itself, an engine message, an engine `data` field or a `schemaPath`. That is the
whole reason the summary is shaped this way: a report is meant to be quotable
without quoting the thing being checked.

## Why `not-checked` exists

The acquired Hyperjump build interprets identifier keywords (`$id`, `$anchor`,
`$schema`, `$ref`, …) **inside data literals**, so a `const`, `enum`, `default`
or `examples` value that itself contains one of those keys is registered as a
reference instead of compared as data. Fourteen of twenty-two fixed cases
reproduce this; eight controls stay correct
(`docs/testing/2026-11-10-config-engine-reproduction.md` in the platform repo).

No patch is authorised. So when a schema uses an affected literal anywhere, this
checker returns `not-checked` with `NOT_CHECKED_SCHEMA_LITERAL_HAS_IDENTIFIER`
and names which literal keyword triggered it — rather than producing a verdict
it cannot stand behind.

Format assertions are the mirror case: the engine only enforces `format` when the
formats entry point is imported **and** the switch is set. The adapter does both,
and reports `formatAssertion: 'asserted'`; a build without the formats entry
would report `'not-asserted'` instead of silently accepting a malformed value.

## Limits

- The judged subset is whatever the engine evaluates minus the affected-literal
  case. A `not-checked` result is **not** a pass.
- `certification: false` and a fixed `notDerived` list ride on every result: a
  validated configuration says nothing about `declarations`,
  `availableCapabilities`, `resources`, `activation`, `loadability`,
  `dependencyResolution` or the `configurationValue` itself.
- Key paths are relative to the declared entry, not to a profile.
- The engine is third party and unpatched; its conformance is not established by
  this package.
- Nothing here reads a profile, loads a plugin or contacts a host.
