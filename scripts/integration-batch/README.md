# integration-batch — the platform side of the t12 integration slice

Task t12. One host shell, one envelope, no retry. Runs two suites in sequence:

1. **platform** `tests/integration/*.test.mjs` — the Layer 1→4 chain end to end
   (L1 executes a kit-generated plugin for real, L2 A1 claims + A2 static
   pre-check + A3 arbitration, L3 `DSHPatchAPI` → `commit` → append-only merge,
   L4 bundle block merge), the eleven conflict scenarios C1–C11 one case each,
   the patch approval flow, bundle installation, and the resource budget.
2. **kit** `tests/integration/*.test.js` — `scaffold → pack → verify-patch` as
   real subprocesses with their exit codes, and `conflict-check` driving the real
   `packages/analyzer` + `dsh-compat-spec` validator.

**The kit suite runs here because `dsh-plugin-kit` has no bounded-runner of its
own.** There is no kit-local envelope and this record must not be read as one: the
32-task / 384 MiB budget below covers both suites, and the kit's own record says
the same thing from the other side.

## Envelope

`systemd-run --scope` with `MemoryMax=402653184` (384 MiB), `MemorySwapMax=0`,
`TasksMax=32`, `CPUQuota=50%`, `RuntimeMaxUSec=120000000`, plus the cooperative
MemAvailable gate. `payload.sh` reads the cgroup back and refuses (exit 70) when
the kernel applied something other than what `policy.sh` declares.

Each suite runs in its own `bwrap` sandbox (`--ro-bind / /`, private `/tmp`, no
network, `--unshare-pid`) under `env -i` with `NODE_OPTIONS=--max-old-space-size=192`.

## Policy

Unit base `integration-batch` is in `scripts/bounded-runner/policy.sh`
`br_prefix_allowed`; the captain authorised that line on 2026-11-13 and
`core.manifest` was rebuilt for the new `policy.sh` digest only.

## What the numbers mean, and do not mean

`memory_peak` and `pids_peak` are the kernel's own cgroup peaks (`memory.peak`,
`pids.peak`), read before the unit can disappear. They prove the suites fit the
budget. They do **not** prove a host would accept any of the plugins these suites
build: every declaration, patch and approval in them is a static artifact, and the
one case that actually loads a plugin loads it into a scratch context, not into a
running DSH profile.

## What this slice does not show

- No production deployment, no `push`, no profile rewrite: the run touches only
  `/data/dsh-ecosystem-test-artifacts` and each suite's own temporary directory.
- The spec repository's suite is **not** run here; it has its own envelope
  (`dsh-compat-spec/scripts/integration-batch`).
- A green run is not certification. `mergePatchBlock` does not consult an approval
  record, `lifecycle-bootstrap` merges a bundle patch only for packages that also
  declare `dsh.lifecycle`, and `staticPreCheck` takes one platform per package.
  Those three are asserted as recorded limitations inside the suites, not hidden.
