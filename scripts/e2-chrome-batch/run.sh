#!/bin/bash
# Bounded slice for packages/host: E2 headless Chrome heavy test suite (Phase 5).
# TasksMax comes from the read-only policy constant BR_TASKS_CHROME (256), selected by
# host.sh/envelope.sh for the e2-chrome-batch unit prefix; no environment override exists.
# All other limits match the standard bounded-runner policy.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/host
SLICE=$REPO/scripts/e2-chrome-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
RUNS=${E2_CHROME_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
[ "$#" -eq 0 ] || exit 70
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/host.sh" || exit 70
command -v systemd-run >/dev/null 2>&1 || exit 70
[ -x "$NODE" ] || exit 70
BR_EXTRA_CONTROL=()
BR_WORKLOAD_EXITS=(0 70 71 72 73)
BR_SELECTED_INPUTS=("$SLICE/README.md" "$SLICE/ui-e2e.mjs" "$PKG/package.json" "$PKG/README.md")
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
# Cross-package inputs the host tests and ui-e2e.mjs import: the real repair
# package (lazy-loaded by api.js), the real conflict service, and the example
# document the repair tests copy into a mkdtemp directory.
shopt -s nullglob globstar dotglob
REPAIR_SOURCES=("$REPO"/packages/repair/src/**/*)
shopt -u nullglob globstar dotglob
[ "${#REPAIR_SOURCES[@]}" -gt 0 ] || exit 70
for f in "${REPAIR_SOURCES[@]}"; do
  [ ! -d "$f" ] || continue
  BR_SELECTED_INPUTS+=("$f")
done
BR_SELECTED_INPUTS+=(
  "$REPO/packages/analyzer/src/conflict-service.js"
  "$REPO/packages/analyzer/src/conflict-detector.js"
  "$REPO/examples/repair/profile.yml"
)
# Chrome-driver test is required; existing tests must also be present.
for f in \
  "$PKG/tests/chrome-driver.test.js" \
  "$PKG/src/chrome-driver.js" \
  "$PKG/tests/api.test.js" \
  "$PKG/tests/gui.test.js" \
  "$PKG/tests/gui-phase3-4.test.js" \
  "$PKG/tests/repair-api.test.js" \
  "$SLICE/ui-e2e.mjs" \
  "$PKG/tests/client.test.js"; do
  [ -f "$f" ] || exit 70
done
for f in "${BR_SELECTED_INPUTS[@]}"; do br_path "$f" && [ -f "$f" ] || exit 70; done
(
  set +e
  set -uo pipefail
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" e2-chrome-batch
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
