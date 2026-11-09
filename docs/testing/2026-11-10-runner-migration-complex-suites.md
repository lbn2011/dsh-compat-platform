# Three complex wrapper migrations — real wiring, retained export, GUI carrier

**Status: executed by the Lead; three slices green, one of them after a payload edit and a
single re-run.** The wrapper slices under
[`scripts/diagnose-real-wiring`](../../scripts/diagnose-real-wiring/README.md),
[`scripts/profile-dump-retained-export`](../../scripts/profile-dump-retained-export/README.md)
and [`scripts/diagnostics-gui-run`](../../scripts/diagnostics-gui-run/README.md) were migrated to
the repository-local canonical core ([bounded-runner](../../scripts/bounded-runner/README.md), ABI
`bounded-runner/1`, core commit `c8123de`) in a source-only pass, then run by the Lead. This record
is written from the retained run directories and the current scripts. No test, workload, install or
commit was performed while writing it — only read-only inspection of those artifacts and scripts.

## 0. What this does and does not establish

Established for the exact bytes and host observed on 2026-11-10:

- Each executed run launched exactly one bounded unit under the approved envelope, reached a
  settled terminal state (`terminal.txt`: `terminal_ok=yes`, `confirmation=settled`,
  `stop_rc=not-attempted`), kept its control and selected inputs unchanged (both `*-diff.txt`
  empty), recorded `write_failures=0`, `hash_rc=0` and `acceptance_exit=0`.
- The effective cgroup/systemd readback matched the approved limits with `mismatch=0` in all four
  runs, and every unit's `ownership.txt` matched its own unit name and InvocationID.
- The three suites' workloads kept their subjects: six real CLI cases (`c1`–`c6`) with expected
  exits `0/0/2/1/2/2` all matched, the retained-export verifier re-verified three content-pinned
  captures, and the GUI carrier served and refused on a loopback port that was not `3080`.
- The strict six-field TAP gate passed where the artifact exists: `6/6` for the wiring test and
  `16/16` for the GUI package test, with `fail=cancelled=skipped=todo=0`.

Not established — see §8 for the full statement:

- **Not the full suite.** Three of the maintained wrapper pairs are covered; the others are not.
- **No host acceptance**, no plugin loading or activation, no certification, no loadability claim.
- **A single sample per runner** (two for the GUI, from different payload bytes); no retry after a
  green run, no negative re-run.
- Historical records and the numbers in the READMEs remain valid **for their own bytes only**.

## 1. Disclosure of how the source and results were produced

- The three slices — launcher, payload and README, plus each slice's own helper modules
  (`retained-export.mjs`; `boot.mjs` and `probe.mjs`) — were **migrated without execution** by a
  subagent: no syntax check, no test, no install, no unit, no commit. Each `run.sh`, `payload.sh`
  and README carried a `SOURCE-ONLY … Awaiting Lead bounded verification` header saying exactly
  that.
- The Lead then reviewed the source and **ran each slice exactly once** — with one exception. The
  `diagnostics-gui-run` slice was **edited and re-run**: its first run
  (`20261109T185044Z-diagnostics-gui-1150577-22658`) was green but produced **no six-field TAP
  artifact**, so the Lead added `test-file/tap-fields.txt` to the payload and ran it once more
  (`20261109T185224Z-diagnostics-gui-1152437-27024`). **The two GUI runs therefore used different
  payload bytes**, and neither is a retry of a failed run:

  | GUI run | `payload.sh` sha256 (from `control-before.txt`) | `run.sh` sha256 |
  | --- | --- | --- |
  | `…185044Z-diagnostics-gui-1150577-22658` | `754f47e5ac83a9cc13d7a4bc12d1543fcd2194b127688103dc1f3019cbb42f45` | `fd4ce8735884f0dd9051730f026eec3ba92e82856e8e3c345e8a214814345cc2` |
  | `…185224Z-diagnostics-gui-1152437-27024` | `968f80c1d933a7170551d9d331df06c32c72e201e6fa731cde1c31dc93de9b69` | `fd4ce8735884f0dd9051730f026eec3ba92e82856e8e3c345e8a214814345cc2` |

  The core modules and `run.sh` were byte-identical across the two; only `payload.sh` changed. The
  produced envelope was identical (`8b2832462b9c7cdfec56a0188c8d84fdb257a7f384c0ce7f066ef67d17e3782d`,
  7169 bytes in both runs), and the two `gui-ok/probe.json` files differ only in `origin` and the
  `envelopeFile` path — every check and every response byte count is the same.
- Invocation must use the **absolute** entry path. Each wrapper declares absolute control roots
  (`ROOT`, `REPO`, `SLICE`, `CORE`, `NODE`) and the core binds every active source frame to that
  absolute control list, so a relative invocation (`scripts/…/run.sh`, `./run.sh`) is refused with
  `77` **before** the lock is taken, before a run directory exists and before any unit is created.
  All four runs used the absolute path (see each `argv.txt`).
- Run IDs carry a UTC `Z` stamp while filesystem timestamps are local (`+08:00`). The four runs
  occupy 2026-11-10 02:49:26–02:52:24 local time, i.e. 18:49:26–18:52:24 UTC on 2026-11-09.

## 2. Shared envelope

Identical for all four runs: requested values in `requested.txt`, effective values read back inside
the payload in `envelope-effective.txt`. Every receipt ends `mismatch=0`.

| Property | Requested (`requested.txt`) | Effective readback |
| --- | --- | --- |
| `Type` | `exec` | `Type=exec` |
| Memory | `MemoryMax=402653184` (`384M`) | `memory.max=402653184` |
| Swap | `MemorySwapMax=0` | `memory.swap.max=0` |
| Tasks | `TasksMax=32` | `pids.max=32` |
| CPU | `CPUQuota=50%` | `cpu.max=50000 100000` |
| Runtime | `RuntimeMaxUSec=120000000` | `RuntimeMaxUSec=120000000` |
| Node heap | `NodeHeapMiB=192` | passed as `NODE_OPTIONS=--max-old-space-size=192` |
| Admission gate | `MemAvailableMinKiB=819200` | one `MemAvailable` sample ≥ `819200` KiB |
| Concurrency | — | shared nonblocking `flock`; a held lock is `75`, never a wait |

Observed `MemAvailableKiB` samples: `1515680` (diagnose), `1453508` (retained export), `1363532`
(GUI first run). `status.txt` in every run records `abi=bounded-runner/1`, `launch_attempted=yes`,
`phase=completed`, `launch_rc=0`.

## 3. Results

| # | Suite | Run directory | Unit | exit | terminal | hash_rc | write_failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | diagnose-real-wiring | [20261109T184926Z-diagnose-real-wiring-1148557-5494](</data/dsh-ecosystem-test-artifacts/runs/20261109T184926Z-diagnose-real-wiring-1148557-5494>) | `diagnose-real-wiring-20261109t184926z-1148557-19268.service` | 0 | settled | 0 | 0 |
| 2 | profile-dump-retained-export | [20261109T185020Z-profile-dump-retained-export-1149975-11126](</data/dsh-ecosystem-test-artifacts/runs/20261109T185020Z-profile-dump-retained-export-1149975-11126>) | `profile-dump-retained-export-20261109t185020z-1149975-20006.service` | 0 | settled | 0 | 0 |
| 3 | diagnostics-gui (first) | [20261109T185044Z-diagnostics-gui-1150577-22658](</data/dsh-ecosystem-test-artifacts/runs/20261109T185044Z-diagnostics-gui-1150577-22658>) | `diagnostics-gui-20261109t185044z-1150577-20228.service` | 0 | settled | 0 | 0 |
| 4 | diagnostics-gui (after payload edit) | [20261109T185224Z-diagnostics-gui-1152437-27024](</data/dsh-ecosystem-test-artifacts/runs/20261109T185224Z-diagnostics-gui-1152437-27024>) | `diagnostics-gui-20261109t185224z-1152437-9012.service` | 0 | settled | 0 | 0 |

### 3.1 Peaks, controls and selections

Peaks are in-cgroup observations, recorded `measured` (never invented as zero). They are not a
resource-admission claim.

| Run | `memory_peak` (B) | `pids_peak` | control files | selected files | `workload_dependency_closure` | select diff |
| --- | --- | --- | --- | --- | --- | --- |
| diagnose-real-wiring | 37220352 | 16 | 8 | 17 | `no` | empty |
| profile-dump-retained-export | 31293440 | 17 | 8 | 11 | `no` | empty |
| diagnostics-gui (first) | 46219264 | 27 | 8 | 14 | `no` | empty |
| diagnostics-gui (second) | 42868736 | 27 | 8 | 14 | `no` | empty |

`control-diff.txt` is zero bytes in all four. Selection is an explicit input list, **not** a
dependency closure: installed `yaml`, the Node runtime, `@deepseek-ai/cordis`,
`@deepseek-ai/dsh-host-webserver` and system tools are outside it.

### 3.2 The six-field TAP gate

`br_tap_check` reads exactly one well-formed summary per field, rejects a missing, malformed **or
duplicate** field, requires `tests != 0` and `tests == pass`, and requires
`fail = cancelled = skipped = todo = 0` as well as the original Node exit `0`
([`tap.sh`](../../scripts/bounded-runner/tap.sh)).

| Run | test file | tests | pass | fail | cancelled | skipped | todo | `tap_rc` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| diagnose-real-wiring | `tests/diagnose-spec-wiring.test.js` | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| diagnostics-gui (second) | `tests/gui.test.js` | 16 | 16 | 0 | 0 | 0 | 0 | 0 |

The GUI **first** run parsed the same `16/16` (`test-file/summary.txt`,
`test-file/tap-verdict.txt` `tap_rc=0`) and passed every case verdict, but its `test-file/`
directory contains no `tap-fields.txt` — the artifact simply was not written by those payload bytes.

## 4. Suite-specific outcomes

### 4.1 diagnose-real-wiring

`case-verdict.txt`: `acc_smoke_verdict=pass`, `acc_case_failures=none`,
`acc_test_file_verdict=pass`, `acc_yaml_snapshot=identical`.

Six cases, each a real child process:

| case | expected exit | actual exit |
| --- | --- | --- |
| `c1-profile-only` | 0 | 0 |
| `c2-all-clear` | 0 | 0 |
| `c3-static-negative` | 2 | 2 |
| `c4-admission-attention` | 1 | 1 |
| `c5-static-bare-declaration` | 2 | 2 |
| `c6-admission-grammar-refusal` | 2 | 2 |

`cases-summary.txt` reads `case_count=6`, `case_failures=none`. `syntax.txt`
(`acc_syntax_run_sh_rc=0`/`acc_syntax_payload_sh_rc=0`) and `static-verdict.txt` passed;
`sibling-precondition.txt` recorded the sibling checkout present. The `yaml` snapshot covered
`233` regular files and was identical at both instants (`yaml-manifest.txt`), with
`yaml-manifest-diff.txt` empty.

### 4.2 profile-dump-retained-export

`retained-export-verdict.txt`: `acc_retained_export_verdict=pass`, `acc_samples_snapshot=identical`,
`acc_yaml_snapshot=identical`, `acc_verifier_rc=0`. Note this payload writes
`retained-export-verdict.txt` and **no** `case-verdict.txt`.

The three historical captures were unchanged, and the three digests the batch has always pinned
still held after the run (`retained-export-inputs.txt`):

| sample | bytes | sha256 |
| --- | --- | --- |
| `probe` | 333 | `222a50d077c792cbdc1d5f248d3cc8888b8330b9fa2c089cd2915379f0f810cc` |
| `denied` | 162 | `34ea1fbc81ccc7d9c4c7ba575e34ff8d0c2049287835efdfda20d9c564b9a0f0` |
| `script-probe` | 568 | `3af2218cf02f2aae97d9ec37255df5a98fb6d0752d72beb71774a38fd636b44b` |

`retained-export-result.txt` reports `verdict=pass`, `first_failure=none`, `samples_verified=3`,
`child_runs=3`, `write_failures=0`; each child exited `0` with `signal=none` and `check=pass`
(stdout bytes 1513 / 1513 / 2017). `samples-diff.txt` and `yaml-manifest-diff.txt` are empty;
`snapshots.txt` reads `samples_snapshot_state=identical` and
`yaml_manifest_snapshot_state=identical` over 233 files. The `yaml` manifest was read as exactly
`2.9.1` (`dependency.txt`: `yaml_state=exact`).

### 4.3 diagnostics-gui-run — two runs, different payload bytes

Both runs produced an envelope with the `dsh-compat-diagnose` CLI, booted the read-only GUI carrier
and probed it, booted a second carrier whose envelope was missing and probed the refusal, and ran
the package test file. Both `case-verdict.txt` files read `pass` for
`acc_smoke_verdict`/`acc_envelope_verdict`/`acc_carrier_verdict`/`acc_refusal_verdict`/
`acc_test_file_verdict` and `acc_yaml_snapshot=identical`.

First run, `acc_origin=http://127.0.0.1:42605`; second run, `acc_origin=http://127.0.0.1:35599`.
Neither is `3080` (`workload.txt`: `forbidden_port=3080`).

The second run's probe evidence (the first run's `probe.json` carries the same checks, differing
only in `origin` and `envelopeFile`):

- Happy path — seven checks, all `ok`: `page-200-html` (`status=200`,
  `contentType=text/html; charset=utf-8`, `bodyBytes=10633`),
  `page-states-certification-false`, `page-states-correlation-literal`,
  `envelope-200-json-verbatim` (`status=200`, `bodySha256 == fileSha256 ==`
  `8b2832462b9c7cdfec56a0188c8d84fdb257a7f384c0ce7f066ef67d17e3782d`, `bodyBytes=7169`),
  `post-405-with-allow` (`status=405`, `allow=GET, HEAD`,
  `{"code":"METHOD_NOT_ALLOWED","allow":"GET, HEAD"}`), `foreign-host-403`
  (`{"code":"HOST_NOT_ALLOWED"}`), `unknown-path-404` (empty body).
- Refusal path — three checks, all `ok`: both the page route and the envelope route answered
  `503` with a closed reason `{"code":"ENVELOPE_UNREADABLE","reason":"ENVELOPE_MISSING"}`, and
  `refusal-does-not-serve-html` confirmed `contentType=application/json; charset=utf-8` on the
  refusal.

The GUI batch's own test file reported `16/16` in both runs, against the payload's floor of
`EXPECT_MIN_TESTS=15`.

## 5. Preserved semantics

Only host lifecycle, evidence plumbing, TAP interpretation and exit mapping were replaced. The
workloads kept their commands, arguments, fixtures, expected exits and sandbox shape
(`--ro-bind / / --dev /dev --proc /proc --tmpfs /tmp`, private pid/ipc/uts namespaces,
`--die-with-parent`).

| Behaviour | Preserved as | Observed in |
| --- | --- | --- |
| Six real CLI cases, one child process each, CWD-relative specifier resolution | same argv, expected `0/0/2/1/2/2` | diagnose `cases/*/case.txt`, `exit.txt` |
| `node --test` on the wiring test, both reporter shapes normalised before the checker | `# tests 6` / `ℹ tests 6` accepted, one summary per key | diagnose `test-file/stdout.tap.normalized` |
| Two-point `yaml` snapshot, symlinked tree refused | same find/sha256 manifest | all runs, 233 files |
| Three retained captures pinned by content | same digests and byte lengths | retained export `retained-export-inputs.txt` |
| Verifier's own `60`–`66` codes relayed only when both snapshots are identical | unchanged `case` block in the payload | `payload.sh` lines 281–288 |
| GUI step order: envelope → carrier → refusal → test file → snapshot | unchanged precedence inside the payload | `case-verdict.txt` field order |
| Carrier/probe keep **no** `--unshare-net`; carrier dir bound writable | deviation preserved verbatim | `payload.sh` carrier comments, `boot.mjs` invocations |
| Readiness poll 200 × 0.1 s, TERM-then-KILL stop, forbidden port `3080` | unchanged | `payload.sh` lines 412–446, 479 |
| Recorded verdict vocabularies (`acc_smoke_verdict`, `acc_envelope_verdict`, `acc_carrier_verdict`, `acc_refusal_verdict`, `acc_test_file_verdict`, `acc_yaml_snapshot`, `acc_origin`; `acc_retained_export_verdict`, `acc_samples_snapshot`, `acc_verifier_rc`) | unchanged names and meanings | each `*-verdict.txt` |
| No retry, one unit, lock `75`, collision `76` | core-owned | `status.txt`, `argv.txt` |

## 6. Artifacts changed versus the pre-migration wrappers

Historical run directories keep their old schema and are not rewritten; consumers must migrate.

| Artifact | Before | Now | First evidence |
| --- | --- | --- | --- |
| Hash records | `hashes-before.txt` / `-after.txt` / `-diff.txt` | `control-before.txt` / `control-after.txt` / `control-diff.txt` **plus** `selected-before.txt` / `selected-after.txt` / `selected-diff.txt` (8 control files, explicit selections) | `selection.txt` in all four runs |
| Evidence accounting | `evidence-gate.txt`, per-write counter files | `br_evidence_gate`, sticky counter; `payload-evidence.txt` | `payload-evidence.txt`, `status.txt` |
| Terminal state | `terminal-query*.txt`, `stop-confirm*` | `terminal-before.txt`, `terminal.txt`, conditional `stop.txt` / `terminal-after-stop.txt` | `terminal-before.txt` in all four |
| TAP summary | per-suite permissive counting | `tap-fields.txt` (six canonical fields, `ok`/`invalid`), `tap-summary.txt`, `tap-verdict.txt`; missing/duplicate fields refused | diagnose and GUI-second `test-file/` |
| Raw TAP | single `stdout.tap` | `stdout.tap` **plus** `stdout.tap.normalized` | both GUI runs |
| Peaks | suite-specific text | `peaks.txt` with `memory_peak`, `memory_peak_state`, `pids_peak`, `pids_peak_state` | all four |
| Envelope receipt | per-payload cgroup dumps | `envelope-systemctl/getunit/runtime/effective.txt`, `requested.txt`, `memory-gate.txt` | all four |
| Unit log | payload and host both wrote | only the host writes `unit.log`; payload relays to stdout | `unit.log` present, no payload journal |
| Retained-export verdict file | `case-verdict.txt`-style summary | `retained-export-verdict.txt` (this payload writes no `case-verdict.txt`) | run 2 directory listing |
| GUI step verdicts | separate per-step files | one `case-verdict.txt` with `acc_origin` | both GUI runs |
| Payload argument contract | retained export took a **third** argument (artifact root) | exactly two arguments (`unit`, `run`) | `argv.txt` (two payload arguments), `payload.sh` `[ "$#" -eq 2 ] || exit 70` |

## 7. The one capability not preserved: a redirectable artifact root

`profile-dump-retained-export` reads three captures from an **external** historical evidence
directory. Before the migration that root travelled to the payload as a third argument. The
canonical host launches every payload with **exactly two arguments** inside a detached transient
service, so there is no faithful channel for a third:

- `payload.sh` now pins the root as a constant (`ARTIFACT_ROOT`, line 47) and refuses `70` unless it
  receives exactly two arguments.
- `run.sh` pins the same value (`PINNED_ARTIFACT_ROOT`, line 72) and, if
  `RETAINED_EXPORT_ARTIFACT_ROOT` is set to anything else, prints the pinned root and its reason and
  `exit 70` **before** sourcing the core — see `run.sh` lines 82–89.
- The executed run's `argv.txt` shows exactly two payload arguments, and
  `workload.txt` records the pinned root it actually read:
  `/data/dsh-ecosystem-test-artifacts/experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141`.

Refusing an override is deliberate: silently ignoring it would let a caller believe the batch judged
a different tree. **Redirecting the artifact root is therefore unsupported by the migrated batch**
unless the canonical launch contract itself changes (a reviewed core change, not a local
workaround). This is the one capability the migration did not preserve.

### 7.1 A precedence change in the other direction: evidence failure outranks a red test file

The GUI payload still returns `74` for a red test file (`payload.sh` lines 627–632, unchanged
intent). But finalisation is now the core's: `br_verdict` remaps `74` for an unsettled unit and then
applies `[ "$1" != 73 ] || result=73`
([`policy.sh`](../../scripts/bounded-runner/policy.sh) lines 44–52). So if an evidence write fails
**and** the test file is red, the run exits `73`, whereas the pre-migration GUI payload returned
`74` first. Evidence loss now outranks the workload verdict in every combination — including over
an unsettled unit. No executed run exercised this path; it is a source-level statement.

## 8. Non-claims and known limits

- **Not the full suite.** These three slices are not the whole maintained set; nothing here
  qualifies the wrappers not named.
- **No host acceptance.** No plugin was loaded or activated, no host observed the evidence
  documents, and `certification` stays `false` in the product's own vocabulary. The core's
  cooperative lifecycle is explicitly not a security boundary.
- **No certification, correlation or loadability claim** follows from any green run, including the
  GUI page literals (`certification: false`, `correlation: not-established`) — those are strings
  the page must show, not conclusions.
- **No browser rendered the page.** The HTML was fetched and inspected as text; the page's inline
  script never ran. `bodyBytes=10633` is a byte count, not a rendering claim.
- **Single sample per runner** — two for the GUI, but from different payload bytes, so they are two
  observations, not a reproducibility result.
- **A green run exercises only the happy path.** No refusal, limit, terminated child, write failure
  or retry occurred; those paths remain review-only claims.
- **Historical records are valid for their own bytes only.** The pre-migration numbers quoted in the
  slices' READMEs do not qualify these new scripts, and these runs do not retroactively qualify the
  older ones.
- The `yaml` snapshot is a two-point equality check over file contents; it is not provenance and
  cannot see a change made and reverted between the samples.

## 9. Reproduction

Entry points (absolute path required; no arguments):

```
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnose-real-wiring/run.sh
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export/run.sh
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnostics-gui-run/run.sh
```

Artifact roots default to `/data/dsh-ecosystem-test-artifacts/runs` and accept
`DIAGNOSE_RUNS_ROOT` (diagnose and GUI) or `PROFILE_DUMP_RETAINED_EXPORT_RUNS_ROOT` (retained
export). The retained-export slice reads a **fixed** evidence root and refuses `70` on any other
`RETAINED_EXPORT_ARTIFACT_ROOT` (§7).

Exit vocabulary: `0` green; `60`–`66` the retained-export verifier's fixed codes (relayed only when
both snapshots are identical); `70` refusal/unknown workload exit; `71` syntax/static/dependency
precondition; `72` workload/TAP/YAML/HTTP verdict; `73` evidence failure; `74` timeout or unsettled
unit (and, from the GUI payload, a red test file); `75` lock held; `76` run collision; `77` hash
read/manifest failure including a relative entry path; `78` control or selected-input drift.

The manifest header is `bounded-runner/1 source-review-unreleased` and makes no upstream commit
claim; manifest hashing is integrity against reviewed local pins, not protection against a writer
who can replace both pins and code.

## Appendix. Evidence index

| Context | Evidence |
| --- | --- |
| Shared envelope readback | `envelope-effective.txt`, `requested.txt`, `memory-gate.txt` in each run |
| Ownership receipt | `ownership.txt` / `ownership-systemctl.txt` |
| Terminal settlement | `terminal-before.txt`, `terminal.txt`, `status.txt` |
| Evidence accounting | `payload-result.txt`, `payload-evidence.txt`, `status.txt` |
| TAP gate | `test-file/tap-fields.txt`, `tap-verdict.txt`, `stdout.tap.normalized` |
| Control closure and selection | `control-before/after/diff.txt`, `selected-before/after/diff.txt`, `selection.txt` |
| Workload identity | `workload.txt`, `argv.txt`, `cases/<id>/case.txt` |
| Retained-export pins | `retained-export-inputs.txt`, `retained-export-result.txt`, `snapshots.txt` |
| GUI probe evidence | `gui-ok/probe.json`, `gui-refusal/probe.json`, `envelope-step/stdout.json` |
| Core source | [bounded-runner](../../scripts/bounded-runner/README.md), [tap.sh](../../scripts/bounded-runner/tap.sh), [policy.sh](../../scripts/bounded-runner/policy.sh) |
