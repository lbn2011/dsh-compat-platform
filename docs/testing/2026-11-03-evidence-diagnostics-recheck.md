# Recheck: evidence-diagnostics + runtime-evidence — corrected bounded launch

**STATUS: PASS — 57 tests, 57 pass, 0 fail, envelope read back in-unit before Node.**

This is an **appended recheck**, not a replacement. The failed-127 attempt at
[`2026-11-03-evidence-diagnostics.md`](2026-11-03-evidence-diagnostics.md) stays
immutable and remains valid history; only its launch wrapper was defective.

- Date/time of record: 2026-11-03T23:52:29+08:00 (20261103T154613Z)
- Transient unit: `diag-evidence-recheck-20261103T154613Z.service` (collected, no residue)
- Run directory: `docs/testing/runs/20261103T154613Z-evidence-diagnostics-recheck/`
- Tier: **bounded-unit.** Not real-host, not coexistence acceptance, **not** a
  certification. `certification:false` still stands: a green suite here means the
  module matches its stated contract, not that any plugin is compatible.

## 0. What changed versus the failed-127 attempt

Only the launch wrapper: **absolute** payload path plus explicit
`--property=WorkingDirectory=/root/dsh-ecosystem-spec`. The payload is the same
reviewed 263-line file, sha256
`814ba503cffc6520dd53d561be1afbdd20f9610c6a4116d5f4a3e6f433e4d651`, unchanged and
unpatched. Same two literal test files. **No source or test file changed** (§5).

## 1. Outcome

**PASS.** One launch, one attempt, no retry, no escalation.

| item | value |
| --- | --- |
| tests | **57** |
| pass | **57** |
| fail / cancelled / skipped / todo | 0 / 0 / 0 / 0 |
| `acc_node_rc` | **0** |
| `systemd-run` rc | **0**, `result: success`, `status=0/SUCCESS` |
| node duration | 345.09 ms |
| workload wall (in-unit) | 546 ms |
| service runtime (manager) | 634 ms, CPU 306 ms |
| unit residue | none (`--collect`; `systemctl status` → "could not be found") |

The 57 tests are the sum of the two literal files: **19** in
`tests/evidence-diagnostics.test.js` + **38** in `tests/runtime-evidence.test.js`.
Every declared top-level case ran; nothing was skipped. For comparison only, this is
**not** the 167-test five-file combined workload and **not** the 59-test first slice —
do not merge those numbers with this one.

Workload, literally:
`node --test --test-concurrency=1 tests/evidence-diagnostics.test.js tests/runtime-evidence.test.js`,
cwd `/root/.../packages/analyzer`, inside
`bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent`,
`env -i` with `PATH`, `HOME=/tmp`, `TMPDIR=/tmp`, `NODE_OPTIONS=--max-old-space-size=384`.

## 2. Envelope — requested versus read back inside the unit, before Node

Captured from `/proc/self/cgroup` and `systemctl show` by the payload itself; the
payload refuses before any Node if any value mismatches. `acc_capture_ok=yes`.

| property | requested | observed in-unit |
| --- | --- | --- |
| `Type` | `exec` | **`exec`** |
| `MemoryMax` | `768M` | `acc_cgroup_memory_max=`**`805306368`** |
| `MemorySwapMax` | `0` | `acc_cgroup_swap_max=`**`0`** |
| `TasksMax` | `32` | `acc_cgroup_pids_max=`**`32`** |
| `CPUQuota` | `50%` | `acc_cgroup_cpu_max=`**`50000 100000`** |
| `RuntimeMaxSec` | `120` | **`120000000` µs** (manager renders `2min`) |
| cgroup | — | `/system.slice/diag-evidence-recheck-20261103T154613Z.service` |
| Node heap cap | 384 MiB | `acc_node_options=--max-old-space-size=384` |

`ENVELOPE_VERIFIED=yes`. All seven matched; `acc_launch_blockers` was empty.

## 3. Memory gate

Single sample, one read, no polling, no retry, no escalation.

| field | value |
| --- | --- |
| sampled at | 2026-11-03T23:52:29+08:00 |
| `MemAvailable` | 1296680 kB = **1266 MiB** |
| gate | 1200 MiB (1228800 kB) |
| verdict | **pass** (headroom 66 MiB — the tightest of this pair, but a single-sample gate is what was authorized) |

## 4. Measured peaks (inside the unit's own cgroup)

| counter | value | share of limit |
| --- | --- | --- |
| `memory.peak` / `MemoryPeak` | 55828480 B = **53.2 MiB** | 6.9 % of 768 MiB |
| `memory.current` at end | 20021248 B = 19.1 MiB | — |
| `pids.peak` | **20** | 62.5 % of 32 |
| `memory.swap.current` peak | 0 | swap disabled |
| `memory.events.local` | `low 0 high 0 max 0 oom 0 oom_kill 0 oom_group_kill 0` | no throttle, no OOM |

No memory pressure, no OOM kill, no task-limit exhaustion: the workload was bounded
by far more headroom than it used.

## 5. Digests — identical before and after

sha256 computed host-side immediately before the attempt and after it; `diff` of the
two files is empty. Nothing was mutated, and nothing outside the listed files was
touched.

| file | sha256 (before = after) |
| --- | --- |
| `src/evidence-diagnostics.js` | `cf207ab3616d31fabc5a0af4efd5e8c49eed70fbde208ac29ed0b24e21e5df36` |
| `src/evidence-diagnostics.d.ts` | `4e4e5e4cdcedb568b75830829d41ffaf827fb21c59b3873bdaa3317c07c4ab82` |
| `src/runtime-evidence.js` | `a332d17893db1817afe16bafe2ec62738106fe63db417886351831ecab964253` |
| `tests/evidence-diagnostics.test.js` | `2063539ab96269ea6fd2dfc1a0c5b8ab6b55147a5613b0f299449268f3c1bda6` |
| `tests/runtime-evidence.test.js` | `56ef991f9c9deda553450b216356ca108f05523a9efa299459833685e6359d67` |
| `payload.sh` (run 1) | `814ba503cffc6520dd53d561be1afbdd20f9610c6a4116d5f4a3e6f433e4d651` |

These are the same five digests recorded in the failed-127 attempt, so the code that
passed here is byte-identical to the code that never ran there.
`tests/runtime-evidence.test.js` `56ef991f…9d67` also matches the historical ledger
(§4), so the pre-existing target is unchanged since row 6. **Code revision at run
time: NOT RECORDED** — this repository still has no commit; the digests are the only
pin, and they pin files, not a tree state.

## 6. Deviations and limits

- **`busctl` property read returned `<unavailable>`** for `RuntimeMaxUSec`
  (`acc_runtime_usec_numeric=<unavailable>`), so the numeric deadline was resolved
  from the manager's humanized `RuntimeMaxUSec=2min` → `120000000` µs by the
  payload's own normalizer. Two independent sources agreed on the humanized value
  (`acc_unit_runtime_max=2min`, `acc_runtime_usec_resolved=120000000`); the
  machine-numeric read is the one that failed, and that is disclosed rather than
  papered over.
- **Heap cap is a literal, not a probed number.** No `node -p` heap probe was run, by
  design: exactly one Node invocation was authorized, so the 384 MiB cap is attested
  by `NODE_OPTIONS` in the workload env plus the 768 MiB cgroup ceiling — not by
  reading `v8.getHeapStatistics()`. The historical record notes that such a probe
  measures a different quantity anyway.
- **The payload file lives in the previous run's directory** and is reused unmodified;
  it is referenced by absolute path in `argv.txt` and pinned by digest above, so the
  reuse is traceable.
- **Host-side commands outside the envelope**, all disclosed, none touching code or
  services: `awk` read of `/proc/meminfo` (the gate sample itself), `sha256sum` before
  and after, `diff` of the digest files, and read-only `systemctl status` /
  `journalctl` captures to prove no unit residue. **No** `node` or syntax probe ran
  outside the envelope; **no** build, install, service stop/restart, GUI or host change.
- **No writable bind** was needed or granted: both test files only `readFile` their own
  sources, so the capsule stayed fully read-only.
- **Scope.** This proves the two files' declared cases pass under a verified envelope.
  It does **not** re-run `analyze.test.js`, `cli.test.js`, `evidence-cli.test.mjs` or
  the coexistence orchestrator, does **not** touch real Loader acceptance (separate
  worker, code-only), and does **not** certify any plugin. `certification:false`.

## 7. Raw artifacts

`docs/testing/runs/20261103T154613Z-evidence-diagnostics-recheck/`:
`unit.log` (full 57-test output + in-unit capture), `argv.txt`, `gate.txt`,
`gate-result.txt`, `systemd-run.rc` (`systemd_run_rc=0`), `journal.txt`,
`hashes-before.txt`, `hashes-after.txt` (identical).
