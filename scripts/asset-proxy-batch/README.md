# asset-proxy-batch

Bounded verification slice for `packages/asset-proxy` (C3).

## What it runs

```
/packages/asset-proxy $ node --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.js'
```

under the repository's bounded envelope, plus a static contract over the package.

| Stage | Evidence file | Pass means |
| --- | --- | --- |
| syntax | `syntax.txt` | both slice scripts parse |
| static contract | `static-contract.log`, `static-verdict.txt` | manifest shape, five exports, `dsh` entry + inject list, zero non-builtin imports, `assets` declared as a proposed extension, scheme/relative refusals, `script-src` and `html`+link rows, id-order and dedupe, cold table stays empty, plugin/service names |
| workload | `node-tap.log`, `tap-summary.txt`, `tap-verdict.txt` | TAP totals, `tap_check_rc=0`, `node_rc=0` |
| peaks | `peaks.txt` | memory and pid peaks `measured` |
| closure | `control-before/after.txt`, `selected-before/after.txt` | identical before and after |

## Status

**Executed once, green.** Run directory
`/data/dsh-ecosystem-test-artifacts/runs/20261112T165533Z-asset-proxy-batch-1734563-9496`:
`acceptance_exit=0`, `phase=completed`, `launch_rc=0`, `terminal_ok=yes`,
`hash_rc=0`, `write_failures=0`; `tap_tests=65 tap_pass=65 tap_fail=0
tap_cancelled=0 tap_skipped=0 tap_todo=0`; `tests_exit=0 tap_check_rc=0
verdict=pass`; `acc_static_contract=pass` (33 checks); memory and pid peaks
`measured`; `control_files=8 selected_workload_files=10` with the control and
selected-input snapshots identical before and after.

The unit base was added to `scripts/bounded-runner/policy.sh` `br_prefix_allowed`
by the captain and `core.manifest` was regenerated afterwards; this worker did not
edit `policy.sh`.

## How to run

An absolute entry path is mandatory: the wrapper compares `BASH_SOURCE` against
`$CORE` and fails closed with 77 when the path is relative.

```
TMPDIR=/root/kit-scratch/tmp bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/asset-proxy-batch/run.sh
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | green |
| 70 | wrapper precondition refused |
| 71 | static contract failed |
| 72 | workload or TAP check failed |
| 73 | evidence write failure |
| 74 | the lock is held by another run |
| 75 | memory gate tripped |
| 76 | workload exceeded its runtime bound |
| 77 | control closure mismatch (wrong path, edited control file, stale manifest) |
| 78 | selected-input closure changed during the run |

## Limits

Memory 384 MiB, swap 0, `TasksMax=32`, `CPUQuota=50%`, `RuntimeMaxSec=120`, Node
heap 192 MiB — all from `scripts/bounded-runner/policy.sh`, none overridable here.

## What a green run here establishes

That these 65 tests pass, in this envelope, on this host, with the control and
selected-input closures unchanged. It does **not** establish that any real page
renders these rows, that any declared asset exists or loads, or that the host
reads `dsh.client.assets` — the host does not.
