# `repair-plan-batch` — bounded acceptance run for the repair package

Two scripts, one transient unit, one workload, no retry. It answers two questions:

1. Are `repair-plan` and `repair-preview` what they claim — a closed schema, a
   one-element operation vocabulary, a stale refusal, and no writer anywhere?
2. Does the package's own suite pass on these bytes under the envelope, and does the
   shipped example preview render as `ready` without changing its fixture?

**No repair is applied by this batch.** There is no apply path in the package to call.

Status: **EXECUTED — two bounded rounds, both green** (2026-11-09). Evidence:
`docs/testing/2026-11-09-repair-plan.md`.

## Files

| File | Role |
| --- | --- |
| `run.sh` | Host-side launcher: envelope, lock, hash manifests, one `systemd-run` unit, terminal readback. |
| `payload.sh` | In-envelope payload: envelope readback, memory gate, syntax, static contract, example preview, suite, peaks, TAP verdict. |

## Usage

```bash
bash projects/dsh-compat-platform/scripts/repair-plan-batch/run.sh
```

Takes no arguments. Raw artefacts go to
`${REPAIR_PLAN_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}`; only the narrative
record is committed.

## Envelope

`MemoryMax=384 MiB`, `MemorySwapMax=0`, `TasksMax=32`, `CPUQuota=50%`,
`RuntimeMaxSec=120`, Node heap 192 MiB, one `MemAvailable >= 819200 KiB` gate checked
once before any work, `flock -n` on the shared acceptance lock, serial execution.

## Launcher exit codes

| Code | Meaning |
| --- | --- |
| 0 | Green: payload 0, unit settled, hashes identical, no write failures. |
| 70 | Refusal before or inside the launch (missing tool, active unit, envelope mismatch). |
| 73 | An evidence write failed. |
| 74 | The unit did not settle. |
| 75 | Another acceptance batch holds the shared lock. |
| 76 | Run directory collision. |
| 77 | A hash manifest could not be read or written. |
| 78 | Selected-input drift. |

## Payload exit codes

| Code | Meaning |
| --- | --- |
| 0 | Green. |
| 70 | Envelope did not match the approved limits, or the memory gate failed. |
| 71 | Static contract failed; no test was started. |
| 72 | Suite verdict not green, or the example preview did not behave. |
| 73 | An evidence write failed before the workload. |

## Artefacts in one run directory

`status.txt`, `argv.txt`, `launch.txt`, `unit.log`, `journal.txt`, `terminal-query.txt`,
`hashes-before.txt`, `hashes-after.txt`, `hashes-diff.txt`, `envelope-*.txt`,
`memory-gate.txt`, `syntax.txt`, `static-contract.log`, `static-verdict.txt`,
`example-preview.txt`, `example-preview.err`, `example-verdict.txt`, `node-tap.log`,
`node-stderr.log`, `node.rc`, `tap-fields.txt`, `tap-summary.txt`, `tap-verdict.txt`,
`peaks.txt`.

## What one green run does not establish

That any repair is safe, approved or applicable; that a plan's digest confers authority;
that a DSH runtime would honour the field being set; that anything was loaded. The
package has no apply path, and the batch never writes a document.
