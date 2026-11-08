# diagnose-real-wiring — acceptance runner (EXECUTED)

**STATUS: EXECUTED — three bounded rounds on 2026-11-08, the third green.**
Rounds 1 and 2 exited `72` for test-side reasons only (a wrong envelope path in
the assertions, then input documents passed as `file:` URLs where the reader takes
a filesystem path); round 3 exited `0` with six CLI cases at `0/0/2/1/2/2` and a
clean `6/6` TAP run of the wiring test. No implementation file changed between
rounds. Round totals and paths:
[`../../docs/testing/2026-11-08-diagnose-spec-wiring.md`](../../docs/testing/2026-11-08-diagnose-spec-wiring.md).

The design below is what was built; where a number appears it is now a measured
one, transcribed from the run artefacts under
`/data/dsh-ecosystem-test-artifacts/runs/` (outside the repository). It remains
**local evidence of one bounded chain** — not the full suite, not a host run, and
not loadability.

Minimal adaptation of [`../diagnose-batch/`](../diagnose-batch/README.md): the
resource envelope, the shared lock, the two-point hash discipline, the terminal
state readback and the exit-code vocabulary are kept identical **on purpose**.
What changes is the workload and the subject.

- `diagnose-batch` proves `tests/diagnose.test.js` passes, with **synthetic**
  validators and injected sinks.
- `diagnose-real-wiring` drives the `dsh-compat-diagnose` CLI as a **real child
  process** against the **real** validators in the sibling `dsh-compat-spec`
  checkout, one invocation per case, and keeps each case's `stdout` / `stderr` /
  exit code as its own file.

It does **not** run the new unit tests. Those are ordinary `node --test` files
(`tests/diagnose-spec-wiring.test.js`) that run in the normal `scripts.test`
glob; this runner exists to show the same wiring through the CLI's actual process
boundary, which the in-process test cannot cover.

## Files

| file | role |
| --- | --- |
| `run.sh` | host-side launcher: lock, hashes, one transient unit, terminal state, verdict |
| `payload.sh` | in-unit payload: self-checks its envelope, then runs the CLI cases |
| `README.md` | this document |

## The envelope (unchanged from `diagnose-batch`)

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

The payload verifies the envelope from inside the unit (`memory.max`,
`memory.swap.max`, `pids.max`, `cpu.max`, `systemctl show … Type`, and
`RuntimeMaxUSec` read in two `busctl` steps). Any mismatch refuses (70). An
unreadable value is a mismatch, never a silent pass.

## Stages (payload)

1. argument and path checks (`UNIT` ends in `.service`, `$RUN` writable, CLI and
   `$WORKDIR` present, node binary executable);
2. envelope readback and match;
3. single `MemAvailable` gate;
4. `bash -n` on `run.sh` and `payload.sh`;
5. static contract (`static-contract.mjs`, heredoc): `package.json` shape (test
   script exact, only `yaml` dependency at `2.9.1`, bin and export wiring, the
   assembler not exported), the selected test file present and inside the glob,
   and the `yaml` dependency resolvable to exactly `2.9.1` (else refuse 71 — this
   batch never installs);
6. sibling precondition: every `dsh-compat-spec` input the cases read must exist
   (else refuse 71 — a missing sibling checkout is a failure, never a skip);
7. evidence gate (every record so far must have landed, else 73) and a
   `yaml`-directory sha256 snapshot (before);
8. the six CLI cases (below), each a real child process, each gated by a
   per-case evidence-write check;
9. one bounded `node --test` run of `tests/diagnose-spec-wiring.test.js` from the
   package directory — the same two real validators, in-process. A skipped or
   absent run is never a pass: the TAP summary must report six or more tests, all
   passing;
10. `yaml`-directory sha256 snapshot (after) — must be byte-identical;
11. verdict, peaks.

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

## Artefacts (under `$RUN`)

Per case: `cases/<id>/stdout.json`, `cases/<id>/stderr.txt`, `cases/<id>/exit.txt`,
`cases/<id>/case.txt`. Batch-level: `envelope-*.txt`, `memory-gate.txt`,
`syntax.txt`, `evidence-gate.txt`, `static-contract.mjs`/`.log`,
`static-verdict.txt`, `sibling-precondition.txt`, `yaml-manifest-before.txt`/
`-after.txt`/`-diff.txt`/`.txt`, `cases-summary.txt`, `test-file/` (`stdout.tap`, `stderr.txt`, `exit.txt`,
`summary.txt`), `case-verdict.txt`, `peaks.txt`. Host-side: `argv.txt`, `unit.log`, `journal.txt`,
`terminal-query*.txt`, `hashes-before.txt`/`-after.txt`/`-diff.txt`,
`selection.txt`, `status.txt`.

Raw artefacts live outside the repo, under `${DIAGNOSE_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}`.

## Exit codes

Payload: `0` green; `70` envelope refusal; `71` static contract / dependency /
sibling precondition failed (no case started); `72` a case's exit code did not
match its expected code, or a case produced no JSON envelope; `73` an evidence
write failed; `74` the selected test file did not report a clean TAP run.

Launcher: `0` green; `70` refusal before/inside launch; `71`/`72`/`73` relayed;
`74` unit did not settle; `75` lock held; `76` run-directory collision; `77` a
hash manifest could not be read or written; `78` selected-input drift.

## Selected inputs (hashed before and after)

The runner, the payload, `packages/analyzer/package.json` and the CLI/source
modules the verdict depends on, the three example data files, the example
README, and the wiring test file. Drift → `78`.

The **sibling `dsh-compat-spec` sources and fixtures are deliberately NOT in this
hash set** — they are another repository's bytes. Their *existence* is still a
hard preflight check (`70`/`71`), because an absent sibling is the failure this
batch exists to catch, but their contents are not hashed here.

## What a green run would NOT establish

- That any plugin in `profile.yml` would **load** or activate.
- That a **host** observed any of this. `runtime-evidence.json` and
  `admission-evidence.json` are synthetic documents typed to satisfy a schema; a
  passing validator means "internally consistent", not "a host ran it".
- **Correlation** or **certification** across the named sources.
- That the `yaml` snapshot proves the dependency was installed intact — it proves
  the file list and contents were identical at two instants, nothing about
  provenance.

## Deviations found while executing

- **`--static` takes the analyzer input envelope**, not one declaration. Three
  cases had been designed around spec `conformance/*.json` single declarations;
  those were replaced by `fixtures/clean.json` / `fixtures/invalid-declaration.json`
  and one case (`c5`) was added to show the bare-declaration refusal.
- **The TAP parser had to read both reporter shapes.** `node --test` wrote the
  spec reporter (`ℹ tests 6`) in round 1, and the payload only matched `# tests N`,
  so round 1 reported `tap_*=unparsed` while the tests themselves were failing for
  another reason. The parser now accepts both.
- **A test-file step was added** (exit `74`) after the case list was frozen: the
  runner now also runs the wiring test file once and requires a clean TAP run.
- **`chmod 755`** was needed on `run.sh`/`payload.sh`, which had been written
  `600`; the first invocation refused with `rc=126` and started no unit. File modes
  do not enter the sha256 manifest.
- **The payload changed between rounds**, so the three rounds do not share one
  payload hash; the record names the hash of the executed version.
