# `package-install` — pack the four packages and install them somewhere else

Two scripts. `run.sh` opens one transient systemd unit under fixed limits, hashes the
selected inputs, and calls `payload.sh` inside it.

```
bash projects/dsh-compat-platform/scripts/package-install/run.sh
```

Run directories land in `/data/dsh-ecosystem-test-artifacts/runs` (override with
`PACKAGE_INSTALL_RUNS_ROOT`). One run takes a few seconds and needs no network.

## The question one run answers

Do the four packages, packed as tarballs, install into a directory that has no sibling
checkout, and does every documented subpath then import **by package specifier** and
behave the same way it does inside the repository?

The packages are `@dsh-ecosystem`'s:

| directory | package | version |
|---|---|---|
| `packages/analyzer` | `dsh-compat-platform` | `0.0.0` |
| `packages/host` | `dsh-compat-diagnostics-ui` | `0.0.0-draft.1` |
| `packages/runtime` | `dsh-compat-trusted-extraction` | `0.0.0-draft.1` |
| `packages/repair` | `dsh-compat-repair` | `0.0.0-draft.1` |

The analyzer's single dependency, `yaml@2.9.1`, is packed from the copy the analyzer
already resolved and installed alongside — so the install is offline and the dependency
is the pinned one, not whatever a registry would hand over.

## What one run does

1. Checks its own cgroup limits and refuses unless they match: 384 MiB, swap 0,
   `TasksMax=32`, `CPUQuota=50%`, `RuntimeMaxSec=120`. One `MemAvailable >= 819200` KiB
   gate, read once, before any workload starts.
2. Parses the two scripts and `consumer-check.mjs`.
3. Static contract on the four manifests: names, versions, `private: true`,
   `type: module`, the analyzer's single exact `yaml` dependency and zero dependencies
   everywhere else, every `exports` target existing on disk, and each `files` list
   present.
4. `npm pack --offline` each package plus `yaml` inside a sandbox with only the artifact
   and npm-home directories writable. Five tarballs, hashed and size-recorded.
5. `npm install --offline --no-audit --no-fund <five tarballs>` into a fresh consumer
   directory whose `package.json` names nothing.
6. Runs `consumer-check.mjs` in the consumer directory: resolves each documented subpath
   through `createRequire(...).resolve`, asserts the resolved path is under that
   consumer's `node_modules`, checks installed versions, resolves `yaml@2.9.1`, calls
   `summarizeProfileDumpText` on a two-line fixture (expecting
   `profile-dump-summary/0.2-draft.1`, one entry) and `decideApply` on an invalid plan
   (expecting `refused` / `APPLY_PLAN_INVALID`).
7. Records `memory.peak` and `pids.peak` from the unit's own cgroup.

## What one run does not establish

- **Nothing is published.** Every manifest stays `private: true`; `npm pack` produces a
  tarball, not a release. A green run says the tarball contents and the export map agree
  with what the probe imports — not that a registry would accept the package.
- **The consumer is this machine.** The probe runs on the same Node build as the packing
  side. A different Node, a different platform, or a real dependency tree could behave
  differently.
- **`files` is not audited.** The static contract checks that a `files` list exists; the
  probe checks that the subpaths it imports are present. Nothing checks that every file a
  consumer might want is in the tarball.
- **No host, no plugin, no profile.** No DSH process is started and no profile is read.
  The `decideApply` call is a pure refusal path; nothing is written.
- **Not the full test suite.** This batch runs one probe; the packages' own suites are
  separate records.

## Exit codes

`run.sh` (launcher):

| code | meaning |
|---|---|
| 0 | unit ran, payload green |
| 70 | preflight refused (missing file, bad argument, limit readback, unit name) |
| 71 | the unit could not be started or its limits were not applied |
| 72 | the payload reported a failed step |
| 73 | the payload reported an evidence write failure |
| 74 | a hashed input changed during the run |
| 75 | the transient unit was still loaded after the run |
| 76 | the terminal state was not settled |
| 77 | the payload produced no verdict |
| 78 | the run directory was not created |

`payload.sh`:

| code | meaning |
|---|---|
| 0 | verdict `pass` |
| 70 | envelope mismatch (limits, cgroup values, memory gate) |
| 71 | static contract failed |
| 72 | pack, install, or consumer probe failed |
| 73 | an evidence write failed |

## Artefacts in one run directory

`envelope-cgroup.txt`, `envelope-systemctl.txt`, `envelope-busctl-path.txt`,
`envelope-busctl.txt`, `envelope-effective.txt`, `envelope-verdict.txt`,
`memory-gate.txt`, `syntax.txt`, `static-contract.mjs`, `static-contract.log`,
`static-verdict.txt`, `pack-<label>.out|.err|.rc`, `pack-verdict.txt`,
`tarball-hashes.txt`, `tarball-file-counts.txt`, `install.out`, `install.err`,
`install-verdict.txt`, `consumer-check.txt`, `consumer-check.err`,
`consumer-verdict.txt`, `consumer-ok-count.txt`, `peaks.txt`, `hashes-before.txt`,
`hashes-after.txt`, plus `run.txt`, `tap-verdict.txt` and the launcher's own logs.

## Deviations this batch carries

- **The `run.sh` and `payload.sh` files were mode `600`** when written; they were made
  `755` before the first run. File modes are not part of the sha256 manifest.
- **`npm pack` writes a tarball name** derived from the manifest; the probe does not
  depend on the file name, only on what `npm install` resolves from the five paths.
- **The consumer directory is inside the run directory**, so the tarballs and the
  installed tree live under the same run root that holds the evidence.
- **One package has a dependency.** `yaml` is packed from
  `packages/analyzer/node_modules/yaml`; if that directory is missing the pack step fails
  rather than falling back to a registry.
