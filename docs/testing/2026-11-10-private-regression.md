# Clearing `private` broke six runners, and that is worth writing down (2026-11-10)

## What happened

The slice before this one removed `private` from five manifests
(`docs/testing/2026-11-10-publishable.md`). It updated two payloads that asserted the flag and
reported the batches it re-ran as green: `package-install`, `trusted-extraction-batch`,
`spec-test-batch`.

It was **wrong about being complete**. When every runner was swept on the final bytes, three came
back `71`:

| Runner | Reason recorded |
| --- | --- |
| `correspondence-batch` | `package_private=fail`, `static_contract_failures=private` |
| `repair-plan-batch` | `private=fail`, `static_contract_failures=private` |
| `diagnostics-gui-run` | `field private` |

A fourth (`trusted-extraction-hang-budget`), a fifth (`second-version-baseline`) and
`config-engine-install/inspect.mjs` had the same assertion and had simply not been run in that
window, so they would have failed next.

## Why it happened

The search that was supposed to enumerate every assertion was

```
grep -rn "private" ... | grep -v 'private:true"' | head -20
```

`head -20` truncated the output after the two payloads already fixed. The remaining five matches
were never seen. That is a **process** defect, not a subtle semantic one: the command that was
supposed to prove coverage could not prove coverage, and the result was read as if it could.

## What was changed

Six files, each inverted rather than deleted, so a manifest that sets the flag again now fails:

| File | Before | After |
| --- | --- | --- |
| `scripts/repair-plan-batch/payload.sh` | `private=${manifest.private === true …}` | `private_absent=${manifest.private === undefined …}` |
| `scripts/correspondence-batch/payload.sh` | `package_private=${isPrivate …}` | `package_private_absent=${privateAbsent …}` |
| `scripts/diagnostics-gui-run/payload.sh` | `check('private', …=== true…)` | `check('private-absent', …=== undefined…)` |
| `scripts/trusted-extraction-hang-budget/payload.sh` | `if (pkg.private !== true) …` | `if (pkg.private !== undefined) …` |
| `scripts/second-version-baseline/payload.sh` | `runtime:not-private` | `runtime:private-set` |
| `scripts/config-engine-install/inspect.mjs` | `doc.private !== true` | `doc.private !== undefined` |

## The sweep that found it, and that now passes

Every offline registered batch was run once by absolute path on the final bytes. One launch each;
no retry-to-green.

| Runner | Exit | Run directory (under `/data/dsh-ecosystem-test-artifacts/runs/`) |
| --- | --- | --- |
| `profile-dump-batch` | 0 | `20261110T152316Z-profile-dump-batch-1418075-29899` |
| `dependency-shape-batch` | 0 | `20261110T152319Z-dependency-shape-batch-1418592-21758` |
| `correspondence-batch` | 0 | `20261110T152308Z-correspondence-1416817-20263` |
| `diagnose-batch` | 0 | `20261110T152322Z-diagnose-batch-1419089-4054` |
| `diagnose-real-wiring` | 0 | `20261110T152012Z-diagnose-real-wiring-1415575-2161` |
| `diagnostics-gui-run` | 0 | `20261110T152313Z-diagnostics-gui-1417673-32134` |
| `repair-plan-batch` | 0 | `20261110T152312Z-repair-plan-batch-1417423-13416` |
| `config-check-batch` | 0 | `20261110T152323Z-config-check-batch-1419575-28096` |
| `profile-dump-retained-export` | 0 | `20261110T152326Z-profile-dump-retained-export-1419901-28287` |
| `bounded-runner-qualification` | 0 | `20261110T152506Z-bounded-runner-qualification-1420248-26281` |
| `trusted-extraction-hang-budget` | 0 | `20261110T152510Z-trusted-extraction-hang-1421798-18787` |

The three that had failed share one first-green run in this sweep; the earlier red runs are kept
above as evidence, not overwritten.

`trusted-extraction-hang-budget` re-ran the shipped 80 s kill path after its payload changed:
`status=incomplete`, `cleanup=unconfirmed`, `signal=SIGKILL`, all six checks true,
`memory_peak=36892672` B, `pids_peak=21`, 81 s wall clock.

## What this does not establish

Nothing new about any plugin, profile or host. This record documents a regression **in the test
harness** and its fix. `package-install` and `trusted-extraction-batch` were not re-run in this
sweep because their payloads were unchanged since their last green rounds on the same bytes.

## The lesson worth keeping

A `head` in a coverage command silently discards the evidence of coverage. When the goal is "find
every place that asserts X", the search must report a **count** and compare it to what was read, or
it is not a search.
