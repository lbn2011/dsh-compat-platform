#!/bin/bash
# Node TAP singleton summary policy, not a general-purpose TAP implementation.
br_tap_value() { # file key; malformed duplicates are also counted and rejected
  case "$2" in tests|pass|fail|cancelled|skipped|todo) ;; *) return 1;; esac
  awk -v k="$2" '
    $1=="#" && $2==k {n++; if($0 !~ ("^# " k " (0|[1-9][0-9]*)$")) bad=1; v=$3}
    END {if(n!=1 || bad) exit 1; print v}' "$1"
}
br_tap_check() { # file original-node-exit; failures are 72, never green
  local tests pass value key
  [ "$2" = 0 ] || return 72
  tests=$(br_tap_value "$1" tests) || return 72
  pass=$(br_tap_value "$1" pass) || return 72
  [ "$tests" != 0 ] && [ "$tests" = "$pass" ] || return 72
  for key in fail cancelled skipped todo; do
    value=$(br_tap_value "$1" "$key") || return 72
    [ "$value" = 0 ] || return 72
  done
}
