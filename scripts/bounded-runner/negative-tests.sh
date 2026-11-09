#!/bin/bash
# PREPARED, NOT EXECUTED. Lead must authorize a bounded test run separately.
# No real systemd commands or production paths are used by this harness.
set -uo pipefail
CORE=${BASH_SOURCE[0]%/*}
source "$CORE/common.sh"
source "$CORE/policy.sh"
source "$CORE/host.sh"
source "$CORE/envelope.sh"
source "$CORE/tap.sh"
BR_WORKLOAD_EXITS=(0 60 61 62 63 64 65 66 70 71 72 73 74)
failures=0
expect_rc() {
  local expected=$1 label=$2 actual; shift 2
  "$@"; actual=$?
  if [ "$actual" != "$expected" ]; then
    printf 'not ok - %s expected=%s actual=%s\n' "$label" "$expected" "$actual"
    failures=$((failures + 1))
  else printf 'ok - %s\n' "$label"; fi
}
expect_rc 1 duplicate-field br_field $'Type=exec\nType=exec' Type
expect_rc 1 missing-field br_field 'Other=exec' Type
expect_rc 1 diagnostic-path br_bus_path $'o "/org/freedesktop/systemd1/unit/a"\nwarning'
expect_rc 1 empty-object br_bus_path 'o "/org/freedesktop/systemd1/unit/"'
expect_rc 1 duplicate-runtime br_bus_u64 $'t 120000000\nt 120000000'
expect_rc 1 garbage-runtime br_bus_u64 't 120000000 warning'
expect_rc 1 negative-runtime br_bus_u64 't -1'
expect_rc 1 blank-line-runtime br_bus_u64 $'t 120000000\n\n'
expect_rc 1 blank-line-path br_bus_path $'o "/org/freedesktop/systemd1/unit/a"\n\n'
expect_rc 1 failed-terminal-query br_settled 1 $'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0'
expect_rc 1 live-terminal br_settled 0 $'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=42'
expect_rc 78 drift-over-workload br_verdict 72 yes 78
expect_rc 74 terminal-over-workload br_verdict 0 no 0
expect_rc 73 payload-evidence-over-drift br_verdict 73 no 78
expect_rc 60 preserve-special br_verdict 60 yes 0
expect_rc 70 reject-unknown br_verdict 42 yes 0
BR_WRITE_FAILURES=1
expect_rc 73 evidence-over-everything br_verdict 60 no 78
BR_WRITE_FAILURES=0

# Scratch-only parser/hash fixtures. No service/workload invocation.
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/bounded-runner-fixtures.XXXXXXXX") || exit 73
printf 'one\ntwo\n' > "$SCRATCH/multiline"
expect_rc 1 multiline-knob br_single "$SCRATCH/multiline"
printf 'MemAvailable: 819200 kB\nMemAvailable: 819200 kB\n' > "$SCRATCH/meminfo"
expect_rc 1 duplicate-memory br_memory_available "$SCRATCH/meminfo"
printf '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n' > "$SCRATCH/tap"
expect_rc 0 tap-green br_tap_check "$SCRATCH/tap" 0
printf '# fail garbage\n' >> "$SCRATCH/tap"
expect_rc 72 malformed-duplicate-tap br_tap_check "$SCRATCH/tap" 0
expect_rc 73 unwritable-evidence br_record "$SCRATCH/missing/file" '%s' no
expect_rc 73 sticky-evidence br_finish 0
BR_WRITE_FAILURES=0
printf 'before\n' > "$SCRATCH/input"
expect_rc 0 hash-before br_snapshot "$SCRATCH/before" "$SCRATCH/input"
printf 'after\n' > "$SCRATCH/input"
expect_rc 0 hash-after br_snapshot "$SCRATCH/after" "$SCRATCH/input"
expect_rc 1 actual-drift diff -q "$SCRATCH/before" "$SCRATCH/after"
BR_HOST_USED=yes
expect_rc 70 host-second-call br_host_run /unused /unused /unused /unused correspondence
BR_HOST_USED=no
printf 'fixtures_retained=%s\n' "$SCRATCH"

# Mock all lifecycle commands; timeout dispatches ONLY declared mocked commands.
MOCK_ID=0123456789abcdef0123456789abcdef
MOCK_LIVE=$'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=42'
MOCK_SHOW="$MOCK_LIVE"$'\nInvocationID='"$MOCK_ID"
MOCK_SHOW_RC=0 MOCK_STOP_RC=0 MOCK_SETTLE=yes
stops=0 records=0
BR_UNIT=correspondence-mock.service BR_RUN=/mock-evidence BR_LAUNCHED=yes
systemctl() {
  case "$1" in
    show) printf '%s\n' "$MOCK_SHOW"; return "$MOCK_SHOW_RC";;
    stop)
      [ "$2" = "$BR_UNIT" ] || return 99
      stops=$((stops + 1))
      if [ "$MOCK_SETTLE" = yes ]; then MOCK_SHOW=$'LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\nInvocationID='"$MOCK_ID"; fi
      return "$MOCK_STOP_RC";;
    *) return 99;;
  esac
}
timeout() { shift; case "$1" in systemctl|busctl) "$@";; *) return 99;; esac; }
# Replacing terminal's redirection target requires a scratch directory. No cleanup
# deletes it: keep failed evidence for review; only mktemp's directory is written.
BR_RUN=$(mktemp -d "${TMPDIR:-/tmp}/bounded-runner-negative.XXXXXXXX") || exit 73
br_record() { records=$((records + 1)); return 0; }
expect_rc 0 missing-receipt br_terminal
expect_rc 0 missing-receipt-no-stop test "$stops" = 0
expect_rc 0 missing-receipt-unconfirmed test "$BR_TERMINAL_OK" = no
# A same-name foreign service after StartTransientUnit failure is not ours.
BR_LAUNCH_RC=1
expect_rc 0 launch-collision br_terminal
expect_rc 0 collision-no-stop test "$stops" = 0
expect_rc 0 collision-unconfirmed test "$BR_TERMINAL_OK" = no
printf 'unit=%s\ninvocation_id=%s\n' "$BR_UNIT" ffffffffffffffffffffffffffffffff > "$BR_RUN/ownership.txt"
expect_rc 0 invocation-mismatch br_terminal
expect_rc 0 invocation-mismatch-no-stop test "$stops" = 0
expect_rc 0 invocation-mismatch-unconfirmed test "$BR_TERMINAL_OK" = no
printf 'unit=foreign.service\ninvocation_id=%s\n' "$MOCK_ID" > "$BR_RUN/ownership.txt"
expect_rc 0 unit-mismatch br_terminal
expect_rc 0 unit-mismatch-no-stop test "$stops" = 0
printf 'unit=%s\ninvocation_id=%s\ninvocation_id=%s\n' "$BR_UNIT" "$MOCK_ID" "$MOCK_ID" > "$BR_RUN/ownership.txt"
expect_rc 0 duplicate-receipt br_terminal
expect_rc 0 duplicate-receipt-no-stop test "$stops" = 0
expect_rc 0 duplicate-receipt-unconfirmed test "$BR_TERMINAL_OK" = no
printf 'unit=%s\ninvocation_id=%s\nextra=yes\n' "$BR_UNIT" "$MOCK_ID" > "$BR_RUN/ownership.txt"
expect_rc 0 extra-receipt-field br_terminal
expect_rc 0 extra-receipt-no-stop test "$stops" = 0
printf 'unit=%s\ninvocation_id=%s\n' "$BR_UNIT" "$MOCK_ID" > "$BR_RUN/ownership.txt"
BR_LAUNCH_RC=0
expect_rc 0 own-live-stop br_terminal
expect_rc 0 stop-count test "$stops" = 1
expect_rc 0 confirmed-terminal test "$BR_TERMINAL_OK" = yes
MOCK_SHOW_RC=1
expect_rc 0 failed-query-terminal br_terminal
expect_rc 0 failed-query-no-stop test "$stops" = 1
expect_rc 0 failed-query-not-settled test "$BR_TERMINAL_OK" = no
MOCK_SHOW_RC=0 MOCK_SETTLE=no
MOCK_ID=0123456789abcdef0123456789abcdef
MOCK_LIVE=$'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=42'
MOCK_SHOW="$MOCK_LIVE"$'\nInvocationID='"$MOCK_ID"
expect_rc 0 unsettled-stop br_terminal
expect_rc 0 unsettled-remains-no test "$BR_TERMINAL_OK" = no
BR_LAUNCHED=no
printf 'unit=%s\ninvocation_id=invalid\n' "$BR_UNIT" > "$BR_RUN/ownership.txt"
expect_rc 0 malformed-receipt br_terminal
expect_rc 0 malformed-no-stop test "$stops" = 2
expect_rc 0 malformed-unconfirmed test "$BR_TERMINAL_OK" = no
BR_WRITE_FAILURES=1
expect_rc 73 ownership-evidence-priority br_verdict 0 "$BR_TERMINAL_OK" 78
BR_WRITE_FAILURES=0

# Envelope readbacks and commands mocked; never read real /proc or cgroups.
br_single() {
  case "$1" in
    /proc/self/cgroup) printf '0::/system.slice/%s\n' "$MOCK_MEMBER";;
    */memory.max) printf '%s\n' "$MOCK_MEMORY";;
    */memory.swap.max) printf '0\n';;
    */pids.max) printf '32\n';;
    */cpu.max) printf '50000 100000\n';;
    *) return 1;;
  esac
}
systemctl() {
  [ "$1" = show ] || return 99
  case "$4" in
    InvocationID) printf 'InvocationID=%s\n' "$MOCK_ID";;
    Type) printf 'Type=exec\n';;
    *) return 99;;
  esac
}
mock_envelope_enter() {
  BR_RUN=$(mktemp -d "$SCRATCH/envelope.XXXXXXXX") || return 73
  br_envelope_enter "$BR_UNIT" "$BR_RUN"
}
INVOCATION_ID=$MOCK_ID MOCK_MEMBER=$BR_UNIT
busctl() {
  case "$2" in
    call) printf '%s\n' "$MOCK_PATH"; return "$MOCK_PATH_RC";;
    get-property) printf '%s\n' "$MOCK_RUNTIME"; return "$MOCK_RUNTIME_RC";;
    *) return 99;;
  esac
}
br_memory_available() { printf '%s\n' "$MOCK_AVAILABLE"; }
MOCK_MEMORY=402653184 MOCK_PATH='o "/org/freedesktop/systemd1/unit/mock"'
MOCK_PATH_RC=0 MOCK_RUNTIME='t 120000000' MOCK_RUNTIME_RC=0 MOCK_AVAILABLE=819200
BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no
expect_rc 0 exact-envelope mock_envelope_enter
expect_rc 70 second-envelope-refused mock_envelope_enter
BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no MOCK_MEMBER=foreign.service
expect_rc 70 foreign-cgroup-refused mock_envelope_enter
expect_rc 0 foreign-cgroup-no-receipt test ! -e "$BR_RUN/ownership.txt"
BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no MOCK_MEMBER=$BR_UNIT INVOCATION_ID=ffffffffffffffffffffffffffffffff
expect_rc 70 environment-invocation-mismatch mock_envelope_enter
expect_rc 0 environment-mismatch-no-receipt test ! -e "$BR_RUN/ownership.txt"
BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no INVOCATION_ID=INVALID
expect_rc 70 malformed-environment-invocation mock_envelope_enter
expect_rc 0 malformed-environment-no-receipt test ! -e "$BR_RUN/ownership.txt"
INVOCATION_ID=$MOCK_ID
BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no MOCK_MEMORY=max
expect_rc 70 unlimited-memory-refused mock_envelope_enter
BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no MOCK_MEMORY=402653184 MOCK_PATH_RC=1
expect_rc 70 failed-getunit-refused mock_envelope_enter
BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no MOCK_PATH_RC=0 MOCK_RUNTIME_RC=1
expect_rc 70 failed-runtime-refused mock_envelope_enter
BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no MOCK_RUNTIME_RC=0 MOCK_AVAILABLE=819199
expect_rc 70 low-memory-refused mock_envelope_enter
BR_WRITE_FAILURES=1 BR_ENVELOPE_USED=no BR_MEMORY_GATE_USED=no
expect_rc 73 evidence-over-envelope mock_envelope_enter
printf 'failures=%s\nscratch_retained=%s\n' "$failures" "$BR_RUN"
[ "$failures" = 0 ]
