#!/bin/bash
# ABI bounded-runner/1. Constants intentionally cannot be overridden by environment.
readonly BR_ABI=bounded-runner/1
readonly BR_LOCK=/root/dsh-ecosystem-spec/experiments/acceptance/runs/.acceptance.lock
readonly BR_MEMORY_BYTES=402653184 BR_SWAP_BYTES=0 BR_TASKS=32
readonly BR_CPU_MAX='50000 100000' BR_RUNTIME_USEC=120000000
readonly BR_MEMORY_GATE_KIB=819200 BR_NODE_OPTIONS=--max-old-space-size=192
readonly -a BR_UNIT_FAMILIES=(
  'profile-dump-batch-*' 'diagnose-batch-*' 'dependency-shape-batch-*'
  'dependency-shape-*' 'correspondence-batch-*' 'correspondence-*'
  'repair-plan-batch-*' 'diagnose-real-wiring-*' 'diagnostics-gui-run-*'
  'diagnostics-gui-*' 'profile-dump-retained-export-*' 'profile-dump-install-*'
  'package-install-*' 'trusted-extraction-batch-*' 'trusted-extraction-hang-*'
  'spec-test-batch-*'
  'config-check-batch-*' 'second-version-baseline-*' 'second-version-observe-*'
  'driver-config-contract-batch-*' 'analyzer-test-script-batch-*'
  'profile-export-real-*' 'profile-export-main-unit-*' 'profile-export-unit-*'
  'profile-export-unit-split-*' 'profile-export-orchestration-unit-split-*'
  'snapshot-compare-*' 'combined-report-*'
  'hbl-*' 'tkl-*' 'harbor-*' 'lfx-*' 'rbk-*' 'tkb-*' 'cpy-*' 'exc-*' 'acq-*'
  'p0-*' 'acc-*' 'admission-*'
)
br_prefix_allowed() {
  case "$1" in
    profile-dump-batch|config-check-batch|diagnose-batch|dependency-shape-batch|correspondence|correspondence-batch|repair-plan-batch|diagnose-real-wiring|diagnostics-gui|diagnostics-gui-run|profile-dump-retained-export|profile-dump-install|package-install|trusted-extraction-batch|trusted-extraction-hang|spec-test-batch|second-version-baseline|second-version-observe) return 0;;
    *) return 1;;
  esac
}
# BR_WORKLOAD_EXITS is an explicit wrapper-owned array. Listed special exits are
# preserved as nonzero outcomes, NEVER converted to green. 73 is not overridable.
br_workload_policy_valid() {
  local rc
  [ "${#BR_WORKLOAD_EXITS[@]}" -gt 0 ] || return 1
  for rc in "${BR_WORKLOAD_EXITS[@]}"; do
    case "$rc" in 0|60|61|62|63|64|65|66|70|71|72|73|74) ;; *) return 1;; esac
  done
}
br_workload_exit() {
  local allowed
  case "$1" in 73) return 73;; 124|137|143) return 74;; esac
  for allowed in "${BR_WORKLOAD_EXITS[@]}"; do
    [ "$1" != "$allowed" ] || return "$allowed"
  done
  return 70
}
br_verdict() { # launch rc, terminal yes/no, hash rc (0/77/78)
  local result
  br_workload_exit "$1"; result=$?
  [ "$2" = yes ] || result=74
  case "$3" in 0) ;; 77|78) result=$3;; *) result=77;; esac
  # A payload evidence failure outranks terminal and hash failures too.
  [ "$1" != 73 ] || result=73
  br_finish "$result"
}
