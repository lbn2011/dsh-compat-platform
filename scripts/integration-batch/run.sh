#!/bin/bash
# Bounded slice for the cross-repository integration suite (task t12).
#
# This unit runs the three repositories' integration suites in ONE envelope, in
# sequence, so the 32-task / 384 MiB budget covers the whole flow rather than
# each piece separately:
#   1. platform tests/integration/*.test.mjs  — Layer1→4 chain, C1–C11, patch
#      approval, bundle install, resource budget
#   2. kit tests/integration/*.test.js       — scaffold → pack → verify-patch and
#      conflict-check against the real analyzer + validator
#   3. spec tests/integration/*.test.js      — the declarations the kit renders,
#      judged by the protocol owner
# The kit repository has no bounded-runner of its own, so its suite can only be
# bounded from here; the records say so instead of implying a kit-local envelope.
#
# Unit base `integration-batch` is in scripts/bounded-runner/policy.sh
# br_prefix_allowed (exact match, authorised by the captain 2026-11-13).
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
SLICE=$REPO/scripts/integration-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
RUNS=${INTEGRATION_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
[ "$#" -eq 0 ] || exit 70
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/host.sh" || exit 70
command -v bwrap >/dev/null 2>&1 || exit 70
[ -x "$NODE" ] || exit 70
BR_EXTRA_CONTROL=()
BR_WORKLOAD_EXITS=(0 70 71 72 73)
# Every input the run reads is declared here and digested before and after; the
# list crosses repositories on purpose, because the suites do.
BR_SELECTED_INPUTS=(
  "$SLICE/README.md"
  # This repository has no root package.json: each package carries its own.
  "$REPO/packages/analyzer/package.json"
  "$REPO/packages/host/package.json"
  "$REPO/packages/repair/package.json"
  "$REPO/packages/lifecycle-bootstrap/package.json"
)
unset GLOBIGNORE
shopt -s nullglob globstar dotglob
for dir in "$REPO/tests/integration" "$REPO/../dsh-plugin-kit/tests/integration" \
           "$REPO/../dsh-compat-spec/tests/integration"; do
  [ -d "$dir" ] || exit 70
  for f in "$dir"/**/*; do
    [ -d "$f" ] && continue
    BR_SELECTED_INPUTS+=("$f")
  done
done
# The libraries under test, one manifest per repository plus the sources the
# suites import across repository boundaries.
BR_SELECTED_INPUTS+=(
  "$REPO/../dsh-plugin-kit/package.json"
  "$REPO/../dsh-plugin-kit/src/index.js"
  "$REPO/../dsh-compat-spec/package.json"
  "$REPO/../dsh-compat-spec/src/index.js"
  "$REPO/packages/host/src/page.js"
)
shopt -u nullglob globstar dotglob
[ "${#BR_SELECTED_INPUTS[@]}" -gt 3 ] || exit 70
for f in "${BR_SELECTED_INPUTS[@]}"; do br_path "$f" && [ -f "$f" ] || exit 70; done
# Selected local sources/tests, not a dependency-closure assertion.
(
  set +e
  set -uo pipefail
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" integration-batch
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
