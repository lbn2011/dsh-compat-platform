# spec-test-batch — bounded full-suite run for `packages/analyzer`

**AUTHORED 2026-11-12 for task t8 (A2 static pre-check + D1 layer attribution).**
The slice reuses the repository-local [bounded-runner](../bounded-runner/README.md)
core unchanged (`bounded-runner/1 source-review-unreleased`, five hashed modules plus
`core.manifest`). Its unit base `spec-test-batch` is already listed in
`br_prefix_allowed` and `BR_UNIT_FAMILIES` in
[policy.sh](../bounded-runner/policy.sh), so **no policy file is edited**.

It exists because of a narrow, checked observation: the slices inspected for this
task — `profile-dump-batch`, `diagnose-batch`, `dependency-shape-batch`,
`correspondence-batch`, `trusted-extraction-batch` and `repair-plan-batch` — each pin
either one test file of the analyzer or a glob belonging to another package
(`packages/repair`). No inspected analyzer slice runs this package's `*.test.mjs`
files. `policy.sh` also lists an `analyzer-test-script-batch` unit family; that slice
was **not** inspected and this README does not claim it is absent or unusable.

Task t8 adds `tests/pre-check.test.js` and `tests/profile-dump-layers.test.js`, and
also changes `src/profile-dump.js` (schema `0.4-draft.1`) and the root export
surface, so a slice pinned to one file cannot show what those changes did to the rest
of the suite. This slice therefore runs the package's own test glob verbatim.

## Invocation and scope

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/spec-test-batch/run.sh
```

No arguments. Use the absolute entry path so control-source closure matches.
`SPEC_TEST_RUNS_ROOT` retains its default `/data/dsh-ecosystem-test-artifacts/runs`;
any override must be absolute. One launch, no retries, no installation.

[run.sh](run.sh) declares its selected inputs explicitly (package manifest, package
README, this README, the analyzer sources and declarations touched by t8, the two new
test files) and then adds every regular file under `src/`, `tests/` (including
`tests/helpers/`) and `fixtures/` by glob. It refuses an empty required category and
refuses any selected path that is not an absolute regular file. It calls
`br_host_run` in a dedicated subshell with errexit disabled.

[payload.sh](payload.sh) enters the verified envelope and runs, in order:

1. `bash -n` on both scripts, recorded separately; a failure stops before Node.
2. A static Node contract over `package.json`: exact `scripts.test`, `yaml` `2.9.1`
   as the only dependency, both bins (`dsh-compat-profile-dump`,
   `dsh-compat-pre-check`), both subpath exports (`./profile-dump`, `./pre-check`)
   as types/default pairs, and the eleven files this slice exists to qualify. A
   missing/unreadable/wrong YAML install is `acc_static_contract=blocked` with
   `acc_block_reason=yaml_dependency_not_installed` and acceptance `71`; it never
   installs anything.
3. A sorted regular-file SHA-256 manifest of `node_modules/yaml` before and after the
   workload, refusing a symlinked YAML directory or any symlink below it.
4. Exactly one sandboxed Node run of the package's full test glob:

```bash
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir /root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     /www/server/nodejs/v24.21.0/bin/node --test --test-concurrency=1 \
       --test-reporter=tap 'tests/*.test.js' 'tests/*.test.mjs'
```

The two glob patterns are passed literally and expanded by Node's own test runner,
which is the same expansion the package's `scripts.test` performs. Root is
read-only, scratch is a private tmpfs, PID/network/IPC/UTS namespaces and
`--die-with-parent` are retained, and the run directory is not writable from the
sandbox.

## Envelope, evidence and verdict

Fixed core policy, not tunable here: `Type=exec`, memory 384 MiB, swap 0, tasks 32,
CPU 50%, runtime 120 s, Node heap 192 MiB, one `MemAvailable >= 819200 KiB` gate, and
one nonblocking lock shared with every other bounded run in this workspace. The core
verifies actual cgroup membership plus `InvocationID` and can stop only the exact
unit with a verified ownership receipt.

Evidence gates precede each syntax subprocess, the static Node contract and the test
workload. Node's stdout/stderr destinations are opened and checked before Node
starts, so a failed write cannot become a green verdict. YAML snapshots are a
two-point observation only — not provenance, not installation integrity, not
transient-edit protection. Strict six-field TAP requires exactly one valid
tests/pass/fail/cancelled/skipped/todo summary with `tests = pass > 0`, every other
count zero, and Node exit 0; malformed duplicates, missing fields, skipped tests and
TODOs cannot pass.

Exits: `0` green; `70` refusal/unknown workload exit; `71` syntax/static/dependency
failure; `72` test/TAP/YAML drift; `73` evidence failure; `74` timeout/unconfirmed
terminal; `75` lock held; `76` run collision; `77` hash read/manifest failure; `78`
selected/control input drift. Precedence: evidence > hash > terminal > workload.

## What this slice does not claim

A green result says the analyzer's own suite passed inside the envelope at one point
in time. It does **not** establish that real DSH hosts load these plugins, that a
declaration's `configSchema` admits any particular config, that dependency
installation is complete, or that anything outside the selected inputs is unaffected.
The selection is conservative, not a dependency closure: YAML is covered only by its
snapshots, and external tools, newly added files after selection and transient edits
restored between samples are not covered. Keep the checkout immutable for an
authorized run.

## Status

Authored for t8. It has been `bash -n` checked and reviewed line by line against
[profile-dump-batch](../profile-dump-batch/README.md), the closest existing slice, but
its first execution is the t8 bounded verification run; read the run directory
receipts (`control-before.txt`, `selected-before.txt`, `syntax.txt`,
`static-verdict.txt`, `workload.txt`, `node-tap.log`, `node.rc`, `yaml-manifest*.txt`,
`payload-result.txt`) before quoting any number from it.
