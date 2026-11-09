# diagnose-real-wiring — acceptance runner (SOURCE-ONLY)

**STATUS: SOURCE-ONLY migration to the canonical bounded runner. Awaiting Lead
bounded verification.**

These three files have been rewritten against canonical `scripts/bounded-runner`
(ABI `bounded-runner/1`, core commit `c8123de`). They have **not been executed,
syntax-qualified, sourced or launched** in this form, and no unit has been created
from them. Nothing below is a measurement of the migrated bytes: the numbers this
document quotes are the ones recorded by the **pre-migration** version, kept as
history so the expectation is reviewable before the Lead runs it.

**History (pre-migration, 2026-11-08):** three bounded rounds, the third green.
Rounds 1 and 2 exited `72` for test-side reasons only (a wrong envelope path in the
assertions, then input documents passed as `file:` URLs where the reader takes a
filesystem path); round 3 exited `0` with six CLI cases at `0/0/2/1/2/2` and a
clean `6/6` TAP run of the wiring test. No implementation file changed between
rounds. Round totals and paths:
[`../../docs/testing/2026-11-08-diagnose-spec-wiring.md`](../../docs/testing/2026-11-08-diagnose-spec-wiring.md).
That record describes the pre-migration runners; it is not evidence about these
bytes.

Minimal adaptation of [`../diagnose-batch/`](../diagnose-batch/README.md), now
expressed the same way as the already-migrated
[`../profile-dump-batch/`](../profile-dump-batch/README.md): the resource envelope,
the shared lock, the two-point hash discipline, the terminal state readback and the
exit-code vocabulary are the **core's**, identical **on purpose**. What this batch
still owns is the workload and the subject.

- `diagnose-batch` proves `tests/diagnose.test.js` passes, with **synthetic**
  validators and injected sinks.
- `diagnose-real-wiring` drives the `dsh-compat-diagnose` CLI as a **real child
  process** against the **real** validators in the sibling `dsh-compat-spec`
  checkout, one invocation per case, and keeps each case's `stdout` / `stderr` /
  exit code as its own file.

It does **not** run the whole unit-test suite. The wiring test
(`tests/diagnose-spec-wiring.test.js`) is an ordinary `node --test` file that runs
in the normal `scripts.test` glob; this runner runs that one file, and it exists to
show the same wiring through the CLI's actual process boundary, which the
in-process test cannot cover.

## Invocation

    bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnose-real-wiring/run.sh

No arguments; extra arguments are refused (`70`). **The path must be absolute.** The
core binds every active shell source frame to its absolute control list, so a
relative entry path (`scripts/…/run.sh`, `./run.sh`) is refused with `77` **before**
the lock is taken, before a run directory is created and before any unit or
workload is launched. Raw artefacts live outside the repository, under
`${DIAGNOSE_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}`.

## Files

| file | role |
| --- | --- |
| `run.sh` | host-side launcher: refuses bad invocations, names the selected inputs, delegates one unit to the core |
| `payload.sh` | in-unit payload: after the core's envelope receipt, runs the six CLI cases and the selected test file |
| `README.md` | this document |

All three are control sources: the core hashes them, its own five modules and its
manifest, and refuses (`77`) if any of them cannot be read or was invoked by a
relative path.

## The envelope (the core's, not restated here)

| knob | value |
| --- | --- |
| unit type | `Type=exec` |
| memory | `MemoryMax=384M` |
| swap | `MemorySwapMax=0` |
| tasks | `TasksMax=32` |
| CPU | `CPUQuota=50%` |
| runtime | `RuntimeMaxSec=120` (read back as `RuntimeMaxUSec=120000000` via `busctl`) |
| node heap | `NODE_OPTIONS=--max-old-space-size=192` |
| memory gate | one `MemAvailable >= 819200 KiB` check, before the workload |
| lock | `flock -n` on `experiments/acceptance/runs/.acceptance.lock` |
| retries | none — a failure stops the batch |

The readback from inside the unit (`memory.max`, `memory.swap.max`, `pids.max`,
`cpu.max`, `systemctl show … Type`, `RuntimeMaxUSec` in two `busctl` steps), the
ownership receipt, the memory gate, the peak readback and the evidence-write
counter all live in `scripts/bounded-runner/envelope.sh` and are entered with
`br_envelope_enter` before any subprocess starts. Any mismatch refuses (`70`/
`73`); an unreadable value is a mismatch, never a silent pass.

## Stages (payload)

1. the core's envelope receipt (`br_envelope_enter`), before any other subprocess;
2. argument and path checks (two arguments, unit name, `$RUN` an existing
   directory, CLI and `$WORKDIR` present, node binary and `bwrap` executable);
3. `bash -n` on `run.sh` and `payload.sh` — both always checked, so one failure
   never hides the other;
4. static contract (`static-contract.mjs`, heredoc, byte-identical to the
   pre-migration file): `package.json` shape (test script exact, only `yaml`
   dependency at `2.9.1`, bin and export wiring, the assembler not exported), the
   selected test file present and inside the glob, and the `yaml` dependency
   resolvable to exactly `2.9.1` (else refuse `71` — this batch never installs);
   a missing dependency is reported as `acc_static_contract=blocked` with
   `acc_block_reason=yaml_dependency_not_installed`;
5. sibling precondition: every `dsh-compat-spec` input the cases read must exist
   (else refuse `71` — a missing sibling checkout is a failure, never a skip);
6. `yaml` directory precondition (a symlinked `node_modules/yaml`, or a symlink
   inside it, is refused rather than hashed) and the first sha256 snapshot;
7. the six CLI cases (below), each a real child process, each preceded by an
   evidence-write gate;
8. one bounded `node --test` run of `tests/diagnose-spec-wiring.test.js` from the
   package directory — the same two real validators, in-process. The summary is
   normalised first (see below), then checked: exit `0`, every test passing, no
   skipped/cancelled/todo, and at least **six** tests. A skipped or absent run is
   never a pass;
9. the second `yaml` sha256 snapshot — must be byte-identical to the first;
10. verdict.

## The cases

Each case is `bwrap --ro-bind / / … --chdir "$WORKDIR" -- env -i … <abs node>
<abs cli> …`. The working directory is `projects/dsh-compat-platform`, and the
validator specifiers are **CWD-relative** (`../dsh-compat-spec/...`) on purpose:
`resolveModuleTarget` resolves a `./`/`../` specifier against `process.cwd()`, so
running from `$WORKDIR` exercises that exact branch against real files.

| case | argv (after the CLI) | expected exit | why |
| --- | --- | --- | --- |
| `c1-profile-only` | `--profile examples/diagnose/profile.yml` | `0` | one clean profile block, everything else absent |
| `c2-all-clear` | `--profile … --static packages/analyzer/fixtures/clean.json --declaration-validator <spec index> --runtime examples/diagnose/runtime-evidence.json` | `0` | three lanes clear with the real declaration grammar |
| `c3-static-negative` | `--profile … --static packages/analyzer/fixtures/invalid-declaration.json --declaration-validator … --runtime …` | `2` | real `validateDeclaration` refuses a declaration, the analyzer reports `analysisComplete: false`, profile/runtime still reported |
| `c4-admission-attention` | `--profile … --static fixtures/clean.json … --runtime … --admission examples/diagnose/admission-evidence.json --admission-validator <spec admission>` | `1` | the example is valid evidence, but its `refused` case and its unreported optional cases are attention, never a pass |
| `c5-static-bare-declaration` | `--static ../dsh-compat-spec/conformance/positive/01-minimal-tool.json --declaration-validator …` | `2` | `--static` takes the analyzer input envelope; a bare declaration is `INPUT_INVALID` on that lane |
| `c6-admission-grammar-refusal` | `--static fixtures/clean.json … --admission fixtures/clean.json --admission-validator …` | `2` | the admission grammar refuses a document that is not admission evidence; static stays clear |

`<spec index>` is `../dsh-compat-spec/src/index.js` and `<spec admission>` is
`../dsh-compat-spec/src/admission-evidence.js`. Every `--static` input above is a
`{ declarations, availableCapabilities }` envelope: `clean.json` and
`invalid-declaration.json` already are one, and case `c5` exists precisely
because a single bare declaration is **not** that shape.

For every case the payload also requires stdout to begin with `{` (a JSON
envelope), so a crash that prints no report is a distinct failure from a wrong
exit code.

### TAP normalisation

The reporter `node --test` picks is not this batch's choice, so **both** summary
shapes are accepted and a single summary per key is required either way:

- `# tests 6` — the TAP summary;
- `ℹ tests 6` — the spec reporter's info line.

The spec form is rewritten to the TAP form before the core's singleton checker
(`br_tap_check`) sees it; nothing else in the stream is touched. The tests
themselves are not re-parsed, so a stray `# tests` line elsewhere in the output is
still a refusal (`72`), not a silent pass.

## Exit codes

Payload:

- `0` green;
- `70` envelope/argument/launch-context refusal;
- `71` static contract, dependency or sibling precondition failed (no case
  started);
- `72` a case's exit code did not match its expected code, a case produced no
  JSON envelope, the case count was wrong, or the `yaml` snapshot changed;
- `73` an evidence write failed;
- `74` the selected test file did not report a clean TAP run.

Launcher (relaying the core):

- `0` green;
- `70` refusal before or inside the launch;
- `71`/`72`/`73`/`74` relayed from the payload;
- `74` also the core's "unit did not settle" code, as before the migration;
- `75` lock held;
- `76` run-directory collision;
- `77` a hash manifest or a control source could not be read, matched or written —
  including a **relative** entry path;
- `78` selected-input drift.

## Artefacts (under `$RUN`)

Canonical, written by the core: `selection.txt`, `control-before.txt`,
`selected-before.txt`, `active-units.txt`, `argv.txt`, `requested.txt`,
`unit.log`, `launch.txt`, `systemd-run.rc`, `journal.txt`/`journal.rc`,
`terminal-before.txt`, `terminal-after-stop.txt`, `terminal.txt`, `stop.txt`,
`ownership.txt`/`ownership-systemctl.txt`, `envelope-systemctl.txt`,
`envelope-getunit.txt`, `envelope-runtime.txt`, `envelope-effective.txt`,
`memory-gate.txt`, `control-after.txt`, `selected-after.txt`,
`control-diff.txt`, `selected-diff.txt`, `payload-result.txt`,
`payload-evidence.txt`, `peaks.txt`, `status.txt`.

Written by this payload: `syntax.txt`,
`static-contract.mjs`/`.log`/`.rc`, `static-verdict.txt`,
`sibling-precondition.txt`,
`yaml-manifest-before.txt`/`-after.txt`/`-diff.txt`/`.txt`, `workload.txt`,
`cases/<id>/stdout.json`, `cases/<id>/stderr.txt`, `cases/<id>/exit.txt`,
`cases/<id>/case.txt`, `cases-summary.txt`, `test-file/stdout.tap`,
`test-file/stdout.tap.normalized`, `test-file/stderr.txt`, `test-file/exit.txt`,
`test-file/summary.txt`, `test-file/tap-fields.txt`, `test-file/tap-verdict.txt`,
`test-file/verdict.txt`, `case-verdict.txt`.

Changes relative to the pre-migration runner: the envelope/knob/memory-gate/peak
records are now the core's names and shapes (`envelope-effective.txt` with
`mismatch=`, `memory-gate.txt` with `read_rc`/`MemAvailableKiB`/`minimum_kib`,
`peaks.txt` with the four canonical fields); `evidence-gate.txt` and the
per-write counter files are gone (the counter is `payload-evidence.txt`); the
payload no longer writes its own `journal.txt` or `terminal-query*.txt`; the test
file's raw TAP now has a normalised sibling; `terminal-query*.txt` is replaced by
the core's three terminal files; and `hashes-before.txt`/`-after.txt`/`-diff.txt`
are replaced by `control-*` and `selected-*` pairs.

## Selected inputs (hashed before and after)

The launcher names them; the core hashes them twice. `packages/analyzer/package.json`
and the CLI/source modules the verdict depends on, the three example data files,
the example README, the two analyzer fixtures, and the wiring test file. `run.sh`
and `payload.sh` are not repeated there — they are control sources. Drift → `78`.

The **sibling `dsh-compat-spec` sources and fixtures are deliberately NOT in this
hash set** — they are another repository's bytes. Their *existence* is still a
hard preflight check in both files (`70`/`71`), because an absent sibling is the
failure this batch exists to catch, but their contents are not hashed here.

## What a green run would NOT establish

- That any plugin in `profile.yml` would **load** or activate.
- That a **host** observed any of this. `runtime-evidence.json` and
  `admission-evidence.json` are synthetic documents typed to satisfy a schema; a
  passing validator means "internally consistent", not "a host ran it".
- **Correlation** or **certification** across the named sources.
- That the `yaml` snapshot proves the dependency was installed intact — it proves
  the file list and contents were identical at two instants, nothing about
  provenance.

## Deviations found while executing (pre-migration history)

- **`--static` takes the analyzer input envelope**, not one declaration. Three
  cases had been designed around spec `conformance/*.json` single declarations;
  those were replaced by `fixtures/clean.json` / `fixtures/invalid-declaration.json`
  and one case (`c5`) was added to show the bare-declaration refusal.
- **The TAP parser had to read both reporter shapes.** `node --test` wrote the
  spec reporter (`ℹ tests 6`) in round 1, and the payload only matched `# tests N`,
  so round 1 reported `tap_*=unparsed` while the tests themselves were failing for
  another reason. The parser now accepts both — now as an explicit normalisation
  in front of the core's checker.
- **A test-file step was added** (exit `74`) after the case list was frozen: the
  runner now also runs the wiring test file once and requires a clean TAP run.
- **`chmod 755`** was needed on `run.sh`/`payload.sh`, which had been written
  `600`; the first invocation refused with `rc=126` and started no unit. File modes
  do not enter the sha256 manifest.
- **The payload changed between rounds**, so the three rounds do not share one
  payload hash; the record names the hash of the executed version.

## Changes in this migration (for the reviewer)

- The launcher no longer computes unit names, hashes, terminal state or the
  verdict: it validates its own invocation, names its selected inputs, and hands
  one launch to `br_host_run`.
- The payload's argument contract is now exactly two arguments (`unit`, `run`), as
  the canonical host launches it.
- The payload's own envelope readback, memory gate, evidence counter, peak
  readback and terminal verdict are gone, replaced by `br_envelope_enter`,
  `br_evidence_gate`, `br_peaks` and `br_payload_finish`.
- Evidence writes go through `br_record`; a failed write is the core's `73`
  instead of a locally incremented counter.
- The recorded verdict vocabulary is unchanged
  (`acc_smoke_verdict`/`acc_case_failures`/`acc_test_file_verdict`/
  `acc_yaml_snapshot`), and so is the precedence: case mismatch, then case count,
  then test file, then snapshot.
