# profile-export orchestration unit slice (two targets) — RUN ONCE, STOPPED AT LAUNCH 2

> Date: 2026-11-07. **Status: RUN ONCE — batch stopped at launch 2.** `acceptance_exit=11`,
> `green_count=1`, `stop_reason=failed:run`. `evaluate` green 39/39; `run` **46 tests / 45 pass / 1
> fail**. Measured results are in §10; §§1–9 are the pre-launch draft, kept as written so the prepared
> state is not rewritten after the fact.
>
> The earlier draft's opening line ("No GO has been consumed … nothing was executed") described this
> slice before it ran. It has been superseded by the batch in §10 — and only by that batch.
>
> A later authorised batch is recorded separately in
> [`2026-11-07-profile-export-orchestration-unit-split-recheck.md`](2026-11-07-profile-export-orchestration-unit-split-recheck.md)
> (§10.8). It does not change anything below.

## 1. What this slice is, and what it is not

A two-target sibling of the accepted three-module unit slice, covering the next modules the
orchestration layer is built from:

| id | test file | module |
|---|---|---|
| `evaluate` | `experiments/profile-export-fixture/tests/evaluate-export.test.mjs` | `evaluate-export.mjs` |
| `run` | `experiments/profile-export-fixture/tests/run-export.test.mjs` | `run-export.mjs` |

Both test files drive **mocked ports**. So this batch never starts the real CLI, never creates a real
`prepare` instance, never resolves a fixture bundle, and performs no export on this host. That limit
belongs to the tests, not to the modules: `run-export.mjs` is the orchestration module and does
prepare, capture and write when given real ports. Only its mocked paths are exercised here, and the
`run` tests' last two cases use the real evaluator against fixture text — still no CLI, still no
proof that an export works.

## 2. Environment and envelope (planned, not measured)

```
systemd-run --wait --pipe --collect --unit=<unit> \
  -p Type=exec -p MemoryMax=384M -p MemorySwapMax=0 -p TasksMax=32 \
  -p CPUQuota=50% -p RuntimeMaxSec=120 -- /bin/bash payload.sh <unit> <out> <id>
```

node `/www/server/nodejs/v24.21.0/bin/node --max-old-space-size=192 --test --test-reporter=tap
--test-concurrency=1 <one test file>`; bwrap read-only root, private PID/net/IPC/UTS, tmpfs `/tmp` and
`/home`, `env -i`; one `MemAvailable >= 819200` KiB sample per unit; shared lock
`experiments/acceptance/runs/.acceptance.lock` held for the whole batch.

The cgroup limits are an aggregate over the service process tree; the V8 heap option bounds one
process's old space, not the tree and not RSS. The envelope is verified inside the unit from the cgroup
files (`memory.max`, `memory.swap.max`, `pids.max`, `cpu.max`) plus systemd `Type` and runtime ceiling;
any unreadable or differing value refuses with 70 before node starts.

## 3. Selected inputs — nine named hashes, **not a closure**

`tests/evaluate-export.test.mjs`, `tests/run-export.test.mjs`, `observation.mjs`, `capture.mjs`,
`prepare.mjs`, `evaluate-export.mjs`, `run-export.mjs`, this slice's `run.sh` and `payload.sh`.

**No digests are recorded here.** The two target files were still being revised while this slice was
prepared, so any hash written now would describe bytes that no longer exist — a stale number presented
as a measurement. The nine-file list is a named selection, not a closure: the profiles, the export
templates, the manifests, the fixture bundle and the built CLI sit outside it and outside this stage.
Hashes belong to a run record, with the run id beside them.

## 4. Artifacts a real run would produce

Batch root: `summary.txt` (primary), `argv.txt`, `snapshot.txt`; a batch-root `status.txt` **only** for
a `run.sh`-level preflight refusal; `verdict-override.txt` only when a write failure withdraws green.
Per target `1-evaluate/`, `2-run/`: `argv.txt`, `command.txt`, `hashes-before.txt`, `hashes-after.txt`,
`hash-diff-before.txt`, `hash-diff-after.txt`, `systemd-run.rc`, `unit.log`, `journal.txt`,
`terminal-query.txt`, `status.txt`, `out/node-tap.log`, `out/node-stderr.log`; plus
`status-withdrawn.txt` if that target's own record could not be written.

A target that is never launched holds only `status.txt` with `launch_status=not-run`; its counts are
**unknown, not zero**.

## 5. Rules the runner enforces (read from the source, not observed in a run)

- One batch, one attempt, no arguments, no subset, no automatic retry; serial; first non-green stops the
  batch and later targets are written `not-run`.
- Pre-launch drift: `hashes-before.txt` is compared with `snapshot.txt` **before** `systemd-run`; a
  mismatch prevents the launch (78 drift / 77 read error) and the target is recorded as refused.
- Green requires: no refusal, envelope pass, gate pass, complete six-field TAP, `tests == pass > 0`,
  zero fail/skipped/cancelled/todo, `node_rc -eq 0`, hashes identical on both sides, confirmed terminal
  state with `MainPID=0`, no launch error, and `write_fail -eq 0`. `green_count` increments only after
  that target's `status.txt` was written successfully.
- Exit priority `73 > 70 (terminal/refusal) > 0 green > 77 > 78 > 11`. A payload-level refusal inside a
  launched unit ends the batch with 11 while the target's raw `70` is preserved.

## 6. History index — the earlier three-module stage, linked not restated

These are the **previous stage's** measurements, quoted only so the two stages are not confused. Their
counts are that stage's, not this slice's.

| # | event | run id | result |
|---|---|---|---|
| 1 | single-target slice (one target) | `20261106T190515Z-profile-export-unit-493524-31564` | refused at the capacity gate `764264` vs `819200` (shortfall `54936`), no workload, no TAP — counts unknown, never zero |
| 2 | three-module split, batch 1 | `20261107T021014Z-profile-export-unit-split-503446-18723` | stopped at launch 2: `observation` 35/35, `capture` 21/20/1, `prepare` not-run |
| 3 | three-module split, recheck 1 | `20261107T022340Z-profile-export-unit-split-504184-14687` | stopped at launch 3: 35/35, 21/21, `prepare` 39/37/2 |
| 4 | three-module split, recheck 2 | `20261107T025959Z-profile-export-unit-split-505534-15399` | green: 35/35, 21/21, 42/42, `acceptance_exit=0` |

Records, in order: [`2026-11-07-profile-export-unit.md`](2026-11-07-profile-export-unit.md),
[`2026-11-07-profile-export-unit-split.md`](2026-11-07-profile-export-unit-split.md),
[`2026-11-07-profile-export-unit-split-recheck.md`](2026-11-07-profile-export-unit-split-recheck.md),
[`2026-11-07-profile-export-unit-split-recheck-2.md`](2026-11-07-profile-export-unit-split-recheck-2.md)
— the last of which carries the clickable raw-artifact index for those four runs.

**This slice contributes no row to that table.** Its state is the one below, and only a real batch would
replace it.

## 7. This slice's own state — nothing measured (pre-launch draft; superseded by §10)

| field | value |
|---|---|
| launches | `0` |
| TAP counts for `evaluate` / `run` | unknown — never executed, not zero |
| exit code | none |
| capacity samples | none |
| hashes | not taken (see §3) |
| terminal queries | none |
| units created | none |

## 8. Non-claims (pre-launch draft; still binding, see also §10.7)

- Not run: no count here is a result, and this record must not be cited as evidence that either module
  passes.
- Green, when it happens, would mean each test file's own assertions passed under this envelope. It
  would not mean an export works, that the fixture is valid, that the bundle resolves, that the CLI
  fits, or that any compatibility claim holds.
- Nine selected files are a selection, not a closure of the orchestration stage.
- Two targets are two separate facts; no suite total would be claimed.
- No `bash -n` has been performed on either script by its author; parse validity is unverified here.

## 9. Blockers before a GO

1. Both target files and their modules must be frozen by their authors — they were still being revised
   when this slice was written. The runner fails closed with 70 if any of the nine is missing.
2. Independent review of `run.sh` and `payload.sh` by someone other than their author.
3. The export stage itself (`--dump-config` against the real built CLI, three controlled profiles) is a
   different runner and a separate authorisation. Nothing here substitutes for it.

# Measured — one batch, one invocation

## 10. The authorised batch

One GO, one attempt, no retry, no extra pre-check, no `bash -n`, no source edit, no real CLI.

```
bash experiments/acceptance/profile-export-orchestration-unit-split/run.sh
```

Batch: `20261107T034631Z-profile-export-orchestration-unit-split-507129-29183`
(`experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/`),
unit prefix `profile-export-orchestration-unit-split-20261107T034631Z-507129-`.

### 10.1 Outcome

| field | value | source |
|---|---|---|
| `acceptance_exit` | `11` | [`summary.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/summary.txt) |
| `batch_verdict` | `stopped` | same |
| `stop_reason` | `failed:run` | same |
| `green_count` | `1` | same |
| `targets` / `ids` | `2` / `evaluate run` | same |
| `snapshot_lines` | `9` | same |
| `evidence_write_failures` | `none` | same |

Both targets were launched, because the first was green; the batch stopped on the second, so there is
no `not-run` target and no unknown count in this batch.

### 10.2 Per target

| # | id | `systemd_run_rc` | TAP tests/pass/fail | `node_rc` | hash | TAP lines / bytes | `launch_status` |
|---|---|---|---|---|---|---|---|
| 1 | `evaluate` | `0` | `39 / 39 / 0` | `0` | `identical` | `244` / `7733` | **green** |
| 2 | `run` | `1` | `46 / 45 / 1` | `1` | `identical` | `304` / `9822` | **failed** |

Skipped, cancelled and todo are `0` for both; six TAP fields present exactly once, sum equal to tests,
`acc_tap_malformed_fields=` empty, `acc_node_rc_basis=complete-summary-observed` for both. TAP
`# duration_ms`: `evaluate` `—` (see the raw log), `run` `301.267929`.

- `evaluate` status: [`1-evaluate/status.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/1-evaluate/status.txt), TAP: [`1-evaluate/out/node-tap.log`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/1-evaluate/out/node-tap.log), terminal: [`1-evaluate/terminal-query.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/1-evaluate/terminal-query.txt), unit log: [`1-evaluate/unit.log`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/1-evaluate/unit.log)
- `run` status: [`2-run/status.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/2-run/status.txt), TAP: [`2-run/out/node-tap.log`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/2-run/out/node-tap.log), terminal: [`2-run/terminal-query.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/2-run/terminal-query.txt), unit log: [`2-run/unit.log`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/2-run/unit.log)
- Batch: [`argv.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/argv.txt), [`snapshot.txt`](../../../../experiments/acceptance/profile-export-orchestration-unit-split/runs/20261107T034631Z-profile-export-orchestration-unit-split-507129-29183/snapshot.txt)

### 10.3 The one failure

TAP item 18, `not ok 18 - a prepare refusal keeps its fixed code and private progress, never its message`
at `experiments/profile-export-fixture/tests/run-export.test.mjs:406`, assertion at `:425`:

```
Expected values to be strictly equal:
+ actual - expected
+ null
- 'SOURCE_MISSING'
code: 'ERR_ASSERTION', operator: 'strictEqual'
```

Recorded as returned. No repair, no rerun, no reduced run.

**Static correspondence (not a proof of cause).** The test builds its refusal as
`Object.assign(new Error('cannot copy …'), { name: 'PrepareRefusal', code: 'SOURCE_MISSING', … })`
(`run-export.test.mjs:409-414`) — a plain `Error` carrying a `name` string. `run-export.mjs:626` reads
the code with `error instanceof PrepareRefusal ? error.code : null`, so a name-tagged plain `Error`
yields `null`, and `failureCode: typeof code === 'string' ? code : null` (`:633`) stores `null`, which
is the actual value above. The test file imports nothing from `../prepare.mjs`; `PrepareRefusal` appears
in it only as that string at `:410`. So the shape of the mismatch is a test that simulates a refusal by
name against a module that recognises the class. Whether the test or the module should change is a
decision for those files' authors; this record only reports the observation and the reading that
matches it.

### 10.4 Envelope, caps and capacity (both launches, from `unit.log`)

| field | evaluate | run |
|---|---|---|
| `acc_envelope_check` | `pass` (6/6 ok) | `pass` (6/6 ok) |
| cgroup `memory.max` / `memory.swap.max` | `402653184` / `0` | `402653184` / `0` |
| cgroup `pids.max` / `cpu.max` | `32` / `50000 100000` | `32` / `50000 100000` |
| `acc_cap_type` | `exec` | `exec` |
| runtime ceiling | `120000000` µs (`span-fallback`, rendered `2min`) | same |
| `acc_gate_memavailable_kib` ≥ `819200` | `844680` | `839956` |
| `acc_gate` | `pass` | `pass` |
| `acc_sandbox_rc` / `acc_raw_exit` | `0` / `0` | `1` / `1` |
| unit tail | `624ms`, CPU `260ms`, peak `52.5M` | `512ms`, `260ms`, `38.4M` |

Four limits read from cgroup files, `Type` and the ceiling from systemd properties. One capacity sample
per launch: two samples, no trend, no attribution. `memory.events` was not read by this payload, so
nothing is claimed about how close any limit came; nothing is claimed about host memory health.

### 10.5 Selected hashes (nine, identical before and after both launches)

`hash_status=identical` for both launches; all four diff files are 0 lines. `snapshot.txt` holds:

| file | sha256 |
|---|---|
| `tests/evaluate-export.test.mjs` | `ca270dcb0a06cc54b1363261588b78b8e10fa293447526c9f7720756e824375d` |
| `tests/run-export.test.mjs` | `4f455cc8ba72718b3c1d99abd51930141d470e88f612c6e6dec355df26f98b04` |
| `observation.mjs` | `bae0f3cd6f1eaea85682a30a83959e0136ae0e83dc691b4cdac3c088e4b8678e` |
| `capture.mjs` | `f7af3584819c88dfd8d3764a7ea93346f342bb8aa192569e46c215aba827b405` |
| `prepare.mjs` | `c9ae27a9dac1c8ddac211ff4841eaf7079789154c38bf4f50d63aabe274b25fa` |
| `evaluate-export.mjs` | `7cb9e54e86667380290fdbdb3677ad9d88782f6b990ba35cc4398ebf904470fd` |
| `run-export.mjs` | `4b2be6ffbf018abdf5585169a1b96b82c75b960dda80a9e84021cebb2d6787df` |
| `run.sh` | `279b0a568e16d8dec3ee2a19df63ea64bcd60637bf9a483b2c638097643d72ff` |
| `payload.sh` | `db75bc466f08d3d55f404eca636f1874960b25faffd1fb5bc7cb6740477c8d46` |

These are **the bytes this batch measured** — the first time this slice's inputs were frozen. They are
still a named selection, not a closure. The three observation/capture/prepare digests equal the ones in
the earlier stage's green batch, so those three modules were unchanged across the two stages.

### 10.6 Terminal state

Both launches: `terminal_query_rc=0`, `LoadState=not-found`, `ActiveState=inactive`, `SubState=dead`,
`MainPID=0`, `terminal_ok=yes`, `terminal_note=notfound-settled`, `stop_attempted=no`,
`stop_rc=not-attempted`. Journals: launch 1 ends `Deactivated successfully`; launch 2 ends
`Main process exited, code=exited, status=1/FAILURE` → `Failed with result 'exit-code'`. No unit of this
slice remained.

### 10.7 Non-claims for this batch

- `evaluate` green means its own assertions passed under this envelope. It is not evidence about
  `run-export.mjs`, the fixture, the bundle, the CLI or compatibility.
- `run` 46/45/1 is one failure in one file; no suite total, no bisection, no stability claim.
- The `run` tests drive mocked ports, so nothing here shows the orchestration module working against
  real ports; `run-export.mjs` can prepare, capture and write, and those paths were not exercised.
- Two targets, two separate facts. Nine named files are a witness, not a closure.
- The static correspondence in §10.3 is a reading of source that matches the observed assertion values;
  it is not a controlled experiment and no fix was tested.
- Two capacity samples, no trend, no attribution, no host-health inference.

### 10.8 Later observation (link only, not a revision)

After the authors' `tests/run-export.test.mjs` correction, one further authorised batch
(`20261107T040803Z-profile-export-orchestration-unit-split-508051-263`) ran both targets green —
`evaluate` 39/39, `run` 47/47, `acceptance_exit=0` — with the same `run.sh`/`payload.sh` bytes. See
[`2026-11-07-profile-export-orchestration-unit-split-recheck.md`](2026-11-07-profile-export-orchestration-unit-split-recheck.md).
This batch's own result (`46/45/1` at `tests/run-export.test.mjs:425`, digest `4f455cc8…`) stands as
measured for its bytes; nothing above is rewritten by the later run.
