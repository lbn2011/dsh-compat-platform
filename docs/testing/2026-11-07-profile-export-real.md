# Real profile-export slice — RUN ONCE, GREEN

> Date: 2026-11-07. **Status: one authorised batch executed; all three scenarios green
> (`acceptance_exit=0`).** §1–§12 are the pre-run text, kept as history; §13 holds what was measured.
>
> Prepared files: `experiments/acceptance/profile-export-real/{run.sh,payload.sh,main.mjs,README.md}`
> and `experiments/acceptance/profile-export-real/tests/main.test.mjs`.
> The earlier unit and orchestration slices are linked, not restated, in §9.
>
> The runner was repaired code-only after review (§12) and **was never parse-checked or executed
> between those repairs and the one batch**; any `rc 0` syntax result elsewhere belongs to older bytes.

## 1. Why this slice

The plan (`docs/requirements-and-design/2026-11-07-isolated-profile-export-dev-plan.md`) asks for
configuration-export observations from the pinned official CLI, under a fixed envelope, with the
export's own writes contained. Every earlier slice in this stage ran `node --test` over fixture
modules; none drove the CLI. This slice does exactly one thing per scenario: **one** `runExport`
invocation with the real default ports, through the built `apps/cli/lib/bin.js`.

Export success is not loadability, admission, dependency satisfaction or compatibility, and this
record does not use it as any of those.

## 2. Interface (fixed)

`bash experiments/acceptance/profile-export-real/run.sh` — no arguments.

Scenarios, in this order, one unit each: `probe`, `denied`, `script-probe`. The runner passes only an
id; `payload.sh` decides the paths; `main.mjs` accepts only `--out` and `--scenario`, and refuses
anything outside the closed list. No profile text, CLI text or command can be supplied.

Unit names: `profile-export-real-<stamp>-<pid>-<n>-<id>`. One shared lock
`experiments/acceptance/runs/.acceptance.lock` for the whole batch.

## 3. What `main.mjs` judges (and what it does not)

`judgeReceipt(receipt, { scenario, runRoot, homeName, outDirectory })` is a **pure export** (no
filesystem, no throwing on shape), returning `{ ok, problems }` with fixed codes.

- Plain-record test: a non-array object whose prototype is `Object.prototype` or `null` — the shape a
  JSON parse produces. This is narrow on purpose: no Proxy-trap or exotic-prototype claim is made.
- Identity: `runVersion`, `receiptClass === 'PRIVATE_ORCHESTRATION_RECEIPT'`, `private === true`.
- Outcome: `status === 'completed'`, `refusal === null`; the scenario equals the one requested.
- Stages: exactly `validate,prepare,capture,persist,evaluate,done`, compared densely by index, so a
  sparse or hole-y array cannot pass.
- Verdict: `code === ACCEPTED`, `accepted === true`, `checkCount === passedCount`, safe integers
  `> 0`, `issueCount === 0`, and `checkCount` equal to the length of that scenario's own
  `SCENARIO_CHECK_IDS` entry (3 / 4 / 5) — the catalog is imported, never re-declared.
- Publication: `observation` is a record and `observationCandidate === null`.
- Capture summary as the receipt records it: `green`, `terminalState === 'closed'`, `exitCode === 0`,
  `signal === null`, `terminationReason === null`, `timeoutFired === false`, `errorCount === 0`,
  byte counts safe integers.
- Preparation: `homeName` equals the driver's home name and `home` is exactly
  `join(runRoot, homeName)`, with `failureCode === null`.
- Artifact: `stdoutPath`/`stderrPath` are **exactly** `join(outDirectory, ARTIFACT_NAMES.*)` —
  equality, not `startsWith()` and not a prefix test, so `../` cannot pass;
  `partial.artifactsAttempted` and `partial.artifactsWritten` each list both and nothing else;
  retained bytes equal the capture summary's and are within `STREAM_LIMIT_BYTES`; both problems null.

Not checked: raw capture streams. `run-export.mjs`'s `captureSummary` normalises a non-string signal
to `null`, so the summary's `signal === null` does not certify the raw record — this slice does not
claim to re-validate capture. Also not checked: rendered YAML content or completeness, plugin
loadability, admission, compatibility, or the identity of the source tree behind the built artifact.

There is no top-level `ok` or `green` in the receipt. `main.mjs` prints twenty fixed `main_*` lines
(including `main_judged_ok`, `main_problems`, `main_receipt_present`, `main_receipt_written`) and the
runner forms green from the whole conjunction: receipt present **and written**, envelope pass, gate
pass, `problems=none`, `verdict=ACCEPTED`, `capture_green=true`, `node_started=yes`, `node_rc`
exactly `0`, `launch_rc=0`, confirmed terminal state, empty write-failure list, `batch_hash_rc=0`.
A bare `launch_rc == 0` is not sufficient.

Field spellings are a fixed table rather than an inferred convention. `payload.sh` emits its own
checks as `acc_envelope_check`, `acc_gate`, `acc_node_started`, `acc_node_rc`, `acc_refusal`,
`acc_sandbox_rc`, and relays each driver key as `acc_<key>`, so the six judgement fields in `unit.log`
are `acc_main_receipt_present`, `acc_main_receipt_written`, `acc_main_judged_ok`, `acc_main_problems`,
`acc_main_verdict_code`, `acc_main_capture_green`; `run.sh` reads exactly those. The relay requires
each driver key exactly once.

Preflight refusal and post-workload anomaly are separate, and this distinction is load-bearing:

- `acc_refusal` (exit `70`) is a **preflight** refusal: nothing ran, so it prints
  `acc_workload_started=no`, `acc_node_started=no` and `acc_node_rc=not-observed` with basis
  `refused-before-workload`.
- `acc_post_workload_refusal` is an **after-workload** anomaly: `acc_sandbox_rc`/`acc_raw_exit` and
  `acc_node_started` have already been printed once, and this field only explains why the summary is
  unusable. It does not print `workload_started=no` and does not exit `70`, because both would be
  false. A sandbox `73` always wins; any other non-zero code is preserved as the exit code; a zero
  exit with a missing or duplicated summary key becomes `73`, since an unusable summary can never be
  green. The driver's own early refusals (a bare `main_refusal=` line) are counted as started, not as
  never-run.

Readout uses `show_field`, whose sentinel is `<ambiguous-or-missing:<n>>` with `n` the occurrence
count — absent is `:0`, ambiguous or duplicated is `:2` upward. A refusal therefore counts only when
the line is present and unique (a prefix match on the sentinel), and a missing line can never satisfy
the green test.

## 3a. Directory creation, persistence order, exit codes

The out directory is never created by the driver. Four conditions must hold before anything is
created: the spelling is absolute; the spelling equals its `normalize`d form (no `..`, `.` or
trailing slash); `realpath` returns byte-identical text (a symlinked target or parent changes it);
and `lstat` on the caller's own path reports a real directory that is not a symlink. `run-root` and
`run-root/out` are then created with exclusive non-recursive `mkdir`; an existing `run-root` is
refused rather than reused, and a second-directory failure leaves the first in place. A rejected
path yields zero `mkdir` and zero `runExport` calls. `receipt.json` is written with `flag: 'wx'`; only
success claims `present`/`written`. `main` is `async` and sets `process.exitCode` (no
`process.exit`). Output flows through an injectable writer whose failure paths are separate and
unconditional: a synchronous throw rejects even when what was thrown is `0`, `null` or `undefined`
(normalised to an `Error`), a callback argument other than `null`/`undefined` rejects, and an
independent `'error'` event rejects. Node's `Writable` often calls the callback with an error and
then emits `'error'`, so the listener is removed on success and **kept** on failure until that event
arrives; a failing write that never emits leaves one listener parked for the remaining life of the
one-shot writer (at most one per failed write). The caller sets `process.exitCode = 73` and lets the
process drain naturally — an immediate exit is not guaranteed and nothing forces one. A non-`Error`
rejection value is reported as the fixed message `stream write failed`, with the original value never
read or coerced (a hostile `toString` cannot run). Settlement is single and later events are
absorbed, not re-settled. Every branch turns a rejection into `73` — including the early refusals
that would otherwise be `10`/`12`/`70`. Driver codes: `0` green, `10` arguments/scenario, `11` not
green, `12` `runExport` threw, `70` layout refused, `73` write failure (highest).

`deps.runExport` takes precedence over the module's real import (`deps.runExport ?? runExport`).
That precedence is a static property of the expression plus the unit tests' call counts: the tests
show the injected function is called exactly once with the exact input and that the summary comes
from its receipt. They do not claim the real default was never reached at runtime — that belongs to
the export stage.

Runner-side, `acc_refusal` is read as three states by occurrence count: absent is a normal run with
no refusal; exactly one non-empty, non-sentinel line is `refused`; a duplicated line, an empty value
or a sentinel value is `malformed` (failed, never green, never "no refusal"). Ten required fields are
each counted and must appear exactly once.

## 4. Negative-case tests (written, not executed)

`experiments/acceptance/profile-export-real/tests/main.test.mjs` is written and has **never been
executed**. It covers, over injected ports and plain receipt objects: the plain-record boundary
(array/string/null/custom prototype); identity and status defects; scenario mismatch; missing,
out-of-order and sparse stage arrays; missing verdict, wrong code, `accepted: false`, `0/0` counts,
decimal counts, catalog-size mismatch, issues present; missing observation and leftover candidate;
each capture defect separately; wrong preparation home/name/`failureCode`; artifact path inequality
(including a `../` path that merely starts with the out directory), missing artifact, one-of-two
written, an extra path, retained bytes disagreeing with capture, a non-null problem, and bytes above
the stream cap; driver-level refusals (existing run-root before `runExport`, out not a directory,
unknown scenario touching nothing), a throwing `runExport`, a non-accepted receipt, a refused receipt
write (`73`, never downgraded to `11`/`12`), a failing summary writer (`73` even when green), a
partial artifact listing, an unusable `expected` (fixed `EXPECTED_INVALID`, no throw), rejected out
spellings (relative, `..`, trailing slash, non-canonical `realpath`, symlink) with zero `mkdir` and
zero `runExport`, a failing writer in an early refusal branch (`73`, not `10`/`70`), and `stdoutWrite`
over an injected stream (callback success, synchronous throw, callback error, independent `'error'`
event, single settlement, listener removal).

Positives there are built from the reviewed `runExport` receipt shape — `receiptClass`, `private`,
`partial.stagesCompleted`, `capture`, `artifact`, `verdict` — not from invented fields.

## 5. Envelope (unchanged from the reviewed stage)

`Type=exec`, `MemoryMax=384M`, `MemorySwapMax=0`, `TasksMax=32`, `CPUQuota=50%`, `RuntimeMaxSec=120`,
`--max-old-space-size=192`, one `MemAvailable >= 819200` KiB sample per unit, verified inside the
payload against the cgroup files **and** the systemd properties before the workload starts. A
mismatch refuses `70` and prints no `acc_capture_ok`.

The cgroup ceiling covers the whole service process tree; the heap option is one V8 heap. Ordinary
export fitting this envelope is **unproven**; prior approval of the budget is not evidence of fit.

## 6. Isolation and the write surface

bwrap: read-only root, private PID/net/IPC/UTS, tmpfs `/tmp` and `/home`, `env -i` with a fixed PATH,
the out directory as the **only** persistent bind. `runRoot` is created under that out directory, with
`homeName` `home` and the artifact directory under `runRoot/out`, matching `runExport`'s input
contract. `/root/.dsh` and port 3080 are not touched, scanned or read; no installation runs.

Export writes its own profile: this is **not a read-only export** and is not described as one.

## 7. Selected hash witness (no preview digests recorded)

23 named files: 11 fixture files (three profiles' manifests and patch layers), 5 fixture modules, the
3 scripts, `build-checkout/apps/cli/lib/bin.js`, and `dump-config-D97dwXdd.js`,
`dump-config-DuXZcU0e.js`, `profile-boot-e2mS45fC.js`. No digests are written here: the authors were
still editing this stage, and recording a preview would be a measurement of a file that no longer
exists at launch. The batch's own `snapshot.txt` is the witness.

The list is **not a closure**, and the built bin is an ignored build artifact: a source pin does not
authenticate it.

## 8. What a green batch would and would not mean

Would mean: three receipts were completed, published an observation, carried an `ACCEPTED` verdict
with equal check/pass counts, and survived this driver's consistency, persistence and terminal checks
under the fixed envelope.

Would not mean: that export output is complete or correct; that any plugin is loadable, admissible or
compatible; that the fixture selection is closed; that memory/CPU headroom is established; or that the
binary corresponds to the pinned commit.

## 9. Stage history (links only)

- single-target capacity refusal: [`2026-11-07-profile-export-unit.md`](../../../../projects/dsh-compat-platform/docs/testing/2026-11-07-profile-export-unit.md)
- three-module split: [`…-split.md`](2026-11-07-profile-export-unit-split.md),
  [`…-split-recheck.md`](2026-11-07-profile-export-unit-split-recheck.md),
  [`…-split-recheck-2.md`](2026-11-07-profile-export-unit-split-recheck-2.md)
- orchestration split: [`…-orchestration-unit-split.md`](2026-11-07-profile-export-orchestration-unit-split.md),
  [`…-orchestration-unit-split-recheck.md`](2026-11-07-profile-export-orchestration-unit-split-recheck.md)

Those records keep their own counts; none of them measures the files prepared here.

## 10. Blockers

1. Independent review of the rewritten `main.mjs`, `payload.sh`, `run.sh` and `tests/main.test.mjs`;
   no syntax check has been run and the test file has never been executed.
2. A GO for **one** batch, same envelope, no retry, no extra pre-checks.
3. Confirmation from the fixture owners that the 11 fixture files and the built CLI are frozen for
   the duration.

## 11. Deviations and disclosures

- Preparing this slice used file tools only, except that one `bash` invocation read the `main_*` key
  list out of `payload.sh` (a read-only `grep`) and one wrote nothing. Earlier in the round, one
  `glob` enumerated the fixture tree; no node, no `bash -n`, no test was run.
- A `glob` result is a listing, not an existence proof for anything it omitted; the fixture files and
  the built chunks were then read to confirm they exist.
- `payload.sh` has `set -uo pipefail`, resolves runtime by numeric microseconds, then the strictly
  anchored full-consumption `span_usec` parse (so `2min` works and `junk2minjunk` cannot), then the
  `busctl` Service fallback, printing render/usec/source; pre-launch refusals print no
  `acc_capture_ok` and claim `acc_node_rc=not-observed`.
- `run.sh` takes the shared lock before the snapshot; pre-launch snapshot/ids writes failing exit 73
  with nothing launched; every per-launch artefact is checked before `systemd-run`; an active-unit
  query failure is refused rather than read as "nothing running"; the terminal query's raw output is
  kept beside its own rc; the summary is emitted line by line with each write checked.
- Three design decisions changed during this round: the run root moved under the driver's out
  directory with `home` + `out` inside it (the earlier `runRoot/<id>` shape tripped
  `OUT_DIRECTORY_OVERLAPS_HOME`); the receipt is written with `wx`; and the import guard is file
  identity (`import.meta.url === pathToFileURL(process.argv[1]).href`) rather than a filename suffix.

## 12. Runner repairs made after review, before the only real batch — never separately parse-checked

Six defects were found by review of `run.sh` and fixed **code-only**. No `bash -n` was run on the
repaired bytes before the batch, and none was run afterwards either: the only execution of these files
is the one real batch recorded in §13, which exercised the happy path (three green launches) and did not
inject a failure into any of the repaired branches. Where a `rc 0` syntax result is quoted elsewhere in
this repository, it belongs to earlier bytes of these files.

1. `hashset()` validated the length of the whole `sha256sum` line, which always carries a path and is
   therefore never 64 characters — every hash would have failed and the batch would have refused before
   launching. The manifest still stores the full `"<digest>  <path>"` line; validation now takes
   `digest=${line%% *}`, requires 64 characters, and rejects any character that is not lowercase hex.
2. `show_field()` had an uninitialised `n` in awk, so a zero-match lookup printed
   `<ambiguous-or-missing:>` instead of `:0`, driving the tri-state refusal reader to `malformed`. Fixed
   with `BEGIN { n = 0; v = "" }`.
3. A redundant `hashset | wr snapshot-lines.txt … || true` line was removed: it duplicated work, its
   failure was discarded, and nothing read the file.
4. Every preflight branch now tests `write_fail` after writing its evidence and exits `73` rather than
   the branch's `70`; the empty `active-units.txt` marker is checked too, so a failure there cannot
   reach a launch.
5. The bounded stop now requires a terminal query rc `0`, a numeric non-zero `MainPID` and a known live
   `LoadState`/`ActiveState`. A failed query or an unreadable field is reported as not-confirmed and is
   never acted on.
6. The payload's `73` is counted separately: `payload_write_failure` accumulates per launch, is
   summarised as `payload_reported_73`, and keeps the batch at `73` (§13 exit ordering). What the code
   also does, and what has **never run**, is mark that launch `launch_status=error` with a
   `payload-reported-73` detail line; the three-scenario batch never took that branch, so the branch is
   written-but-unexercised, not measured. The count itself reports that a write failure was **reported**;
   it does not identify which write failed, and a payload can exit `73` with a zero sandbox rc and an
   unusable summary. The closing `printf` to the caller is checked and exits `73` on failure.

The active-unit family query also gained `profile-export-main-unit-*`. Budget, scenarios, fixtures,
`main.mjs` and `payload.sh` were not changed.

## 13. Measured — one batch, three scenarios, all green

One invocation, no retry, and none of the run inputs (`run.sh`, `payload.sh`, `main.mjs`, fixtures)
edited during or after that invocation — only this record and `README.md` were written afterwards:

`bash experiments/acceptance/profile-export-real/run.sh` → batch
[`runs/20261107T062654Z-profile-export-real-512194-18141`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141).

| batch field | value |
|---|---|
| `acceptance_exit` | **0** |
| `batch_verdict` | `green` |
| `green_count` | `3` |
| `stop_reason` | `none` — nothing was stopped, so there are no `not-run` scenarios |
| `snapshot_lines` | `23` |
| `evidence_write_failures` | `0` |
| `payload_reported_73` | `0` |
| `batch_hash_rc` | `0` |

Batch files: [`summary.txt`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/summary.txt),
[`ids.txt`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/ids.txt),
[`snapshot.txt`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/snapshot.txt),
[`active-units.txt`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/active-units.txt).

### 13.1 Per scenario

| # | scenario | status | verdict | checks passed | `node_rc` | sandbox rc | capture bytes (out/err) | gate KiB |
|---|---|---|---|---|---|---|---|---|
| 1 | [`probe`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/1-probe) | `green` | `ACCEPTED` | 3 / 3 | `0` | `0` | `333` / `0` | `890168` |
| 2 | [`denied`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/2-denied) | `green` | `ACCEPTED` | 4 / 4 | `0` | `0` | `162` / `383` | `851944` |
| 3 | [`script-probe`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/3-script-probe) | `green` | `ACCEPTED` | 5 / 5 | `0` | `0` | `568` / `0` | `836468` |

Every scenario: `envelope_check=pass`, `gate=pass`, `receipt_present=yes`, `receipt_written=yes`,
`main_judged_ok=yes`, `main_problems=none`, `capture_green=true`, `capture_terminal=closed`,
`capture_exit=0`, `capture_signal=none`, `stages=validate,prepare,capture,persist,evaluate,done`,
`observation_present=yes`, `candidate_present=no`, `terminal_ok=yes`, `hash_status=identical`.

Per-scenario raw evidence (each directory holds `unit.log`, `argv.txt`, `status.txt`,
`systemd-run.rc`, `hashes-before.txt`, `hashes-after.txt`, `pre-hash-diff.txt`, `hash-diff.txt`,
`terminal-query.txt`, `terminal-query-raw.txt`, `journal.txt`, and `out/`):

- probe — [`status.txt`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/1-probe/status.txt) ·
  [`unit.log`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/1-probe/unit.log) ·
  [`out/receipt.json`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/1-probe/out/receipt.json) ·
  [`out/run-root/out/stdout.bin`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/1-probe/out/run-root/out/stdout.bin) ·
  [`out/run-root/out/stderr.bin`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/1-probe/out/run-root/out/stderr.bin)
- denied — [`status.txt`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/2-denied/status.txt) ·
  [`unit.log`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/2-denied/unit.log) ·
  [`out/receipt.json`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/2-denied/out/receipt.json) ·
  [`out/run-root/out/stdout.bin`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/2-denied/out/run-root/out/stdout.bin) ·
  [`out/run-root/out/stderr.bin`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/2-denied/out/run-root/out/stderr.bin)
- script-probe — [`status.txt`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/3-script-probe/status.txt) ·
  [`unit.log`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/3-script-probe/unit.log) ·
  [`out/receipt.json`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/3-script-probe/out/receipt.json) ·
  [`out/run-root/out/stdout.bin`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/3-script-probe/out/run-root/out/stdout.bin) ·
  [`out/run-root/out/stderr.bin`](../../../../experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/3-script-probe/out/run-root/out/stderr.bin)

### 13.2 What the three exports rendered

- `probe`: one patch layer applied on top of the controlled bundle —
  `# == @fixture/dsh-bundle-probe, patched by …/home/profiles/probe/cordis.patch.yml`, then the
  `fixture-probe-marker` row with `layer: user`.
- `denied`: the bundle row alone with `layer: bundle`, exit `0`, and on **stderr** the skip line
  `dsh: skipping profile bundle "@fixture/dsh-bundle-absent": Error: dsh: cannot resolve profile bundle
  "@fixture/dsh-bundle-absent" from the dsh installation or …; run 'dsh plugin --profile denied install' …`.
  The scenario is **missing-bundle, not permission**: nothing was present-but-unreadable.
- `script-probe`: the bundle row plus the patch layer, and the patch values printed verbatim as
  `probeA: !!js process.env.DSH_FIXTURE_PROBE_A ?? 'sentinel-a-missing'` /
  `probeB: !!js process.env.DSH_FIXTURE_PROBE_B ?? 'sentinel-b-missing'` — rendered, not evaluated, so
  no environment value appears.

### 13.3 Envelope, capacity, hashes, terminal

All three units reported `memory.max=402653184`, `memory.swap.max=0`, `pids.max=32`,
`cpu.max='50000 100000'`, `Type=exec`, runtime `2min` → `span-fallback` → `120000000` µs, heap `192`,
each re-read from its own cgroup files and unit properties by `unit.log` and reduced to a single
`acc_envelope_check=pass` (this stage prints no per-limit `acc_verify_*` lines; that field family
belongs to the earlier main-unit slice). Gates: `890168`, `851944`, `836468` KiB
against `819200` — three single samples, each only just above the floor.

Hashes: 23 selected files, `hashes-before.txt` and `hashes-after.txt` each 23 lines in every scenario,
both `pre-hash-diff.txt` and `hash-diff.txt` empty; `hash_status=identical`.

Terminal: every scenario `terminal_query_rc=0`, `not-found` / `inactive` / `dead`, `main_pid=0`,
`notfound-settled`, `stop_attempted=no`; each journal ends `Deactivated successfully`.

### 13.4 What this batch does and does not establish

- It establishes that, under this envelope and with this controlled fixture set, three ordinary
  `--dump-config` exports ran to completion through the built CLI, produced a receipt the driver could
  reconcile (`3/3`, `4/4`, `5/5` checks, `problem=none`), and left their units settled.
- An ordinary dump is **not** plugin loadability, not a complete inventory of what would load, not
  admission, not dependency satisfaction, and not a compatibility or security certification. The
  `script-probe` output shows unevaluated `!!js` text precisely because the export does not execute it.
- `denied` proves only that an unresolvable bundle is skipped and the export still exits `0`; it says
  nothing about permission-denied reads, which this slice never created.
- Three gate samples just above `819200` KiB are three observations, not a fit claim; green here does
  not say ordinary export fits `384 MiB` in general.
- 23 hashed files are a witness, not a closure; nothing asserts the rest of the tree is unchanged.
- No stability, trend, or host-memory-health claim is made.
