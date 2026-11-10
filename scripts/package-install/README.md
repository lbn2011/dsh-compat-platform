# `package-install` — pack the four packages and install them somewhere else

**STATUS: MIGRATED (ABI `bounded-runner/1`, core `c8123de`), executed once by the
Lead on 2026-11-10: `acceptance_exit=0`, five tarballs, offline install into a
throwaway consumer, 24 consumer checks, missing-dependency probe `ERR_MODULE_NOT_FOUND`.**

`run.sh` now hands the workload to the canonical shared bounded runner, which opens one
transient `Type=exec` unit under fixed limits, writes an ownership receipt, hashes the
control closure and the selected inputs, and calls `payload.sh` inside it. The outcomes
below that cite pre-migration figures remain history for their own bytes; the changed
artifact inventory is in `docs/testing/2026-11-10-runner-migration-install-suites.md`.

Invoke by **absolute** path: the core binds every source frame to an absolute control
list, so a relative entry refuses with 77 before any lock, run directory or unit.

**History (pre-migration, 2026-11-09):** green rounds from #5 through #10, with 21
hashed inputs per round, five tarballs packed offline, an offline consumer install
and eight `ok` probe lines. The record is
[`../../docs/testing/2026-11-09-package-install.md`](../../docs/testing/2026-11-09-package-install.md);
it describes the pre-migration runners and is not evidence about these bytes.

Two scripts and this document. `run.sh` names the selected inputs and delegates one
transient unit to the core; `payload.sh` does the packing, installing and probing
inside it. The resource envelope, the shared lock, the two-point hash discipline, the
ownership receipt, the terminal readback and the exit-code vocabulary are the
**core's**, identical **on purpose**. What this batch still owns is the workload.

    bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/package-install/run.sh

No arguments; extra arguments are refused (`70`). **The path must be absolute.** The
core binds every active shell source frame to its absolute control list, so a
relative entry path is refused with `77` **before** the lock is taken, before a run
directory is created and before any unit is launched.

Run directories land in `${PACKAGE_INSTALL_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}`.
One run takes a few seconds and needs no network.

## The question one run answers

Do the four packages, packed as tarballs, install into a directory that has no
sibling checkout, and does every documented subpath then import **by package
specifier** and behave the same way it does inside the repository?

The packages are `@dsh-ecosystem`'s:

| directory | package | version |
|---|---|---|
| `packages/analyzer` | `dsh-compat-platform` | `0.0.0` |
| `packages/host` | `dsh-compat-diagnostics-ui` | `0.0.0-draft.1` |
| `packages/runtime` | `dsh-compat-trusted-extraction` | `0.0.0-draft.1` |
| `packages/repair` | `dsh-compat-repair` | `0.0.0-draft.1` |

The analyzer's single dependency, `yaml@2.9.1`, is packed from the copy the analyzer
already resolved and installed alongside — so the install is offline and the
dependency is the pinned one, not whatever a registry would hand over.

## Files

| file | role |
| --- | --- |
| `run.sh` | host-side launcher: refuses a bad invocation, names the selected inputs, delegates one unit to the core |
| `payload.sh` | in-unit payload: after the core's envelope receipt, parses, checks the static contract, packs, installs and probes |
| `consumer-check.mjs` | the probe the payload runs inside the consumer directory (selected input, not migrated) |
| `expect.json` | the probe's expectations (selected input, not migrated) |
| `README.md` | this document |

`run.sh`, `payload.sh` and `README.md` are control sources: the core hashes them, its
own five modules and its manifest, and refuses (`77`) if any of them cannot be read or
was invoked by a relative path. `consumer-check.mjs` and `expect.json` are **workload**
inputs, so the launcher names them in the selected set and the core hashes them twice.

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

The readback from inside the unit, the ownership receipt, the memory gate, the peak
readback and the evidence-write counter all live in
`scripts/bounded-runner/envelope.sh` and are entered with `br_envelope_enter` before
any subprocess starts. Any mismatch refuses (`70`/`73`); an unreadable value is a
mismatch, never a silent pass.

## What one run does

1. Enters the core's envelope receipt, which reads the cgroup limits and refuses
   unless they match: 384 MiB, swap 0, `TasksMax=32`, `CPUQuota=50%`,
   `RuntimeMaxSec=120`, plus one `MemAvailable >= 819200` KiB gate.
2. Parses the two scripts, `consumer-check.mjs` and `publish_audit.py`.
3. Static contract on the four manifests: names, versions, `private: true`,
   `type: module`, the analyzer's single exact `yaml` dependency and zero dependencies
   everywhere else, every `exports` target existing on disk, and each `files` list
   present.
4. `npm pack --offline` each package plus `yaml` inside a sandbox with only the
   artifact and npm-home directories writable. Five tarballs, hashed and
   size-recorded.
4b. **Publish readiness**: `publish_audit.py` opens each tarball and lists its regular
   files. Only `package/package.json`, `package/README.md` and `package/src/**` may
   appear; anything else is a violation and fails the step with `74`. It also records —
   never resolves — the decisions a public release would need: missing `license`,
   `private: true`, a placeholder version. Output: `publish-readiness.json/.txt`.
5. `npm install --offline --no-audit --no-fund <five tarballs>` into a fresh consumer
   directory whose `package.json` names nothing.
6. Runs `consumer-check.mjs` in the consumer directory: resolves each documented
   subpath through `createRequire(...).resolve`, asserts the resolved path is under
   that consumer's `node_modules`, checks installed versions, resolves `yaml@2.9.1`,
   calls `summarizeProfileDumpText` on a two-line fixture (expecting
   `profile-dump-summary/0.3-draft.1`, one entry) and `decideApply` on an invalid plan
   (expecting `refused` / `APPLY_PLAN_INVALID`).
7. The **missing-dependency probe**: copies the installed consumer, deletes
   `node_modules/yaml` from the copy, imports `dsh-compat-platform/profile-dump` there
   and requires the failure to be exactly `ERR_MODULE_NOT_FOUND`. A resolution that
   succeeds, or a different error code, fails the batch.
8. Verdict; the core records `memory.peak`/`pids.peak` and the payload receipt.

## The offline npm contract (unchanged)

Both npm invocations run inside `bwrap` with **only** the artifact directory, the
npm-home directory (and, for the install, the consumer directory) writable, under
`env -i` with a fixed `PATH`, `HOME="$NPMHOME"` and `TMPDIR=/tmp`:

```
npm pack    --offline --cache "$NPMHOME/cache" --pack-destination "$ART"
npm install --offline --cache "$NPMHOME/cache" --no-audit --no-fund "$ART"/*.tgz
```

`--offline` forbids any registry access (a missing cache entry is a failure, never a
fetch), and `--cache` is explicit and **inside a writable home** — npm writes lock
files and logs under `HOME`, so an unwritable or inherited home is exactly what this
construct must exclude. `--no-audit --no-fund` remove the two remaining network-touching
defaults. Nothing here retries.

## Exit codes

Payload:

- `0` green;
- `70` envelope/argument/precondition refusal;
- `71` a script or the probe does not parse, or the static contract failed;
- `72` pack, offline install, consumer probe or missing-dependency probe failed;
- `73` an evidence write failed;
- `74` a tarball carries a file outside its `files` allowlist (or its name cannot be
  matched to a manifest).

Launcher (relaying the core):

- `0` green;
- `70` refusal before or inside the launch;
- `71`/`72`/`73` relayed from the payload;
- `74` the unit did not settle (also the core's mapping of a launch timeout);
- `75` lock held;
- `76` run-directory collision;
- `77` a hash manifest or a control source could not be read, matched or written —
  including a **relative** entry path;
- `78` selected-input drift.

The pre-migration launcher used `71` for "the unit could not be started", `74`/`75`/`76`
for input drift / a still-loaded unit / an unsettled terminal, and `77`/`78` for "no
verdict" / "no run directory". Those meanings are **gone**: the codes are now the
core's and the same numbers no longer mean the same thing. In particular a launch that
cannot start is `70`, input drift is `78`, and an unsettled terminal is `74`.

## Artefacts (under `$RUN`)

Canonical, written by the core: `selection.txt`, `control-before.txt`,
`selected-before.txt`, `active-units.txt`, `argv.txt`, `requested.txt`, `unit.log`,
`launch.txt`, `systemd-run.rc`, `journal.txt`/`journal.rc`, `terminal-before.txt`,
`terminal-after-stop.txt`, `terminal.txt`, `stop.txt`, `ownership.txt`,
`ownership-systemctl.txt`, `envelope-systemctl.txt`, `envelope-getunit.txt`,
`envelope-runtime.txt`, `envelope-effective.txt`, `memory-gate.txt`,
`control-after.txt`, `selected-after.txt`, `control-diff.txt`, `selected-diff.txt`,
`payload-result.txt`, `payload-evidence.txt`, `peaks.txt`, `status.txt`.

Written by this payload: `syntax.txt`, `syntax-consumer.txt`, `static-contract.mjs`,
`static-contract.log`, `static-verdict.txt`, `pack-<label>.out|.err|.rc` (per
package, including `pack-yaml.*`), `pack-verdict.txt`, `tarballs.txt`,
`tarball-hashes.txt`, `tarball-file-counts.txt`, `install.out`, `install.err`,
`install-facts.txt`, `install-verdict.txt`, `consumer-check.txt`,
`consumer-check.err`, `consumer-verdict.txt`, `consumer-ok-count.txt`,
`missing-dep.txt`, `missing-dep.err`, `missing-dep-verdict.txt`, and the working
trees `artifacts/`, `npmhome/`, `consumer/`, `consumer-missing/`.

Changes relative to the pre-migration runner: envelope and peak records are the
core's names and shapes; `evidence-gate.txt` and the local write counter are gone
(the counter is `payload-evidence.txt`); the payload no longer writes its own
`journal.txt` or terminal-query files; `run.txt`/`tap-verdict.txt` are gone (there is
no TAP stream in this batch, and the verdict lives in `status.txt`); and
`hashes-before.txt`/`-after.txt` are replaced by the `control-*` and `selected-*`
pairs.

## Selected inputs (hashed before and after)

The launcher names 20 files; the core hashes them twice and reports drift as `78`:
`consumer-check.mjs`, `publish_audit.py`, `expect.json`, the four `packages/*/package.json`, the four
`packages/*/README.md`, `packages/analyzer/src/{profile-dump,dependency-shape,diagnose}.js`,
`packages/host/src/{index,envelope,page}.js`,
`packages/runtime/src/isolation-policy.js`, `packages/repair/src/repair-apply.js`, and
`packages/analyzer/node_modules/yaml/package.json`.

`run.sh` and `payload.sh` are **not** repeated there — they are control sources, which
the core hashes together with its manifest and its five modules.

The install **outputs** are deliberately not hashed: this run creates
`artifacts/`, `npmhome/` and `consumer/` under `$RUN`, outside the repository, so their
appearance is not drift.

## What one run does not establish

- **Nothing is published.** Every manifest stays `private: true`; `npm pack` produces a
  tarball, not a release. A green run says the tarball contents and the export map
  agree with what the probe imports — not that a registry would accept the package.
  The publish audit lists the decisions a release needs (license, `private`, version)
  and deliberately does not take any of them.
- **The consumer is this machine.** The probe runs on the same Node build as the
  packing side. A different Node, a different platform, or a real dependency tree could
  behave differently.
- **`files` is not audited.** The static contract checks that a `files` list exists; the
  probe checks that the subpaths it imports are present. Nothing checks that every file
  a consumer might want is in the tarball.
- **No host, no plugin, no profile.** No DSH process is started and no profile is read.
  The `decideApply` call is a pure refusal path; nothing is written.
- **Not the full test suite.** This batch runs one probe; the packages' own suites are
  separate records.
- **The missing-dependency probe says nothing about the analyzer's runtime.** It shows
  that removing `yaml` makes the documented subpath fail with
  `ERR_MODULE_NOT_FOUND` instead of resolving from a stray ancestor copy — no more.

## Deviations this batch carries

- **The `run.sh` and `payload.sh` files were mode `600`** when first written; they were
  made `755` before the first run. File modes are not part of the sha256 manifest.
- **`npm pack` writes a tarball name** derived from the manifest; the probe does not
  depend on the file name, only on what `npm install` resolves from the five paths.
- **The consumer directory is inside the run directory**, so the tarballs and the
  installed tree live under the same run root that holds the evidence.
- **One package has a dependency.** `yaml` is packed from
  `packages/analyzer/node_modules/yaml`; if that directory is missing the pack step
  fails rather than falling back to a registry.
- **`install-facts.txt` shells out to a bare `node`** (not the absolute `$NODE` the
  rest of the payload uses) to read the installed `package.json` version. This is kept
  verbatim from the pre-migration payload because it is what was executed; on this host
  `/usr/bin/node` is a symlink to `/www/server/nodejs/v24.21.0/bin/node`, so it
  resolves, and the step's own failure is non-fatal (the version is also asserted by
  the probe). It is a latent PATH dependency, not a proven-portable construct.

## Changes in this migration (for the reviewer)

- The launcher no longer computes unit names, hashes, terminal state, journal, peaks or
  the verdict: it validates its own invocation, names its selected inputs, and hands one
  launch to `br_host_run`. Its preflight still checks `bwrap`, the node and npm
  binaries, and the four package directories, because a missing package is a refusal
  (`70`), not a workload failure.
- The payload's argument contract is now exactly two arguments (`unit`, `run`), as the
  canonical host launches it.
- The payload's own envelope readback, memory gate, evidence counter, peak readback and
  terminal verdict are gone, replaced by `br_envelope_enter`, `br_evidence_gate`,
  `br_peaks` and `br_payload_finish`.
- Evidence writes go through `br_record`; a failed write is the core's `73` instead of a
  locally incremented counter, and it now outranks a green workload verdict.
- `static-contract.mjs`, `consumer-check.mjs`, `expect.json`, the `bwrap` sandboxes, the
  `npm pack`/`npm install` argv, the five-tarball requirement, the eight-`ok` probe
  assertion and the missing-dependency probe are **byte-for-byte** the pre-migration
  behaviour.

## Two standards, and why

The audit answers two different questions and no longer conflates them:

* `--standard private` (default) — the roadmap's target is a **private** release candidate
  (P5), so `"private": true` is the intended state and is **not** a blocker. Missing fields,
  placeholder versions and an undecided licence still block.
* `--standard public` — `"private": true` becomes a blocker, because it would silently
  prevent the publish.

The standard is recorded in the document and in every package row, and `public` is now the
default. On the current bytes **both standards report 0 blockers on all five packages**:
`private` was cleared on explicit approval on 2026-11-10, so `PRIVATE_FLAG_SET` no longer
fires. The `private` standard is kept because the roadmap literally asked for a private
candidate and a future reader should be able to re-measure that state.

`@dsh-compat/config-check` is packed into `tarballs-own/` and audited from there: its two
`@hyperjump/*` peers are not installed on this machine, so it cannot join the offline consumer
install. Its tarball and manifest are still audited; its installability is not claimed.
