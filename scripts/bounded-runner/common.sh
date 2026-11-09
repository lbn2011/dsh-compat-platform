#!/bin/bash
# ABI bounded-runner/1. Prepared source; not execution evidence.
# Load once in each host/payload shell. No implicit imports or shell-option changes.
BR_WRITE_FAILURES=0

br_uint() { [[ $1 =~ ^(0|[1-9][0-9]*)$ ]]; }
br_path() { [[ $1 = /* && $1 != *$'\n'* && $1 != *$'\r'* && $1 != *'\\'* ]]; }
br_unit() { [[ $1 =~ ^[a-z][a-z0-9-]*\.service$ ]]; }
br_write_failure() {
  BR_WRITE_FAILURES=$((BR_WRITE_FAILURES + 1))
  printf 'bounded-runner: evidence failure: %s\n' "$1" >&2
}
# Never pipe into these helpers: their failure counter belongs to this shell.
br_record() { # path format [printf arguments...]
  local path=$1; shift
  if ! printf "$@" > "$path"; then br_write_failure "$path"; return 73; fi
}
br_capture_file() { # destination source; empty artifacts are allowed
  if ! cat -- "$2" > "$1"; then br_write_failure "$1"; return 73; fi
}
br_evidence_gate() { [ "$BR_WRITE_FAILURES" -eq 0 ] || return 73; }
br_finish() { # requested return code; evidence failures always win
  br_evidence_gate || return 73
  return "$1"
}
br_field() { # complete systemctl output, key; duplicates INCLUDING malformed values fail
  printf '%s\n' "$1" | awk -v k="$2" '
    index($0,k "=")==1 { n++; v=substr($0,length(k)+2) }
    END { if(n!=1 || v=="") exit 1; print v }'
}
br_single() { # file: exactly one nonempty line, no CR
  awk 'NR==1 {v=$0} END {if(NR!=1 || v=="" || v ~ /\r/) exit 1; print v}' "$1"
}
br_bus_path() { # permit one terminal LF, never blank or diagnostic extra lines
  local raw=${1%$'\n'}
  local re='^o "(/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+)"$'
  [[ $raw =~ $re ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}
br_bus_u64() {
  local raw=${1%$'\n'}
  [[ $raw = 't '* ]] || return 1
  local value=${raw#t }
  br_uint "$value" || return 1
  [ "${#value}" -le 20 ] || return 1
  printf '%s\n' "$value"
}
br_settled() { # command rc, complete show output
  [ "$1" = 0 ] || return 1
  local load active sub pid
  load=$(br_field "$2" LoadState) || return 1
  active=$(br_field "$2" ActiveState) || return 1
  sub=$(br_field "$2" SubState) || return 1
  pid=$(br_field "$2" MainPID) || return 1
  case "$load" in loaded|merged|not-found) ;; *) return 1;; esac
  case "$active:$sub" in inactive:dead|failed:failed) ;; *) return 1;; esac
  [ "$pid" = 0 ]
}
br_digest() {
  local line digest
  br_path "$1" && [ -f "$1" ] || return 1
  line=$(sha256sum -- "$1") || return 1
  digest=${line%% *}
  [[ $digest =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s  %s\n' "$digest" "$1"
}
br_snapshot() { # output file followed by explicit absolute paths
  local out=$1 f line; shift
  br_record "$out" '%s' '' || return 73
  [ "$#" -gt 0 ] || return 77
  for f in "$@"; do
    line=$(br_digest "$f") || return 77
    if ! printf '%s\n' "$line" >> "$out"; then br_write_failure "$out"; return 73; fi
  done
}
