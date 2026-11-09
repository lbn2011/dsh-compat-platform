# Five simple wrapper migrations — bounded serial acceptance

**Status: executed by the Lead, once per wrapper, serially; all five green.** These five wrapper
pairs were migrated to the repository-local canonical core
([bounded-runner](../../scripts/bounded-runner/README.md), canonical commit
`c8123de9f7bec62f9b09b5a542cd8fe383169a67`) in a source-only pass and then run once each by the
Lead. This record is written from the retained run directories and the current scripts: no test,
workload, install or commit was run while writing it, only read-only inspection of those artifacts
and scripts.

## 0. What this does and does not establish

Established for the exact bytes and host observed on 2026-11-10:

- Each of the five migrated wrapper pairs launched exactly one bounded unit under the approved
  envelope, reached a settled terminal state, kept control and selected inputs unchanged, recorded
  zero evidence write failures, and returned `acceptance_exit=0`.
- Each wrapper's own workload (unchanged arguments, unchanged assertions) produced the same TAP test
  count as its last pre-migration historical run: **81 / 54 / 37 / 43 / 42**, all passing, zero
  failed/cancelled/skipped/todo.
- The effective cgroup/systemd readback matched the approved limits with `mismatch=0` in every run.

Not established:

- Not a full-suite, host, integration, installation or production qualification. Five of the
  twelve maintained runner pairs were migrated and exercised here; the rest are untouched by this
  record.
- No certification, plugin-loadability, profile-correctness, dependency-provenance or
  hostile-code-containment claim follows. `certification` remains `false` in the product's own
  vocabulary, and the core's cooperative lifecycle is explicitly not a security boundary.
- A single green execution per wrapper is an observation about one host, one checkout, one
  dependency tree and one moment. There was no retry, no repetition and no negative re-run.
- Historical records remain valid **for their own bytes only**. The numbers quoted below are used
  solely to show that the mirrored workloads still assert the same behaviour; the older records do
  not qualify these new scripts, and these runs do not retroactively qualify the older ones.

## 1. Disclosure of how the source and results were produced

- The migration edits (host wrapper, payload, README for each pair) were **authored without
  execution**: no syntax check, no test, no install and no commit was performed while writing them.
  Each migrated README carried a source-only status line, and each `run.sh` header said the same.
- The Lead then reviewed the source and executed each wrapper **exactly once, serially**, in the
  order the run IDs show. There was no retry after any run, green or otherwise, so there is no
  second sample and no evidence of reproducibility.
- Invocation must use the **absolute** entry path, e.g.
  `bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-batch/run.sh`.
  The wrappers declare absolute control paths (`REPO`, `SLICE`, `CORE`, `NODE`) and hash those
  exact strings; a relative-path invocation would refuse with `77` (hash read/manifest failure)
  **before** any launch. A `77` refusal is not a workload failure and must not be read as one.
- The run IDs carry a UTC `Z` stamp while the filesystem timestamps are local (`+08:00`). The five
  runs occupy 2026-11-10 02:31:37–02:32:33 local time, i.e. 18:31:37–18:32:33 UTC on 2026-11-09.

## 2. Shared envelope

Identical for all five runs; requested values are in `requested.txt`, effective values read back
inside the payload in `envelope-effective.txt`.

| Property | Requested | Effective readback |
| --- | --- | --- |
| `Type` | `exec` | `exec` |
| Memory | `MemoryMax=384M` | `memory.max=402653184` |
| Swap | `MemorySwapMax=0` | `memory.swap.max=0` |
| Tasks | `TasksMax=32` | `pids.max=32` |
| CPU | `CPUQuota=50%` | `cpu.max=50000 100000` |
| Runtime | `RuntimeMaxSec=120` | `RuntimeMaxUSec=120000000` |
| Node heap | `NODE_OPTIONS=--max-old-space-size=192` | passed explicitly in every cleaned environment |
| Admission gate | one `MemAvailable` sample | ≥ `819200` KiB |
| Verdict | — | `mismatch=0` in all five |
| Concurrency | shared nonblocking `flock` | held lock is `75`, never a wait |

Each `envelope-effective.txt` also records the actual unified cgroup membership line, and each
`envelope-getunit.txt`/`envelope-runtime.txt` pair shows the two-step `busctl` readback. The
`ownership.txt` receipt is exactly two lines (`unit=`, `invocation_id=`) and matches the unit name
and the 32-hex InvocationID recorded at launch.

## 3. Results

`acceptance_exit` is the wrapper's own exit; `hash_rc` covers control and selected snapshots;
`write_failures` is the sticky evidence counter. "diff empty" means the corresponding `*-diff.txt`
artifact is zero bytes.

| # | Suite | Run directory | Unit | exit | terminal | hash_rc | write_failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | profile-dump | [20261109T183137Z-profile-dump-batch-1130062-12612](</data/dsh-ecosystem-test-artifacts/runs/20261109T183137Z-profile-dump-batch-1130062-12612>) | `profile-dump-batch-20261109t183137z-1130062-17054.service` | 0 | `ok` / settled | 0 | 0 |
| 2 | diagnose | [20261109T183203Z-diagnose-batch-1130885-29028](</data/dsh-ecosystem-test-artifacts/runs/20261109T183203Z-diagnose-batch-1130885-29028>) | `diagnose-batch-20261109t183203z-1130885-3572.service` | 0 | `ok` / settled | 0 | 0 |
| 3 | dependency-shape | [20261109T183218Z-dependency-shape-batch-1131563-11803](</data/dsh-ecosystem-test-artifacts/runs/20261109T183218Z-dependency-shape-batch-1131563-11803>) | `dependency-shape-batch-20261109t183218z-1131563-1686.service` | 0 | `ok` / settled | 0 | 0 |
| 4 | correspondence | [20261109T183228Z-correspondence-1132240-20185](</data/dsh-ecosystem-test-artifacts/runs/20261109T183228Z-correspondence-1132240-20185>) | `correspondence-20261109t183228z-1132240-15099.service` | 0 | `ok` / settled | 0 | 0 |
| 5 | repair-plan | [20261109T183233Z-repair-plan-batch-1132861-25692](</data/dsh-ecosystem-test-artifacts/runs/20261109T183233Z-repair-plan-batch-1132861-25692>) | `repair-plan-batch-20261109t183233z-1132861-22755.service` | 0 | `ok` / settled | 0 | 0 |

In every run `terminal.txt` reads `terminal_ok=yes`, `confirmation=settled`,
`stop_rc=not-attempted`; the runtime unit had already been collected
(`MainPID=0`, `LoadState=not-found`, `ActiveState=inactive`, `SubState=dead`), so no stop was
required and none was attempted. `status.txt` records `phase=completed`, `launch_rc=0` and
`launch_attempted=yes`; `launch.txt` retains the pre-launch `launch=about-to-attempt` marker.

Note on naming: the correspondence wrapper requests the original unit prefix `correspondence`,
not `correspondence-batch`, and the core admits both families. The run directory follows the unit
prefix; the directory suffix is the Lead's launcher PID, not the payload PID.

### 3.1 TAP fields

All six fields are `ok` in all five runs (`tap-fields.txt`); no field was `invalid`, missing,
duplicated or malformed. Values from `tap-summary.txt`:

| Suite | tests | pass | fail | cancelled | skipped | todo |
| --- | --- | --- | --- | --- | --- | --- |
| profile-dump | 81 | 81 | 0 | 0 | 0 | 0 |
| diagnose | 54 | 54 | 0 | 0 | 0 | 0 |
| dependency-shape | 37 | 37 | 0 | 0 | 0 | 0 |
| correspondence | 43 | 43 | 0 | 0 | 0 | 0 |
| repair-plan | 42 | 42 | 0 | 0 | 0 | 0 |

### 3.2 Peaks, controls and selections

Peaks are in-cgroup observations, recorded as `measured` (never invented as zero); they are not
substitutes for the effective-limit readback and are not a resource-admission claim.

| Suite | `memory_peak` (B) | `pids_peak` | control files | selected files | select diff | `workload_dependency_closure` |
| --- | --- | --- | --- | --- | --- | --- |
| profile-dump | 57196544 | 23 | 8 | 72 | empty | `no` |
| diagnose | 42401792 | 16 | 8 | 80 | empty | `no` |
| dependency-shape | 76840960 | 23 | 8 | 63 | empty | `no` |
| correspondence | 54038528 | 23 | 8 | 65 | empty | `no` |
| repair-plan | 34570240 | 16 | 8 | 14 | empty | `no` |

Every run has `control-diff.txt` and `selected-diff.txt` empty, and the YAML-library snapshots
(`yaml-manifest-before/after.txt`, 233 regular files) are byte-identical where the payload takes
them (`yaml-manifest-diff.txt` empty; `yaml_manifest_snapshot_state=identical`). Selection is an
explicit input list, **not** a dependency closure: installed `yaml`, the Node runtime and system
tools are outside it.

### 3.3 Suite-specific outcomes

- **profile-dump** — `acc_static_contract=pass`, `acc_smoke_verdict=pass`,
  `acc_yaml_snapshot=identical`, `node_rc=0`, `tap_check_rc=0`. The two retained `bash -n` steps
  both returned 0.
- **diagnose** — `tests_exit=0`, `tap_check_rc=0`, `acc_smoke_verdict=pass`,
  `acc_yaml_snapshot=identical`.
- **dependency-shape** — `acc_smoke_verdict=pass`, `acc_yaml_snapshot=identical`,
  `acc_example=pass`; the example checker returned 0 with `example.rc=0` and empty stderr.
- **correspondence** — `acc_smoke_verdict=pass`, `acc_example=pass`, `acc_stale=pass`; all four
  Node `--check` calls (module, declaration, CLI, test) returned 0. The shipped example exited 1
  with `CORRESPONDENCE_PLUGIN_NOT_DECLARED` and the single-character `profileSha256` flip exited 2
  with `CORRESPONDENCE_STALE`; both expected nonzero outcomes are checked as workload data and did
  not become runner errors.
- **repair-plan** — `tests_exit=0`, `tap_check_rc=0`, `verdict=pass`; `example-preview` and
  `four-paths` both passed with the fixture digest unchanged before/after
  (`cb17e29249058665802437256e8faa5f1e11113382681d19e7646152b13d3bca`).

## 4. Artifact schema changes versus the pre-migration wrappers

Consumers of the old run directories must migrate; the historical directories keep their old
schema and are not rewritten.

1. **Strict six-field core TAP replaces the permissive parsers.** Each suite previously summarised
   Node's TAP output with its own counting logic (byte/line diagnostics, and in the repair wrapper
   a verdict that never required `cancelled`/`skipped`/`todo` to be zero). The core's
   [`br_tap_check`/`br_tap_value`](../../scripts/bounded-runner/tap.sh) now accepts exactly one
   well-formed summary line per field, rejects missing, malformed **and** duplicate fields,
   requires `tests = pass > 0` and `fail = cancelled = skipped = todo = 0`, and additionally
   requires the original Node exit to be 0. `tap-fields.txt` states `ok`/`invalid`;
   `tap-summary.txt` holds the six canonical values (or `<invalid>`); `tap-verdict.txt` adds
   `tap_check_rc`. A skipped or TODO test can no longer pass, and a duplicate `# pass` line is a
   failure rather than a silent first-match.
2. **YAML diff/count/read errors are now evidence failures (`73`), not drift (`72`).** Previously a
   broken snapshot, an unreadable manifest or a `diff` execution error was folded into the same
   "snapshot drifted" verdict as an actual byte change. Now a missing or unreadable before/after
   manifest, a non-numeric or zero file count, and a `diff` output/execution error each raise the
   sticky write-failure counter, so finalization returns `73`; only a genuine content difference
   (or a symlinked YAML directory) remains the workload verdict `72`. Missing evidence is no longer
   reported as a workload opinion.
3. **Precedence is explicit: evidence > hash > terminal > workload.** `br_verdict` maps a payload
   `73` over any other outcome, a hash failure `77`/`78` over terminal and workload, an unsettled
   unit to `74`, and only then the workload exit. Unknown workload exits collapse to `70`; listed
   special exits stay nonzero and never become success. A green TAP stream cannot mask a lost
   evidence write, and an evidence failure cannot be laundered into `72`.
4. **Control closure now includes the wrapper, the payload, the core manifest and all five core
   modules.** The old wrappers hashed a combined input list; the core snapshots a declared control
   closure of exactly 8 files before and after — `run.sh`, `payload.sh`, `core.manifest`,
   `common.sh`, `policy.sh`, `host.sh`, `envelope.sh`, `tap.sh` — and separately the selected
   workload inputs. `BR_EXTRA_CONTROL` is empty for all five (nothing else is sourced), which is a
   reviewed wrapper contract, not automatic discovery.
5. **Other renamed or added artifacts.** `hashes-before/after/diff.txt` become
   `control-before/after/diff.txt` plus `selected-before/after/diff.txt`; `selection.txt` records
   `control_files`, `selected_workload_files` and `workload_dependency_closure=no`.
   `terminal-query*`/`stop-confirm*` become `terminal-before.txt`, `terminal.txt` and conditional
   `stop.txt`/`terminal-after-stop.txt`. `active-units.txt` merges query rc and output (no separate
   `.err`); `journal.rc` is its own record. Envelope evidence is
   `envelope-systemctl/getunit/runtime/effective.txt` plus `requested.txt` and `memory-gate.txt`;
   peaks move to `peaks.txt` with explicit `measured`/`unavailable` state. Ownership,
   `payload-result.txt` and `payload-evidence.txt` are new. Only the host writes `unit.log`; the
   payload relays its logs to stdout.

## 5. Preserved workloads and parity with the historical counts

The migrated payloads keep the original commands, arguments, environment cleaning, sandbox shape
(`--ro-bind / / --dev /dev --proc /proc --tmpfs /tmp`, private pid/net/ipc/uts namespaces,
`--die-with-parent`), static-contract assertions, example invocations and expected exit codes.
Only the host lifecycle, evidence plumbing, TAP interpretation and exit mapping were replaced.

| Suite | Count in this run | Last pre-migration count | Source for the historical number |
| --- | --- | --- | --- |
| profile-dump | 81 / 81 | 81 / 81 | [2026-11-08 profile-dump rows](2026-11-08-profile-dump-rows.md) |
| diagnose | 54 / 54 | 54 / 54 | [2026-11-09 diagnose provenance](2026-11-09-diagnose-provenance.md) |
| dependency-shape | 37 / 37 | 37 / 37 | [2026-11-09 dependency shape](2026-11-09-dependency-shape.md) |
| correspondence | 43 / 43 | 43 / 43 | [2026-11-09 correspondence](2026-11-09-correspondence.md) |
| repair-plan | 42 / 42 | 42 / 42 | [2026-11-09 repair apply](2026-11-09-repair-apply.md) |

Equal counts show that the same assertions were collected and passed through the new TAP gate;
they are not a claim that the suites are complete, that the counts are additive across suites, or
that the implementations are correct. The peak-memory figures are new observations and are close
to, but not equal to, some older records (for example repair 34570240 B here versus 36208640 B
historically); no equality is claimed for resources, only for test counts and outcomes.

## 6. Reproduction and known limits

- Entry points (absolute path required):
  `scripts/{profile-dump,diagnose,dependency-shape,correspondence,repair-plan}-batch/run.sh`.
  Each takes no arguments and accepts a `*_RUNS_ROOT` override for the artifact root; the default
  is `/data/dsh-ecosystem-test-artifacts/runs`.
- Exit vocabulary: `0` green; `70` refusal/unknown workload exit; `71` syntax/static/dependency
  precondition; `72` workload/TAP/YAML verdict; `73` evidence failure; `74` timeout or unsettled
  unit; `75` lock held; `76` run collision; `77` hash read/manifest failure; `78` control or
  selected-input drift.
- The control manifest header is `bounded-runner/1 source-review-unreleased` and deliberately makes
  no upstream commit claim; provenance is the repository-local commit named above. Manifest hashing
  is integrity against reviewed local pins, not protection against a writer who can replace both
  pins and code, and before/after hashing cannot detect an edit restored between samples. Keep the
  checkout immutable for an authorised run.
- Out of scope here: the remaining seven maintained wrapper pairs, real-host plugin loading,
  installation acceptance, adversarial payloads, multi-host behaviour, and any "the tools are
  correct" conclusion. Those require separate, reviewed evidence.

## Appendix. Evidence index

| Context | Evidence |
| --- | --- |
| Shared envelope readback | `envelope-effective.txt` in each run directory |
| Ownership receipt | `ownership.txt` / `ownership-systemctl.txt` |
| Terminal settlement | `terminal-before.txt`, `terminal.txt`, `status.txt` |
| Evidence accounting | `payload-result.txt`, `payload-evidence.txt`, `status.txt` |
| TAP gate | `tap-fields.txt`, `tap-summary.txt`, `tap-verdict.txt`, `node-tap.log` |
| Control closure | `control-before.txt`, `control-after.txt`, `control-diff.txt`, `selection.txt` |
| Workload identity | `selected-before.txt`, `selected-after.txt`, `selected-diff.txt`, `workload.txt` |
| Core source | [bounded-runner](../../scripts/bounded-runner/README.md), [manifest](../../scripts/bounded-runner/core.manifest) |
