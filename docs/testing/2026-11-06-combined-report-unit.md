# combined-report unit slice — refused at the capacity gate

## 0. Run record — one invocation, refused before the workload

**Status: RUN ONCE — REFUSED AT THE CAPACITY GATE.** The `NOT EXECUTED` text below is kept
verbatim as the pre-GO historical state; it is no longer this entry's final status.

> **Later attempts (links only, nothing else amended):** four further authorised single
> invocations followed. Three were refused at the same gate —
> [`…-recheck.md`](./2026-11-06-combined-report-unit-recheck.md) (run
> `20261105T231441Z-combined-report-unit-453269-2607`, `1225256 KiB`),
> [`…-recheck-2.md`](./2026-11-06-combined-report-unit-recheck-2.md) (run
> `20261106T124906Z-combined-report-unit-470929-2539`, `1203776 KiB`) and
> [`…-recheck-4.md`](./2026-11-06-combined-report-unit-recheck-4.md) (run
> `20261106T133937Z-combined-report-unit-473037-1938`, `1186032 KiB`) — all against
> `1228800 KiB`. The fourth passed the gate (`1576044 KiB`), ran the workload, and **failed
> 8 of 83 assertions**: see
> [`…-recheck-3.md`](./2026-11-06-combined-report-unit-recheck-3.md) (run
> `20261106T132504Z-combined-report-unit-472520-21317`). That record carries the only
> executed measurement of these targets, and it describes bytes that were afterwards
> repaired; no attempt supersedes another.

| field | value |
|---|---|
| run id | `20261105T201825Z-combined-report-unit-448944-22547` |
| unit | `combined-report-unit-20261105T201825Z-448944` |
| invocation | `bash experiments/acceptance/combined-report-unit/run.sh`, exactly once |
| `acceptance_exit` | `70` |
| `systemd_run_rc` | `70` |
| `hash_status` | `identical` (17 rows before, 17 after) |
| `evidence_write_failures` | `none` |
| refusal | `acc_gate=below_floor` — `MemAvailable=899980 KiB` against a required `1228800 KiB` |
| `acc_workload_started` | `no`; `acc_node_rc=refused_before_workload` |
| terminal | `load_state=not-found`, `active_state=inactive`, `sub_state=dead`, `main_pid=0`, `stop_attempted=no`, `terminal_ok=yes`, `confirmation=notfound-settled` |
| envelope readback | `805306368` / swap `0` / pids `32` / `50000 100000` / `Type=exec`; `acc_unit_runtime_max=2min`, `acc_runtime_usec_numeric=<unavailable>`, resolved `120000000` |

**No test counts exist.** `tests`, `pass`, `fail`, `skipped`, `cancelled` are **unknown**,
not zero: node never started, so there is no TAP body and no summary. Any later reading of
this entry that treats the count as 0 is wrong.

The gate is a single sample, taken once. Its refusal says this host was below the floor at
that moment; it says nothing about the host's health generally, and nothing about whether
the three targets pass. No retry, no rerun, no edit-then-rerun was performed, and none is
claimed. The recorded hashes are 17 rows, counted by reading `hashes-before.txt` (17 lines)
rather than by `wc -l` — no command was used to count them.

---

# Pre-GO record (historical: REVIEWED, NOT EXECUTED)

**Status at that time: REVIEWED, NOT EXECUTED.** No launch, no `bash -n`, no `node`, no
test, no install, no build, no service start, no host GUI had been performed for this
entry. Every outcome field read `*not run*`. Review is not execution: this part describes
intended behaviour and records nothing observed.

## 1. Why this entry exists

`projects/dsh-compat-platform/packages/analyzer/src/combined-report.js` and
`src/combined-cli.js` are new: a wrapper joining the analyze, admission and runtime
evidence lanes, and a CLI that reads documents and reports through it. Their tests live in
the analyzer's `tests/` directory, and a third integration target is being written in
`experiments/` by another author.

Nothing has measured those three targets together on this host. This entry prepares that
one measurement under the same envelope as the earlier unit slices, without inventing a
second runner.

## 2. Targets, literal

| # | path | on disk |
|---|---|---|
| 1 | `projects/dsh-compat-platform/packages/analyzer/tests/combined-report.test.js` | yes (661 lines) |
| 2 | `projects/dsh-compat-platform/packages/analyzer/tests/combined-cli.test.mjs` | yes (579 lines) |
| 3 | `experiments/combined-report-integration.test.mjs` | yes (469 lines) — authored and frozen by another author |

Three literal paths, no glob and no discovery. The launcher refuses to start while any
target is missing, so this slice cannot accidentally measure two thirds of its own claim.

Target 3's header states it drives `buildCombinedReport` and the CLI through the **real**
validators (`validateDeclaration`, `validateAdmissionEvidence`) and the real runtime lane,
with **synthetic** documents throughout. Its own words: passing would say the three adapters
agree with the draft contracts, not that any machine behaved that way. That is also this
entry's reading — a green count here is not host evidence, load this file's §9 first.

## 3. The workload, as written

```
/www/server/nodejs/v24.21.0/bin/node --max-old-space-size=384 \
    --test --test-reporter=tap --test-concurrency=1 <three literal files>
```

inside `bwrap --ro-bind / /` with private pid/net/ipc/uts, a throwaway `/tmp` tmpfs, one
read-write bind to the run's `out/`, and `env -i` carrying only `PATH`, `HOME`, `TMPDIR`.
The heap cap is an argument rather than `NODE_OPTIONS`, so the recorded command line is the
executed one. The reporter is pinned to `tap` for the same reason: the summary is parsed,
so a reporter whose shape changed must not be able to degrade `# fail` into silence.

## 4. Run identity

| field | planned | actual (run `…448944-22547`) |
|---|---|---|
| run id | *not run* | `20261105T201825Z-combined-report-unit-448944-22547` |
| unit | *not run* | `combined-report-unit-20261105T201825Z-448944` |
| `systemd_run_rc` | *not run* | `70` |
| `acc_sandbox_rc` | *not run* | never recorded — bwrap never ran |
| `acc_node_started` | *not run* | `no` |
| `acc_node_report_complete` | *not run* | never recorded — no TAP body |
| `acc_node_rc` | *not run* | `refused_before_workload` |
| `acceptance_exit` | *not run* | `70` |
| `hash_status` | *not run* | `identical` |
| counts (`tests`/`pass`/`fail`) | unknown by design | **unknown — workload never started** |

## 5. What a run would have to record

- **counts** — `tests`, `suites`, `pass`, `fail`, `cancelled`, `skipped`, `todo` exactly as
  node prints them. The real numbers are **unknown** before a run; no expectation is
  stated here, because a guessed target becomes a target someone aims at.
- **exits, kept apart** — the unit's raw code in `systemd-run.rc`; the sandbox's code in
  `acc_sandbox_rc`; whether node actually started in `acc_node_started`; node's own in
  `acc_node_rc`, claimed only when node's test-runner markers appear in the captured
  output, and `not_observed` otherwise. `bwrap`'s status is not node's status.
- **caps** — the envelope read back from `/sys/fs/cgroup` and from `systemctl show`, with
  `RuntimeMaxUSec` resolved numerically through `busctl` and a spelling-tolerant parser.
- **gate** — one `MemAvailable` sample and whether it cleared `1228800` KiB.
- **hashes** — the selected set before and after, compared, with a diff file when they
  differ; a diff that cannot be read is reported separately from drift.
- **terminal query** — this unit's own load/active/sub state and `MainPID` after the run,
  the stop's rc when one was attempted, and the two confirmation reads.
- **unavailable counters** — `memory.swap.peak`, `cpu.stat`, `memory.events` read
  `<unavailable>` when the kernel does not publish them. No zero is invented.

## 6. Write-failure discipline

| situation | behaviour |
|---|---|
| `argv.txt` / `hashes-before.txt` cannot be written | refuse before launch (70); nothing runs |
| `unit.log` cannot be opened | refuse before launch (70) |
| `unit.log` empty or missing afterwards | write failure (73) |
| `journalctl` fails | write failure (73) — the journal is required evidence, not best-effort |
| `terminal-query.txt` / `hashes-after.txt` / `status.txt` cannot be written | write failure (73) |
| a hash line fails to print | write failure (73) — a short manifest must not look complete |
| payload's own `printf` fails | payload exits 73 |

Opening `unit.log` early proves the path was openable at that moment; it does **not** prove
later bytes land on a filesystem that fills up. That is why the payload checks its own
writes instead of relying on the pre-opened descriptor.

Priority: `73` > `70` (terminal unconfirmed) > `77` (hash read error) > `78` (drift) > the
unit's own code.

## 7. Terminal query rules

| observed | action |
|---|---|
| query fails | record `query-failed`; stop nothing; run is **not** a success (70) |
| missing fields / unknown state | record; stop nothing; not a success |
| `not-found` | require readable `MainPID=0`; missing PID is never rewritten to 0 |
| `not-found` with nonzero PID | record the contradiction; do not stop, do not repair |
| `loaded`/`merged` + `inactive` | success only with `MainPID=0` |
| `loaded`/`merged` + known live state (incl. `deactivating`) | `systemctl stop`, then two reads; all of stop rc, both rcs, load, state and PID must confirm, else non-zero |
| anything else | left alone — no `reset-failed` |

The preflight also lists `combined-report-unit-*`, `admission-*`, `p0-*` and `pilot-*`
together: a leftover unit from an earlier slice is exactly what this check exists to keep
visible, and the shared lock alone does not show the machine is at rest.

## 8. Selected hashes — witness, not closure

Three targets, twelve selected inputs, two runner scripts. The inputs are the two new
modules, the five modules they really import, `combined-report.d.ts`, the analyzer
`package.json`, and three spec-side files:
`projects/dsh-compat-spec/src/index.js` (which implements `validateDeclaration`),
`projects/dsh-compat-spec/src/admission-evidence.js`, and
`projects/dsh-compat-spec/spec/admission-evidence.md`.

Their import status is **not asserted**. Target 1 supplies its own fake §6.6 validator on
purpose and target 3 is unread, so those three are enumerated to keep a protocol change
visible beside a green count — listed is not imported.

The list is therefore a **selected witness over identified files, not a closure**. Two
equal manifests show only that those bytes matched at two sampled moments; they cannot
catch an unlisted module, cannot establish provenance, and cannot explain why an outcome
moved. `experiments/` is untracked, so HEAD is not a version for target 3 or either script.

## 9. What this record will not claim

Not realLoader evidence, not Loader acceptance, not a certification, not a dependency
closure, not global host health, and not a coverage claim for the combined-report
behaviour. The earlier slices' records and run directories are untouched and stand as
measured.

## 10. Gate — satisfied, and spent

1. Lead review of `run.sh` and `payload.sh` — done.
2. Target 3 on disk — done (`experiments/combined-report-integration.test.mjs`, 469 lines).
3. Explicit single-attempt GO — given, and consumed by the one invocation recorded in §0.
4. One launch, no retry, no polling, no limit increase — honoured. The attempt ended in a
   capacity refusal, which is the gate doing its job: it is not a failed test and not a
   passing one.

**What the refusal does not license.** It is not evidence about the three targets, not
evidence about the host's general health, and not a reason to loosen the gate. Re-attempting
requires a new explicit GO; this entry records exactly one attempt and no diagnosis of the
scripts was made or needed.
