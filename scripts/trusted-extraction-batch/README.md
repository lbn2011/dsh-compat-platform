# trusted-extraction-batch — observation round

**STATUS: MIGRATED (ABI `bounded-runner/1`, core `c8123de`), executed once after
migration on 2026-11-10: `acceptance_exit=0`, `abi=bounded-runner/1`, ownership receipt
present, five phases `observed`, `cleanup=confirmed`, six failure-path checks true,
isolation gate `none` with `uid=65534`, peaks 37621760 B / 21 pids.**

This is an **uplift, not an equivalence refactor**. The workload is unchanged — the
supervisor, the uid 65534 sandbox, the sentinel probe, the observed network errno and
the phase-budget SIGKILL path all stay as they were — but the host layer now provides
`Type=exec`, an invocation ownership receipt with an ownership-gated stop, a verified
terminal state, a declared control closure and strict TAP, none of which this launcher
had before. Limits are unchanged (384 MiB / swap 0 / 32 tasks / 50 % CPU / 120 s); the
core adds a 192 MiB V8 heap and its own MemAvailable gate. Invoke by **absolute** path;
a relative entry refuses 77 before launch.

**History (pre-migration, 2026-11-09):** two clean green rounds, plus the harness-fix
attempts, recorded in
[`../../docs/testing/2026-11-09-trusted-extraction.md`](../../docs/testing/2026-11-09-trusted-extraction.md);
then two more green rounds after the failure-path step was added, in
[`../../docs/testing/2026-11-09-trusted-extraction-failure-paths.md`](../../docs/testing/2026-11-09-trusted-extraction-failure-paths.md).
Those records describe the pre-migration runners; they are not evidence about these
bytes.

## This migration is an UPLIFT, not an equivalence refactor

Read this before comparing the two versions line by line.

The **workload is unchanged**. Configuring the trusted-extraction supervisor, building
the bubblewrap sandbox as uid `65534` with dropped capabilities, probing the sentinels,
observing the network refusal, and demonstrating the phase budget's SIGKILL path
through six failure-path checks are all carried over as-is, with the same budget
arithmetic, the same six checks and the same evidence files. The sandbox is **not
built here and is not touched by this migration**: it lives in
`packages/runtime/src/trusted-extraction-supervisor.js` (`--unshare-user --uid 65534
--gid 65534`, capability drop, `--unshare-net`, `--proc/--dev/--tmpfs /tmp`). Every
refusal it produces is still the workload's own verdict, never the runner's.

What the batch **gains** is the host layer it never had:

| gained | pre-migration | now |
| --- | --- | --- |
| unit type | `systemd-run` default (`Type=simple`) | `Type=exec`, read back inside the unit |
| ownership | none — a unit name and `systemctl show`, no receipt | `ownership.txt` (`unit=…`, `invocation_id=…`), and a stop only when that receipt matches the unit's **current** invocation |
| terminal verdict | `systemctl show … >> terminal.txt`, unread (`\|\| true`) | settled readback required; unconfirmed is `74`, never a pass |
| control closure | a 17-path relative `sha256sum` list with no verdict | declared control closure (manifest, wrapper, payload, five modules) plus two-point hashing of the selected inputs; violation is `77`, drift is `78` |
| TAP | node's exit status only | strict singleton `# tests/pass/fail/cancelled/skipped/todo`, `tests != 0`, `pass == tests` |
| exit vocabulary | local `75/76/77` for mkdir / lock-open / lock-held | the core's `73` evidence, `74` terminal-or-budget, `75` lock held, `76` collision, `77` manifest, `78` drift |

The old `75/76/77` meanings are **not** the new ones. A pre-migration `75` meant "the
run directory could not be created"; it now means "the lock is held". Do not carry the
old reading across.

**Limits are not weakened.** The core's envelope is the same 384 MiB / swap 0 / 32
tasks / 50% CPU / 120 s this batch already declared, so no per-slice override was
needed and none was made. The core **adds** two constraints this batch did not have: a
192 MiB V8 heap via `NODE_OPTIONS=--max-old-space-size=192`, and a strict
`MemAvailable >= 819200` KiB gate (the payload already performed that check itself, so
this is the same threshold, now enforced by the harness rather than by convention).

## Invocation

    bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/trusted-extraction-batch/run.sh

No arguments; extra arguments are refused (`70`). **The path must be absolute.** The
core binds every active shell source frame to its absolute control list, so a relative
entry path is refused with `77` **before** the lock is taken, before a run directory is
created and before any unit or workload is launched.

One invocation is one round. Output goes to
`${TRUSTED_EXTRACTION_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}/<stamp>-trusted-extraction-batch-<pid>-<n>/`.

## Files

| file | role |
| --- | --- |
| `run.sh` | host-side launcher: refuses a bad invocation, names the selected inputs, delegates one unit to the core |
| `payload.sh` | in-unit payload: after the core's envelope receipt, runs the eight observation steps |
| `failure-paths.mjs` | the six failure-path checks the payload runs (selected input, not migrated) |
| `README.md` | this document |

`run.sh`, `payload.sh` and `README.md` are control sources: the core hashes them, its
own five modules and its manifest, and refuses (`77`) if any of them cannot be read or
was invoked by a relative path.

## What one round does

1. The core's envelope receipt inside the unit: cgroup membership, `InvocationID`,
   `memory.max=402653184`, `memory.swap.max=0`, `pids.max=32`, `cpu.max=50000 100000`,
   `Type=exec`, `RuntimeMaxUSec=120000000`, then one `MemAvailable >= 819200` KiB gate.
2. `bash -n` and `node --check` on every file it runs (both scripts, the five runtime
   sources, `failure-paths.mjs`, `plugin-hang.mjs`).
3. Static contract: the package is `private`, has zero dependencies of any kind, every
   export target exists, the budget slack is positive, `FAILURE_PHASE_READ_BY_REIMPORT`
   is declared a limitation, and `NOT_DERIVED` holds exactly six entries.
4. Unit tests (`32/32`): one `node --test --test-concurrency=1` run over
   `packages/runtime/tests/*.test.js`. The summary is normalised, and then the core's
   singleton TAP check must pass on it.
5. Isolation gates 1–5 in a bubblewrap sandbox, including one outbound attempt observed
   from **inside** the sandbox (`ENETUNREACH`), the sentinel probes, and the
   uid/capability readback.
6. This baseline's runtime receipt: `scripts/runtime-receipt/receipt.mjs` runs against the
   observed installation **inside the same unit**, so the receipt and the observation cannot
   describe different runtimes. `baseline.txt` records the resolved version, the receipt
   document's own sha256, and the official pin's commit/version marked as *declared*.
7. Fixture observation: five phases, four entry outcomes, and a receipt shape check.
8. Failure paths: a fixture that outlives a **3 s demo phase budget** is killed and
   reaped (`status: incomplete`, `cleanup: unconfirmed`, `timedOut: true`), and the
   network verdict is observed from inside the sandbox. The shipped 80 s budget is still
   covered only by the arithmetic check.
9. yaml snapshot, then the verdict. The core records peaks and the payload receipt.

## The six failure-path checks (unchanged)

`failure-paths.mjs` demonstrates its claims with a 30 s outer budget and a 3 s demo
phase budget (`phaseSeconds: 3, killGraceSeconds: 2, readbackSeconds: 2`), and exits
`3` if any check fails, `64` on bad arguments:

| check | what it proves |
| --- | --- |
| `isolationGate` | the child ran inside the gate, not outside it |
| `networkDenied` | the observed network verdict is `denied` |
| `networkCodeRecorded` | the attempt recorded its exact code (`ENETUNREACH`) rather than a generic failure |
| `hangIncomplete` | the wedged target's receipt says `incomplete` |
| `hangCleanupUnconfirmed` | cleanup is reported honestly as unconfirmed, not as a claimed success |
| `hangTimedOut` | the phase budget actually killed the child (`timedOut: true`) |

## Exit codes

Payload:

- `0` green;
- `70` envelope, syntax or static-contract refusal;
- `72` unit tests or the fixture observation failed;
- `73` an isolation gate refused, an evidence write failed, or the TAP summary could
  not be normalised;
- `74` the failure-path step failed (network observation or kill path did not behave).

Launcher (relaying the core):

- `0` green;
- `70` refusal before or inside the launch;
- `71` unused by this payload;
- `72`/`73`/`74` relayed from the payload;
- `74` also the core's "the unit did not settle" code, as before the migration;
- `75` lock held;
- `76` run-directory collision;
- `77` a hash manifest or a control source could not be read, matched or written —
  including a **relative** entry path;
- `78` selected-input drift.

`74` is declared explicitly in the launcher's `BR_WORKLOAD_EXITS`, together with `70`,
`72` and `73`. Without it the core would collapse a failed failure-path step to `70` and
the distinction this batch exists to draw — "the demo did not time out" versus "the
demo refused to start" — would be lost.

## Artefacts (under `$RUN`)

Canonical, written by the core: `selection.txt`, `control-before.txt`,
`selected-before.txt`, `active-units.txt`, `argv.txt`, `requested.txt`, `unit.log`,
`launch.txt`, `systemd-run.rc`, `journal.txt`/`journal.rc`, `terminal-before.txt`,
`terminal-after-stop.txt`, `terminal.txt`, `stop.txt`, `ownership.txt`,
`ownership-systemctl.txt`, `envelope-systemctl.txt`, `envelope-getunit.txt`,
`envelope-runtime.txt`, `envelope-effective.txt`, `memory-gate.txt`,
`control-after.txt`, `selected-after.txt`, `control-diff.txt`, `selected-diff.txt`,
`payload-result.txt`, `payload-evidence.txt`, `peaks.txt`, `status.txt`.

Written by this payload: `tests.tap`, `tests.err`, `tests-exit.txt`,
`tests-summary.txt`, `tests-normalized.tap`, `tests-fields.txt`,
`static-contract.txt`, `isolation.txt`, `runtime-receipt.json`, `runtime-receipt.err`,
`runtime-receipt.rc`, `baseline.txt`,
`fixture.json`, `fixture.err`, `fixture-exit.txt`, `failure-paths/report.txt`,
`failure-paths.json`, `failure-paths-summary.txt`, `yaml.txt`, `verdict.txt`,
`reason.txt` (first refusal only), plus per-gate files under `isolation/` and the raw
failure-path artifacts under `failure-paths/`.

Changes relative to the pre-migration runner: `envelope-*.txt` and `memory-gate.txt`
are now the core's, written before any subprocess; the payload no longer writes its own
`journal.txt`, `terminal.txt`, `summary.txt` or `peaks.txt` (the core owns all four);
`tests-normalized.tap` is new; and `hashes-before.txt`/`hashes-after.txt` are replaced
by the `control-*` and `selected-*` pairs. `reason.txt` is kept deliberately: it is the
pre-migration shape of a refusal, written once, before the payload returns.

## Selected inputs (hashed before and after)

The launcher names 16 files; the core hashes them twice and reports drift as `78`:
`packages/runtime/package.json`, the five runtime sources
(`isolation-policy.js`, `child-probe.js`, `trusted-extraction-adapter.js`,
`trusted-extraction-receipt.js`, `trusted-extraction-supervisor.js`), the two test files,
`failure-paths.mjs`, the six `examples/trusted-extraction/` fixtures, and
`scripts/runtime-receipt/receipt.mjs` (the receipt step's own script, hashed because a
receipt produced by unhashed code would be unaccounted control).

`run.sh` and `payload.sh` are **not** repeated there — they are control sources. The
observed DSH installation
(`/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh`) is outside this
repository and is deliberately **not** hashed: this batch observes it, it does not own
its bytes, and hashing a vendored installation would turn an upgrade into a false drift.

## Not established

No production profile is read, no real plugin is loaded, no network is used. A green
round means the fixture behaved as designed inside the boundary; it is not a
loadability, correlation or certification result. The kill path is demonstrated here at
a 3 s demo budget; the shipped 80 s budget is measured by the separate
`scripts/trusted-extraction-hang-budget` slice, not by this batch.

## Changes in this migration (for the reviewer)

- The launcher no longer computes a unit name by hand (`<prefix>-$$-<epoch>` with no
  `.service` suffix), no longer opens its own lock descriptor, and no longer hashes
  relative paths inside a `( cd "$REPO" && … )` subshell: it names its selected inputs
  as absolute paths and hands one launch to `br_host_run`, which also derives a unit
  name that satisfies `br_unit`.
- The payload's argument contract is now two arguments (`unit`, `run`); the
  pre-migration payload took one (the run directory) because there was no unit receipt
  to bind to.
- The payload's own envelope self-check (`knob()` over the cgroup, the `pids.max` and
  `cpu.max` comparisons) and its memory gate are gone, replaced by
  `br_envelope_enter`. Nothing in the sandbox, the budget arithmetic, the six checks or
  the static contract moved.
- **The TAP summary is now normalised before it is checked.** The pre-migration payload
  grepped `^ℹ (tests|pass|fail) ` into `tests-summary.txt` and treated node's exit
  status as the verdict. The migrated payload rewrites the spec reporter's `<key>
  <decimal>` bodies into `# <key> <decimal>` comments and then runs the core's
  `br_tap_check`, so a summary that is missing, duplicated or arithmetically
  inconsistent is a `72` refusal instead of a pass.
- Evidence writes go through `br_record`; a failed write is the core's `73` instead of
  a locally incremented counter, and it now outranks a green workload verdict.
- The bwrap sandbox, the uid/capability drop, the sentinel list, the `ENETUNREACH`
  observation, the phase budget, the SIGKILL/hang path and the six failure-path checks
  are **byte-for-byte** the pre-migration behaviour.
