#!/bin/bash
# Host-side launcher for the packaging acceptance batch (S5).
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1,
# core commit c8123de). Awaiting Lead bounded verification. These bytes have not
# been executed, syntax-qualified, sourced or launched; no unit, no workload.
#
# Scope: ONE transient unit, one workload, no retry. One question:
#   Do the four platform packages still work when they are packed into tarballs and
#   installed into a directory that has no sibling checkout on disk?
#
# The envelope, the shared lock, the two-point hash discipline, the terminal-state
# readback and the exit-code vocabulary now live in scripts/bounded-runner and are
# NOT restated here. What this wrapper owns is the workload name and the selected
# inputs.
#
# The consumer imports every documented subpath by package specifier, and each resolved
# module path is checked to live under the consumer's own node_modules. Nothing here
# publishes anything: `npm pack` writes a tarball, `npm install` puts it in a throwaway
# directory, and both stay inside the run.
#
# PRECONDITION, NOT PERFORMED HERE: `npm pack`/`npm install` run with `--offline` and
# an explicit `--cache` under a writable HOME inside the run directory, so a missing
# tarball fails instead of being downloaded. npm and node are taken from the pinned
# absolute paths below, never from the caller's PATH.
#
# Usage:  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/package-install/run.sh
#         Takes no arguments. Invoke it by ABSOLUTE path: the core binds every
#         active source frame to the absolute control list, so a relative entry
#         path is refused (77) before any unit is created.
#
# Exit codes (host, from the core): 0 green; 70 refusal before or inside the
# launch; 71 static contract failed (nothing was packed); 72 a pack/install/probe
# step failed; 73 an evidence write failed; 74 the unit did not settle; 75 lock
# held; 76 run-directory collision; 77 a hash manifest/source frame could not be
# read, matched or written; 78 selected-input drift.
#
# Payload: 0 green, 70 envelope/argument refusal, 71 static contract failed,
# 72 a step failed, 73 evidence write failed.

set +e
set -uo pipefail
(
  # Dedicated host subshell owns the core lock descriptor; never enable errexit.
  set +e
  set -uo pipefail
  ROOT=/root/dsh-ecosystem-spec
  REPO=$ROOT/projects/dsh-compat-platform
  SLICE=$REPO/scripts/package-install
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  NPM=/www/server/nodejs/v24.21.0/bin/npm
  # Raw artifacts live OUTSIDE the repository; only the narrative record is committed.
  RUNS=${PACKAGE_INSTALL_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  command -v bwrap >/dev/null 2>&1 || exit 70
  [ -x "$NODE" ] || exit 70
  [ -x "$NPM" ] || exit 70
  for d in analyzer host runtime repair; do
    [ -d "$REPO/packages/$d" ] || exit 70
  done
  # No additional sourced control file: this payload imports core modules only.
  BR_EXTRA_CONTROL=()
  # The payload's only non-green exits are refusals (70), a failed static contract
  # (71), a failed pack/install/probe step (72) and an evidence failure (73). All
  # four are declared so the launcher relays them instead of collapsing them to 70.
  BR_WORKLOAD_EXITS=(0 70 71 72 73)
  # SELECTED INPUTS: the probe, its expectations, the four manifests, the four
  # READMEs, every module the consumer imports, and the tarball source for the one
  # dependency. run.sh and payload.sh are NOT repeated here — the core hashes them
  # as control sources, together with the manifest and all five modules. This is a
  # named selection, not a dependency closure.
  BR_SELECTED_INPUTS=(
    "$SLICE/consumer-check.mjs"
    "$SLICE/publish_audit.py"
    "$SLICE/expect.json"
    "$REPO/packages/analyzer/package.json"
    "$REPO/packages/analyzer/README.md"
    "$REPO/packages/host/package.json"
    "$REPO/packages/host/README.md"
    "$REPO/packages/runtime/package.json"
    "$REPO/packages/runtime/README.md"
    "$REPO/packages/repair/package.json"
    "$REPO/packages/repair/README.md"
    "$REPO/packages/analyzer/src/profile-dump.js"
    "$REPO/packages/analyzer/src/dependency-shape.js"
    "$REPO/packages/analyzer/src/diagnose.js"
    "$REPO/packages/host/src/index.js"
    "$REPO/packages/host/src/envelope.js"
    "$REPO/packages/host/src/page.js"
    "$REPO/packages/runtime/src/isolation-policy.js"
    "$REPO/packages/repair/src/repair-apply.js"
    "$REPO/packages/analyzer/node_modules/yaml/package.json"
  )
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" package-install
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
