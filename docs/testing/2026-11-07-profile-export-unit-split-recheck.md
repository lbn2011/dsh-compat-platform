# profile-export unit slice, split by target — recheck 1: `capture` green, `prepare` failed

> Date: 2026-11-07. **Status: RUN ONCE — STOPPED AT LAUNCH 3.** One batch, one invocation after the
> authors' `capture.test.mjs` correction: `acceptance_exit=11`, `stop_reason=failed:prepare`,
> `green_count=2`. `capture` is now green; `prepare` — never launched before — failed on two of its 39
> tests. The first batch and its failure are preserved in
> `2026-11-07-profile-export-unit-split.md` §9 and are not rewritten here.

## 1. Invocation

```
bash experiments/acceptance/profile-export-unit-split/run.sh
```

No arguments, one attempt, no retry, no repair, no additional test, no real CLI, no installation. The
frozen runner and payload were unchanged: `run.sh` `96e1bbd68b356358ef9e9e2ea0f4c5b36a0e609149afcea85b442cc0ea984f2c`,
`payload.sh` `a9f60f2e6475daf5a5889feeccf6619676bb7edf7ff2f21e7e5bfa9bbb0ca8ae`, both identical to
the first batch. The only difference between the two batches is the test file named in §6.

## 2. Batch

| field | value | source |
|---|---|---|
| run id | `20261107T022340Z-profile-export-unit-split-504184-14687` | batch root |
| `acceptance_exit` | `11` | `summary.txt` |
| `batch_verdict` | `stopped` | `summary.txt` |
| `stop_reason` | `failed:prepare` | `summary.txt` |
| `green_count` | `2` | `summary.txt` |
| `targets` / `ids` | `3` / `observation capture prepare` | `summary.txt` |
| `snapshot_lines` | `8` | `summary.txt` |
| `evidence_write_failures` | `none` | `summary.txt` |

All three targets launched. No batch-root `status.txt` exists, consistent with no `run.sh`-level
refusal.

## 3. Per target

| # | id | `systemd_run_rc` | TAP | `node_rc` | hash | terminal | `launch_status` |
|---|---|---|---|---|---|---|---|
| 1 | `observation` | `0` | `35 / 35 / 0 / 0 / 0 / 0` | `0` | `identical` | `not-found`/`inactive`/`dead`, `MainPID=0`, `notfound-settled`, `stop_attempted=no` | **`green`** |
| 2 | `capture` | `0` | `21 / 21 / 0 / 0 / 0 / 0` | `0` | `identical` | same settled state | **`green`** |
| 3 | `prepare` | `1` | `39 / 37 / **2** / 0 / 0 / 0` | `1` | `identical` | same settled state | **`failed`** |

No suite total is claimed: three counts are three separate facts. Both green targets printed all six
TAP fields once, digits only, summing to `tests`; `acc_tap_malformed_fields=` empty for all three.

## 4. Envelope and capacity

| field | observation | capture | prepare |
|---|---|---|---|
| `acc_envelope_check` | `pass` (6/6 `acc_verify_*` ok) | `pass` | `pass` |
| cgroup `memory.max` / swap / `pids.max` / `cpu.max` | `402653184` / `0` / `32` / `50000 100000` | same | same |
| `acc_cap_type` | `exec` | `exec` | `exec` |
| `acc_cap_runtime_max_usec` | `120000000` (`span-fallback`, rendered `2min`) | same | same |
| `acc_gate_memavailable_kib` ≥ `819200` | `1170352` | `1126684` | `1162468` |
| `acc_gate` | `pass` | `pass` | `pass` |
| `acc_sandbox_rc` / `acc_raw_exit` | `0` / `0` | `0` / `0` | `1` / `1` |
| unit tail | `660ms`, CPU `258ms`, peak `61.9M` | `427ms`, `210ms`, `34.3M` | `606ms`, `308ms`, `38M` |

Four limits read from cgroup files, `Type` and the runtime ceiling from systemd properties (rendered
string parsed). Peaks are one sample each at the cgroup aggregate level: not a fit proof, not host
memory health, and `memory.events` was not read, so nothing is claimed about proximity to any limit.

## 5. The two `prepare` failures, verbatim

Both are assertions inside `experiments/profile-export-fixture/tests/prepare.test.mjs`, whose digest
`d3381e30e0e31cc0867c9e68cdffa737681c13204fafb97df982f84992e03db9` is **unchanged** from the first
batch — these bytes were never executed before, because `prepare` was `not-run` then.

**Item 8** — `location: .../tests/prepare.test.mjs:363:1`, `failureType: 'testCodeFailure'`,
`code: 'ERR_ASSERTION'`, `operator: 'strictEqual'`, `expected: false`, `actual: true`, stack at
`prepare.test.mjs:373:14`:

```
not ok 8 - home names that are not one lowercase segment are refused
    the refusal must not echo the input
    true !== false
```

**Item 18** — `location: .../tests/prepare.test.mjs:597:1`, `operator: 'fail'`,
`code: 'ERR_ASSERTION'`, stack through `expectRefusal` (`prepare.test.mjs:191:17`) at
`prepare.test.mjs:617:3`:

```
not ok 18 - a run root inside, containing, or linking to the protected root is refused
    expected the call to refuse with RUN_ROOT_PROTECTED
```

Read at face value: item 8 says the refusal message carried the rejected input back (`true` where
`false` was asserted), and item 18 says a protected-root case did not produce the expected
`RUN_ROOT_PROTECTED` refusal. No source bisection was performed, no library call was made outside the
test, and nothing was edited, so **neither diagnosis is established by execution** — the record holds
the assertions and their operands, not a cause.

No resource influence is claimed or excluded by this record: the target's envelope and gate passed,
its TAP summary was complete, and the failures are assertions about refusal behaviour.

## 6. Selected hash witness and the change since the first batch

`hash_status=identical` for all three launches; every `hash-diff-before.txt` and `hash-diff-after.txt`
is empty. Eight files, 8 lines in `snapshot.txt`:

| file | sha256 |
|---|---|
| `tests/observation.test.mjs` | `782e74eb294bc88b8b2b31f214a029b9eae1bc7112b8af78dab835ef4e13ddfd` |
| `tests/capture.test.mjs` | `8e25c29b248d76b7b05e5beda4feacd554f878e789d6ca234e75b790c2f028e0` |
| `tests/prepare.test.mjs` | `d3381e30e0e31cc0867c9e68cdffa737681c13204fafb97df982f84992e03db9` |
| `observation.mjs` | `bae0f3cd6f1eaea85682a30a83959e0136ae0e83dc691b4cdac3c088e4b8678e` |
| `capture.mjs` | `f7af3584819c88dfd8d3764a7ea93346f342bb8aa192569e46c215aba827b405` |
| `prepare.mjs` | `c9ae27a9dac1c8ddac211ff4841eaf7079789154c38bf4f50d63aabe274b25fa` |
| `run.sh` | `96e1bbd68b356358ef9e9e2ea0f4c5b36a0e609149afcea85b442cc0ea984f2c` |
| `payload.sh` | `a9f60f2e6475daf5a5889feeccf6619676bb7edf7ff2f21e7e5bfa9bbb0ca8ae` |

Diff against the first batch's `snapshot.txt` is **exactly one line**: `tests/capture.test.mjs`
`ca3fe223…` → `8e25c29b…`. The other seven digests are byte-identical, including `capture.mjs` and
`prepare.test.mjs`. This is a witness over eight named files, measured before and after this batch —
**not a closure**, and not a claim that these eight decide the outcome.

## 7. Raw paths

`experiments/acceptance/profile-export-unit-split/runs/20261107T022340Z-profile-export-unit-split-504184-14687/`:
`summary.txt`, `argv.txt`, `snapshot.txt`; and `1-observation/`, `2-capture/`, `3-prepare/` each with
`argv.txt`, `command.txt`, `hashes-before.txt`, `hashes-after.txt`, `hash-diff-before.txt`,
`hash-diff-after.txt`, `systemd-run.rc`, `unit.log`, `journal.txt`, `terminal-query.txt`, `status.txt`,
`out/node-tap.log`, `out/node-stderr.log`.

## 8. Deviations and non-claims

- One batch, one attempt. Nothing was retried, repaired or re-run; the two `prepare` failures stand as
  measured.
- The `capture` result changed from `21/20/1` to `21/21/0` while `capture.mjs` stayed byte-identical
  and only the test file changed. That is a **sequence of two observations**, not a causal proof that
  the test correction was the sole cause — no controlled comparison was run.
- Two green targets mean those two files' own assertions passed under this envelope. They say nothing
  about export success, fixture validity, bundle resolution, CLI fit or compatibility.
- Eight hashes and three targets are a selection, not a closure of this stage.
- One capacity sample per launch: no trend, no attribution, no host-health claim.
- Whether the `prepare` failures are test defects or module defects is undecided here, and any fix is a
  source change by those files' authors.

> Later observation, recorded separately and **not** a revision of anything above: after the authors'
> `prepare.test.mjs` correction, one further batch
> (`20261107T025959Z-profile-export-unit-split-505534-15399`) ran all three targets green —
> `observation 35/35`, `capture 21/21`, `prepare 42/42`, `acceptance_exit=0`. See
> `2026-11-07-profile-export-unit-split-recheck-2.md`. The two `prepare` failures recorded above stand
> as measured for their own batch.
