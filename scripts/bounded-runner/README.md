# Bounded runner core — ABI 1 (source-review candidate)

Date: 2026-11-10. **Bounded mock qualification executed: one bootstrap mount refusal, then syntax and both mock suites passed.** The core has not yet launched a real workload; no existing wrapper is migrated in this core slice. Historical evidence is preserved. See [qualification record](../../docs/testing/2026-11-10-bounded-runner-core.md).

> Decided: repository-local canonical core here; a pinned byte-identical spec copy will be created by a later explicit maintainer operation. Never resolve a sibling repository at runtime. Workload commands, sandbox mounts/networking, acquisitions and their exit semantics remain wrapper/payload policy.

## 1. Baseline and scope

The [design](../../docs/requirements-and-design/2026-11-10-config-contract-and-runner-design.md#L50-L65) identifies twelve maintained runner pairs. The [correspondence host](../correspondence-batch/run.sh#L180-L304) supplies the lifecycle baseline and the [payload](../correspondence-batch/payload.sh#L87-L205) supplies the effective-limit gate. This extraction strengthens singleton parsing, payload-evidence precedence and the union of unit-family guards. It does not implement a universal bwrap or a generic command-string executor.

## 2. Module API

Source files using **absolute repository-local paths**, once, in dedicated Bash shells with `set -uo pipefail`, **without `set -e`**. Functions deliberately return nonzero verdicts for explicit handling. No module sources another file, executes a workload at load time, installs a trap, or changes caller shell options. Do not invoke stateful functions through a pipeline or command substitution: counters and one-shot guards belong to the calling shell.

| Module | API and contract |
| --- | --- |
| [common.sh](common.sh) | `br_record path format args...` overwrites evidence with checked printf; `br_evidence_gate`, `br_finish rc`; strict `br_field raw key`, `br_single file`, `br_bus_path raw`, `br_bus_u64 raw`, `br_uint`; `br_snapshot output paths...` |
| [policy.sh](policy.sh) | immutable bounds, lock and family registry; `br_workload_exit rc`, `br_verdict launch_rc terminal_yes_no hash_rc`; special exits preserve their nonzero meaning |
| [host.sh](host.sh) | `br_host_run core wrapper payload runs_root prefix`; owns FD9 for the dedicated host shell, fresh run directory, one launch, journal, terminal confirmation, before/after manifests and final status |
| [envelope.sh](envelope.sh) | `br_envelope_enter unit run_dir`, then workload-specific commands, then `br_payload_finish original_rc`; strict effective readback, one memory gate, in-cgroup peaks and evidence marker |
| [tap.sh](tap.sh) | optional `br_tap_check tap_file original_node_exit`; singleton tests/pass/fail/cancelled/skipped/todo, positive test count and no skipped/todo/cancelled/failing tests |

Host wrapper must initialize these indexed Bash arrays before `br_host_run`:

- `BR_EXTRA_CONTROL=(...)`: absolute paths of **every additional transitively sourced control file**, from both host and payload, including policy helpers and manifests outside this core. May be empty. Include dynamically generated control source only if it is fixed and present before launch; otherwise redesign that wrapper before migration.
- `BR_SELECTED_INPUTS=(...)`: explicit selected workload/source/fixture inputs. May be empty. This is **not** a dependency closure, and excludes installed dependencies unless deliberately listed.
- `BR_WORKLOAD_EXITS=(0 70 71 72 73)` or an explicit workload-specific extension using `60 61 62 63 64 65 66 74`. Unknown exits become 70; accepted special exits stay nonzero, never become success. Original substep exits belong in payload evidence via `br_record`.

Host return codes: 0 green; 60–66 explicitly admitted workload outcomes; 70 refusal/unknown exit; 71 precondition; 72 workload/TAP; 73 evidence failure; 74 timeout/unconfirmed terminal; 75 shared lock held; 76 run collision; 77 hash read/manifest failure; 78 drift. Precedence: **evidence > hash > terminal > workload**. A payload 73 also outranks hash/terminal. Host timeout exits 124/137/143 map to 74.

Payload must finalize every exit after validating its two arguments. A wrapper should capture each function's status explicitly, call `br_payload_finish "$rc"`, then exit with its return status. On a successful envelope entry, pass `NODE_OPTIONS="$BR_NODE_OPTIONS"` explicitly through every cleaned environment/sandbox; exporting it alone cannot constrain a child that clears its environment. The core does not inspect workload commands or certify that they preserve the heap setting. Payloads must use checked evidence APIs, gate before every consequential substep, and never write the host-owned unit log.

## 3. Bounds and lifecycle

The fixed lock is `/root/dsh-ecosystem-spec/experiments/acceptance/runs/.acceptance.lock`, opened only if it already exists. Lock acquisition is nonblocking. Requested/effective limits are Type=exec, memory 402653184 bytes (384 MiB), swap 0, tasks 32, CPU `50000 100000` (50%), runtime 120000000 microseconds (120s), Node heap 192 MiB and one MemAvailable gate at 819200 KiB. Host launch timeout is 200s; query deadlines are bounded separately.

Before any workload, payload verifies its actual unified cgroup membership, queries the manager's InvocationID as one exact property line, and matches it to the inherited `INVOCATION_ID`; both IDs must be 32 lowercase hex digits. Only then does it exclusively create `ownership.txt` in the host's fresh run directory, with exactly two newline-terminated singleton fields in order: `unit=<unit>` and `invocation_id=<id>`. Existing receipts are never overwritten. Receipt write failure retains evidence-failure priority (73). Cgroup knobs remain exact singleton lines. Runtime uses GetUnit then get-property against only a validated object path; both command statuses and complete outputs matter. Extra trailing blank lines are preserved and refused.

The host never retries a launch, resets failed units or performs broad cleanup. Before stopping, it obtains the current manager InvocationID alongside state/PID and requires an exact receipt/unit/current-ID match. For a live or otherwise unsettled unit, missing, malformed, duplicate, extra-field or mismatched receipts, invalid IDs and failed queries mean **no stop and terminal unconfirmed**. Neither `BR_LAUNCHED` (attempted launch), a random generated name, nor a live PID proves ownership; a failed StartTransientUnit call may have collided with a foreign service. A successful strict settled-state readback (including a collected unit reported not-found/inactive/dead with MainPID=0) confirms termination without an InvocationID; this is terminal observation, not authority to stop. The same settled-state rule applies after an ownership-authorized stop. A failed launch remains a failed workload even if terminal state is settled.

The receipt is **cooperative lifecycle control, not hostile-payload security**: code with access to the run directory can forge or replace it. Manager readback and name-based stop are not an atomic invocation-conditional operation; external unit replacement between query and stop remains a race. The reviewed cooperative runner, exclusive fresh directory and no-retry discipline are assumptions, not a guarantee against hostile service-manager actors.

Unavailable peak counters are recorded as unavailable, not invented as zero; they are observations, not substitutes for effective-limit verification. The current ABI assumes system.slice on unified cgroup v2; other slice layouts refuse rather than guess.

## 4. Control manifest and provenance

[core.manifest](core.manifest) has an exact ABI/provenance header followed by SHA-256 and relative basename for all five core modules. It excludes itself from its internal digest set. Host snapshots **include the manifest itself**, all five core files (even unused modules), host wrapper, payload, and every `BR_EXTRA_CONTROL` entry before and after the run. Selected workload snapshots are separate. Active Bash source frames are checked against the declared closure; Bash cannot retrospectively enumerate previously returned source frames or predict future source calls. Thus exhaustive `BR_EXTRA_CONTROL` enumeration is a mandatory reviewed wrapper contract, not automatic dependency discovery.

The header `bounded-runner/1 source-review-unreleased` explicitly has no upstream commit claim. **Before vendoring/release**, pin a reviewed revision, agree a released manifest-header ABI, regenerate module digests and update verification together. Do not fabricate a commit now. Copy byte-identically only through an explicit future maintenance operation; no sync command is implemented here. Any core edit requires regenerated hashes before use. Manifest verification is integrity against reviewed local pins, not protection against a malicious writer who can replace both pins and code. Before/after hashing cannot detect a change restored between samples; immutable checkout/process discipline remains required.

## 5. Negative harness and review risks

[negative-tests.sh](negative-tests.sh) and [host-negative-tests.sh](host-negative-tests.sh) passed the bounded mock qualification linked above; they are not evidence of real manager integration. It replaces systemctl/busctl/timeout/readbacks with mocks and retains only its generated temporary scratch directory. No real service command runs inside the mock suites; the independent bootstrap owns their bounded execution. Current cases cover duplicate/malformed readbacks, unknown/special exits, evidence priority, hash-drift precedence, missing/malformed/duplicate/extra-field receipts, invocation/unit mismatches, launch collision with no stop, positive own-invocation stop, payload membership/environment identity refusals, failed queries, nonsettling stop, exact envelope, repeated entry, unlimited memory, failed GetUnit/property calls and low memory.

Scratch-only harness cases also cover actual hash drift, unwritable evidence, sticky write-failure precedence, malformed TAP duplicates, duplicate MemAvailable, multiline knobs and repeated host entry. These passed as mock assertions in the recorded round; they do not establish production service behavior.

The host mock suite now covers manifest corruption, lock contention, first-call single launch, journal failure, diff evidence-open failure, hash drift, special exits and collected/unowned terminal cases. Its scratch policy substitutes only the lock path; this does not qualify the production lock. Pending: explicit source-closure omission cases, serial pilot migrations and real bounded acceptance. Do not interpret this source-only slice as qualification of all twelve wrappers.

Risks/mitigations: shell library callers can ignore return codes or redefine functions (thin wrappers require review); crash/signals can skip finalization (host refuses missing payload marker and performs terminal readback); unexpected manager/cgroup formats refuse (qualify target host before migration); control edits race preflight (hash drift rejects but is not immutable storage); output devices may fail mid-stream (checked writes and mandatory evidence marker fail closed where detectable). This is cooperative workload containment, not a hostile-code trust boundary.

## Appendix: review entry points

- [Host lifecycle and closure](host.sh)
- [Exact readbacks and memory gate](envelope.sh)
- [Verdict and union of unit families](policy.sh)
- [Mocked negative source](negative-tests.sh)
