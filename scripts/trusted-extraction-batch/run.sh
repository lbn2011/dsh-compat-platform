#!/bin/bash
# Host-side launcher for the trusted-extraction observation batch.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1,
# core commit c8123de). Awaiting Lead bounded verification. These bytes have not
# been executed, syntax-qualified, sourced or launched; no unit, no workload.
#
# THIS IS AN UPLIFT, NOT AN EQUIVALENCE REFACTOR. The workload — configure the
# trusted-extraction supervisor, sandbox a child as uid 65534 with --unshare-net,
# probe the sentinels, observe the network verdict, and demonstrate the phase
# budget's SIGKILL/hang path through six failure-path checks — is carried over
# unchanged. What it GAINS is the host layer it never had:
#   * Type=exec (the old transient unit was the systemd default, Type=simple);
#   * an invocation receipt (`ownership.txt`) and ownership-gated stop, so no
#     foreign or reused unit can ever be stopped;
#   * a verified terminal state (settled-or-74) instead of an unread `systemctl show`
#     append with `|| true`;
#   * a declared control closure (core manifest, wrapper, payload, five modules) and
#     two-point hashing of the selected inputs, instead of a relative-path sha256sum
#     list with no drift verdict;
#   * strict TAP on the unit-test summary (singleton `# tests/pass/fail/...`),
#     instead of trusting node's exit status alone;
#   * one exit-code vocabulary (73 evidence failure, 74 timeout/unconfirmed
#     terminal, 75 lock held, 76 run collision, 77 manifest/source, 78 drift).
# The pre-migration launcher used 75/76/77 for mkdir/lock-open/lock-held and had no
# drift or terminal verdict at all; those codes are now the core's and are NOT
# interchangeable with the old ones.
#
# LIMITS ARE NOT WEAKENED: the core's envelope is the same 384 MiB / swap 0 /
# 32 tasks / 50% CPU / 120 s that this batch already declared, so no per-slice
# override is needed. The core adds two constraints this batch did not have: a
# 192 MiB V8 heap via NODE_OPTIONS and a strict MemAvailable gate (819200 KiB,
# which the payload already checked itself). The one thing the core's argv cannot
# express is the old `-p PrivateTmp=no`; nothing in this workload depends on a
# shared /tmp — the supervisor mounts its own `--tmpfs /tmp` inside the sandbox
# and every artefact lives under $RUN.
#
# Usage:  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/trusted-extraction-batch/run.sh
#         Takes no arguments. Invoke it by ABSOLUTE path: the core binds every
#         active source frame to the absolute control list, so a relative entry
#         path is refused (77) before any unit is created.
#
# Exit codes (host, from the core): 0 green; 70 refusal before or inside the
# launch (envelope, syntax, static contract); 71 unused by this payload; 72 unit
# tests or the fixture observation failed; 73 an evidence write failed or an
# isolation gate refused; 74 the demo phase budget did not time out, the unit did
# not settle, or a failure-path check failed; 75 lock held; 76 run-directory
# collision; 77 a hash manifest/source frame could not be read, matched or
# written; 78 selected-input drift.

set +e
set -uo pipefail
(
  # Dedicated host subshell owns the core lock descriptor; never enable errexit.
  set +e
  set -uo pipefail
  ROOT=/root/dsh-ecosystem-spec
  REPO=$ROOT/projects/dsh-compat-platform
  SLICE=$REPO/scripts/trusted-extraction-batch
  CORE=$REPO/scripts/bounded-runner
  NODE=/www/server/nodejs/v24.21.0/bin/node
  # Raw artifacts live OUTSIDE the repository; only the narrative record is committed.
  RUNS=${TRUSTED_EXTRACTION_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
  [ "$#" -eq 0 ] || exit 70
  source "$CORE/common.sh" || exit 70
  source "$CORE/policy.sh" || exit 70
  source "$CORE/host.sh" || exit 70
  # bwrap is used by the workload itself (the supervisor builds the sandbox); a
  # missing binary is a precondition, never a workload failure.
  command -v bwrap >/dev/null 2>&1 || exit 70
  [ -x "$NODE" ] || exit 70
  # No additional sourced control file: this payload imports core modules only.
  BR_EXTRA_CONTROL=()
  # The payload's non-green exits are: 70 (envelope/syntax/static), 72 (unit tests,
  # fixture), 73 (isolation gates, evidence) and its own 74 (failure paths / unit
  # did not settle). 74 MUST be declared here or the launcher would collapse a
  # failed failure-path check to 70 and lose the distinction.
  BR_WORKLOAD_EXITS=(0 70 72 73 74)
  # SELECTED INPUTS: the runtime package's sources, its two test files, the
  # failure-path probe, and every example fixture the workload loads. run.sh and
  # payload.sh are NOT repeated here — the core hashes them as control sources,
  # together with the manifest and all five modules. This is a named selection,
  # not a dependency closure (the DSH installation the fixture observes is outside
  # this repository and is deliberately not hashed).
  BR_SELECTED_INPUTS=(
    "$REPO/packages/runtime/package.json"
    "$REPO/packages/runtime/src/isolation-policy.js"
    "$REPO/packages/runtime/src/child-probe.js"
    "$REPO/packages/runtime/src/trusted-extraction-adapter.js"
    "$REPO/packages/runtime/src/trusted-extraction-receipt.js"
    "$REPO/packages/runtime/src/trusted-extraction-supervisor.js"
    "$REPO/packages/runtime/tests/isolation-policy.test.js"
    "$REPO/packages/runtime/tests/trusted-extraction-receipt.test.js"
    "$SLICE/failure-paths.mjs"
    "$REPO/scripts/runtime-receipt/receipt.mjs"
    "$REPO/examples/trusted-extraction/config.yml"
    "$REPO/examples/trusted-extraction/plugin-ok.mjs"
    "$REPO/examples/trusted-extraction/plugin-import-throw.mjs"
    "$REPO/examples/trusted-extraction/plugin-activate-throw.mjs"
    "$REPO/examples/trusted-extraction/config-hang.yml"
    "$REPO/examples/trusted-extraction/plugin-hang.mjs"
  )
  for f in "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || exit 70
  done
  br_host_run "$CORE" "$SLICE/run.sh" "$SLICE/payload.sh" "$RUNS" trusted-extraction-batch
  rc=$?
  printf 'run_dir=%s\nacceptance_exit=%s\n' "${BR_RUN:-not-created}" "$rc"
  exit "$rc"
)
exit "$?"
