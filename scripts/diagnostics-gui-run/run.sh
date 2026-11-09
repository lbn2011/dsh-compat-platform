#!/bin/bash
# Host-side launcher for the read-only diagnostics GUI (host route) batch.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1,
# core commit c8123de). Awaiting Lead bounded verification. These bytes have not
# been executed, syntax-qualified, sourced or launched; no unit, no workload.
#
# Scope: ONE transient unit, one workload, no retry. The envelope, the shared
# lock, the two-point hash discipline, the terminal-state readback and the
# exit-code vocabulary live in scripts/bounded-runner and are NOT restated here.
# What this wrapper owns is the workload name and the selected inputs: this batch
# produces one real envelope with the `dsh-compat-diagnose` CLI, boots the host
# carrier with the new read-only GUI plugin and probes it, boots a second carrier
# whose configured envelope is missing and probes the refusal path, and runs the
# GUI package's own test file.
#
# PRECONDITION, NOT PERFORMED HERE: the boot carrier needs `@deepseek-ai/cordis`
# and `@deepseek-ai/dsh-host-webserver` resolvable from the machine's module root,
# and the analyzer needs `yaml` at exactly 2.9.1. This runner installs nothing: if
# either is missing the payload refuses (71) before any carrier is started. It also
# needs a sibling checkout of `projects/dsh-compat-spec`; if it is absent the
# wrapper refuses (70) before any unit is created.
#
# Usage:  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnostics-gui-run/run.sh
#         Takes no arguments. Invoke it by ABSOLUTE path: the core binds every
#         active source frame to the absolute control list, so a relative entry
#         path is refused (77) before the lock, before any run directory, and
#         before any unit is created.
#
# Exit codes (host, from the core): 0 green; 70 refusal before or inside the
# launch; 71 static contract or dependency precondition failed (no workload was
# started); 72 an HTTP assertion or the CLI envelope step did not match; 73 an
# evidence write failed; 74 the GUI test file was not a clean run (and, from the
# core, the unit did not settle); 75 lock held; 76 run-directory collision;
# 77 a hash manifest/source frame could not be read, matched or written;
# 78 selected-input drift.

set +e
set -uo pipefail
(
  # Dedicated host subshell owns the core lock descriptor; never enable errexit.
  set +e
  set -uo pipefail
  ROOT=/root/dsh-ecosystem-spec
  REPO=$ROOT/projects/dsh-compat-platform
  PKG=$REPO/packages/analyzer
  HOSTPKG=$REPO/packages/host
  SLICE=$REPO/scripts/diagnostics-gui-run
  SPEC=$ROOT/projects/dsh-compat-spec
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  # Raw artifacts live OUTSIDE the repository; only the narrative record is committed.
  RUNS=${DIAGNOSE_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  command -v bwrap >/dev/null 2>&1 || exit 70
  [ -x "$NODE" ] || exit 70
  # No additional sourced control file: this payload imports core modules only.
  BR_EXTRA_CONTROL=()
  # The payload's per-step verdicts become 72, the test file keeps its own 74.
  BR_WORKLOAD_EXITS=(0 70 71 72 73 74)
  # The single workload file the static contract requires to be present in the
  # suite's glob. This file is the subject of the batch.
  TEST_FILES=(
    tests/gui.test.js
  )
  # SELECTED INPUTS. Everything the verdict depends on and that lives in THIS repo
  # is hashed, so a change to what is judged shows up as drift in the same
  # manifest. run.sh and payload.sh are NOT repeated here — they are control
  # sources, hashed by the core together with the manifest and all five modules.
  #
  # boot.mjs and probe.mjs are deliberately absent, exactly as before the
  # migration: they are the harness that observes the carrier, not the package
  # under test. Their sha256 is recorded in the batch README instead.
  BR_SELECTED_INPUTS=(
    "$HOSTPKG/package.json"
    "$HOSTPKG/src/index.js"
    "$HOSTPKG/src/envelope.js"
    "$HOSTPKG/src/page.js"
    "$PKG/package.json"
    "$PKG/src/diagnose-cli.js"
    "$PKG/src/diagnose-internal.js"
    "$PKG/src/diagnose.js"
    "$PKG/src/profile-dump.js"
    "$REPO/examples/diagnose/profile.yml"
    "$REPO/examples/diagnose/runtime-evidence.json"
    "$REPO/examples/diagnose/admission-evidence.json"
    "$PKG/fixtures/clean.json"
  )
  for t in "${TEST_FILES[@]}"; do BR_SELECTED_INPUTS+=("$HOSTPKG/$t"); done
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  # The sibling `dsh-compat-spec` sources are DELIBERATELY OUTSIDE this selection:
  # they are another repository's bytes, not this repo's. They are still verified
  # to exist, because an absent sibling is a hard refusal.
  SPEC_INPUTS=(
    "$SPEC/src/index.js"
    "$SPEC/src/admission-evidence.js"
  )
  for f in "${SPEC_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" diagnostics-gui
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
