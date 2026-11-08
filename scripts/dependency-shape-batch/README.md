# `dependency-shape-batch` — bounded acceptance for `dsh-compat-dependency-shape`

Two scripts, one transient systemd unit, no retry:

| File | Runs | Does |
| --- | --- | --- |
| `run.sh` | host | takes the lock, writes a hash manifest of the selected inputs, launches one `systemd-run` unit, reads the unit back and reports |
| `payload.sh` | inside the unit | verifies its own cgroup envelope, the static contract of the command, runs the shipped example, runs the test file, snapshots `yaml` twice, prints the verdict |

Raw artifacts go to `/data/dsh-ecosystem-test-artifacts/runs/<stamp>-dependency-shape-batch-<pid>-<n>/`;
only the narrative record under `docs/testing/` is committed.

## Usage

```bash
bash projects/dsh-compat-platform/scripts/dependency-shape-batch/run.sh
```

Takes no arguments. `DEPENDENCY_SHAPE_RUNS_ROOT` may redirect the artifact root.

## What one run establishes

- the static contract of the command: `yaml` pinned to exactly `2.9.1` and the only dependency,
  `dsh-compat-dependency-shape` as the one `bin`, `./dependency-shape` exporting a `types` sibling,
  the test file present in the suite's glob;
- that the shipped example export `examples/dependency-shape/profile.yml` yields the documented
  counters (`rows 4`, `rowsWithInject 3`, `absent 1`, `null 1`, `sequence 1`, `mapping 1`,
  `items 2`, `names 2`, `mappingKeys 1`) at exit `0` with no diagnostics;
- that `tests/dependency-shape.test.js` is green under a 384 MiB / swap 0 / 32 tasks / 50 % CPU /
  120 s envelope with a 192 MiB heap, and that the `yaml` regular-file manifest is byte-identical
  before and after.

## What one run does not establish

Anything about a real DSH host or a real profile: no export is produced here, no plugin is loaded,
no dependency is resolved, and the suite asserts on this package's own summary. `certification`
stays `false`. The `yaml` two-point snapshot is a comparison of two instants, not a provenance or
install-integrity check. The example is synthetic and is not a valid loader configuration.

## Exit codes

Launcher: `0` green, `70` refusal before or inside the launch, `71` static contract or dependency
precondition failed (no workload started), `72` verdict not green, `73` an evidence write failed,
`74` the unit did not settle, `75` lock held, `76` run-directory collision, `77` a hash manifest
could not be read or written, `78` selected-input drift.

Payload: `0` green, `70` envelope refusal, `71` static contract or dependency precondition
failed, `72` verdict not green, `73` an evidence write failed.

## Files a run leaves behind

`status.txt`, `envelope-verdict.txt`, `memory-gate.txt`, `memory-gate-raw.txt`,
`static-verdict.txt`, `example.stdout.json`, `example.stderr.txt`, `example.rc`,
`example-verdict.txt`, `example-check.err.txt`, `node-tap.log`, `node-stderr.log`, `node.rc`,
`tap-summary.txt`, `tap-verdict.txt`, `yaml-manifest-before.txt`, `yaml-manifest-after.txt`,
`selected_inputs`, `selection.txt`, `hashes-before.txt`, `hashes-after.txt`, `peaks.txt`,
`active-units.err`.

## Deviations seen so far

- The scripts were created mode `600` by the editor and needed `chmod 755` before the first
  launch; that refusal starts no unit and is not a round. File modes are not part of the hash
  manifest.
