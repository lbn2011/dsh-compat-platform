#!/bin/bash
# Source-only migration to the repository-local bounded-runner (ABI bounded-runner/1).
# Awaiting Lead bounded verification; nothing here was executed or qualified.
#
# Invocation must be ABSOLUTE: control closure compares each BASH_SOURCE frame
# with the absolute control paths, so a relative path is refused with 77.
#
# This batch needs the acquired engine tree. The caller names it with
# CONFIG_CHECK_ENGINE_ROOT (that tree's node_modules directory); without it the
# payload falls back to the single tree recorded in README.md.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/config-check
SLICE=$REPO/scripts/config-check-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
RUNS=${CONFIG_CHECK_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
[ "$#" -eq 0 ] || exit 70
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/host.sh" || exit 70
command -v bwrap >/dev/null 2>&1 || exit 70
[ -x "$NODE" ] || exit 70
# Unit family, spelled exactly as the fifth br_host_run argument. The core reads
# no BR_UNIT_PREFIX; this name only keeps the prefix in one place.
BR_UNIT_PREFIX=config-check-batch
BR_EXTRA_CONTROL=()
BR_WORKLOAD_EXITS=(0 70 71 72 73 74)
BR_SELECTED_INPUTS=(
  "$PKG/package.json" "$PKG/README.md"
  "$PKG/src/config-check.js" "$PKG/src/config-check.d.ts"
  "$PKG/src/hyperjump-engine.js" "$PKG/src/hyperjump-engine.d.ts"
  "$PKG/src/config-check-cli.js"
  "$PKG/tests/config-check.test.js" "$PKG/tests/hyperjump-engine.test.js"
  "$PKG/examples/valid.json" "$PKG/examples/invalid.json" "$PKG/examples/contract.json"
  "$SLICE/run.sh" "$SLICE/payload.sh" "$SLICE/README.md"
)
# Explicit selection, not dependency closure: the acquired engine tree, Node and
# every system tool used below are deliberately outside this list.
for f in "${BR_SELECTED_INPUTS[@]}"; do br_path "$f" && [ -f "$f" ] || exit 70; done
(
  set +e
  set -uo pipefail
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" "$BR_UNIT_PREFIX"
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
