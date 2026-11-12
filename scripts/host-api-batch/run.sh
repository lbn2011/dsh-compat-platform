#!/bin/bash
# Bounded slice for packages/host: the envelope/page tests and the E1 diagnostic
# endpoints. Prepared 2026-11-12; unit base `host-api-batch` is NOT yet in
# scripts/bounded-runner/policy.sh br_prefix_allowed, so this wrapper is refused (70)
# until that one-line policy change is authorised — the allow-list is an exact match and
# policy.sh is hashed by core.manifest.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/host
SLICE=$REPO/scripts/host-api-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
RUNS=${HOST_API_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
[ "$#" -eq 0 ] || exit 70
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/host.sh" || exit 70
command -v bwrap >/dev/null 2>&1 || exit 70
[ -x "$NODE" ] || exit 70
# Core hashes this wrapper, payload, manifest and all five modules automatically.
BR_EXTRA_CONTROL=()
BR_WORKLOAD_EXITS=(0 70 71 72 73)
BR_SELECTED_INPUTS=("$SLICE/README.md" "$PKG/package.json" "$PKG/README.md")
unset GLOBIGNORE
shopt -s nullglob globstar dotglob
SOURCES=("$PKG"/src/**/*)
TESTS=("$PKG"/tests/**/*)
shopt -u nullglob globstar dotglob
[ "${#SOURCES[@]}" -gt 0 ] && [ "${#TESTS[@]}" -gt 0 ] || exit 70
for f in "${SOURCES[@]}" "${TESTS[@]}"; do
  [ ! -d "$f" ] || continue
  BR_SELECTED_INPUTS+=("$f")
done
for f in "$PKG/tests/api.test.js" "$PKG/tests/gui.test.js" "$PKG/tests/client.test.js"; do
  [ -f "$f" ] || exit 70
done
for f in "${BR_SELECTED_INPUTS[@]}"; do br_path "$f" && [ -f "$f" ] || exit 70; done
# Selected local sources/tests, not a dependency-closure assertion.
(
  set +e
  set -uo pipefail
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" host-api-batch
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
