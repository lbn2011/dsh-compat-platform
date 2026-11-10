# trusted-extraction-hang-budget — the shipped phase budget, measured

**STATUS: EXECUTED (ABI `bounded-runner/1`), two bounded rounds on 2026-11-10, both
`acceptance_exit=0`.** Each round ran the wedged fixture under the policy's own
`BUDGET` (`phaseSeconds: 80`), which was killed with `SIGKILL` and produced
`status: incomplete`, `cleanup: unconfirmed`, `process.timedOut: true`. Record:
[`../../docs/testing/2026-11-10-shipped-phase-budget.md`](../../docs/testing/2026-11-10-shipped-phase-budget.md).

## Why a separate slice

`scripts/trusted-extraction-batch/` demonstrates the kill path with a **3 s demo
budget** so the mechanism is visible inside a batch that also runs unit tests and a
full fixture observation. The number the product actually enforces (80 s phase, 10 s
kill grace, 20 s read-back inside a 120 s outer limit) was therefore covered only by
an arithmetic inequality. Eighty seconds of waiting cannot share a 120 s envelope
with the rest of that workload, so this slice runs **only** the wedged fixture — plus
the isolation probe, because a kill observed outside a verified boundary would not
mean much.

## Files

| File | Role |
|---|---|
| `run.sh` | Launcher: declares the control closure and the eight selected inputs, then calls the core's `br_host_run` once. No arguments; invoke by **absolute** path (a relative entry refuses 77 before launch). |
| `payload.sh` | Payload: envelope, syntax, static contract, isolation probe, then `failure-paths.mjs --budget-profile shipped`, then an attestation step that refuses unless the receipt and the executed budget both say "shipped". |
| `README.md` | This file. |

The budget is **imported** from `packages/runtime/src/isolation-policy.js`, never
restated, and the static contract pins `120/80/10/20` so a silent change to the
policy refuses this batch instead of quietly measuring a different number.

## Exit codes

Launcher (from the core): `0` green; `70` refusal before or inside the launch;
`73` evidence write failure or isolation gate refusal; `74` the shipped budget did
not time out, the receipt was not `incomplete`/`unconfirmed`, or the unit did not
settle; `75` lock held; `76` run collision; `77` manifest/source frame unreadable;
`78` selected-input drift.

Payload: `0`, `70`, `73`, `74` as above. `72` is not used — this slice runs no unit
tests.

## Artefacts

`status.txt`, `verdict.txt`, `attestation.txt`, `hang-budget-used.json`, `hang.json`,
`failure-paths.json`, `isolation.txt`, `static-contract.txt`, `peaks.txt`,
`memory-gate.txt`, `terminal.txt`, plus the two-point control and selected manifests.

## What green means, and what it does not

It means: under the shipped 80 s phase budget, this wedged synthetic fixture was
killed, reaped, read back, and reported as incomplete rather than truncated green —
twice, on identical inputs.

It does **not** mean: that a real plugin will behave, that the boundary resists
hostile code, or that anything about loadability/activation is established. The
target is a fixture whose `apply()` spins forever.

## Deviation

`scripts/bounded-runner/policy.sh` gained this slice's prefix and unit family; without
both, the core refuses 70 before creating a unit. `core.manifest` was refreshed and
the qualification suite re-run. See the record, §Deviations.
