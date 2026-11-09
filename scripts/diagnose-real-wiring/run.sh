#!/bin/bash
# Host-side launcher for the `diagnose` ↔ real `dsh-compat-spec` wiring batch.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1,
# core commit c8123de). Awaiting Lead bounded verification. These bytes have not
# been executed, syntax-qualified, sourced or launched; no unit, no workload.
#
# Scope: ONE transient unit, one workload, no retry. The envelope, the shared
# lock, the two-point hash discipline, the terminal-state readback and the
# exit-code vocabulary now live in scripts/bounded-runner and are NOT restated
# here. What this wrapper owns is the workload name and the selected inputs —
# this batch exercises the `dsh-compat-diagnose` CLI as a **real child process**
# against the **real** `dsh-compat-spec` validators.
#
# PRECONDITION, NOT PERFORMED HERE: the workload (the CLI, transitively through the
# profile summarizer) imports `yaml`. This runner never installs anything. If the
# dependency does not already resolve to exactly 2.9.1 from the analyzer package,
# the payload refuses (71) before the workload starts. It also needs a sibling
# checkout of `projects/dsh-compat-spec`; if it is absent the wrapper refuses (70)
# before any unit is created.
#
# Usage:  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnose-real-wiring/run.sh
#         Takes no arguments. Invoke it by ABSOLUTE path: the core binds every
#         active source frame to the absolute control list, so a relative entry
#         path is refused (77) before any unit is created.
#
# Exit codes (host, from the core): 0 green; 70 refusal before or inside the
# launch; 71 static contract or dependency precondition failed (no workload was
# started); 72 a case, the TAP summary or the test file did not match; 73 an
# evidence write failed; 74 the unit did not settle; 75 lock held; 76
# run-directory collision; 77 a hash manifest/source frame could not be read,
# matched or written; 78 selected-input drift.
#
# Payload: 0 green, 70 envelope/argument refusal, 71 static contract or
# dependency precondition, 72 assertion mismatch, 73 evidence write failed.

set +e
set -uo pipefail
(
  # Dedicated host subshell owns the core lock descriptor; never enable errexit.
  set +e
  set -uo pipefail
  ROOT=/root/dsh-ecosystem-spec
  REPO=$ROOT/projects/dsh-compat-platform
  PKG=$REPO/packages/analyzer
  SLICE=$REPO/scripts/diagnose-real-wiring
  SPEC=$ROOT/projects/dsh-compat-spec
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  # Raw artifacts live OUTSIDE the repository; only the narrative record is committed.
  RUNS=${DIAGNOSE_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  command -v bwrap >/dev/null 2>&1 || exit 70
  [ -x "$NODE" ] || exit 70
  # No additional sourced control file: this payload imports core modules only.
  BR_EXTRA_CONTROL=()
  # The payload's only non-green exits are its refusals, mismatches and its
  # dedicated test-file code; 73 and 74 are declared so the launcher relays them
  # instead of collapsing them to 70.
  BR_WORKLOAD_EXITS=(0 70 71 72 73 74)
  # The single workload file the static contract requires to be present in the
  # suite's glob. This file is the subject of the batch.
  TEST_FILES=(
    tests/diagnose-spec-wiring.test.js
  )
  # SELECTED INPUTS: everything the verdict depends on that lives in THIS repo.
  # run.sh and payload.sh are NOT repeated here — the core hashes them as control
  # sources, together with the manifest and all five modules.
  BR_SELECTED_INPUTS=(
    "$PKG/package.json"
    "$PKG/src/diagnose-cli.js"
    "$PKG/src/diagnose-internal.js"
    "$PKG/src/diagnose.js"
    "$PKG/src/diagnose.d.ts"
    "$PKG/src/runtime-evidence.js"
    "$PKG/src/combined-report.js"
    "$PKG/src/combined-cli.js"
    "$PKG/src/profile-dump.js"
    "$PKG/src/evidence-cli.js"
    "$REPO/examples/diagnose/profile.yml"
    "$REPO/examples/diagnose/runtime-evidence.json"
    "$REPO/examples/diagnose/admission-evidence.json"
    "$REPO/examples/diagnose/README.md"
    "$PKG/fixtures/clean.json"
    "$PKG/fixtures/invalid-declaration.json"
  )
  for t in "${TEST_FILES[@]}"; do BR_SELECTED_INPUTS+=("$PKG/$t"); done
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  # The sibling `dsh-compat-spec` sources and fixtures are DELIBERATELY OUTSIDE
  # this selection: they are another repository's bytes, not this repo's. They
  # are still verified to exist, because an absent sibling is a hard refusal and
  # never a skip.
  SPEC_INPUTS=(
    "$SPEC/src/index.js"
    "$SPEC/src/admission-evidence.js"
    "$SPEC/conformance/positive/01-minimal-tool.json"
  )
  for f in "${SPEC_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" diagnose-real-wiring
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
