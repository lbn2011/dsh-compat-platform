# dependency-shape-batch — source-only bounded-runner migration

**Source-only; awaiting Lead bounded verification.** These migrated bytes have not
been executed, syntax-checked, or tested. Historical evidence does not qualify them.
The local [core](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner/README.md>) is the canonical `c8123de` source; the spec pilot `1615ecf` informed this migration.

## Interface and workload

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/dependency-shape-batch/run.sh
```

No arguments. `DEPENDENCY_SHAPE_RUNS_ROOT` may override the absolute artifact root
(default `/data/dsh-ecosystem-test-artifacts/runs`). One launch, no retry; shared
nonblocking acceptance lock. [run.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/dependency-shape-batch/run.sh>) calls the core in a dedicated subshell with
`set +e` and `set -uo pipefail`. [payload.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/dependency-shape-batch/payload.sh>) retains:

- Both in-envelope Bash syntax checks, then the original static contract: exact test
  script, pinned `yaml@2.9.1`, bin/export targets and test presence. Missing, unreadable,
  or mismatching installed YAML is still static exit 3 mapped to batch 71; no install.
- The shipped [profile](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/examples/dependency-shape/profile.yml>) CLI invocation, expected exit 0 and all original counters and shape checks:
  rows 4, rowsWithInject 3, absent/null/sequence/mapping each 1, other 0,
  items/names each 2, mappingKeys 1, emptyMappings/nonScalarItems/taggedItems each 0;
  no diagnostics, six notDerived entries, nine limitations, certification false.
- Serial TAP invocation of [dependency-shape.test.js](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer/tests/dependency-shape.test.js>), and YAML regular-file snapshots before the example and after the suite.
  Symlinked YAML roots/contents are refused. These are two-point comparisons, not
  installation integrity, provenance, or proof against reverted intermediate changes.

The core verifies ownership/cgroup identity, 384 MiB memory, swap 0, 32 tasks,
50% CPU, 120 seconds and one MemAvailable >= 819200 KiB gate. All Node processes,
including the example checker, explicitly use a cleaned environment and heap 192.
Each workload has an evidence gate and preopened output destinations. The core
finalizer handles every normal valid-argument exit, including refusals.

TAP uses the core's strict six singleton fields: tests=pass>0 and
fail=cancelled=skipped=todo=0; missing, duplicate or malformed fields fail.

## Hash selection and limits

The core hashes both scripts, its manifest and all five core modules before/after.
There are no additional sourced controls. Selected workload inputs include this
README, package manifest/README, every regular file under analyzer src/tests
(including helpers and nested fixtures), analyzer fixtures and the dependency-shape
example tree. This broad selection is **not dependency closure**. Installed YAML is
covered only by the separate payload snapshots; Node/system tools are not hashed.
No real host/plugin loading, runtime dependency resolution or certification is claimed.

## Exits

0 green; 70 argument/preflight/envelope refusal; 71 syntax/static/dependency
precondition; 72 example/TAP/YAML verdict; 73 evidence failure; 74 timeout or
unsettled unit; 75 held lock; 76 directory collision; 77 hash failure;
78 control or selected-input drift. Evidence failure overrides workload verdicts.

## Artifact migration

Core artifacts replace the former combined hash and terminal schemas:
`control-before.txt`, `control-after.txt`, `control-diff.txt` and
`selected-before.txt`, `selected-after.txt`, `selected-diff.txt` replace
`hashes-before.txt`, `hashes-after.txt`, `hashes-diff.txt`.
`selection.txt` now distinguishes control/selected counts and records
`workload_dependency_closure=no`. `terminal-before.txt`, optional
`terminal-after-stop.txt`, and `terminal.txt` replace terminal-query/stop-confirm
files. `active-units.txt` contains query rc plus merged output; no separate
`active-units.err`. Core ownership, requested envelope, launch, journal/status,
`payload-result.txt`, `payload-evidence.txt` and measured/unavailable peaks are added.
Envelope evidence is now `envelope-systemctl.txt`, `envelope-getunit.txt`,
`envelope-runtime.txt`, `envelope-effective.txt`, and `memory-gate.txt`.

Workload names retained: `syntax.txt`, `static-contract.mjs`, `static-contract.log`,
`static-verdict.txt`, `example.stdout.json`, `example.stderr.txt`, `example.rc`,
`example-verdict.txt`, `example-check.err.txt`, `workload.txt`, `node-tap.log`,
`node-stderr.log`, `node.rc`, `tap-fields.txt`, `tap-summary.txt`, `tap-verdict.txt`,
and the YAML manifest files. Static stderr and rc now have separate
`static-contract.err`/`static-contract.rc`; syntax streams, example-check stdout/rc,
and YAML snapshot/diff stderr are separate artifacts. TAP summaries now contain
six core values (`<invalid>` on parse failure), fields are `ok|invalid`, and the
verdict includes `tap_check_rc`; old byte/line counts are not emitted.
Only the host writes `unit.log`. No artifacts were generated by this migration.
