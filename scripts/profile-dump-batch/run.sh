#!/bin/bash
# Source-only migration to canonical c8123de; awaiting Lead bounded verification.
set +e
set -uo pipefail
(
  # Dedicated host subshell owns the core lock descriptor; never enable errexit.
  set +e
  set -uo pipefail
  REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
  PKG=$REPO/packages/analyzer
  SLICE=$REPO/scripts/profile-dump-batch
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  RUNS=${PROFILE_DUMP_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  command -v bwrap >/dev/null 2>&1 || exit 70
  [ -x "$NODE" ] || exit 70
  BR_EXTRA_CONTROL=()
  BR_WORKLOAD_EXITS=(0 70 71 72 73)
  BR_SELECTED_INPUTS=("$SLICE/README.md" "$PKG/package.json" "$PKG/README.md"
    "$PKG/src/profile-dump.js" "$PKG/src/profile-dump.d.ts"
    "$PKG/src/profile-dump-cli.js" "$PKG/src/evidence-cli.js"
    "$PKG/tests/profile-dump.test.js" "$REPO/examples/diagnose/profile.yml")
  # Conservative source/test/helper/fixture/example selection, NOT a dependency closure.
  unset GLOBIGNORE
  shopt -s nullglob globstar dotglob
  SOURCES=("$PKG"/src/**/*)
  TESTS=("$PKG"/tests/**/*)
  FIXTURES=("$PKG"/fixtures/**/*)
  EXAMPLES=("$REPO"/examples/diagnose/**/*)
  shopt -u nullglob globstar dotglob
  [ "${#SOURCES[@]}" -gt 0 ] && [ "${#TESTS[@]}" -gt 0 ] &&
    [ "${#FIXTURES[@]}" -gt 0 ] && [ "${#EXAMPLES[@]}" -gt 0 ] || exit 70
  for f in "${SOURCES[@]}" "${TESTS[@]}" "${FIXTURES[@]}" "${EXAMPLES[@]}"; do
    [ ! -d "$f" ] || continue
    BR_SELECTED_INPUTS+=("$f")
  done
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  # Core hashes wrapper, payload, manifest and all five modules, including payload imports.
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" profile-dump-batch
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
