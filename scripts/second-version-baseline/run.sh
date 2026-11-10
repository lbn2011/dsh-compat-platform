#!/bin/bash
# Host-side launcher for the second-version baseline batch (dev plan item 3 B).
#
# Scope: ONE transient unit, one workload, no retry. One question:
#   What does a *published, older* DSH release say about itself and about the
#   entry-outcome interface this repository's fixture observation depends on?
#
# This is the only batch in the repository that talks to a registry. The install step
# is therefore the only step with network access, and it is named in the record.
#
# Usage:  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-baseline/run.sh
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
  SLICE=$REPO/scripts/second-version-baseline
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  NPM=/www/server/nodejs/v24.21.0/bin/npm
  RUNS=${SECOND_VERSION_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  [ -x "$NODE" ] || exit 70
  [ -x "$NPM" ] || exit 70
  BR_EXTRA_CONTROL=()
  BR_WORKLOAD_EXITS=(0 70 71 72 73)
  BR_SELECTED_INPUTS=(
    "$SLICE/probe-release.mjs"
    "$REPO/packages/runtime/package.json"
    "$REPO/packages/runtime/src/isolation-policy.js"
    "$REPO/packages/runtime/src/trusted-extraction-adapter.js"
    "$REPO/packages/runtime/src/trusted-extraction-receipt.js"
    "$REPO/packages/runtime/src/trusted-extraction-supervisor.js"
    "$REPO/examples/trusted-extraction/config.yml"
    "$REPO/examples/trusted-extraction/plugin-ok.mjs"
    "$REPO/examples/trusted-extraction/plugin-import-throw.mjs"
    "$REPO/examples/trusted-extraction/plugin-activate-throw.mjs"
  )
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" second-version-baseline
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
