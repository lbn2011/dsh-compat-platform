# 2026-11-08 — analyzer test-script contract + one smoke test (`analyzer-test-script-batch`)

Status: **RUN ONCE — GREEN (`acceptance_exit=0`).** One authorised invocation of the reviewed bytes, no
retry, no widening to the full eleven-file run, and no edit to `run.sh`/`payload.sh` afterwards.

## 1. Invocation

```
bash experiments/acceptance/analyzer-test-script-batch/run.sh
```

- The two approved digests were re-checked immediately before the run and matched to the byte:
  `run.sh` `5b0a8c85deea054d4c65005dc6302819544cca715f3d23404ee38bc37f3d0a82`,
  `payload.sh` `44cd024dabd54203e48d26b31706013744d336d9b1c855d5a372f1d407ee99d2`.
- Tool exit code: **0** (`WRAPPER_RC=0`).
- Envelope: `Type=exec`, `MemoryMax=384M`, `MemorySwapMax=0`, `TasksMax=32`, `CPUQuota=50%`,
  `RuntimeMaxSec=120`, node `--max-old-space-size=192`, one `MemAvailable >= 819200` KiB sample,
  shared acceptance lock taken with `flock -n` (no waiting), `bwrap` read-only root with private
  pid/net/ipc/uts namespaces and a private `tmpfs /tmp`, `env -i`.

## 2. Batch result

| item | value |
|---|---|
| batch | [`experiments/acceptance/runs/20261107T183007Z-analyzer-test-script-batch-560403-4679`](../../../../experiments/acceptance/runs/20261107T183007Z-analyzer-test-script-batch-560403-4679) |
| unit | `analyzer-test-script-batch-20261107T183007Z-560403-925.service` |
| `acceptance_exit` | **0** |
| `systemd_run_rc` | `0` |
| `payload_rc` | `0` |
| `write_failures` | `0` |
| `selected_inputs` | `29` |
| `hashes` | `identical` (`hash_rc=0`, empty `hashes-diff.txt`) |

Naming note, recorded rather than explained away: the unit name and the run-directory name end in
different random suffixes (`-925` vs `-4679`), because `$RANDOM` was expanded twice when the two names
were built. Both names are unique and the run is self-consistent (`argv.txt`, `journal.txt`,
`status.txt` and the in-unit cgroup path all name the same unit); this is a naming artefact, not a test
failure, and it is not claimed to be anything more.

## 3. Evidence (all under the batch directory)

| file | content |
|---|---|
| `status.txt` | unit, run dir, launch state, rc pair, terminal verdict, hash verdict, `acceptance_exit=0` |
| `argv.txt` | the exact `systemd-run` argv |
| `selection.txt` | `selected_inputs=29` |
| `hashes-before.txt` / `hashes-after.txt` | 29 digests each, byte-identical; `hashes-diff.txt` is empty |
| `active-units.txt` / `active-units.err` | empty — this shows only that none of the unit families the query lists matched in `active,activating,deactivating`; it does not show that no acceptance process of any other name was running |
| `unit.log` | full unit output including every `acc_*` field and the relayed TAP |
| `node-tap.log` | 6759 bytes, 208 lines, complete TAP version 13 |
| `node-stderr.log` | 0 bytes |
| `static-contract.mjs` / `static-contract.log` | the checker as written and its output |
| `systemd-run.rc` | `0` |
| `journal.txt` | start, deactivate, `journal_rc=0` |
| `terminal-query-raw.txt` / `terminal-query.txt` | the terminal read and its judgement |

## 4. Effective envelope, as read back inside the unit

| knob | observed |
|---|---|
| `acc_cgroup_memory_max` | `402653184` (= 384M) |
| `acc_cgroup_swap_max` | `0` |
| `acc_cgroup_pids_max` | `32` |
| `acc_cgroup_cpu_max` | `50000 100000` (= 50%) |
| `acc_unit_type` | `exec` |
| `acc_unit_memory_max` | `402653184` |
| `acc_unit_swap_max` | `0` |
| `acc_unit_tasks_max` | `32` |
| `acc_unit_cpu_quota` | `500ms` |
| `acc_unit_runtime_max` | `2min` |
| `acc_runtime_usec_numeric` | `120000000` via **busctl** (`.service` object path), resolved `120000000` |
| `acc_capture_ok` | `yes` |

Capacity gate: `acc_gate_memavailable_kib=2092184` against a floor of `819200` → `acc_gate=pass`.
One sample, read once, before the workload.

## 5. Syntax check of this round's bytes

`acc_syntax_run_sh_rc=0`, `acc_syntax_payload_sh_rc=0`, `acc_syntax_scope=this-round-bytes-only`,
`acc_syntax_status=pass`. This ran inside the envelope, after the readback match, and before any Node
process. It certifies the syntax of these bytes only; it says nothing about earlier revisions and
replaces no historical record.

## 6. Static contract result

`static-contract.log`, quoted in full:

```
acc_static_manifest_test_script_exact=pass
acc_static_manifest_test_script_actual="node --test --test-concurrency=1 \"tests/*.test.js\" \"tests/*.test.mjs\""
acc_static_declared=11
acc_static_present=11
acc_static_declared_only=
acc_static_present_only=
acc_static_file_set=pass
acc_static_contract=pass
```

`package.json` was read with `JSON.parse` and `scripts.test` compared as a whole string, not as a
substring of the file; `tests/` was read with `readdir` and the eleven-name set compared in both
directions. The checker ran under `env -i` with `--max-old-space-size=192`.

**This is a contract check on two artefacts, not a test-runner discovery result.** Nothing here shows
that `node --test` would discover those files; the one smoke test below is the only evidence that a
runner reached a `.mjs` file at all.

## 7. Smoke test

One workload, one file: `tests/admission-cli.test.mjs`, `node --test --test-concurrency=1
--test-reporter=tap`, inside the sandbox.

| field | value |
|---|---|
| `acc_workload_started` | `yes` |
| `acc_node_rc` | `0` |
| `acc_workload_wall_ms` | `341` |
| TAP `tests` / `pass` / `fail` | `33` / `33` / `0` |
| TAP `cancelled` / `skipped` / `todo` | `0` / `0` / `0` |
| field occurrences | all six `ok` (exactly once each) |
| `acc_smoke_verdict` | `pass` |
| `acc_memory_peak` | `58724352` (~56 MiB, one reading) |
| `acc_pids_peak` | `16` |

The 33 is this one file's count. It is not the 54 recorded for the profile-export fixture's
`main.test.mjs` and the two numbers are not comparable; no arithmetic relates them.

## 8. Terminal state

```
terminal_query_rc=0
load_state=not-found
active_state=inactive
sub_state=dead
main_pid=0
terminal_ok=yes
confirmation=settled
stop_attempted=no
stop_rc=not-attempted
```

The unit was collected (`--collect`) on exit, so `LoadState=not-found` with `inactive/dead` and
`MainPID=0` is the expected settled shape. No stop was attempted, and nothing outside this unit was
touched.

## 9. What this run does NOT establish

- It is **one** smoke test out of eleven files. It says nothing about the other ten.
- The static contract check is not runner discovery, and a matching `scripts.test` string is not proof
  that the string does what it looks like on every Node build.
- No compatibility, admission, or dependency-closure claim. The 29 hashed inputs are a named selection,
  not a closure; a matching digest authenticates bytes, not behaviour.
- No coverage, stability, or host-health claim; `memory.peak` is a single reading.
- **The error branches were never fault-injected.** Every refusal, write-failure, drift, lock-busy,
  timeout and unconfirmed-terminal path in `run.sh`/`payload.sh` was reviewed but not exercised by this
  run — it took the happy path end to end. Nothing here should be quoted as "the runner is fully
  validated"; only the green path was demonstrated once.

## 10. Defects found in review and fixed before the run (listed by kind, not as a chronology)

Every item below was a defect in the acceptance harness found by reading the scripts, reported by the
reviewing Lead, and fixed before the single authorised invocation. They are grouped by the kind of
mistake, because the review happened in more than one pass and inventing a clean round-by-round timeline
would overstate what the record shows. All of them belong to the harness, not to the analyzer package,
and none was ever observed as a runtime failure — no run existed for any of the affected bytes.

**Envelope and accounting.**
- `UNIT` lacked the `.service` suffix while the payload required it, so every run would have been
  refused at the envelope check.
- The busctl object path was built from that suffixless name, addressing the wrong unit object; the
  runtime value is now read from the `.service` object path and the source is recorded.
- `RuntimeMaxUSec` parsing truncated mixed tokens instead of rejecting them as unparseable.
- `settled_read` claimed four facts while checking three: `SubState` was not consulted, so
  `inactive/stop-sigterm` could read as settled.

**Locking and concurrency.**
- The serial lock was a new `/tmp` path instead of the shared acceptance lock every other batch uses.
- `flock -w 900` waited for a busy lock instead of refusing it.

**Query failure treated as a result.**
- The active-unit query ended in `|| true`, so a failed query read as "nothing running".
- A failed `journalctl` query was not counted as an evidence failure; only an empty file was.
- A failed terminal `systemctl show` could still be reported through the launch rc alone.

**Evidence writes and their failures.**
- A heredoc or `cat` failure in the static-contract stage could continue into the smoke test.
- A `launch.txt` write failure only incremented a counter and still launched the unit.
- The TAP relay's own write failure could still yield a green verdict.

**Static contract and TAP reading.**
- The stage-1 check grepped the raw manifest for tokens instead of `JSON.parse`-ing it and comparing
  `scripts.test` as a whole string; the file set is now compared by `readdir` in both directions.
- The static checker inherited the host environment and had no heap cap.
- TAP summary fields were read with `tail -1`, so a duplicated field silently won; each of the six keys
  is now required to occur exactly once.

## 11. Process deviations

- The unit-name/run-directory suffix mismatch described in §2 (`$RANDOM` expanded twice; both names
  unique, same unit throughout the evidence).
- This record was first written with an inaccurate review history — it attributed a hardcoded terminal
  state and a dependency-closure claim to earlier drafts of these scripts, which the reviewing Lead had
  not seen in them. Those two attributions were removed; the defects that remain listed above were each
  reported in review against the actual bytes.
- Nothing was retried, and no additional tests, builds, installs, commits or pushes accompanied this run.
