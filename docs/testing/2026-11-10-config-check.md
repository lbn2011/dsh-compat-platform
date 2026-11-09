# Config checker — bounded verification

Status: **executed, four invocations, the last two green on identical inputs.**
The first two were green against an earlier revision of the shared runner's
policy module and are kept below, labelled superseded, because the control
closure changed after they ran.

Scope: `packages/config-check` and `scripts/config-check-batch`, under the
shared runner `scripts/bounded-runner` (ABI `bounded-runner/1`).

## 0. What this does not establish

- The engine is third party (`@hyperjump/json-schema@1.18.0` plus
  `@hyperjump/browser@1.6.0`) and **unpatched**. This slice does not re-run the
  22-case reproduction, does not claim conformance, and does not claim the
  affected-literal defect is fixed.
- The engine is read from one acquired tree, itself produced from one reviewed
  lock. A second acquisition, a second lock, or a registry re-publish is not
  verified here.
- `54` unit tests plus three CLI cases are not the JSON Schema test suite.
- No production profile is read, no plugin is loaded, no host is contacted, and
  `certification` stays `false` on every result.
- A green run says the checker behaves as documented on these inputs; it says
  nothing about whether a configuration is *correct* for a plugin, only whether
  it satisfies a declared contract.

## 1. What changed

| file | change |
|---|---|
| `packages/config-check/package.json` | new package `@dsh-compat/config-check`, private, two exact dependencies |
| `packages/config-check/src/config-check.js` | result shape, closed word sets, affected-literal scan, expectation summary, key-path rendering |
| `packages/config-check/src/hyperjump-engine.js` | engine adapter: dialect handling, BASIC errors, format assertion |
| `packages/config-check/src/config-check-cli.js` | CLI plus `--declaration` mode |
| `packages/config-check/src/*.d.ts` | declarations |
| `packages/config-check/tests/*.test.js` | 54 unit tests, fake engine only |
| `packages/config-check/examples/*.json` | one contract, one valid value, one invalid value |
| `packages/config-check/README.md` | behaviour, result kinds, limits |
| `scripts/config-check-batch/{run.sh,payload.sh,README.md}` | bounded runner triple |
| `scripts/bounded-runner/policy.sh` | `config-check-batch` added to the unit-prefix allowlist and to `BR_UNIT_FAMILIES` |
| `scripts/bounded-runner/core.manifest` | `policy.sh` digest refreshed |
| `projects/dsh-compat-spec/scripts/bounded-runner/*` | vendored copy re-synced, `UPSTREAM.md` re-pinned |

## 2. Rounds

| # | run directory | core policy.sh | verdict | tests | cases | peak B | pids | MemAvailable KiB |
|---|---|---|---|---|---|---|---|---|
| 1 | `20261109T192002Z-config-check-batch-1179202-30581` | pre-family-add | pass | 54/54 | 0/1/2 | 35553280 | 16 | — |
| 2 | `20261109T192022Z-config-check-batch-1179795-30700` | pre-family-add | pass | 54/54 | 0/1/2 | 35254272 | 16 | — |
| 3 | `20261109T192107Z-config-check-batch-1180774-27046` | `67ab0cd1…` | pass | 54/54 | 0/1/2 | 38039552 | 16 | 1430840 |
| 4 | `20261109T192118Z-config-check-batch-1181195-8371` | `67ab0cd1…` | pass | 54/54 | 0/1/2 | 36065280 | 16 | 1453040 |

Rounds 1 and 2 are **superseded**: `policy.sh` did not yet carry
`config-check-batch` in `BR_UNIT_FAMILIES`, so the active-unit guard could not
have seen a concurrent unit of this family. The wrapper refused `70` before
launching anything until the prefix was added to `br_prefix_allowed`; both
guards were fixed together, `core.manifest` refreshed, and rounds 3 and 4 were
run against those bytes.

Rounds 3 and 4: `verdict=pass`, `tap_check_rc=0`, `tap_tests=54`,
`acc_cases=pass`, `acc_leak=clean`, `terminal_ok=yes`, `hash_rc=0`,
`write_failures=0`, terminal `not-found/inactive/dead` with `MainPID=0` verified
through this unit's own `InvocationID`. `control-before.txt` and
`selected-before.txt` are byte-identical between the two rounds; each round's
before equals its own after.

## 3. What the three cases showed

- `examples/contract.json` + `examples/valid.json` → exit `0`, `schemaStatus: checked`, `valid: true`.
- `examples/contract.json` + `examples/invalid.json` → exit `1`, three findings:

  ```
  config.retries   maximum  {type: integer, minimum: 0, maximum: 5}
  config.mode      enum     {type: string, enumSize: 2}
  config.endpoint  format   {type: string, format: "uri"}
  ```

  The `format` finding is the reason the formats entry point matters: with only
  `setShouldValidateFormat(true)` and no `@hyperjump/json-schema/formats` import,
  all 19 formats accept obviously invalid values. The adapter imports both and
  reports `formatAssertion: 'asserted'`.
- A schema generated in the run directory whose `const` literal carries
  `{"$anchor":"x"}` → exit `2`, `schemaStatus: not-checked`,
  `NOT_CHECKED_SCHEMA_LITERAL_HAS_IDENTIFIER`, and no engine call.
- The leak assertion found neither the configuration value `not a uri` nor the
  sentinel `sk-live-SECRET` in any case's report.

## 4. Defects found while building this

1. **The engine's `absoluteKeywordLocation` points at the keyword, not the
   subschema.** `…/properties/retries/minimum` has the value `0`, so rendering an
   expectation from it produced `{}` for every finding. Fixed by resolving
   `keywordPath.slice(0, -1)`.
2. **Dialect-qualified keywords were dropped.** `…/keyword/draft-2020-12/format`
   does not fit a single-segment pattern; the word was reported as `unknown`. The
   unit test that pinned `a/b → unknown` was itself wrong and was corrected to
   `a/b → b` plus a dialect case.
3. **Declaration mode required two positionals.** In `--declaration` mode the
   schema comes from the declaration, so only the instance is positional; every
   such invocation exited `64` until the arity was fixed.
4. **The shared core refused this runner twice.** `br_prefix_allowed` rejected
   `config-check-batch` (`exit 70`, no unit created), and `BR_UNIT_FAMILIES`
   lacked `config-check-batch-*`. Both were added; the second is the control that
   makes the concurrent-unit guard see this family.
5. **A synthetic declaration was refused by the real grammar** — `capabilities`
   is an object, not an array. The refusal was correct and is what made the
   declaration path get exercised against the real validator rather than a stub.

## 5. Deviations

- Rounds 1–2 ran against a `policy.sh` that lacked the family entry; they are
  kept, labelled superseded, and not counted as accepted evidence.
- Several exploratory executions happened outside any envelope while
  developing: the 19-format enumeration, the format-entry comparison, and the
  end-to-end CLI runs against the acquired engine. They shaped the design and are
  not evidence.
- `scripts/config-check-batch/{run.sh,payload.sh}` were created mode `600` and
  changed to `755` before round 1. File modes are not in the hash manifest.
- The batch runner triple and its README were authored by a subagent and
  reviewed by the Lead before execution; the Lead wrote this record, its README
  status lines, and fixed five of the six defects in §4.
- `packages/config-check/README.md` and `scripts/config-check-batch/README.md`
  are selected inputs; both were finalised before rounds 3–4. The design doc was
  edited after the rounds and is therefore not in the selection.
- `projects/dsh-compat-spec/scripts/bounded-runner/UPSTREAM.md` was re-pinned
  after rounds 3–4 (the pin names the commit that carries the core change), so
  the spec pilot was re-run afterwards; that re-run is recorded in
  `projects/dsh-compat-spec/docs/testing/`.

## 6. Hashes at round 4

See `selected-before.txt` in the run directory for the authoritative list. The
package files:

| file | sha256 |
|---|---|
| `src/config-check.js` | `91e00c230d1ed3043cf6e064de12963c3af65d96c925341ed549fcfa512eadfb` |
| `src/hyperjump-engine.js` | `6985a559ca7691bc47981ce67588e2a4e91f23756dd082f7a568ee9ca577a1ea` |
| `src/config-check-cli.js` | `470766fffd6b9d336096c5c24de85d1f315535d9676ab093e850da981cff50e6` |
| `tests/config-check.test.js` | `237edbc5af15ffdc3399ac7b8ac2651831f2daa080854e200ceddda401880f48` |
| `tests/hyperjump-engine.test.js` | `c949cc030dc84fc2729f6114201a30409c5000e8e4c4084c8d2d6765e4ddf031` |
| `scripts/bounded-runner/policy.sh` | `67ab0cd1240058a3e96852007ac753b479edf06a7ad7ec5c466fc1d47d02d4ab` |

The authoritative list of every selected input and control file for those two
rounds is `selected-before.txt` and `control-before.txt` in the run directory;
`hashes-after.txt`/`control-after.txt` must match them and did.

## 7. Reproduce

```bash
cd /root/dsh-ecosystem-spec/projects/dsh-compat-platform
CONFIG_CHECK_ENGINE_ROOT=/data/dsh-ecosystem-test-artifacts/runs/20261109T184644Z-config-engine-install-1145262-32328/work/node_modules \
  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/config-check-batch/run.sh
```

Exit `0` green, `70` refused before the envelope, `71` syntax, `72` verdict,
`73` evidence, `75`–`78` launcher-side refusals.
