#!/bin/bash
# PREPARED ONLY: execution must be separately authorized and externally bounded.
# No cleanup: retain every scratch artifact, including failures.
# Scope: real common/host/policy functions; simulated manager/payload, not integration.
# The ONLY source adaptation is policy's readonly BR_LOCK -> a scratch lock.
# Consequently this does NOT certify the production lock path/permissions or the
# checked-in manifest's hashes. Manifest parser tests use fresh exact fixture hashes.
set -uo pipefail

# Bootstrap only reads reviewed source files and copies them into a private tree.
# No production lock, /proc, cgroup, journal or manager reads are permitted.
if [ "${1:-}" != --scratch ]; then
  CORE=$(builtin cd -- "${BASH_SOURCE[0]%/*}" && builtin pwd -P) || exit 73
  SELF="$CORE/${BASH_SOURCE[0]##*/}"
  SCRATCH_BASE=${TMPDIR:-/tmp}
  [[ $SCRATCH_BASE = /* && -d $SCRATCH_BASE ]] || exit 73
  SCRATCH_BASE=$(builtin cd -- "$SCRATCH_BASE" && builtin pwd -P) || exit 73
  export BR_TEST_SCRATCH_BASE="$SCRATCH_BASE"
  SCRATCH=$(command mktemp -d "$SCRATCH_BASE/br-host-negative.XXXXXXXX") || exit 73
  [[ $SCRATCH = "$SCRATCH_BASE"/br-host-negative.* && -d $SCRATCH && ! -L $SCRATCH ]] || exit 73
  command mkdir -- "$SCRATCH/core" "$SCRATCH/bin" || exit 73
  for module in common.sh policy.sh host.sh envelope.sh tap.sh; do
    command cp -- "$CORE/$module" "$SCRATCH/core/$module" || exit 73
  done
  command cp -- "$SELF" "$SCRATCH/harness.sh" || exit 73
  printf 'scratch_retained=%s\n' "$SCRATCH"
  /bin/bash "$SCRATCH/harness.sh" --scratch "$SCRATCH"
  exit $?
fi
SCRATCH=${2:?scratch required}
[[ ${BR_TEST_SCRATCH_BASE:-} = /* && $SCRATCH = "$BR_TEST_SCRATCH_BASE"/br-host-negative.* && -d $SCRATCH && ! -L $SCRATCH && ${BASH_SOURCE[0]} = "$SCRATCH/harness.sh" ]] || exit 73
CORE="$SCRATCH/core"
SELF="$SCRATCH/harness.sh"
# Resolve only benign filesystem/text utilities before closing PATH. No executable
# links live in bin: unexpected external dispatch fails closed, even via command.
REAL_MKDIR=$(command -v mkdir) || exit 73
REAL_SHA=$(command -v sha256sum) || exit 73
REAL_AWK=$(command -v awk) || exit 73
REAL_DIFF=$(command -v diff) || exit 73
REAL_CAT=$(command -v cat) || exit 73
PATH="$SCRATCH/bin"
export PATH
EVENTS="$SCRATCH/events"
: > "$EVENTS"
denied() { printf 'DENIED %s\n' "$*" >> "$EVENTS"; return 99; }
scratch_path() { [[ $1 = "$SCRATCH/"* && $1 != */../* && $1 != */.. ]]; }
mkdir() {
  local arg
  for arg in "$@"; do
    case "$arg" in --|-p|-m|700) ;; *) scratch_path "$arg" || { denied mkdir "$@"; return 99; };; esac
  done
  "$REAL_MKDIR" "$@"
}
sha256sum() {
  [ "$#" = 2 ] && [ "$1" = -- ] && scratch_path "$2" || { denied sha256sum "$@"; return 99; }
  "$REAL_SHA" "$@"
}
awk() {
  # br_field reads stdin; br_single reads exactly one scratch file.
  if [ "$#" = 3 ] && [ "$1" = -v ] && [[ $2 = k=* ]]; then
    "$REAL_AWK" "$@"
  elif [ "$#" = 2 ] && scratch_path "$2"; then
    "$REAL_AWK" "$@"
  else denied awk "$@"; fi
}
diff() {
  [ "$#" = 3 ] && [ "$1" = -u ] && scratch_path "$2" && scratch_path "$3" || { denied diff "$@"; return 99; }
  "$REAL_DIFF" "$@"
}
cat() {
  [ "$#" = 2 ] && [ "$1" = -- ] && scratch_path "$2" || { denied cat "$@"; return 99; }
  "$REAL_CAT" "$@"
}
chmod() { denied chmod "$@"; }
date() { [ "$*" = '-u +%Y%m%dT%H%M%SZ' ] || { denied date "$@"; return 99; }; printf '20260101T000000Z\n'; }
flock() {
  [ "$*" = '-n 9' ] || { denied flock "$@"; return 99; }
  printf 'lock\n' >> "$EVENTS"
  [ "$SCENARIO" != lock-contention ]
}
systemd() { denied systemd "$@"; }
busctl() { denied busctl "$@"; }
timeout() {
  [ "$#" -ge 2 ] || { denied timeout "$@"; return 99; }
  local budget=$1 name=$2; shift 2
  case "$budget:$name" in
    30:systemctl) systemctl "$@";;
    20:systemctl) [ "${1:-}" = stop ] || { denied timeout "$name" "$@"; return 99; }; systemctl "$@";;
    200:systemd-run) systemd-run "$@";;
    30:journalctl) journalctl "$@";;
    *) denied timeout "$budget" "$name" "$@";;
  esac
}
systemctl() {
  case "${1:-}" in
    list-units)
      local -a expected=(list-units --state=active,activating,deactivating --no-legend --plain "${BR_UNIT_FAMILIES[@]}")
      same_argv expected "$@" || { denied systemctl "$@"; return 99; }
      printf 'guard\n' >> "$EVENTS"
      ;;
    show)
      [ "$*" = "show $BR_UNIT -p LoadState -p ActiveState -p SubState -p MainPID -p InvocationID" ] || { denied systemctl "$@"; return 99; }
      printf 'show\n' >> "$EVENTS"
      case "$SCENARIO" in
        foreign-refusal|missing-live-receipt)
          printf 'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=42\nInvocationID=%s\n' "$MOCK_ID";;
        collected)
          printf 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n';;
        *) printf 'LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\nInvocationID=%s\n' "$MOCK_ID";;
      esac
      ;;
    stop)
      # Any stop in these scenarios is a safety failure, even for the right name.
      printf 'stop\n' >> "$EVENTS"
      denied systemctl "$@";;
    *) denied systemctl "$@";;
  esac
}
same_argv() {
  local -n want=$1; shift
  [ "$#" = "${#want[@]}" ] || return 1
  local i=0 arg
  for arg in "$@"; do [ "$arg" = "${want[$i]}" ] || return 1; i=$((i + 1)); done
}
systemd-run() {
  local -a expected=(--wait --pipe --collect --unit="$BR_UNIT"
    --property=Type=exec --property=MemoryMax=384M --property=MemorySwapMax=0
    --property=TasksMax=32 --property=CPUQuota=50% --property=RuntimeMaxSec=120
    --working-directory="${PAYLOAD%/*}" -- /bin/bash "$PAYLOAD" "$BR_UNIT" "$BR_RUN")
  same_argv expected "$@" || { denied systemd-run "$@"; return 99; }
  printf 'launch\n' >> "$EVENTS"
  # The payload is NEVER executed; its receipt/evidence are explicit fixtures.
  printf 'write_failures=0\n' > "$BR_RUN/payload-evidence.txt" || return 73
  case "$SCENARIO" in
    foreign-refusal)
      printf 'unit=%s\ninvocation_id=ffffffffffffffffffffffffffffffff\n' "$BR_UNIT" > "$BR_RUN/ownership.txt"
      return 1;;
    missing-live-receipt) ;;
    *) printf 'unit=%s\ninvocation_id=%s\n' "$BR_UNIT" "$MOCK_ID" > "$BR_RUN/ownership.txt" || return 73;;
  esac
  case "$SCENARIO" in
    diff-open) mkdir -- "$BR_RUN/control-diff.txt" || return 73;;
    hash-drift) printf 'changed\n' >> "$SELECTED" || return 73;;
    special60) return 60;;
    special74) return 74;;
  esac
  return 0
}
journalctl() {
  [ "$*" = "-u $BR_UNIT --no-pager -o cat" ] || { denied journalctl "$@"; return 99; }
  printf 'journal\n' >> "$EVENTS"
  [ "$SCENARIO" != journal-failure ]
}

# Keep policy code intact except its impossible-to-override production lock.
lock_lines=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    readonly\ BR_LOCK=*) printf 'readonly BR_LOCK=%q\n' "$SCRATCH/acceptance.lock"; lock_lines=$((lock_lines + 1));;
    *) printf '%s\n' "$line";;
  esac
done < "$CORE/policy.sh" > "$CORE/policy-fixture.txt"
[ "$lock_lines" = 1 ] || { printf 'not ok - policy lock adaptation requires review\n'; exit 1; }
# No move/delete; overwrite only our own copied fixture.
"$REAL_CAT" "$CORE/policy-fixture.txt" > "$CORE/policy.sh" || exit 73
: > "$SCRATCH/acceptance.lock"
source "$CORE/common.sh"
source "$CORE/policy.sh"
source "$CORE/host.sh"
BR_WORKLOAD_EXITS=(0 60 74)
BR_EXTRA_CONTROL=("$SELF")
BR_SELECTED_INPUTS=()
WRAPPER="$SCRATCH/wrapper.sh"
PAYLOAD="$SCRATCH/payload.sh"
printf '# inert wrapper fixture\n' > "$WRAPPER"
printf '# inert payload fixture: never executed\n' > "$PAYLOAD"
MOCK_ID=0123456789abcdef0123456789abcdef
checks=0 failures=0
check() {
  local label=$1; shift
  checks=$((checks + 1))
  if "$@"; then printf 'ok %s - %s\n' "$checks" "$label"
  else printf 'not ok %s - %s\n' "$checks" "$label"; failures=$((failures + 1)); fi
}
manifest() {
  local mode=$1 module line
  printf 'bounded-runner/1 source-review-unreleased\n'
  [ "$mode" != duplicate-header ] || printf 'bounded-runner/1 source-review-unreleased\n'
  for module in common.sh policy.sh host.sh envelope.sh tap.sh; do
    [ "$mode:$module" != missing-row:tap.sh ] || continue
    line=$(sha256sum -- "$CORE/$module") || return 73
    line="${line%% *}  $module"
    if [ "$mode:$module" = digest-mismatch:tap.sh ]; then line="${ZERO_DIGEST}  $module"; fi
    if [ "$mode:$module" = unterminated:tap.sh ]; then printf '%s' "$line"; else printf '%s\n' "$line"; fi
    [ "$mode:$module" != duplicate-row:common.sh ] || printf '%s\n' "$line"
  done
  [ "$mode" != unknown-row ] || printf '%s  alien.sh\n' "$ZERO_DIGEST"
  return 0
}
ZERO_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
for mode in valid duplicate-header missing-row duplicate-row unknown-row unterminated digest-mismatch; do
  manifest "$mode" > "$CORE/core.manifest" || exit 73
  expected=77
  case "$mode" in valid) expected=0;; digest-mismatch) expected=78;; esac
  br_control_closure "$CORE" "$WRAPPER" "$PAYLOAD"; actual=$?
  check "manifest $mode rc=$actual expected=$expected" test "$actual" = "$expected"
  if [ "$mode" = valid ]; then
    check 'valid manifest exact closure count (manifest, wrapper, payload, five modules, harness)' test "${#BR_CONTROL_FILES[@]}" = 9
  fi
done
manifest valid > "$CORE/core.manifest" || exit 73

count_event() {
  local wanted=$1 line n=0
  while IFS= read -r line; do [ "$line" != "$wanted" ] || n=$((n + 1)); done < "$EVENTS"
  printf '%s' "$n"
}
no_denied() {
  local line
  while IFS= read -r line; do [[ $line != DENIED* ]] || return 1; done < "$EVENTS"
}
# Each scenario is a dedicated first-call shell. No second-call guard shortcuts,
# no overrides of br_host_run, br_terminal, br_record, br_snapshot or br_verdict.
host_case() (
  SCENARIO=$1 expected=$2
  checks=0 failures=0
  CASE_ROOT="$SCRATCH/$SCENARIO"
  mkdir -- "$CASE_ROOT" || exit 73
  EVENTS="$CASE_ROOT/events"; : > "$EVENTS"
  SELECTED="$CASE_ROOT/input"; printf 'before\n' > "$SELECTED"
  BR_SELECTED_INPUTS=("$SELECTED")
  BR_HOST_USED=no BR_LAUNCHED=no BR_WRITE_FAILURES=0
  check "$SCENARIO starts unused" test "$BR_HOST_USED" = no
  br_host_run "$CORE" "$WRAPPER" "$PAYLOAD" "$CASE_ROOT/runs" correspondence
  actual=$?
  check "$SCENARIO return rc=$actual expected=$expected" test "$actual" = "$expected"
  check "$SCENARIO consumed first call" test "$BR_HOST_USED" = yes
  launches=1
  [ "$SCENARIO" != lock-contention ] || launches=0
  check "$SCENARIO exact launch count=$launches" test "$(count_event launch)" = "$launches"
  check "$SCENARIO no stop (including foreign names)" test "$(count_event stop)" = 0
  check "$SCENARIO fail-closed dispatch remained clean" no_denied
  check "$SCENARIO single lock attempt" test "$(count_event lock)" = 1
  if [ "$launches" = 1 ]; then
    check "$SCENARIO guard queried once" test "$(count_event guard)" = 1
    check "$SCENARIO journal queried once" test "$(count_event journal)" = 1
    check "$SCENARIO terminal queried once" test "$(count_event show)" = 1
    acceptance= phase= hash_rc= terminal_ok=
    while IFS='=' read -r key value; do
      case "$key" in acceptance_exit) acceptance=$value;; phase) phase=$value;; hash_rc) hash_rc=$value;; terminal_ok) terminal_ok=$value;; esac
    done < "$BR_RUN/status.txt"
    check "$SCENARIO persisted verdict=$expected" test "$acceptance" = "$expected"
    check "$SCENARIO completed whole host path" test "$phase" = completed
    case "$SCENARIO" in
      diff-open) check 'diff output open failure is evidence debt, not drift' test "$hash_rc" = 77;;
      hash-drift) check 'real selected-file hash drift classified 78' test "$hash_rc" = 78;;
      foreign-refusal|missing-live-receipt) check 'live unowned unit remains unconfirmed' test "$terminal_ok" = no;;
    esac
  else
    check 'lock contention never created run directory' test ! -e "$CASE_ROOT/runs"
    check 'lock contention never queried manager' test "$(count_event guard)" = 0
  fi
  printf '# scenario=%s checks=%s failures=%s\n' "$SCENARIO" "$checks" "$failures"
  [ "$failures" = 0 ]
)
for scenario in success foreign-refusal lock-contention journal-failure diff-open hash-drift special60 special74 collected missing-live-receipt; do
  expected=0
  case "$scenario" in
    foreign-refusal|missing-live-receipt|special74) expected=74;;
    lock-contention) expected=75;;
    journal-failure|diff-open) expected=73;;
    hash-drift) expected=78;;
    special60) expected=60;;
  esac
  check "full first-call scenario $scenario" host_case "$scenario" "$expected"
done
# Known audit gap in reviewed source: br_terminal requires InvocationID/receipt
# before accepting br_settled. The collected case deliberately expects success,
# so that implementation fails this suite rather than gaining a fake green check.
# No assertion is made about real manager ownership, payload envelope enforcement,
# actual advisory locking, or production manifest freshness: all are out of scope.
printf '# top_level_checks=%s failures=%s scratch_retained=%s\n' "$checks" "$failures" "$SCRATCH"
[ "$failures" = 0 ]
