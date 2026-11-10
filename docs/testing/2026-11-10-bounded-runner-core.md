# Bounded runner core — bounded mock qualification record

> **Later change (2026-11-10, after this record's runs).** `host.sh` gained the
> declared `BR_SETENV` channel (`--setenv=NAME=value`, validated, recorded to
> `setenv.txt`) so a wrapper can hand its payload one value; a transient service
> inherits no environment. `core.manifest` was refreshed to the new `host.sh` digest
> (`08a12b13…`), and the mock qualification was re-run
> (`/data/dsh-ecosystem-test-artifacts/runs/20261109T194645Z-bounded-runner-qualification-1204712-25203`):
> `acceptance_exit=0`, negative suite `failures=0`, host-path `top_level_checks=18
> failures=0`. That suite does **not** exercise the `--setenv` branch; the branch
> itself has two real executions in
> [the installer scratch record](2026-11-10-profile-dump-install-scratch.md). The
> hashes quoted below describe the earlier bytes and are not retracted.

> **Later change (2026-11-10, second).** `policy.sh` gained the `trusted-extraction-hang`
> prefix and `trusted-extraction-hang-*` unit family (a new slice that measures the shipped 80 s
> phase budget). `core.manifest` was refreshed to the new `policy.sh` digest
> (`f68270f4…`), and the qualification suite was re-run on the new bytes:
> `/data/dsh-ecosystem-test-artifacts/runs/20261110T105604Z-bounded-runner-qualification-1361578-19518`
> — `acceptance_exit=0`, `launch_rc=0`, `terminal_ok=yes`, `hash_rc=0`, `failures=0`,
> `automatic_stop=never`, negative suite `failures=0`, host-path `top_level_checks=22
> failures=0`. The host count rose from 18 to 22 because the same run is the **first mock
> coverage of the `--setenv` channel**: one accepted case (value reaches the manager argv and is
> recorded verbatim) and three refusals (invalid name, non-flag entry, empty value) that never
> launch a unit and never write `setenv.txt`. The `host.sh` digest is unchanged from the earlier
> note (`08a12b13…`). Hashes quoted elsewhere in this record remain historical.

> Date: 2026-11-10. **[Decided] Evidence scope:** the second preserved bootstrap run passed syntax checks and both Bash mock suites for the recorded input bytes. The first run failed before syntax checks or tests began and remains part of this record. This is **mock-only core qualification, not real core lifecycle qualification**, migration acceptance, or release approval.

## 1. Evidence and chronology

This record was prepared by reading existing artifacts and the current [core README](<../../scripts/bounded-runner/README.md>) and [qualification README](<../../scripts/bounded-runner-qualification/README.md>). No shell commands or tests were executed to produce this document; no existing files were edited. The READMEs were updated after attempt B to describe the measured mock qualification; their run-time hashes below remain historical inputs, not hashes of the later prose. No executable core or bootstrap bytes were changed by that documentation update.

| Attempt | Artifact directory | Outcome |
| --- | --- | --- |
| A | [/data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510>) | Final exit **71**; sandbox setup failed; no syntax checks or tests ran. |
| B | [/data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842>) | Final exit **0**; syntax and both suites green. |

The timestamp suffix `Z` in each run ID denotes UTC; the document date is the requested 2026-11-10 record date.

### Attempt A: preserved failure

The exact diagnostic in [A syntax log:1](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/syntax.log#L1>) is:

```text
bwrap: Can't create file /work: Read-only file system
```

The [syntax-stage return code](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/syntax.rc>) is `1`; this was a failure to start the sandboxed syntax stage, **not a Bash syntax rejection**. The bootstrap classified it as `71`. There are no suite results to count for this attempt. The real envelope and memory gate had already completed, so their successful readbacks must not be confused with successful test execution.

The current [sandbox contract:38](<../../scripts/bounded-runner-qualification/README.md#L38>) creates private `/tmp` first and binds the work directory at `/tmp/qualification`, avoiding creation of a mountpoint under the read-only root. Attempt B records different bootstrap payload and README hashes; the core module and suite hashes are unchanged between attempts (Section 5).

### Attempt B: bounded success

The [syntax log:1–9](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/syntax.log#L1-L9>) records nine successful syntax checks: five core modules, two suites, and two bootstrap controls. The [syntax return code](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/syntax.rc>), [parser/envelope suite return code](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/negative-tests.rc>), and [host suite return code](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/host-negative-tests.rc>) are all `0`.

- The [parser/envelope suite log](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/negative-tests.log#L1-L74>) ends with `failures=0`. Cases cover strict singleton parsing, runtime/object-path rejection, verdict precedence, evidence-write failures, actual fixture hash drift, repeated entry, ownership receipts and identity mismatches, simulated stop/settlement behavior, exact envelope checks, and low-memory refusal.
- The [host suite log:154](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/host-negative-tests.log#L154>) reports **`top_level_checks=18 failures=0`**. Nested scenario assertions are **not additive** to that top-level count. The top level comprises eight manifest/closure checks and ten first-call scenarios: success, foreign-refusal, lock-contention, journal-failure, diff-open, hash-drift, special60, special74, collected, and missing-live-receipt.
- Expected diagnostics remain in the logs: unwritable evidence, deliberately differing fixture hashes, journal-query failure, and a diff output path that is a directory. These are successful negative assertions, not hidden or discarded failures.
- The [payload verdict](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/payload-verdict.txt>) is `qualification=complete`; the retained [denial log](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/work/denied.log>) is empty.

## 2. Real bootstrap bounds and actual memory gate

The bootstrap is independent of the core under test: it does not source that core for the real service launch. The suites load core code only within the sandbox. The bootstrap's real envelope therefore bounds the mock execution but does not qualify the core's own service-manager lifecycle against a real manager.

| Control | Requested / observed value |
| --- | --- |
| Service type | `Type=exec` |
| Memory | `MemoryMax=384M`; actual `memory.max=402653184` bytes |
| Swap | `MemorySwapMax=0`; actual `memory.swap.max=0` |
| Tasks | `TasksMax=32`; actual `pids.max=32` |
| CPU | `CPUQuota=50%`, period `100ms`; actual `cpu.max=50000 100000` |
| Runtime | `RuntimeMaxSec=120`; actual `RuntimeMaxUSec=120000000` |
| Stop configuration | `KillMode=control-group`, `TimeoutStopSec=10s` |
| Node heap environment | Explicit `NODE_OPTIONS=--max-old-space-size=192`; not evidence of a Node workload having run |
| Bootstrap launcher timeout | 160 seconds, five-second kill grace |
| Each mock suite timeout | 30 seconds, two-second kill grace; serial execution, no retry |
| Admission memory minimum | One actual `MemAvailable` sample, minimum `819200` KiB, before syntax or suites |

Both [A effective envelope](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/envelope-effective.txt>) and [B effective envelope](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/envelope-effective.txt>) record those effective values and actual unified cgroup membership in their respective `/system.slice/<unit>` paths. The requested launch properties are retained in [A argv](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/argv.txt>) and [B argv](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/argv.txt>).

| Attempt | Actual memory sample | Read status | Gate result |
| --- | --- | --- | --- |
| A | `MemAvailableKiB=1317268` | `read_rc=0` | Above `819200` KiB; [artifact](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/memory-gate.txt>) |
| B | `MemAvailableKiB=1333416` | `read_rc=0` | Above `819200` KiB; [artifact](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/memory-gate.txt>) |

These are real bootstrap admission samples, not the suites' synthetic low-memory fixtures. The [B unit log](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/unit.log>) reports runtime `2.855s`, CPU time `1.444s`, and memory peak `8.2M` with swap `0B`; these observations are not substitutes for the effective-limit readbacks. The core's documented host timeout is 200 seconds; it must not be substituted for this independent bootstrap's 160-second launcher timeout.

## 3. Terminal, integrity, and final status

| Field | Attempt A | Attempt B |
| --- | --- | --- |
| `launch_rc` | `71` | `0` |
| `terminal_ok` | `yes` | `yes` |
| `hash_rc` | `0` | `0` |
| `evidence_failure` | `0` | `0` |
| `automatic_stop` | `never` | `never` |
| `acceptance_exit` | `71` | `0` |

Sources: [A final status:1–6](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/status.txt#L1-L6>) and [B final status:1–6](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/status.txt#L1-L6>).

Both [A terminal readback](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/terminal-raw.txt>) and [B terminal readback](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/terminal-raw.txt>) have `query_rc=0`, `MainPID=0`, `LoadState=not-found`, `ActiveState=inactive`, and `SubState=dead`. This is settled/collected-unit observation, not permission to stop a unit. The bootstrap performed no automatic stop.

Each attempt selected 11 inputs; before/after manifest verdicts were `manifest_rc=0`, and selected-input hashes matched within each attempt. The [B hash diff](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/hashes-diff.txt>) is empty. Stable hashes and terminal settlement do not erase A's workload failure.

## 4. Mock boundary, scratch policy, and remaining gaps

The [host harness scope:1–7](<../../scripts/bounded-runner/host-negative-tests.sh#L1-L7>) explicitly uses real common/host/policy functions with a **simulated manager and payload**. Its only source adaptation is replacing the readonly policy `BR_LOCK` with a scratch lock in the copied mock core. That change is **mock-only**: it does not change or qualify the canonical lock path or its permissions. Manifest parser cases use freshly generated fixture hashes, not a release/provenance certification of the checked-in manifest. Separately, the real bootstrap validates the selected checked-in module digests before/after its run.

Scratch fixtures are retained, including negative outcomes, beneath B's [work directory](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/work>). Within the sandbox, `TMPDIR=/tmp/qualification/scratch` and `HOME=/tmp/qualification/home`; persistent writes are confined to the bound work directory, with additional private tmpfs writes ephemeral. The real bootstrap uses the existing shared acceptance lock; mock lock-contention assertions do not prove operating-system lock contention behavior at that production path.

| Gap / limitation | Meaning and required follow-up |
| --- | --- |
| D1 — real core lifecycle | Mock stop, foreign-unit refusal, receipt identity, manager failures, and journal behavior are not real systemd integration qualification. Require separately authorized bounded real lifecycle acceptance. |
| D2 — migration | **No claim that any or all twelve maintained runner pairs were migrated or qualified.** Require reviewed serial pilot migrations and per-wrapper acceptance. |
| D3 — provenance | Recorded local hashes identify bytes, not an upstream commit, released ABI, or byte-identical vendored copy. Pin and verify provenance before release/vendoring. |
| D4 — containment scope | Audited mock containment is not a hostile-code security boundary; read-only root exposes host contents, deny stubs are not tamper-proof, and no disk quota is supplied. Do not generalize this result to arbitrary scripts or other hosts. |
| D5 — snapshot limits | Before/after selected-input hashes are not complete OS dependency closure and cannot detect edit-and-restore races. Maintain reviewed inputs and cooperative lock discipline. |

**[Pending]** Real core lifecycle qualification, wrapper migrations, integration/installation acceptance, and release approval remain outside this result. The recommended next step is separately reviewed bounded pilot acceptance, not an inferred blanket green status.

## 5. Runtime input hashes from the artifacts

These are SHA-256 values recorded at execution time, not newly computed values. [A before](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/hashes-before.txt>) matches [A after](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/hashes-after.txt>); [B before](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/hashes-before.txt>) matches [B after](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/hashes-after.txt>). Only the qualification payload and qualification README differ between attempts.

| Input | SHA-256 (both attempts unless marked) |
| --- | --- |
| [Core common](<../../scripts/bounded-runner/common.sh>) | `b99d70e898bcaa5ece54b7c08759176d081e26b7fab1eff5fe47a411454ac872` |
| [Core policy](<../../scripts/bounded-runner/policy.sh>) | `13415d05c84bca0a25c70a77729401a59a074a6926046f799fff59bc1a4d0590` |
| [Core host](<../../scripts/bounded-runner/host.sh>) | `01f50aadc04b780fcb60c0180d0541087a01f8ade45cc71695fab9ae924ebc7e` |
| [Core envelope](<../../scripts/bounded-runner/envelope.sh>) | `3c6cff413df965f0015cd7175acadebe1422341e8bab7915af8e88daed7832dd` |
| [Core TAP](<../../scripts/bounded-runner/tap.sh>) | `bae622fb3814c2327be76b94796e1a18745077c824a7c348aaa50aaf519dc1a0` |
| [Core manifest](<../../scripts/bounded-runner/core.manifest>) | `b20468c627937bdb2b6e6a359084d49c0b6dfa89c9d5446a7aba293daadd89e2` |
| [Parser/envelope suite](<../../scripts/bounded-runner/negative-tests.sh>) | `71f1beb6531f82edf46ded886ef94b4a91fa9ca26266bc878111f6f7557c9869` |
| [Host suite](<../../scripts/bounded-runner/host-negative-tests.sh>) | `baa4ff98688b5fdfbadb69e1a9e0f8fe678d767b57fe6068653b9c97f373a9f0` |
| [Bootstrap launcher](<../../scripts/bounded-runner-qualification/run.sh>) | `606fadc42ae487f2bf71a32498e67e4d252784f8fa074345f0a79e4ca34a686a` |
| [Bootstrap payload](<../../scripts/bounded-runner-qualification/payload.sh>) — A | `30aec5852bb5284fd72891151c92ad754d32b2291cd7fb7e27789536495c289f` |
| [Bootstrap payload](<../../scripts/bounded-runner-qualification/payload.sh>) — B | `df5570e7e45b5f6db4fbb3ffbd3bc8cee3d5861827b0e33819712c17bf668973` |
| [Qualification README](<../../scripts/bounded-runner-qualification/README.md>) — A | `68e43be26435ce1dd07099890f07388632f21bc7614b6a9f3d5633349d5d7c6f` |
| [Qualification README](<../../scripts/bounded-runner-qualification/README.md>) — B | `b7d7878ddda081dc96bcbb35a954ae905fb9038c0e2a05b5d2e27795d86ab821` |

## Appendix A. Quick reference

| Context | Evidence |
| --- | --- |
| Failed setup, not syntax rejection | [A syntax log:1](</data/dsh-ecosystem-test-artifacts/runs/20261109T175615Z-bounded-runner-qualification-1098604-16510/syntax.log#L1>) |
| Nine syntax checks | [B syntax log:1–9](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/syntax.log#L1-L9>) |
| Parser/envelope summary | [B negative suite:73](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/negative-tests.log#L73>) |
| Non-additive host count | [B host suite:154](</data/dsh-ecosystem-test-artifacts/runs/20261109T175845Z-bounded-runner-qualification-1100816-22842/host-negative-tests.log#L154>) |
| Scratch-only lock adaptation | [Host harness:1–7](<../../scripts/bounded-runner/host-negative-tests.sh#L1-L7>) |
| Bootstrap gate and execution order | [Qualification README:30–40](<../../scripts/bounded-runner-qualification/README.md#L30-L40>) |
| Core cooperative lifecycle caveats | [Core README:35–49](<../../scripts/bounded-runner/README.md#L35-L49>) |
