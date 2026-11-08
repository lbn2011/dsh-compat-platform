# Raw acceptance runs — index only

The original run directories **remain in this folder on the maintainer's machine**
but are excluded from Git. They are raw execution artifacts (payload scripts,
argv dumps, unit logs, hash manifests) whose value is as preserved evidence, not
as source, so they are not committed.

An identical, unmodified copy is kept outside the repository:

```
/data/dsh-ecosystem-test-artifacts/projects/dsh-compat-platform/docs/testing/runs/
  ├─ 20261103T153921Z-evidence-diagnostics/
  └─ 20261103T153921Z-evidence-diagnostics-recheck/
     (2 run directories, 17 files)
```

That external directory is **local storage on the maintainer's machine, not a
downloadable resource**. It is not on GitHub, not in any archive, and a person who
clones this repository has no access to it by default. It exists so the evidence
survives outside the Git history; it is not a reproduction input.

The path under `/data/dsh-ecosystem-test-artifacts/` mirrors the repository
relative path exactly, so a link such as
`docs/testing/runs/20261103T153921Z-evidence-diagnostics/` in a record resolves at
`/data/dsh-ecosystem-test-artifacts/projects/dsh-compat-platform/docs/testing/runs/20261103T153921Z-evidence-diagnostics/`.

A per-file manifest, `/data/dsh-ecosystem-test-artifacts/SHA256SUMS` (284 entries
covering all three source trees), was verified with
`sha256sum -c --quiet /data/dsh-ecosystem-test-artifacts/SHA256SUMS`. The
originals are still in place next to this file; nothing was moved or deleted, and
every copied file was compared against its original by digest.

Runs of the `analyzer-test-script` and `profile-export-real` batches never lived
here — they were produced under the parent checkout's
`experiments/acceptance/runs/` and are stored in the same external root under
`experiments/acceptance/runs/<run-id>/`. The records in this repository link to
them by that path.

## What this means for reading a record

- Numbers quoted in `docs/testing/*.md` are **historical**: measured in the runs
  named there, on the bytes recorded there. Nothing here was re-run.
- A record's raw-evidence links may point at paths that are now outside the
  repository. The external directory is the authority for those bytes; the
  repository keeps the narrative record only.
- Absence of a run directory here is not evidence that a run did not happen — it
  only means the artifacts are external.

The external copy covers this repository's `docs/testing/runs/` plus the parent's
`experiments/acceptance/runs/` only. It is **not a complete archive of the parent
checkout's experiment history**: other parent experiment trees and their run
directories remain local to the maintainer's machine and are not distributed.

## Reproduction limits

These runs are not reproducible from this repository alone. They depended on:

- the **parent checkout** (`/root/dsh-ecosystem-spec`): the acceptance harnesses
  under `experiments/acceptance/` (envelope, locking, hash accounting) are not
  distributed with this repository, and the external evidence root holds run
  outputs, not harnesses;
- **sibling repositories**, notably `projects/dsh-compat-spec`, whose
  `src/admission-evidence.js` is imported at test time by relative path — the
  analyzer's admission CLI tests fail, rather than skip, when it is absent;
- a specific host, systemd unit envelope, Node version and kernel/CPU state
  recorded per run.
