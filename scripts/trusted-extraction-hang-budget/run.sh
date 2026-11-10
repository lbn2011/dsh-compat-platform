#!/bin/bash
# Host-side launcher for one bounded observation of the shipped phase budget.
#
# What this closes: the trusted-extraction batch proves the kill path with a 3 s
# demo budget, leaving the shipped 80 s phase budget covered only by an
# arithmetic inequality. This batch runs the same wedged fixture under the
# policy's own BUDGET and records what actually happened.
#
# Invoke by ABSOLUTE path: the core binds every active source frame to the
# absolute control list, so a relative entry path is refused (77) before any unit.
#
# Exit codes (from the core): 0 green; 70 refusal before or inside the launch;
# 72 unused by this payload; 73 an evidence write failed or an isolation gate
# refused; 74 the shipped budget did not time out, the receipt was not
# incomplete/unconfirmed, or the unit did not settle; 75 lock held; 76 run
# directory collision; 77 a hash manifest/source frame could not be read or
# written; 78 selected-input drift.

set +e
set -uo pipefail
(
  # Dedicated host subshell owns the core lock descriptor; never enable errexit.
  set +e
  set -uo pipefail
  ROOT=/root/dsh-ecosystem-spec
  REPO=$ROOT/projects/dsh-compat-platform
  SLICE=$REPO/scripts/trusted-extraction-hang-budget
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  RUNS=${TRUSTED_EXTRACTION_HANG_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  command -v bwrap >/dev/null 2>&1 || exit 70
  [ -x "$NODE" ] || exit 70
  BR_EXTRA_CONTROL=()
  # This payload's non-green exits are 70 (envelope/syntax/static), 73 (isolation
  # gates, evidence) and its own 74 (shipped-budget attestation, unsettled unit).
  BR_WORKLOAD_EXITS=(0 70 73 74)
  # SELECTED INPUTS: the policy module whose BUDGET is the subject of this batch,
  # the supervisor and receipt it exercises, the failure-path probe, and the
  # wedged fixture. run.sh and payload.sh are control sources; the DSH
  # installation being exercised is outside this repository and is not hashed.
  BR_SELECTED_INPUTS=(
    "$REPO/packages/runtime/package.json"
    "$REPO/packages/runtime/src/isolation-policy.js"
    "$REPO/packages/runtime/src/child-probe.js"
    "$REPO/packages/runtime/src/trusted-extraction-supervisor.js"
    "$REPO/packages/runtime/src/trusted-extraction-receipt.js"
    "$REPO/scripts/trusted-extraction-batch/failure-paths.mjs"
    "$REPO/examples/trusted-extraction/config-hang.yml"
    "$REPO/examples/trusted-extraction/plugin-hang.mjs"
  )
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" trusted-extraction-hang
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
