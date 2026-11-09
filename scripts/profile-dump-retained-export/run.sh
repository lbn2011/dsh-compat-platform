#!/bin/bash
# Launcher for the retained-export acceptance batch.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1, core
# commit c8123de). Awaiting Lead bounded verification. These bytes have not been
# executed, syntax-qualified or sourced.
#
# This file does almost nothing itself: the host module owns the unit, the run
# directory, the lock, the terminal query, the two-point evidence snapshots and the
# verdict. What is left here is the part only the caller knows — which inputs this
# batch is about — plus the refusal that guards the one thing the canonical launch
# cannot carry (see "Artifact root").
#
# Invocation:
#
#   bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export/run.sh
#
# No arguments; extra arguments are refused 70. The path MUST be absolute: the core
# binds every active shell source frame to its control list, so a relative entry
# path (`scripts/...`, `./run.sh`) is refused 77 BEFORE the lock is taken, before a
# run directory is created, and before any unit or workload is launched.
#
# Artifact root:
#
#   The batch reads three retained captures from a historical evidence directory.
#   Before the migration that root travelled to the payload as a THIRD argument, and
#   a transient service runs in a detached environment, so the canonical two-argument
#   launch (`unit`, `run`) cannot carry it. The root is therefore PINNED, here and in
#   the payload, to the directory the last recorded run used. If the caller sets
#   RETAINED_EXPORT_ARTIFACT_ROOT to any other value this launcher refuses 70 rather
#   than launch against a root the payload would not read; silently ignoring an
#   override would be worse than refusing it. Overriding the root is consequently
#   NOT supported by the migrated batch — see the README.
#
# Launcher exits (the core's, plus this file's own refusals):
#
#   0   green
#   60  a pinned sample is missing
#   61  a sample's size or sha256 differs from its pin
#   62  the sandbox or node is unusable
#   63  a CLI child failed
#   64  a child's stdout was not exactly one JSON document
#   65  a summary vocabulary escape was seen
#   66  a summary mismatch
#   70  refusal before the workload started
#   71  dependency or syntax precondition failed
#   72  the verifier ran but the batch is not green
#   73  an evidence write failed
#   74  the unit did not settle (and any workload exit outside the allowed set)
#   75  the acceptance lock was held
#   76  run-directory collision
#   77  control source or selected input could not be hashed or matched
#   78  selected-input drift
#
# 60-66 are the verifier's own fixed codes: the core relays them only because this
# launcher declares them allowed. The payload re-checks that both snapshots were
# identical before it returns one of them.

set +e
set -uo pipefail
(
  set +e
  set -uo pipefail

  ROOT=/root/dsh-ecosystem-spec
  REPO=$ROOT/projects/dsh-compat-platform
  PKG=$REPO/packages/analyzer
  SLICE=$REPO/scripts/profile-dump-retained-export
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  RUNS=${PROFILE_DUMP_RETAINED_EXPORT_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  PINNED_ARTIFACT_ROOT=/data/dsh-ecosystem-test-artifacts/experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141

  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  command -v bwrap >/dev/null 2>&1 || exit 70
  command -v sha256sum >/dev/null 2>&1 || exit 70
  [ -x "$NODE" ] || exit 70

  ARTIFACT_ROOT=${RETAINED_EXPORT_ARTIFACT_ROOT:-$PINNED_ARTIFACT_ROOT}
  if [ "$ARTIFACT_ROOT" != "$PINNED_ARTIFACT_ROOT" ]; then
    printf 'launcher: refusing — RETAINED_EXPORT_ARTIFACT_ROOT=%s\n' "$ARTIFACT_ROOT" >&2
    printf 'launcher: this batch reads the pinned evidence root only:\n  %s\n' "$PINNED_ARTIFACT_ROOT" >&2
    printf 'launcher: the payload cannot receive a third argument through the canonical launch,\n' >&2
    printf 'launcher: so an override is refused rather than silently ignored.\n' >&2
    exit 70
  fi
  br_path "$ARTIFACT_ROOT" || exit 70
  case "$ARTIFACT_ROOT" in
    */../*|*/..|*//*) printf 'launcher: artifact root must not contain a traversal or empty component: %s\n' "$ARTIFACT_ROOT" >&2; exit 70 ;;
  esac
  [ -d "$ARTIFACT_ROOT" ] || { printf 'launcher: artifact root missing: %s\n' "$ARTIFACT_ROOT" >&2; exit 70; }

  # Nothing extra is hashed beyond the control sources and the selected inputs: the
  # retained captures are content-pinned by the verifier itself, and this batch's
  # point is that those bytes do not change.
  BR_EXTRA_CONTROL=()
  # 60-66 are the verifier's fixed codes and must survive the core's workload map;
  # 71/72/73 are this payload's own refusals.
  BR_WORKLOAD_EXITS=(0 60 61 62 63 64 65 66 71 72 73)
  BR_SELECTED_INPUTS=(
    "$SLICE/run.sh"
    "$SLICE/payload.sh"
    "$SLICE/retained-export.mjs"
    "$PKG/package.json"
    "$PKG/src/profile-dump.js"
    "$PKG/src/profile-dump.d.ts"
    "$PKG/src/profile-dump-cli.js"
    "$PKG/src/evidence-cli.js"
    "$ARTIFACT_ROOT/1-probe/out/run-root/out/stdout.bin"
    "$ARTIFACT_ROOT/2-denied/out/run-root/out/stdout.bin"
    "$ARTIFACT_ROOT/3-script-probe/out/run-root/out/stdout.bin"
  )
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || {
      printf 'launcher: selected input missing or unrepresentable: %s\n' "$f" >&2
      exit 70
    }
  done

  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" profile-dump-retained-export
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
