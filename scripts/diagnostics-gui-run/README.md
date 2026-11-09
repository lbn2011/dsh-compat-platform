# `diagnostics-gui-run` — bounded batch for the read-only diagnostics GUI

Status: **SOURCE-ONLY migration to the canonical bounded runner. Awaiting Lead
bounded verification.** The three files here were rewritten against
`scripts/bounded-runner` (ABI `bounded-runner/1`, core commit `c8123de`) and have
**not** been executed, syntax-qualified, sourced or launched in this form; no unit
has been created from them.

**History (pre-migration):** two rounds on 2026-11-08, the second green. Record:
[`docs/testing/2026-11-08-read-only-diagnostics-gui.md`](../../docs/testing/2026-11-08-read-only-diagnostics-gui.md).
That record describes the pre-migration launcher; it is not evidence about these
bytes.

One run of this launcher does, once, under a bounded envelope and with no retry:

1. hands ONE transient unit to the core, which refuses on any deviation of the
   envelope it actually runs under (384 MiB, swap 0, 32 tasks, 50 % CPU, 120 s,
   `Type=exec`) and takes a single `MemAvailable` reading, refusing below
   819200 KiB;
2. parses both scripts and `node --check`s every JS file the batch runs;
3. asserts the package's static contract (no dependencies, both export targets
   present, `apply`/`name`/`inject`, both default paths, the closed refusal
   vocabulary, the page's two literals, exactly one discovered test file);
4. asserts the dependency precondition (yaml 2.9.1 from the analyzer; the
   installed `@deepseek-ai/cordis` and `@deepseek-ai/dsh-host-webserver` resolve
   from the global module root) and that the sibling `dsh-compat-spec` validators
   exist — an absent sibling is a refusal, never a skip;
5. **step A** produces ONE real envelope with `dsh-compat-diagnose` (expected
   exit **1**: the admission example is attention on purpose);
6. **step B** boots the two-plugin composition over that envelope and probes the
   page, the JSON route and the fence;
7. **step C** boots a second composition whose envelope is missing and probes the
   refusal path;
8. **step D** runs `node --test --test-concurrency=1 tests/gui.test.js` inside the
   package;
9. takes a second yaml snapshot.

## Usage

```
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnostics-gui-run/run.sh
```

No arguments; extra arguments are refused (`70`). **The path must be absolute.** The
core binds every active shell source frame to its absolute control list, so a
relative entry path (`scripts/…/run.sh`, `./run.sh`) is refused with `77` **before**
the lock is taken, before a run directory is created, and before any unit or
workload is launched.

One transient systemd unit, one workload, one acceptance lock taken with `flock -n`
(a held lock is a refusal, never a queue). Raw artifacts land in
`/data/dsh-ecosystem-test-artifacts/runs/<stamp>-diagnostics-gui-<pid>-<rand>/`
(`DIAGNOSE_RUNS_ROOT` overrides the root).

## Requirements

- `systemd-run`, `systemctl`, `journalctl`, `busctl`, `bwrap`, `flock`, `awk`,
  `sha256sum`, `diff` on PATH.
- Node 24 at `/www/server/nodejs/v24.21.0/bin/node`.
- The installed DSH module tree at
  `/www/server/nodejs/v24.21.0/lib/node_modules` (carrier + cordis).
- `packages/analyzer/node_modules/yaml` at exactly 2.9.1.
- A sibling checkout `projects/dsh-compat-spec` with `src/index.js` and
  `src/admission-evidence.js`.

Nothing is installed by this batch.

## Exit codes

Launcher: `0` green, `70` refusal before/inside the launch, `71` static contract
or dependency precondition failed (no workload started), `72` an HTTP assertion or
the CLI envelope step did not match, `73` an evidence write failed, `74` the unit
did not settle (and, relayed, the test file's own code), `75` lock held, `76`
run-directory collision, `77` a hash manifest or control source could not be read,
matched or written — **including a relative entry path**, `78` selected-input
drift.

Payload: `0` green, `70` argument/envelope refusal, `71` static contract or
dependency precondition, `72` assertion mismatch, `73` evidence write failed,
`74` the selected test file was not a clean run.

## Files

| File | Role |
| --- | --- |
| `run.sh` | launcher: validates its invocation, names the selected inputs, delegates one unit and one launch to the core |
| `payload.sh` | in-envelope payload: static/dependency gates, envelope step, carriers, probes, tests, verdict |
| `boot.mjs` | minimal composition: installed `WebServer` + the GUI plugin |
| `probe.mjs` | HTTP assertions, happy path and `--expect-refusal` path |
| `README.md` | this document |

`run.sh`/`payload.sh` are control sources, hashed by the core together with its own
modules and manifest. The package's own files and `tests/gui.test.js` are in the
launcher's selected input set. `boot.mjs` and `probe.mjs` are executed but **not**
hashed — a gap inherited unchanged from the pre-migration launcher; their bytes at
the last recorded run were:

| File | sha256 |
| --- | --- |
| `boot.mjs` | `cf75446106254aa2aeac4febd1c9e37c2ec5ca4ac8045ca02179c8982404830a` |
| `probe.mjs` | `73a3ee61fe46b9e66d4685bbb47d6f6a3ab32d4102dfdb088d20962a97df978e` |

An entry for them in `BR_SELECTED_INPUTS` (in `run.sh`) would make them
drift-checked; that was deliberately not done here, because it changes what the
batch judges and belongs to the Lead's review, not to a migration.

### TAP normalisation

The reporter `node --test` picks is not this batch's choice, so both summary shapes
are accepted — `# tests 15` (TAP) and `ℹ tests 15` (spec reporter). The spec form is
rewritten to the TAP form before the core's singleton checker sees it; the tests
themselves are not re-parsed, so a stray second summary line is still a refusal
(`72`), not a silent pass. The batch additionally requires at least **15** tests,
all passing.

## Artefacts

Canonical, written by the core: `selection.txt`, `control-before.txt`,
`selected-before.txt`, `active-units.txt`, `argv.txt`, `requested.txt`, `unit.log`,
`launch.txt`, `systemd-run.rc`, `journal.txt`/`journal.rc`, `terminal-before.txt`,
`terminal-after-stop.txt`, `terminal.txt`, `stop.txt`, `ownership.txt`/
`ownership-systemctl.txt`, `envelope-systemctl.txt`, `envelope-getunit.txt`,
`envelope-runtime.txt`, `envelope-effective.txt`, `memory-gate.txt`,
`control-after.txt`, `selected-after.txt`, `control-diff.txt`, `selected-diff.txt`,
`payload-result.txt`, `payload-evidence.txt`, `peaks.txt`, `status.txt`.

Written by this payload: `syntax.txt`,
`node-check-<file>.err`, `static-contract.mjs`/`.json`/`.err`/`.rc`,
`deps.mjs`/`deps.json`/`deps.err`/`deps.rc`, `sibling-precondition.txt`,
`yaml-manifest-before.txt`/`-after.txt`/`-diff.txt`/`.txt`, `workload.txt`,
`envelope-step/` (`stdout.json`, `stderr.txt`, `exit.txt`, `case.txt`,
`summary.txt`), `gui-ok/` and `gui-refusal/` (`carrier.txt`, `ready.json`,
`server-stdout.txt`, `server-stderr.txt`, `probe.json`, `probe.rc`,
`probe-stdout.txt`, `probe-stderr.txt`), `test-file/` (`stdout.tap`,
`stdout.tap.normalized`, `stderr.txt`, `exit.txt`, `summary.txt`,
`tap-verdict.txt`, `verdict.txt`), `case-verdict.txt`.

Changes relative to the pre-migration runner: the cgroup/envelope readback,
memory gate, peak readback and evidence counter are now the core's files and field
names (`envelope-effective.txt` with `mismatch=`, `memory-gate.txt` with
`read_rc`/`MemAvailableKiB`/`minimum_kib`, `peaks.txt` with the four canonical
fields); the payload no longer writes its own `envelope-cgroup.txt`,
`envelope-verdict.txt`, `evidence-gate.txt`, `journal.txt` or `terminal-query*.txt`;
`hashes-before.txt`/`-after.txt`/`-diff.txt` are replaced by the `control-*` and
`selected-*` pairs; and the test file's raw TAP now has a normalised sibling.

## Deviations recorded while executing (pre-migration history)

- **`chmod 755` on both scripts** before the first launch (they were written
  `600`, and the first invocation was refused with `rc=126`, starting no unit).
  File modes do not enter the hash manifest.
- **The carrier steps do not pass `--unshare-net`.** A fresh network namespace has
  its loopback interface down, so the probe would measure the sandbox instead of
  the page. Preserved verbatim in the migrated payload.
- **The carrier binds the run's own carrier directory writable** on top of
  `--ro-bind / /`, so the child can write `ready.json` and the probe its report.
  Preserved verbatim.
- **Round 1 exposed three defects, all fixed in bytes**: a read-only `name`
  assignment that killed the composition, an over-permissive `Host` allowlist,
  and an envelope path pointing at a file the CLI never writes (it writes stdout).
  Round 2 differs from round 1 in those files only.

## Changes in this migration (for the reviewer)

- The launcher no longer computes unit names, hashes, terminal state or the
  verdict: it checks its own invocation, names its selected inputs, and calls
  `br_host_run` once.
- The payload's argument contract is exactly two arguments (`unit`, `run`), as the
  canonical host launches it.
- The payload's own envelope readback, memory gate, evidence counter, peak
  readback and terminal verdict are replaced by `br_envelope_enter`,
  `br_evidence_gate`, `br_peaks` and `br_payload_finish`.
- The step order, both carrier flag sets, the readiness polling (200 × 0.1 s), the
  TERM-then-KILL stop (100 × 0.1 s), the `3080` forbidden-port check, the
  `--expect-refusal` probe, the six `node --check` targets and the verdict
  precedence (`envelope_step` → `carrier` → `refusal` → `test_file` →
  `yaml_snapshot`) are unchanged.
- The recorded verdict fields are unchanged (`acc_smoke_verdict`,
  `acc_envelope_verdict`, `acc_carrier_verdict`, `acc_refusal_verdict`,
  `acc_test_file_verdict`, `acc_yaml_snapshot`, `acc_origin`).

## What this batch cannot show

No browser rendered the page — there is no browser binary on this machine and none
is installed. The HTML was fetched and inspected as text; the page's inline script
never ran. No plugin was loaded or activated, no host observed the evidence
documents, and `certification` stays `false`.
