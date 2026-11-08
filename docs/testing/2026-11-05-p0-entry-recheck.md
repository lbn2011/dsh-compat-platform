# 2026-11-05 — P0 entry-unit recheck (platform analyzer lane record)

STATUS: **RAN ONCE — PASSED.** 66 tests, **66 pass**, 0 fail, 0 skipped, 0
cancelled, 0 todo; unit exit 0. One authorized recheck after a **test-only** fix —
not an automatic retry, no retry of it either.

This file was created as a NOT RUN skeleton **before** the launch and filled from
the run's own output afterwards.

Run date: unit stamp `20261104T160325Z` = **2026-11-05 00:03 Asia/Shanghai**.

Raw evidence: `experiments/acceptance/p0-entry-unit/runs/20261104T160325Z-p0-entry-unit-407801-11268/`
— `argv.txt`, `hashes-before.txt`, `unit.log`, `systemd-run.rc`, `journal.txt`,
`hashes-after.txt`, `status.txt`.

The failed 2026-11-04 attempt and its read-only diagnosis stay frozen at
`projects/dsh-compat-platform/docs/testing/2026-11-04-p0-entry-unit.md`. This page
does not revise that record.

## What changed (and what did not)

One file, test-only:
`projects/dsh-compat-platform/packages/analyzer/tests/admission-cli.test.mjs`,
digest `4845f0b8…` → `16c4ff80…`. Its canonical-grammar case now asserts one exact
array of the two expected findings in emission order:

1. `ADMISSION_CASE_REFUSED` / `admission-refused-conflict` / `refused`
2. `ADMISSION_COVERAGE_UNKNOWN` / `admission-visibility` / `null`

That is exactly what the first attempt's diagnosis predicted from
`findingsFor()` (`src/admission-diagnostics.js:454-478`: reported-case findings in
summary order first, `coverage.unknown` findings last).

**Not changed:** every production module (`src/admission-diagnostics.js` included),
`run.sh` (`d135bd4a…`), `payload.sh` (`59f05e42…`), the other two targets, and the
envelope. So this pass says the **expectation** was wrong, not that the diagnoser
changed behaviour. It does not retroactively validate the first attempt, and it
does not make the first attempt pass.

## Unit

`p0-entry-unit-20261104T160325Z-407801.service` — one transient
`systemd-run --wait --pipe --collect`, `Type=exec`, from the unchanged runner,
under the shared `experiments/acceptance/runs/.acceptance.lock` (non-blocking).

`status.txt`: `systemd_run_rc=0`, `hash_status=identical`, `acceptance_exit=0`.
systemd final state: `Deactivated successfully`.

## Command (executed verbatim)

```
systemd-run --wait --pipe --collect --unit=p0-entry-unit-20261104T160325Z-407801 \
  --property=Type=exec \
  --property=MemoryMax=768M --property=MemorySwapMax=0 \
  --property=TasksMax=32 --property=RuntimeMaxSec=120 \
  --property=CPUQuota=50% \
  --property=WorkingDirectory=/root/dsh-ecosystem-spec/experiments/acceptance/p0-entry-unit \
  -- /bin/bash /root/dsh-ecosystem-spec/experiments/acceptance/p0-entry-unit/payload.sh p0-entry-unit-20261104T160325Z-407801
```

Inside the unit, one serial invocation over the same three literal files.

## Observed envelope (readback, not requested caps)

| Field | Readback |
| --- | --- |
| cgroup path | `/system.slice/p0-entry-unit-20261104T160325Z-407801.service` |
| `memory.max` | `805306368` |
| `memory.swap.max` | `0` |
| `pids.max` | `32` |
| `cpu.max` | `50000 100000` |
| unit `Type` | `exec` |
| `RuntimeMaxUSec` | `2min` → resolved `120000000` µs |
| `MemAvailable` gate | `1738176 KiB` vs required `1228800 KiB` → pass (one sample) |
| node heap cap | `--max-old-space-size=384` |

`acc_capture_ok=yes`, `acc_workload_started=yes`. Post-run: `memory.peak=65351680`,
`memory.current` final `31461376`, `pids.peak=20`, `memory.events.local` all `0`
(no `high`, no `max`, no OOM). Workload wall 1019 ms; `acc_node_rc=0`.

## Workload (this lane's share)

The analyzer target ran its two groups again: the seam group with injected
`readFile`/`loadModule`, and the real-path group where the default loader and the
real `readEvidenceFile` execute. This time all 66 tests of the unit passed,
including the corrected canonical-grammar case and the three exit-code cases that
follow it.

Not added by this recheck: no new coverage, no new case, no skip removed. The
runner prints aggregate totals only, so no per-file split is claimed.

## Hashes (before == after)

23 selected inputs, individually hashed before and after: `hash_status=identical`,
both files sha256
`fa9f2a7cb3ebf4d738489ab66668d4077aa1551a9c597e2df181feb9390db46b`, no diff file.

**Delta against the first attempt (selected files only, not a full-tree diff):**
exactly one line —

```
< 4845f0b854bc802425e9680431ce09253e6952fdf6e4d869a674a827bf74ee50  .../tests/admission-cli.test.mjs
> 16c4ff8007f32d3d8c1f24474c28ef3fed15e27b4cf680d8339eddde3886b18b  .../tests/admission-cli.test.mjs
```

This lane's other digests are unchanged from 2026-11-04, e.g.
`src/admission-cli.js` `5e179352…`, `src/admission-diagnostics.js` `7485f724…`,
`src/evidence-cli.js` `75b0c267…`, `src/runtime-evidence.js` `a332d178…`,
`src/index.js` `c14c0811…`, `src/exit-codes.js` `17b812bb…`,
`src/index.d.ts` `39d7d52e…`, `package.json` `86d202d4…`.

Selected witness, **not** a closure: `src/cli.js`, `src/evidence-diagnostics.js`,
node builtins and `tests/helpers/*` stay outside it.

## Disclosure kept (lane-relevant)

- **Scope expansion** to `src/index.d.ts` was accepted by the Lead and stays
  disclosed; it did not change in this recheck.
- The driver-lane author **violated the "no commands" rule** while preparing the
  shared slice (read-only `cat`, `wc`, `grep`, later `ls -la`). No record claims a
  command-free authoring history.
- The preparing author of the slice ran one read-only `pwd && ls`.
- The historical artifact the integration target reads is an **input**: consuming
  it is not new host or Loader evidence.
- The export-map check is an **ESM symlink into a temp `node_modules`** — not a
  packed or installed package, never packaging proof.
- `run.sh` header still reads `STATUS: UNEXECUTED` (runners frozen); run
  directories are authoritative.
- No build, install, network, host boot, plugin runtime or browser was involved;
  tests wrote only under `/tmp` and cleaned their own temp roots.

## Verdict

**PASSED — single authorized recheck.** The corrected expectation agrees with the
frozen diagnoser: 66/66, exit 0, envelope as requested, gate passed, and the only
selected input that moved is the fixed test. One sample only — this establishes
nothing about flakiness, and the 2026-11-04 failure record remains accurate
history.
