# profile-dump acceptance batch

**STATUS: EXECUTED (2026-11-08) — see `docs/testing/2026-11-08-profile-dump.md`.**
Round 1 was a single run that failed `72` on a test-expectation error (not implementation):
65 tests / 64 pass / 1 fail. The test expectation was corrected (the tag-class check now
expects `CORE_NOT_ALLOWED` for `!!python/…`, with the external-URI case kept separate), and a
single re-run then passed: `acceptance_exit=0`, TAP 65/65/0, envelope and readback all green.
This batch runs only `tests/profile-dump.test.js`, not the full suite, and does not verify a
real DSH host.

This batch exists to answer two questions about the new `dsh-compat-profile-dump` command,
and only those two:

1. **Static contract.** Does the package manifest hold the shape the design requires — `yaml`
   pinned to exactly `2.9.1` as the only dependency, one `bin` entry, one `exports` slot with a
   `types` sibling, and the new test file present in the suite's glob?
2. **The suite.** Do the cases in `tests/profile-dump.test.js` pass, unmodified, under the
   approved envelope?

## A precondition this batch does not satisfy by itself

The workload imports `yaml`. **This batch never installs anything.** If `yaml@2.9.1` does not
already resolve from `packages/analyzer/node_modules`, the payload refuses with exit `71` and the
record says `acc_block_reason=yaml_dependency_not_installed`. That is the intended behaviour:
a missing baseline is a refusal, not a skip and not a pass.

Acquiring the dependency is a separate step that needs its own authorisation. It was performed on
2026-11-08 (`scripts/profile-dump-install`, record in `docs/testing/2026-11-08-profile-dump.md`), so
this batch no longer stops at the refusal; if the dependency is absent on a fresh machine, the
refusal path above is still what it reports.

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

Readback is strict: each compared value must come from **exactly one** well-formed line. An empty
read, a missing read, or a duplicate (two differing replies) is itself a mismatch — `head -n 1`
would have quietly accepted the first of several replies, and an empty value must never pass.

`RuntimeMaxUSec` is read in two `busctl` steps: `Manager.GetUnit` must return rc `0` and **exactly
one** legal object path, then `Service.RuntimeMaxUSec` is fetched with `get-property` and accepted
only when the **entire** reply is a single `t <digits>` line. Extra lines, an error string or
trailing garbage disqualify it — a parse that merely counts matching lines could otherwise swallow
the stray text. The value must equal `120000000`.

## Stages

| Stage | What it does | Refusal |
| --- | --- | --- |
| 0 | arguments; unit name must end in `.service`; run directory writable | `70` |
| 1 | read back cgroup `memory.max`/`memory.swap.max`/`pids.max`/`cpu.max`, `Type`, `RuntimeMaxUSec` | `70` |
| 2 | compare readback against the approved limits | `70` |
| 3 | `MemAvailable` gate, once | `70` |
| 4 | `bash -n` on both scripts (a write-failure gate precedes it) | `71` / `73` |
| 5 | static contract (manifest shape, file set, dependency version; a write-failure gate precedes the node step) | `71` / `73` |
| 5b | evidence gate — any record written so far must have landed; yaml regular-file snapshot | `73` |
| 6 | run `tests/profile-dump.test.js` under `bwrap` with full namespace isolation | — |
| 6b | re-snapshot the yaml regular-file list; compare before/after | `72` (drift) |
| 7 | TAP field extraction; each field exactly once; `tests=pass>0`, `fail`/`cancelled`/`skipped`/`todo` = 0 | `72` |
| 8 | peak memory / pids from the cgroup | — |

A write failure in any record before the workload stops the batch with `73` and the workload is
**not** started: an unrecorded envelope is never papered over by a later verdict. The gate is
checked before the `bash -n` stage, again before the `node` static-contract step, and again at
stage 5b before the workload.

## What the workload runs under

```
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp
      --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent
      --chdir packages/analyzer
  env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=192
  node --test --test-concurrency=1 --test-reporter=tap tests/profile-dump.test.js
```

- `--ro-bind / /` keeps the checkout and the installed dependency visible without making anything
  writable; the suite writes only into its own `mkdtemp` scratch under `TMPDIR=/tmp`.
- `--dev /dev --proc /proc` mount fresh `devtmpfs`/`proc` inside the sandbox, and
  `--unshare-pid --unshare-ipc --unshare-uts --unshare-net` give it private pid/ipc/uts/net
  namespaces; `--die-with-parent` ties the sandbox to this process so nothing outlives the unit.
- `--tmpfs /tmp` is the minimum writable surface the suite needs. **No other path is writable**,
  and the run directory is deliberately *not* bound into the sandbox: nothing in the workload is
  supposed to write evidence, so nothing in the workload is given a place to.
- `--unshare-net` means a test that reached for the network would fail here rather than pass
  quietly.
- `--test-reporter=tap` is explicit, so the field extraction in stage 7 does not depend on a
  default that could change.

## Logging

The payload **never writes `unit.log`**. The launcher is the single writer of `unit.log` (it
redirects the unit's `stdout`/`stderr` there); the payload only relays its own logs — the static
contract log and the TAP stream — to `stdout`.

## Evidence

Raw artifacts go to `/data/dsh-ecosystem-test-artifacts/runs/<stamp>-profile-dump-batch-…/`,
outside the repository. The repository keeps only the narrative record, written **after** a run,
at `docs/testing/2026-11-08-profile-dump-<verdict>.md`.

Files the runner writes: `status.txt`, `argv.txt`, `selection.txt`, `hashes-before.txt`,
`hashes-after.txt`, `hashes-diff.txt`, `active-units.txt`/`.err`, `unit.log`, `journal.txt`,
`terminal-query.txt`/`-raw.txt`, `systemd-run.rc`, `launch.txt`.
Files the payload writes: `envelope-cgroup.txt`, `envelope-systemctl.txt`, `envelope-busctl-path.txt`,
`envelope-busctl.txt`, `envelope-effective.txt`, `envelope-verdict.txt`, `memory-gate.txt`,
`syntax.txt`, `evidence-gate.txt`, `static-contract.mjs`/`.log`, `static-verdict.txt`, `yaml-manifest-before.txt`,
`yaml-manifest-after.txt`/`-diff.txt`/`yaml-manifest.txt`, `workload.txt`, `node-tap.log`,
`node-stderr.log`, `node.rc`, `tap-fields.txt`, `tap-summary.txt`, `tap-verdict.txt`, `peaks.txt`.

## Exit codes

`0` green · `70` envelope or precondition refusal · `71` static contract or dependency
precondition failed · `72` test verdict not green · `73` evidence write failed · `74` unit did not
settle · `75` lock held · `76` run-directory collision · `77` hash manifest unreadable/unwritable ·
`78` selected-input drift.

## What a green result would not establish

- That `yaml` behaves identically inside a real DSH host: this is the library the runner finds on
  this machine, at one pinned version, exercised by this package's own tests.
- That any exported profile would load, that its dependencies resolve, or that a `config` block
  conforms to its plugin's schema — the command never inspects configuration.
- Anything about `!!js` evaluation: the parser's tag is kept opaque and the expression text is
  never read.
- That the eight pre-existing analyzer test files are unaffected. They are outside this batch,
  and `src/evidence-cli.js` is hashed here only to show it did not change.

## Selected inputs (hashed before and after)

`run.sh`, `payload.sh`, `packages/analyzer/package.json`, `packages/analyzer/README.md`,
`src/profile-dump.js`, `src/profile-dump.d.ts`, `src/profile-dump-cli.js`,
`src/evidence-cli.js` (reused unchanged), `tests/profile-dump.test.js` — nine paths.
This is a **named selection, not a dependency closure**: `yaml` itself and the other eight test
files are not hashed by the runner.

The runner deliberately leaves `yaml` out, because a named selection is not a closure. The payload
does **not** close that gap — it only takes a two-point snapshot: it lists and `sha256sum`s the
regular files under `packages/analyzer/node_modules/yaml` (sorted) immediately before the test and
again immediately after, and requires the two snapshots to be identical. That equality means the
selected `yaml` **regular files** were the same at those two instants; it does **not** prove the
package was installed intact, does **not** vouch for its provenance, and cannot rule out a change
that happened and was reverted between the two snapshots. Install-source / tarball verification is
a separate concern and is not claimed here. The snapshot refuses if the directory is a symlink or
contains any symlink at all, because `find -type f` does not follow symlinks and would otherwise
silently drop an imported file from the hash. Drift between the two snapshots makes the verdict not
green (`72`), recorded in `yaml-manifest.txt` / `yaml-manifest-diff.txt`.

## Deviations of this round

Two acceptance runs were made on 2026-11-08 (full record in
`docs/testing/2026-11-08-profile-dump.md`). Round 1 failed `72` on a **test-expectation** error —
`profile-dump.test.js` expected `EXTERNAL` where the correct class is `CORE_NOT_ALLOWED` for
`!!python/…` (`!!` expands to `tag:yaml.org,2002:`, so the tag is core-namespace and
non-whitelisted). The expectation was corrected (external-URI case kept as `EXTERNAL`, tested
separately); the implementation was **not** changed to fit it. A single re-run then passed
(`acceptance_exit=0`, 65/65). Worth naming anyway:

- The design document first described `input.bytes` as "bytes read by the reader"; the
  implementation reports the **decoded** byte length, which excludes a stripped BOM. The design
  was corrected to match, not the other way round.
