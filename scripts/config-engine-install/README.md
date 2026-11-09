# Config-engine dependency acquisition — PREPARED, NOT EXECUTED

Preparation only. No install, Node invocation, syntax check, tests, transient unit,
registry request or commit was performed for these files. This is not authorization
to run them. No lock exists yet; transitive dependencies are NOT reviewed or pinned.

> **Bounded reproduction authorized; qualification still on hold (2026-11-10):** the user authorized a bounded local reproduction before any semantic patch. Source review of Hyperjump 1.18.0 found identifier processing inside data literals (`const`, `enum`, `default`, `examples`); see upstream PR 125. No local counterexample has been executed. This authorization is not candidate qualification or permission to skip acquisition's preparatory gates, staged online approval, lock review, or terminal/evidence checks below. This slice only prepares acquisition; it implements and runs no reproduction workload. Do not work around the suspected defect by rejecting otherwise legal literal data.

## Boundary

The private ESM [package manifest](../../packages/config-check/package.json) targets
Node >=24.9.0 and has no scripts (including lifecycle scripts). Exact candidate
versions: `@hyperjump/json-schema@1.18.0`, `@hyperjump/browser@1.6.0`.
`yaml@2.9.1` is deliberately omitted until a future profile-AST requirement needs it.
This prepares a dependency boundary for a full JSON Schema 2020-12 checker separate
from the zero-dependency spec; it implements no checker and proves no conformance.
The existing install-once YAML target is neither called nor modified.

[run.sh](run.sh) is a local adaptation of the strong correspondence-batch launcher;
[payload.sh](payload.sh) retains its strict envelope readback and memory gate.
[acquire.sh](acquire.sh) contains the online npm operations, and
[inspect.mjs](inspect.mjs) reads manifest/lock metadata without importing packages.
No dependency on the concurrently developed shared bounded-runner exists. Migrate
only after that core is stable and reviewed, preserving these stage/input/output gates.

## Exact review/run sequence (future, separately authorized)

1. Read all five control files and the manifest. Review shell, JS, toolchain paths,
   systemd/bubblewrap support, registry policy and filesystem mounts. Do not execute
   anything merely because this preparation exists. Syntax checks/tests need separate
   authorization too. There is no fallback if a prerequisite fails.
2. Obtain explicit approval for ONE online lock-resolution stage. From the repository
   root, the future command is:

   ```bash
   bash projects/dsh-compat-platform/scripts/config-engine-install/run.sh resolve
   ```

   Exactly one transient unit runs. npm uses `install --package-lock-only
   --ignore-scripts --no-audit --no-fund`, not a production install. The printed
   external run directory contains `work/package-lock.json`, metadata and logs.
3. STOP. Require `acceptance_exit=0`, identical control hashes, complete evidence and
   settled terminal state. Human-review the entire lock graph: names, exact versions,
   root/direct version agreement, resolved registry URLs, canonical base64 SHA-512
   integrity (exactly 64 decoded bytes), available license and optional/platform
   fields, install-script flags and unexpected additions. Compare the two direct
   registry metadata records, including their lifecycle declarations, to the lock.
   This is lock/direct-metadata review, NOT full transitive lifecycle inspection:
   complete transitive package manifests/lifecycle declarations are unavailable to
   this review until packages are acquired with scripts suppressed. Missing lock
   flags are not proof of script absence. Integrity binds bytes, not safety.
   Review npm/node versions and effective config. Record the reviewed lock's absolute
   path and literal SHA-256 in an external review record. Do not auto-feed resolver
   output into acquisition. A digest alone does not establish that review happened.
4. Obtain explicit approval for ONE online acquisition stage using those reviewed bytes:

   ```bash
   bash projects/dsh-compat-platform/scripts/config-engine-install/run.sh acquire /absolute/reviewed/package-lock.json REVIEWED_64_LOWERCASE_HEX_SHA256
   ```

   Replace both placeholders with independently reviewed values. Missing, malformed,
   changed, or unapproved-source locks fail closed; supplied digest is a caller review
   attestation, not a cryptographically signed approval. The stage copies the manifest
   and lock to a NEW disposable directory and invokes `npm ci --ignore-scripts
   --no-audit --no-fund`. It does not reuse the resolver cache. Lock bytes must remain
   identical afterwards; npm's dependency consistency validation must succeed.
5. STOP again and review status, terminal confirmation, hashes, lock inventory,
   installed-tree metadata and npm evidence. Inspect acquired transitive manifests
   and lifecycle declarations as data, without importing packages or running scripts.
   `npm ls --all --json` is inventory evidence, not an installed-tree closure proof;
   no complete acquired-file hash manifest or lock-to-installed-file closure is
   produced here. Retain artifacts for review. There is no
   promotion/copy-back/deployment/cleanup step. Cleanup of a verified absolute run path
   needs a separate decision. Any failure ends that attempt; no retries, repair loops,
   cache reuse or automatic re-launch. A new attempt requires fresh approval.

## Limits and fail-closed evidence

Each invocation takes the existing shared nonblocking acceptance lock at
`/root/dsh-ecosystem-spec/experiments/acceptance/runs/.acceptance.lock`, refuses active
known batch families, then starts one `Type=exec` unit. Effective cgroup readback:
`memory.max=402653184` (384 MiB), `memory.swap.max=0`, `pids.max=32`,
`cpu.max=50000 100000`; D-Bus readback `RuntimeMaxUSec=120000000`.
Ambiguous/unreadable limits refuse. One `MemAvailable >=819200 KiB` gate per stage,
no waiting for memory. Every Node/npm process has `--max-old-space-size=192`.
`KillMode=control-group`, stop timeout 10s; launcher outer timeout 200s only accommodates
unit cleanup, not additional workload time. Terminal success needs successful query,
allowed load state, inactive/dead or failed/failed, and MainPID=0. Attempted launch
is not ownership: this adapter has no proven InvocationID receipt and never issues
an automatic stop of a potentially foreign same-name unit. Any unsettled or
unreadable terminal state remains unconfirmed and non-successful. The launched
unit's configured runtime/stop policy is distinct from launcher-initiated cleanup;
ownership-safe cleanup remains separate shared-core work.

Prelaunch evidence failure prevents launch; envelope evidence failure prevents npm;
`set -e` stops the inner stage on any command/evidence write failure. Required evidence
files, before/after hashes and final status are checked. No syntax checks or tests are
embedded in the future acquisition workload. Exit 0 means acquisition evidence only,
not tests or checker acceptance. Other exits: 70 prerequisite, 71 contract, 72 acquisition,
73 evidence, 74 unsettled/timeout, 75 held lock, 76 collision, 77 hash error, 78 drift.

## Immutable inputs versus declared mutable outputs

Immutable selected inputs, hashed before/after: launcher, payload, acquisition script,
inspection module, this README, source package manifest, fixed Node binary and npm CLI
entry file. Acquisition additionally hashes the preexisting reviewed lock. This is a
selected control set, NOT a full OS/npm/toolchain or installed-tree closure. All npm
operations explicitly invoke `/opt/node/bin/node` with
`/opt/node/lib/node_modules/npm/bin/npm-cli.js`; the read-only distribution mount
maps these to the hashed host originals under `/www/server/nodejs/v24.21.0`.
Neither PATH-selected npm nor an npm shebang selects the executable. No newly
generated lock is mistakenly included in the preexisting-input manifest.

Declared artifact outputs: fresh `/data/dsh-ecosystem-test-artifacts/runs/<unique-run>/`,
including launcher/payload logs, envelope/gate/terminal/argv/status evidence and
`work/` (copied manifest, generated or copied lock, isolated home/cache/tmp/prefix,
empty user/global npm configs, npm metadata, inventory, npm logs and acquired modules).
This is NOT an all-effects-contained-in-run-directory guarantee. The existing shared
lock is opened without truncation and its advisory lock state changes outside that
directory. systemd transient-unit state, cgroups, journal records and manager/runtime
bookkeeping also affect the host outside it; the runs parent may be created. There
is no disk quota or disk-usage bound for artifacts, cache, logs or extracted packages.
No package lock, node_modules, config, cache or home is written in the checkout or to
production. The launcher/payload are trusted host-side controls, not hostile-code
sandboxes; review their writes as well as the npm sandbox.

The npm sandbox uses minimal read-only mounts of system libraries, CA certificates,
DNS/hosts files, fixed Node distribution and controls, plus a single writable `work/`
bind. Private user/pid/ipc/uts namespaces, private proc/dev, dropped capabilities and
die-with-parent are requested. Host homes, credentials, repository and system bus
are not mounted. Namespace root maps to the launching identity so it can write its
run-owned directory; this is not a promise of non-root host identity. Review local
bubblewrap/user-namespace semantics before approval. `env -i` excludes inherited npm
configuration, proxy/token environment and NODE_OPTIONS; HOME/cache/user/global config
are explicit and clean. npm fetch retries are zero, request timeout 30s, registry is
explicit, scripts/audit/funding/update notification disabled, engine checks strict.

Network is intentionally ONLINE for metadata and tarballs, with no network namespace
isolation. Registry config and lock URL checks are not a network egress firewall;
redirects/DNS are not an origin-security guarantee. No real profiles or secrets enter
this sandbox. Future checker execution MUST be a separately reviewed OFFLINE stage
(with networking disabled and controlled schema-resource resolution); not provided here.

## Safety review checklist and nonclaims

- [ ] All changed paths remain inside this new script slice and the new manifest.
- [ ] Fixed Node/npm paths, npm bundled configuration and complete toolchain are trusted.
- [ ] Namespace mounts and writable-output boundary are supported and appropriate.
- [ ] Shared lock, active-family guard, effective limits and one memory gate reviewed.
- [ ] Before/after input hashes, evidence failure handling and terminal handling reviewed.
- [ ] Online access separately authorized; no schema checker runs during acquisition.
- [ ] Resolver output reviewed before recording digest and authorizing npm ci.
- [ ] Full lock graph and available lock/direct metadata/integrity/licenses reviewed
      before acquisition; full transitive lifecycle declarations reviewed as data
      only after scripts-suppressed acquisition. Direct pins do not imply safety.
- [ ] Advisory-lock/systemd host effects, no disk quota, no egress firewall and no
      installed-tree closure proof are understood; no automatic stop without ownership.
- [ ] Lifecycle execution suppressed; no source-tree install, retries, promotion or
      YAML-target change.

Prepared does not mean parsed, executed, tested, installed, reproducible, safe against
all hostile npm/toolchain behavior, standards-conformant, offline-ready or production-ready.
