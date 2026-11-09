#!/bin/bash
# Source-only migration to local bounded-runner c8123de; awaiting Lead verification.
# One launch, no retries. Dedicated subshell owns core state, shell options and FD9.
(
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/analyzer
SLICE=$REPO/scripts/diagnose-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
RUNS=${DIAGNOSE_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
[ "$#" -eq 0 ] || exit 70
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/host.sh" || exit 70
command -v bwrap >/dev/null 2>&1 || exit 70
[ -x "$NODE" ] || exit 70
BR_EXTRA_CONTROL=()
BR_WORKLOAD_EXITS=(0 70 71 72 73)
BR_SELECTED_INPUTS=("$SLICE/README.md" "$PKG/package.json" "$PKG/README.md")
# Comprehensive named selection, NOT a dependency closure. YAML has its own
# payload snapshots. Freeze these arrays before launch; no eval or word splitting.
unset GLOBIGNORE
shopt -s nullglob globstar dotglob
for tree in "$PKG/src" "$PKG/tests" "$PKG/fixtures" "$REPO/examples"; do
  [ -d "$tree" ] || exit 70
  files=("$tree"/**/*)
  count=0
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    BR_SELECTED_INPUTS+=("$f")
    count=$((count + 1))
  done
  [ "$count" -gt 0 ] || exit 70
done
shopt -u nullglob globstar dotglob
[ -f "$PKG/tests/diagnose.test.js" ] || exit 70
for f in "${BR_SELECTED_INPUTS[@]}"; do
  br_path "$f" && [ -f "$f" ] || exit 70
done
# Core automatically hashes wrapper, payload, core.manifest and ALL five modules.
br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" diagnose-batch
rc=$?
printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
exit "$rc"
)
