# lifecycle-bootstrap-batch

Bounded slice for `packages/lifecycle-bootstrap` — the C2 lifecycle bootstrap:
declaration grammar, bounded script runner, append-only patch merge, and the
orchestrator that ties them to `plugin-manager/*` triggers.

## Status

**Executed once, green.** Run
`/data/dsh-ecosystem-test-artifacts/runs/20261112T162712Z-lifecycle-bootstrap-batch-1729920-16455`
(2026-11-13 00:27 Asia/Shanghai) returned `acceptance_exit=0`, with
`tap_tests=58 tap_pass=58 tap_fail=0`, `acc_static_contract=pass` (39 checks),
`memory_peak=34488320` and `pids_peak=16` both `measured`, and identical control
and selected-input closures before and after.

The unit base `lifecycle-bootstrap-batch` was added to
`scripts/bounded-runner/policy.sh` `br_prefix_allowed` by the captain, which is an
exact-match allow-list; `policy.sh` is one of the five modules hashed by
`core.manifest`, and the manifest was regenerated afterwards (policy.sh digest
`83365ac6…`, the other four unchanged). A slice in this repository cannot run
until both edits are in place.

## What it runs

```
TMPDIR=/root/kit-scratch/tmp bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/lifecycle-bootstrap-batch/run.sh
```

The entry path **must be absolute**: the wrapper locates its control files through
`BASH_SOURCE`, and a relative invocation fails the core-closure check (77).

Inside the envelope, `payload.sh`:

1. syntax-checks both slice scripts (`bash -n`) into `syntax.txt`;
2. runs a static contract (`static-contract.mjs`) over `packages/lifecycle-bootstrap`:
   manifest shape, the five declared exports, the `dsh` entry and its
   `inject: ['pluginManager']`, zero non-builtin imports across `src/*.js`, the
   event names, the signal list, the patch path, the "HMR is a request" and "kill
   is not a sandbox" limitations, an `env` allow-list that excludes `DSH_TOKEN`, a
   shell command line refused as a declaration, the three merge outcomes
   (`appended` / `skipped` / `PARTIAL_OVERLAP`), config closure, and that `apply()`
   publishes `compatLifecycle`;
3. runs the package's whole test suite under `bwrap`:

```
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir packages/lifecycle-bootstrap -- \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS=$BR_NODE_OPTIONS \
  node --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.js'
```

## Selection

`BR_SELECTED_INPUTS` = this README, `packages/lifecycle-bootstrap/package.json`,
its `README.md`, the explicit four test files, plus every file under
`packages/lifecycle-bootstrap/{src,tests}/**`. Selected local sources, not a
dependency-closure assertion.

## Envelope

Inherited from `scripts/bounded-runner/policy.sh`; the slice pins none of it:

| Limit | Value |
| --- | --- |
| `MemoryMax` | 402653184 B (384 MiB) |
| `MemorySwapMax` | 0 |
| `TasksMax` | 32 |
| `CPUQuota` | 50 % |
| `RuntimeMaxSec` | 120 |
| `NODE_OPTIONS` | `--max-old-space-size=192` |
| run root | `/data/dsh-ecosystem-test-artifacts/runs` |
| serial lock | `/root/dsh-ecosystem-spec/experiments/acceptance/runs/.acceptance.lock` |

## Exit codes

`0` clean · `70` refused before the envelope · `71` static contract failed ·
`72` smoke/TAP/yaml/snapshot check failed · `73` evidence write failed ·
`74` workload policy violation · `75` control closure changed mid-run ·
`76` envelope escape · `77` control files not the expected ones ·
`78` runtime limit breached.

## Non-claims

A green run establishes that these tests pass under these limits on this host. It
does not establish that a real install triggers a real post-install script, that
a real `cordis.patch.yml` is merged into a live profile, or that the HMR service
actually reloads anything. `HMR_IS_REQUESTED_NOT_VERIFIED`,
`PATCH_MERGE_ASSUMES_A_WELL_FORMED_GENERATED_BLOCK` and
`KILL_IS_NOT_A_SANDBOX` remain true after any run of this slice.
