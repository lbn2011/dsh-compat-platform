# evidence-diagnostics + runtime-evidence — bounded execution record

**STATUS: FAILED AT PREFLIGHT — the single authorized launch was consumed by a
wrapper-path defect. ZERO tests executed. No Node process was ever started.**

> **Continued, not retracted.** A corrected re-launch (absolute payload path + explicit
> `WorkingDirectory`) later ran the same two literal files and **PASSED 57/57** — see
> [`2026-11-03-evidence-diagnostics-recheck.md`](2026-11-03-evidence-diagnostics-recheck.md).
> The failure below is retained unchanged and stays part of the record (checklist rule 2:
> never replace red with green). Read the two together: this file is the launch defect,
> the recheck is the workload result.

- Date/time of record: 2026-11-03T23:39:21+08:00 (20261103T153921Z); launch at 23:40:22+08:00
- Transient unit: `diag-evidence-20261103T153921Z.service` (collected, no residue)
- Run directory: `docs/testing/runs/20261103T153921Z-evidence-diagnostics/`
- Tier: **bounded-unit attempt that never reached its workload.** Not a real-host run,
  not coexistence acceptance, **not** a certification. `certification:false` stands.

## 1. Outcome

**FAILED AT PREFLIGHT (launch failure, not a test failure and not a pass).**

| item | value |
| --- | --- |
| test files executed | **0 of 2** |
| node processes started | **0** |
| `systemd-run` exit code | **127** |
| service result | `code=exited, status=127/n/a`, result `exit-code` |
| service runtime | 31 ms, CPU 7 ms |
| envelope verified in-unit | **no** — `payload.sh` never ran, so no cgroup capture exists |
| unit left behind | none (`--collect`; `systemctl status` → "could not be found") |

Stderr of the unit, verbatim:

```
/bin/bash: projects/dsh-compat-platform/docs/testing/runs/20261103T153921Z-evidence-diagnostics/payload.sh: No such file or directory
```

**Mechanism.** `systemd-run --unit=… /bin/bash <relative-path>` starts the service
with the manager's default working directory (`/`), because no `WorkingDirectory=`
was set. The payload path is relative to `/root/dsh-ecosystem-spec`, so `/bin/bash`
could not open it and exited 127. The defect is in the launch wrapper — the same
defect class as row 4 of `2026-11-01-historical-test-records.md` (a preflight
helper/path bug that consumed the one authorized launch). Nothing in `src/` or
`tests/` was involved; no source or test file was read by the workload.

**No retry.** Per the standing discipline (row 4 precedent: one launch, no
self-authorized retry) and this task's explicit instruction, the launch was **not**
repeated, the payload was **not** patched, and no limit or gate was escalated. The
workload remains **NOTRUN**: nothing may be claimed passed or failed.

## 2. Workload (exactly named)

Two literal test files, no glob, no discovery, no `--test-name-pattern`, verified
present host-side before launch and re-verified in-unit by the payload (which never
got to run):

1. `packages/analyzer/tests/evidence-diagnostics.test.js` — new, author c002 done
2. `packages/analyzer/tests/runtime-evidence.test.js` — existing

This is **not** the five-file combined workload behind the 167-test row, and not the
59-test first slice; no count from this document is comparable to either.

## 3. Caps requested → observed

`ENVELOPE_VERIFIED=no`. Nothing below was observed from inside the unit, because the
in-unit capture block never executed.

| property | requested literal | observed |
| --- | --- | --- |
| `Type` | `exec` | **not observed in-unit** (`systemd-run --service-type=exec`) |
| `MemoryMax` | `768M` (= 805306368 B expected) | not observed in-unit |
| `MemorySwapMax` | `0` | not observed in-unit |
| `TasksMax` | `32` | not observed in-unit |
| `CPUQuota` | `50%` (expected `cpu.max=50000 100000`) | not observed in-unit |
| `RuntimeMaxSec` | `120` (expected 120000000 µs) | not observed in-unit |
| Node heap cap | `NODE_OPTIONS=--max-old-space-size=384` | **not applied — no Node ran** |

The only memory figures that exist are the manager's own post-mortem for the unit:
`Memory peak: 2.9M (swap: 0B)`. That is the peak of a failed `/bin/bash`, **not** a
workload peak, and it must never be cited as one. No `memory.peak`, `pids.peak` or
`memory.events.local` reading for a workload exists.

## 4. Memory gate

Single sample, one read, no polling, no retry, no escalation — gate passed.

| field | value |
| --- | --- |
| sampled at | 2026-11-03T23:40:21+08:00 |
| `MemAvailable` | 1553748 kB = **1517 MiB** |
| gate | 1200 MiB (1228800 kB) |
| verdict | **pass** |

The gate is therefore *not* why this run produced no evidence.

## 5. Counts and exit codes

- tests 0, pass 0, fail 0, skipped 0, cancelled 0 — **suite never started**
- `acc_node_rc`: never emitted (payload never ran)
- `systemd-run` rc: **127**
- gate step rc: 0 (pass)

## 6. Source digests (before/after)

sha256, captured host-side immediately before the launch and immediately after it.
All five digests are **identical**, so this attempt neither executed nor mutated the
code under test.

| file | sha256 (before = after) |
| --- | --- |
| `src/evidence-diagnostics.js` | `cf207ab3616d31fabc5a0af4efd5e8c49eed70fbde208ac29ed0b24e21e5df36` |
| `src/evidence-diagnostics.d.ts` | `4e4e5e4cdcedb568b75830829d41ffaf827fb21c59b3873bdaa3317c07c4ab82` |
| `src/runtime-evidence.js` | `a332d17893db1817afe16bafe2ec62738106fe63db417886351831ecab964253` |
| `tests/evidence-diagnostics.test.js` | `2063539ab96269ea6fd2dfc1a0c5b8ab6b55147a5613b0f299449268f3c1bda6` |
| `tests/runtime-evidence.test.js` | `56ef991f9c9deda553450b216356ca108f05523a9efa299459833685e6359d67` |

Cross-check: `runtime-evidence.test.js` `56ef991f…9d67` matches the digest recorded
for that file in the historical ledger (§4), so the pre-existing target is the same
snapshot as row 6. The new file and the new test have no prior digest to compare.

**Code revision at run time: NOT RECORDED** (this repository still has no commit, and
none was captured). The row is unpinnable to a revision; the digests above are the
only pin, and they describe a file set that was never executed.

## 7. Deviations and limits

- **Launch failure consumed the single authorized launch** (rc 127, 0 tests). No
  rerun was attempted; no fix was applied.
- **Node never started**, so the requested heap cap is a literal only. No `node -p`
  heap probe was run either — deliberately, to keep exactly one Node invocation
  authorized; that probe is now moot, since no invocation happened.
- **Host-side commands that ran outside the envelope**, disclosed in full, all
  read-only or unit-external bookkeeping: `bash -n` on `payload.sh` (shell syntax
  check, not a Node probe); one `awk` read of `/proc/meminfo` (the gate sample
  itself); `sha256sum` before and after; `systemctl status` / `systemctl list-units`
  / `journalctl` reads after the failure to prove no unit residue.
- **No** build, install, service stop or restart, GUI/host change, or competing-unit
  interference. Pre-flight confirmed no competing managed test unit was active.
- **No writable bind was needed or granted**: both test files only read their own
  sources (`node:fs/promises readFile`), so the capsule was fully read-only.
- **Scope:** this document proves nothing about the correctness of
  `evidence-diagnostics.js`. Its 19 declared cases and the 38 in
  `runtime-evidence.test.js` remain **NOTRUN**. Written-but-unexecuted is never a
  pass.
- **To continue:** a corrected launch needs a fresh authorization, absolute payload
  path (or explicit `--property=WorkingDirectory=/root/dsh-ecosystem-spec`), and a
  new unit name/timestamp. That decision belongs to the Lead, not to this worker.

## 8. Raw artifacts

All under `docs/testing/runs/20261103T153921Z-evidence-diagnostics/`:

- `payload.sh` — the in-unit payload that never ran (exact content, `bash -n` clean)
- `argv.txt` — exact `systemd-run` argv and the in-unit workload argv
- `gate.txt`, `gate-result.txt` — the single gate sample and verdict
- `unit.log` — verbatim unit output (the rc-127 line) as piped by `systemd-run`
- `systemd-run.rc` — `systemd_run_rc=127`
- `journal.txt` — journal capture showing the exact argv systemd received and the
  127 exit
- `hashes-before.txt`, `hashes-after.txt` — identical per-file digests
