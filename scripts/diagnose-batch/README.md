# diagnose acceptance batch

**STATUS: EXECUTED — twice, on 2026-11-08.** The batch ran once with eight failing cases and
once again after test-side-only corrections; the scripts themselves were not edited between the
two rounds and are byte-frozen. Both rounds and the per-case breakdown are recorded in
[`docs/testing/2026-11-08-unified-diagnostics.md`](../../docs/testing/2026-11-08-unified-diagnostics.md).

| round | run directory | TAP | exit |
| --- | --- | --- | --- |
| 1 | `20261108T132247Z-diagnose-batch-826539-12878` | 48 tests, 40 pass, 8 fail | `72` |
| 2 | `20261108T134246Z-diagnose-batch-828115-18957` | 49 tests, 49 pass | `0` |

Both rounds: `selected_inputs=12`, `hashes=identical`, `envelope_mismatch=none`,
`acc_static_contract=pass`, `acc_yaml_snapshot=identical`, terminal state settled.

**On the `PREPARED` wording still visible in `run.sh` and in this file's earlier revision.** That
text was written *before* the first execution and describes the state of the bytes at the time of
writing — not the state of the batch now. It is deliberately left unchanged in the script:
rewriting a comment after execution would change the bytes of a file that has already been
executed twice, and the record would then describe scripts that never ran. Treat it as a
historical note; the table above is the current status.

This batch exists to answer two questions about the new `dsh-compat-diagnose` command, and
only those two:

1. **Static contract.** Does the package manifest hold the shape the design requires — `yaml`
   pinned to exactly `2.9.1` as the only dependency, one `dsh-compat-diagnose` `bin` entry,
   a `./diagnose` export slot with a `types` sibling, a `./diagnose-cli` entry, the internal
   assembler absent from `exports`, and the new test file present in the suite's glob?
2. **The suite.** Do the cases in `tests/diagnose.test.js` pass, unmodified, under the
   approved envelope?

The file the second round executed is 1154 lines with 49 top-level `test(...)` declarations by
static count. The pre-execution revision had 48 declarations (1073 lines); the difference is one
added entry-attention case plus the fixture and expectation corrections made between the rounds —
see §5 of the [testing record](../../docs/testing/2026-11-08-unified-diagnostics.md). Those edits
are **test-side only**: no source under `src/` changed between rounds.

Pass/fail numbers are reported only as the two recorded rounds in the status table above. They are
counts for one file under one envelope, not a package-level claim.

## A precondition this batch does not satisfy by itself

The workload imports `yaml` transitively (`diagnose-internal.js` → `profile-dump.js`). **This
batch never installs anything.** If `yaml@2.9.1` does not already resolve from
`packages/analyzer/node_modules`, the payload refuses with exit `71` and the record says
`acc_block_reason=yaml_dependency_not_installed`. A missing baseline is a refusal, not a skip
and not a pass. Acquiring the dependency is a separate, explicitly authorised step.

## Envelope

| Property | Value |
| --- | --- |
| `Type` | `exec` |
| `MemoryMax` | 384 MiB (`402653184`) |
| `MemorySwapMax` | `0` |
| `TasksMax` | `32` |
| `CPUQuota` | `50%` (`cpu.max = 50000 100000`) |
| `RuntimeMaxSec` | `120` (`RuntimeMaxUSec = 120000000`, read back through `busctl`) |
| `NODE_OPTIONS` | `--max-old-space-size=192` |
| Host gate | `MemAvailable` ≥ `819200` KiB, read once, before the workload |
| Concurrency | `flock -n` on the shared `experiments/acceptance/runs/.acceptance.lock`; a held lock is a refusal (`75`), never a wait |
| Retries | none |

Every limit is **read back** from the cgroup and from systemd inside the payload and compared
against the approved values; a mismatch refuses (`70`) before any test runs. Recording the
requested values would not have shown what was actually enforced.

Readback is strict: each compared value must come from **exactly one** well-formed line. An
empty read, a missing read, or a duplicate (two differing replies) is itself a mismatch —
`head -n 1` would have quietly accepted the first of several replies, and an empty value must
never pass.

`RuntimeMaxUSec` is read in two `busctl` steps: `Manager.GetUnit` must return rc `0` and
**exactly one** legal object path, then `Service.RuntimeMaxUSec` is fetched with `get-property`
and accepted only when the **entire** reply is a single `t <digits>` line. Extra lines, an
error string or trailing garbage disqualify it. The value must equal `120000000`.

## Stages

| Stage | What it does | Refusal |
| --- | --- | --- |
| 0 | arguments; unit name must end in `.service`; run directory writable | `70` |
| 1 | read back cgroup `memory.max`/`memory.swap.max`/`pids.max`/`cpu.max`, `Type`, `RuntimeMaxUSec` | `70` |
| 2 | compare readback against the approved limits | `70` |
| 3 | `MemAvailable` gate, once | `70` |
| 4 | `bash -n` on both scripts (a write-failure gate precedes it) | `71` / `73` |
| 5 | static contract (manifest shape, export shape, file set, dependency version; a write-failure gate precedes the node step) | `71` / `73` |
| 5b | evidence gate — any record written so far must have landed; yaml regular-file snapshot | `73` |
| 6 | run `tests/diagnose.test.js` under `bwrap` with full namespace isolation | — |
| 6b | re-snapshot the yaml regular-file list; compare before/after | `72` (drift) |
| 7 | TAP field extraction; each field exactly once; `tests=pass>0`, `fail`/`cancelled`/`skipped`/`todo` = 0 | `72` |
| 8 | peak memory / pids from the cgroup | — |

A write failure in any record before the workload stops the batch with `73` and the workload is
**not** started: an unrecorded envelope is never papered over by a later verdict. The gate is
checked before the `bash -n` stage, again before the `node` static-contract step, and again at
stage 5b before the workload. There is no retry: one launch, one workload, one verdict.

## What the workload runs under

```
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp
      --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent
      --chdir packages/analyzer
  env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=192
  node --test --test-concurrency=1 --test-reporter=tap tests/diagnose.test.js
```

- `--ro-bind / /` keeps the checkout and the installed dependency visible without making
  anything writable; the suite writes only into its own `mkdtemp` scratch under `TMPDIR=/tmp`.
- The suite writes temporary validator modules under that same scratch and imports them by
  absolute path. `--tmpfs /tmp` is what makes that path writable; nothing else is.
- `--dev /dev --proc /proc` mount fresh `devtmpfs`/`proc` inside the sandbox, and
  `--unshare-pid --unshare-ipc --unshare-uts --unshare-net` give it private pid/ipc/uts/net
  namespaces; `--die-with-parent` ties the sandbox to this process so nothing outlives the unit.
- **No other path is writable**, and the run directory is deliberately *not* bound into the
  sandbox: nothing in the workload is supposed to write evidence, so nothing in the workload is
  given a place to.
- `--unshare-net` means a test that reached for the network would fail here rather than pass
  quietly.
- `--test-reporter=tap` is explicit, so the field extraction in stage 7 does not depend on a
  default that could change.

## Logging

The payload **never writes `unit.log`**. The launcher is the single writer of `unit.log` (it
redirects the unit's `stdout`/`stderr` there); the payload only relays its own logs — the static
contract log and the TAP stream — to `stdout`.

## Evidence

Raw artifacts go to `/data/dsh-ecosystem-test-artifacts/runs/<stamp>-diagnose-batch-…/`,
outside the repository. The repository keeps only the narrative record, written **after** a run,
under `docs/testing/`.

Files the runner writes: `status.txt`, `argv.txt`, `selection.txt`, `hashes-before.txt`,
`hashes-after.txt`, `hashes-diff.txt`, `active-units.txt`/`.err`, `unit.log`, `journal.txt`,
`terminal-query.txt`/`-raw.txt`, `systemd-run.rc`, `launch.txt`.
Files the payload writes: `envelope-cgroup.txt`, `envelope-systemctl.txt`, `envelope-busctl-path.txt`,
`envelope-busctl.txt`, `envelope-effective.txt`, `envelope-verdict.txt`, `memory-gate.txt`,
`syntax.txt`, `evidence-gate.txt`, `static-contract.mjs`/`.log`, `static-verdict.txt`,
`yaml-manifest-before.txt`, `yaml-manifest-after.txt`/`-diff.txt`/`yaml-manifest.txt`,
`workload.txt`, `node-tap.log`, `node-stderr.log`, `node.rc`, `tap-fields.txt`,
`tap-summary.txt`, `tap-verdict.txt`, `peaks.txt`.

## Exit codes

`0` green · `70` envelope or precondition refusal · `71` static contract or dependency
precondition failed · `72` test verdict not green · `73` evidence write failed · `74` unit did
not settle · `75` lock held · `76` run-directory collision · `77` hash manifest
unreadable/unwritable · `78` selected-input drift.

A settled terminal state requires `LoadState`/`ActiveState`/`SubState` to agree with
`inactive:dead` or `failed:failed` **and** `MainPID=0`. A live unit is stopped once and
re-read; if it still does not settle, the batch exits `74`.

## What a green result would not establish

- That the diagnose implementation is free of defects. Round 1 failed eight cases and round 2
  passed after **test-side** corrections; the eight failures are preserved in the
  [testing record](../../docs/testing/2026-11-08-unified-diagnostics.md), and "the implementation
  is correct" remains an open claim rather than something these 49 cases establish.
- That a validator-wiring defect, found by static reading and fixed before the first run, was
  ever executed in its defective form. It was not: the first execution already contained the fix,
  so no artifact shows the old behaviour.
- That the diagnose envelope behaves identically inside a real DSH host: this is the library
  and CLI this checkout contains, exercised by this package's own tests.
- That any exported profile would load, that a dump is complete or authoritative, or that a
  clean envelope means a healthy profile.
- That named sources describe the same host, build, commit or session — the envelope itself
  reports `correlation: "not-established"`.
- Anything about `!!js` evaluation: the profile text is summarized as inert text and no
  expression is evaluated.
- That the CLI works as a **subprocess**, against a **real protocol validator**, or as a host
  integration. The cases drive `main(argv, io)` in-process with injected sinks, read real
  temporary files, and import a **synthetic** validator module by absolute path. Process exit
  status, real stdio plumbing and the protocol validator are outside this batch.
- That the full package suite is green. The workload names `tests/diagnose.test.js` explicitly;
  the `tests/*.test.js` `tests/*.test.mjs` glob is never run here.
- That the other analyzer test files are unaffected. They are outside this batch, and
  `combined-report.js`, `combined-cli.js`, `profile-dump.js` and `evidence-cli.js` are hashed
  here only to show they did not change.

## Selected inputs (hashed before and after)

`run.sh`, `payload.sh`, `packages/analyzer/package.json`, `src/diagnose-internal.js`,
`src/diagnose.js`, `src/diagnose-cli.js`, `src/diagnose.d.ts`, `src/combined-report.js`,
`src/combined-cli.js`, `src/profile-dump.js`, `src/evidence-cli.js`,
`tests/diagnose.test.js` — twelve paths. This is a **named selection, not a dependency
closure**: `yaml` itself, `combined-report.d.ts`, the analyzer `README.md` and the other
analyzer test files are not hashed by the runner.

The runner deliberately leaves `yaml` out, because a named selection is not a closure. The
payload does **not** close that gap — it only takes a two-point snapshot: it lists and
`sha256sum`s the regular files under `packages/analyzer/node_modules/yaml` (sorted)
immediately before the test and again immediately after, and requires the two snapshots to be
identical. That equality means the selected `yaml` **regular files** were the same at those two
instants; it does **not** prove the package was installed intact, does **not** vouch for its
provenance, and cannot rule out a change that happened and was reverted between the two
snapshots. The snapshot refuses if the directory is a symlink or contains any symlink at all,
because `find -type f` does not follow symlinks and would otherwise silently drop an imported
file from the hash. Drift between the two snapshots makes the verdict not green (`72`).

## Prior review deviations this batch does not repair

Earlier work around the diagnose implementation ran outside any resource envelope:

- a bare `python3` + `json.load` pass over the package manifest, used to check manifest shape;
- a hand-written bracket/parenthesis pairing scan offered as a syntax check — it is not JS syntax
  validation, and the batch's `bash -n` step covers only the two shell scripts;
- two edits made through Python rather than an editor: a documentation typo fix and an unused
  import removal.

None of these ran under a cgroup limit, produced an independent log, used a separate parser path
or recorded its own exit code; their only record is the session narrative. They are recorded as
deviations in §9 of the [testing record](../../docs/testing/2026-11-08-unified-diagnostics.md).
This batch neither repeats them nor offers them as substitute verification, and a green result
here does not retroactively validate them. This document does not reconstruct equivalent scripts
and does not re-run them.
