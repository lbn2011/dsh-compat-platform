#!/bin/bash
# Host-side launcher for the second-version observation batch.
#
# Scope: ONE transient unit, one workload, no retry. One question:
#   Does the runtime this repository's fixture observation was built on (the installed
#   0.2.2-rc.1) and a *published older* release (0.2.2-alpha.2) reach the same per-entry
#   verdicts for the same three fixtures, when the same adapter observes both?
#
# The alpha.2 dependency closure is NOT assembled here. It is a pinned artefact under
# /data/dsh-ecosystem-test-artifacts/closures/alpha2-0.2.2-alpha.2, because assembling it
# takes 3m26s — more than three times the 120 s envelope. This batch therefore has NO
# network step: it observes a closure that already exists, and refuses (72) if that
# closure's manifest does not match the recorded digest.
#
# Usage:  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-observe/run.sh
#         Takes no arguments. Invoke it by ABSOLUTE path (77 otherwise).
#
# Exit codes (host, from the core): 0 green; 70 refusal; 71 static contract failed;
# 72 a step failed; 73 an evidence write failed; 74 the unit did not settle; 75 lock
# held; 76 run-directory collision; 77 control/selected frame unreadable; 78 drift.
# Payload: 0 green, 70/71/72/73 as above.

set +e
set -uo pipefail
(
  set +e
  set -uo pipefail
  ROOT=/root/dsh-ecosystem-spec
  REPO=$ROOT/projects/dsh-compat-platform
  SLICE=$REPO/scripts/second-version-observe
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  RUNS=${SECOND_VERSION_OBSERVE_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  [ -x "$NODE" ] || exit 70
  BR_EXTRA_CONTROL=()
  BR_WORKLOAD_EXITS=(0 70 71 72 73)
  BR_SELECTED_INPUTS=(
    "$SLICE/compare.mjs"
    "$SLICE/payload.sh"
    "$REPO/packages/runtime/src/trusted-extraction-adapter.js"
    "$REPO/packages/runtime/src/trusted-extraction-receipt.js"
    "$REPO/examples/trusted-extraction/config.yml"
    "$REPO/examples/trusted-extraction/plugin-ok.mjs"
    "$REPO/examples/trusted-extraction/plugin-import-throw.mjs"
    "$REPO/examples/trusted-extraction/plugin-activate-throw.mjs"
  )
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" second-version-observe
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
