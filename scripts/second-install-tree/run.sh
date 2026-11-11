#!/bin/bash
# Host-side launcher for the second-install-tree batch (dev plan S6, second cell).
#
# Scope: ONE transient unit, one workload, no retry. One question:
#   The published 0.2.2-alpha.2 has a dependency closure; if that closure is placed
#   under the release's own directory as node_modules, does a runtime receipt over the
#   result resolve every module the receipt names — i.e. is the second cell of the
#   version matrix a *tree* and not only a manifest?
#
# What this does NOT do: it does not run `npm install`. The tree is reconstructed from
# the release's own tarball plus the pinned closure, so it is a reconstruction and the
# record says so. No peer resolution, no lockfile, no lifecycle scripts.
#
# Usage:  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-install-tree/run.sh
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
  SLICE=$REPO/scripts/second-install-tree
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  NPM=/www/server/nodejs/v24.21.0/bin/npm
  RUNS=${SECOND_INSTALL_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  [ -x "$NODE" ] || exit 70
  [ -x "$NPM" ] || exit 70
  BR_EXTRA_CONTROL=()
  BR_WORKLOAD_EXITS=(0 70 71 72 73)
  BR_SELECTED_INPUTS=(
    "$SLICE/payload.sh"
    "$REPO/scripts/runtime-receipt/receipt.mjs"
  )
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" second-install-tree
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
