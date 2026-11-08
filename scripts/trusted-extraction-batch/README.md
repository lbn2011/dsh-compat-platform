# trusted-extraction-batch

Bounded launcher for one trusted-extraction observation round, and its payload.

## Status

EXECUTED. Two clean green rounds on 2026-11-09 (plus harness-fix attempts recorded in
`docs/testing/2026-11-09-trusted-extraction.md`), then two more green rounds after the failure-path
step was added (`docs/testing/2026-11-09-trusted-extraction-failure-paths.md`).

## Usage

```bash
bash projects/dsh-compat-platform/scripts/trusted-extraction-batch/run.sh
```

One invocation is one round. Output goes to
`/data/dsh-ecosystem-test-artifacts/runs/<stamp>-trusted-extraction-batch-<pid>-<n>/`.

## What one round does

1. Envelope self-check (`memory.max=402653184`, `pids.max=32`, `cpu.max=50000 100000`) and one
   `MemAvailable >= 819200 KiB` gate.
2. `bash -n` and `node --check` on every file it runs.
3. Static contract: package is private, zero-dependency, every export target exists, budget
   slack is positive, guard lists are the fixed ones.
4. Unit tests (`29/29`).
5. Isolation gates 1–5 in a bubblewrap sandbox, including one outbound attempt observed from
   inside the sandbox.
6. Fixture observation: five phases, four entry outcomes, receipt shape check.
7. Failure paths: a fixture that outlives a **3 s demo phase budget** is killed and reaped
   (`status: incomplete`, `cleanup: unconfirmed`, `timedOut: true`). The shipped 80 s budget is
   still only covered by the arithmetic check.
8. yaml snapshot, peaks, terminal readback.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | passed |
| 70 | envelope or static-contract refusal |
| 72 | unit tests or fixture observation failed |
| 74 | the failure paths (network observation or kill path) did not behave |
| 73 | an isolation gate refused |
| 75/76/77 | run dir / lock acquisition / lock held (launcher) |

## Artifacts

`summary.txt`, `isolation.txt`, `fixture.json`, `failure-paths.json`, `tests.tap`,
`hashes-before.txt`, `hashes-after.txt`, `terminal.txt`, `peaks.txt`, per-gate files under
`isolation/`, and the raw failure-path artifacts under `failure-paths/`.

## Not established

No production profile is read, no real plugin is loaded, no network is used. A green round
means the fixture behaved as designed inside the boundary; it is not a loadability or
certification result.
