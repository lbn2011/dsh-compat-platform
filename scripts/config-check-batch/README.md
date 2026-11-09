# config-check-batch — source-only bounded-runner migration

**Status: SOURCE-ONLY, awaiting Lead verification.** No execution, syntax
qualification, unit run, case run or commit was performed for these bytes.
Historical runs of other revisions do not qualify this one. The repository-local
[core](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner/README.md>) is ABI `bounded-runner/1`; the migrated sibling
[correspondence-batch](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/correspondence-batch/README.md>) supplied every idiom used here.

## Interface

```bash
CONFIG_CHECK_ENGINE_ROOT=/data/dsh-ecosystem-test-artifacts/runs/20261109T184644Z-config-engine-install-1145262-32328/work/node_modules \
  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/config-check-batch/run.sh
```

The invocation must be **absolute**. Control closure compares every
`BASH_SOURCE` frame against the absolute control paths, so a relative path is
refused with **77** before anything runs. No arguments are accepted; any argument
is **70**.

`CONFIG_CHECK_ENGINE_ROOT` names the acquired tree's `node_modules` directory —
the same variable the package's own CLI reads
([config-check-cli.js](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/config-check/src/config-check-cli.js>)). The single acquired tree for this
batch is:

```
/data/dsh-ecosystem-test-artifacts/runs/20261109T184644Z-config-engine-install-1145262-32328/work/node_modules
```

`CONFIG_CHECK_RUNS_ROOT` may override the absolute artifact root (default
`/data/dsh-ecosystem-test-artifacts/runs`).

**The core cannot forward the caller's environment.** `br_host_run` builds a
fixed `systemd-run` argv with no `--setenv`, so a variable exported before the
wrapper does not reach the payload. The payload therefore reads
`CONFIG_CHECK_ENGINE_ROOT` when it is present and otherwise falls back to the one
tree above, recording which source it used in `engine-root.txt`
(`source=env|recorded-default`). The path is stated again inside every CLI
sandbox, because each case replaces its environment with `env -i`.

## Interface shape

[run.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/config-check-batch/run.sh>) makes one core call, no retry, in a dedicated subshell with
`set +e` and `set -uo pipefail`: `br_host_run "$CORE" "$SLICE/run.sh"
"$SLICE/payload.sh" "$RUNS" "$BR_UNIT_PREFIX"` with the prefix
`config-check-batch`. `BR_EXTRA_CONTROL=()`; `BR_WORKLOAD_EXITS=(0 70 71 72 73 74)`.
`BR_SELECTED_INPUTS` is the explicit 15-file list: the package manifest and
README, the five `src/` files, both test files, the three package
`examples/*.json`, and this trio's `run.sh`, `payload.sh` and `README.md`.

[payload.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/config-check-batch/payload.sh>) takes exactly two arguments (`unit`, `run`), calls
`br_envelope_enter` first and only then checks preconditions. Every workload has
its own `br_evidence_gate` and preopened stdout/stderr.

## The four steps

1. **Preconditions.** `bash -n` on both scripts, then `node --check` on each
   JavaScript file in the selection (`src/config-check.js`,
   `src/hyperjump-engine.js`, `src/config-check-cli.js`, and both test files).
   The `node --check` calls run only when both `bash -n` calls succeeded. A
   declaration file is not syntax-checked by this step and a parse is not a type
   check. Failure is **71**.
2. **Unit suite.** `node --test --test-concurrency=1 --test-reporter=tap
   'tests/*.test.js'` from the package directory inside bubblewrap with
   `--ro-bind / / --dev /dev --proc /proc --tmpfs /tmp`, all four unshares,
   `--die-with-parent`, and `env -i PATH HOME TMPDIR
   NODE_OPTIONS=--max-old-space-size=192`. TAP is normalised by the core's strict
   singleton reader (`br_tap_value` per field, `br_tap_check` for the verdict);
   `unit/tap-fields.txt` is written with the six fields and read back only after
   `br_tap_check` has returned. `tests >= 46` is required in addition to the
   core rule `tests = pass > 0` and `fail = cancelled = skipped = todo = 0`. The
   suite is 28 + 18 tests. Failure is **72**.
3. **Three CLI cases** against the acquired engine, each in its own bubblewrap
   that binds only `/usr`, the Node prefix, the engine tree, the package and this
   run directory — all read-only — with `--unshare-net` and an `env -i` whose
   `CONFIG_CHECK_ENGINE_ROOT` names the bound engine directory:
   `examples/valid.json` must exit **0** with `schemaStatus=checked`,
   `valid=true`; `examples/invalid.json` must exit **1** with exactly three
   findings on `config.retries`, `config.mode` and `config.endpoint`; the third
   case is generated in the run directory and must exit **2** with
   `NOT_CHECKED_SCHEMA_LITERAL_HAS_IDENTIFIER` for a schema whose `const` literal
   contains `{"$anchor":"x"}`. Each case keeps stdout, stderr and its exit code.
   **Any exit or summary mismatch is evidence failure 73, never a green run** —
   the expected nonzero exits are checked as data, not waved through.
4. **Leak assertion.** All three case stdout files are searched for the
   configuration text `not a uri` and for the credential-shaped sentinel
   `sk-live-SECRET` (carried by the generated third instance, so the assertion has
   a real subject). A hit in a report is **73**: configuration values must never
   reach a report, and this is what proves it.

## Exits

0 green; 70 argument/preflight/envelope/engine-tree refusal; 71 syntax or
`node --check` precondition; 72 unit TAP or test-count verdict; 73 evidence
failure, case mismatch or leak; 74 timeout or unsettled unit; 75 held lock;
76 directory collision; 77 hash/control-closure failure; 78 control or selected
drift. 74 and 75–78 belong to the core; 70–73 are this payload's own. Evidence
failures override otherwise green or non-green workload results.

## Artefacts

Core-owned: `status.txt`, `selection.txt`, `control-{before,after,diff}.txt`,
`selected-{before,after,diff}.txt`, `argv.txt`, `requested.txt`, `unit.log`
(host only), `launch.txt`, `systemd-run.rc`, `journal.txt`, `journal.rc`,
`terminal-before.txt`, optional `terminal-after-stop.txt`, `terminal.txt`,
`active-units.txt`, `ownership*.txt`, `envelope-*.txt`, `memory-gate.txt`,
`peaks.txt`, `payload-result.txt`, `payload-evidence.txt`.

Payload-owned: `engine-root.txt`, `workload.txt`, `syntax-run.{log,err,txt}`,
`syntax-payload.{log,err,txt}`, five `node-check-*.{log,err}`, `syntax.txt`,
`unit/tap.log`, `unit/tap.err`, `unit/tap.rc`, `unit/tap-check.txt`,
`unit/tap-fields.txt`, `check-case.mjs`, `case-{valid,invalid,notchecked}.{stdout.json,stderr.txt,rc}`,
`case-notchecked.{schema,instance}.json`, `check-*.{log,err,rc}`, `case-verdict.txt`,
`leak.txt`, `verdict.txt`. Only the host writes `unit.log`; no run artifacts were
produced by this migration.

## Where this deviates from the sibling, and why

- **Prefix allowlist.** `br_prefix_allowed` and `BR_UNIT_FAMILIES` in
  [policy.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner/policy.sh>) are `readonly` and do not list `config-check-batch`. Until the
  core adds it to both, `br_host_run` refuses at preflight with **70** and no
  unit is created. The core is out of scope for this change; the wrapper already
  passes the prefix the core should accept.
- **`BR_UNIT_PREFIX`.** The sibling hard-codes its prefix in the call. This
  wrapper names it once in `BR_UNIT_PREFIX` and passes it as the fifth argument.
  The core reads no such variable; it is a wrapper-local spelling, not a new ABI.
- **`normalize_tap`.** The core's [tap.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner/tap.sh>) defines `br_tap_value` and
  `br_tap_check`, not `normalize_tap`. Normalisation here is exactly those two
  helpers; no TAP parser was invented.
- **Five `node --check` targets, not four.** The selection contains five
  JavaScript files; all five are checked, which is a superset of four.
- **`unit/` subdirectory.** `tap-fields.txt` is written under `unit/` as
  required, so the unit-test artefacts live there together; the sibling kept them
  at the run root.
- **Engine root fallback.** See the interface note above: the core has no
  `--setenv`, so the fallback is required for the sandboxed payload to see a tree
  at all.

## Non-claims

The engine is **third party and unpatched**; its conformance is not established
here and no patch is authorised. Exactly **one** acquired tree is used, from one
install run; other trees, other versions and a reinstall are untested. This is
**not a conformance claim** about JSON Schema 2020-12, Hyperjump or this
repository's protocol: the judged subset is whatever the engine evaluates minus
the affected-literal case, and a `not-checked` result is not a pass. There is
**no production profile** here — nothing loads a plugin, reads a profile or
contacts a host. This is **not the full suite**: it runs one package's tests, not
the repository's. Selected inputs are a broad explicit **selection, not a
dependency closure**; the engine tree, Node, bubblewrap and system tools are
outside it. `certification` remains false, and the checker's own `notDerived`
list stands.
