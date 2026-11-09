#!/bin/bash
# Host-side launcher for the one-time isolated yaml@2.9.1 install batch.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1,
# core commit c8123de). Awaiting Lead bounded verification. These bytes have not
# been executed, syntax-qualified, sourced or launched; no unit, no workload.
#
# Scope: ONE transient unit, one workload, no retry. The envelope, the shared
# lock, the two-point hash discipline, the terminal-state readback and the
# exit-code vocabulary now live in scripts/bounded-runner and are NOT restated
# here. What this wrapper owns is the workload name, the install target and the
# selected inputs.
#
# This batch performs a ONE-TIME install into an EXISTING package directory:
# `packages/analyzer` exists, `packages/analyzer/node_modules` exists or is
# created, and only `node_modules/yaml` is created. It is therefore not
# idempotent — the payload refuses (70) if the target is already present — and
# the launcher refuses (70) before creating any unit for the same reason.
#
# PRECONDITION, NOT PERFORMED HERE: this runner never runs npm, never runs a
# package script and never replaces an existing tree. It needs network access
# from INSIDE the unit (the download is the only network step) and a `bwrap`
# extract sandbox.
#
# OWNERSHIP: this launcher never stops a unit it did not launch. The stop path in
# the core is gated on the invocation receipt written by the payload, so a
# foreign or reused unit name is reported (74) rather than stopped.
#
# Usage:  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install/run.sh
#         Takes no arguments. Invoke it by ABSOLUTE path: the core binds every
#         active source frame to the absolute control list, so a relative entry
#         path is refused (77) before any unit is created.
#
# Exit codes (host, from the core): 0 green; 70 refusal before or inside the
# launch (including "install target already exists"); 71 a batch script does not
# parse; 72 download/verify/extract verification failed; 73 an evidence write
# failed; 74 the unit did not settle; 75 lock held; 76 run-directory collision;
# 77 a hash manifest/source frame could not be read, matched or written;
# 78 selected-input drift.
#
# Payload: 0 green, 70 envelope/precondition refusal, 71 a batch script does not
# parse, 72 download/verify/extract verification failed, 73 evidence write failed.

set +e
set -uo pipefail
(
  # Dedicated host subshell owns the core lock descriptor; never enable errexit.
  set +e
  set -uo pipefail
  ROOT=/root/dsh-ecosystem-spec
  REPO=$ROOT/projects/dsh-compat-platform
  PKG=$REPO/packages/analyzer
  SLICE=$REPO/scripts/profile-dump-install
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  # Raw artifacts live OUTSIDE the repository; only the narrative record is committed.
  RUNS=${PROFILE_DUMP_INSTALL_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  command -v bwrap >/dev/null 2>&1 || exit 70
  command -v curl >/dev/null 2>&1 || exit 70
  command -v python3 >/dev/null 2>&1 || exit 70
  [ -x "$NODE" ] || exit 70
  [ -d "$PKG" ] || exit 70
  # No additional sourced control file: this payload imports core modules only.
  BR_EXTRA_CONTROL=()
  # The payload's only non-green exits are refusals (70), a parse failure (71),
  # a failed download/verify/extract (72) and an evidence failure (73). All four
  # are declared so the launcher relays them instead of collapsing them to 70.
  BR_WORKLOAD_EXITS=(0 70 71 72 73)
  # SELECTED INPUTS: everything the verdict depends on that lives in THIS repo.
  # run.sh and payload.sh are NOT repeated here — the core hashes them as control
  # sources, together with the manifest and all five modules.
  #
  # `node_modules` is DELIBERATELY ABSENT: this run CREATES
  # node_modules/yaml, so hashing the tree before the run is impossible and
  # hashing it after would record the payload's own output as drift. The installed
  # tree is verified by the payload's own per-file manifest instead.
  BR_SELECTED_INPUTS=(
    "$PKG/package.json"
  )
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  # Refuse BEFORE creating a unit when the install target is already present. The
  # payload repeats this check inside the envelope, because the tree can appear
  # between launch and workload.
  if [ -e "$PKG/node_modules/yaml" ] || [ -L "$PKG/node_modules/yaml" ]; then
    printf 'refusing: install target already exists (this batch never replaces it): %s\n' \
      "$PKG/node_modules/yaml" >&2
    exit 70
  fi
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" profile-dump-install
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
