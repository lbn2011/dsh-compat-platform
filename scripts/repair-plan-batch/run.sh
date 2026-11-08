#!/bin/bash
# Host-side launcher for the dsh-compat-repair acceptance batch.
#
# STATUS: PREPARED. Written for review before execution; nothing has been run on
# these bytes at the time of writing.
#
# Scope: ONE transient unit, one workload, no retry. Two questions:
#   1. Are the repair plan and preview modules what they claim — a closed schema, a
#      one-element operation vocabulary, a stale refusal, and no writer anywhere?
#   2. Does the package's own suite pass, unmodified, under the envelope, and does
#      the shipped example preview render without writing anything?
#
# No repair is applied by this batch: there is no apply path to call.
#
# Usage:  bash projects/dsh-compat-platform/scripts/repair-plan-batch/run.sh
#         Takes no arguments.
#
# Exit codes: 0 green; 70 refusal before or inside the launch; 71 static contract
# failed (no test was started); 72 test verdict not green; 73 an evidence write
# failed; 74 the unit did not settle; 75 lock held; 76 run-directory collision;
# 77 a hash manifest could not be read or written; 78 selected-input drift.

set -uo pipefail

ROOT=/root/dsh-ecosystem-spec
REPO=$ROOT/projects/dsh-compat-platform
PKG=$REPO/packages/repair
SLICE=$REPO/scripts/repair-plan-batch
# Raw artifacts live OUTSIDE the repository; only the narrative record is committed.
RUNS=${REPAIR_PLAN_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
LOCKFILE=/root/dsh-ecosystem-spec/experiments/acceptance/runs/.acceptance.lock
RUNNER=$SLICE/run.sh
PAYLOAD=$SLICE/payload.sh
NODE=/www/server/nodejs/v24.21.0/bin/node
UNIT_PREFIX=repair-plan-batch

EXPECT_MEM=384M
EXPECT_SWAP=0
EXPECT_TASKS=32
EXPECT_RUNTIME=120
EXPECT_CPU=50%

# The suite is the package's own; the glob matches what `npm test` discovers.
TEST_GLOB=(tests)

# SELECTED INPUTS. The runner, the payload and every byte this batch judges are
# hashed, so a change to what is judged shows up as drift in the same manifest.
# This is a named selection, not a dependency closure — and this package has no
# dependencies at all, which the static contract re-checks.
HASHED=(
  "$RUNNER"
  "$PAYLOAD"
  "$PKG/package.json"
  "$PKG/README.md"
  "$PKG/src/repair-plan.js"
  "$PKG/src/repair-preview.js"
  "$PKG/tests/repair.test.js"
  "$REPO/examples/repair/profile.yml"
  "$REPO/examples/repair/plan.json"
  "$REPO/examples/repair/preview.mjs"
)
TEST_FILES=(
  tests/repair.test.js
)

write_fail=0
addwf() { write_fail=$((write_fail + 1)); printf 'run.sh: evidence write failed: %s\n' "$1" >&2; }
die() { printf 'run.sh: %s\n' "$2" >&2; exit "$1"; }
wr() { cat > "$1" || return 1; [ -s "$1" ] || return 1; }
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }
show_field() {
  printf '%s\n' "$1" | awk -F= -v k="$2" '
    BEGIN { n = 0; v = "" }
    $1 == k { n++; v = substr($0, length(k) + 2) }
    END { if (n == 1) { print v } else { print "<ambiguous-or-missing:" n ">" } }
  '
}
# A terminal state counts as settled only when all four facts agree.
settled_read() {
  local rc=$1 load=$2 active=$3 sub=$4 pid=$5
  [ "$rc" -eq 0 ] || return 1
  case "$load" in not-found|loaded|merged) ;; *) return 1 ;; esac
  case "$active:$sub" in inactive:dead|failed:failed) ;; *) return 1 ;; esac
  [ "$pid" = 0 ] || return 1
  return 0
}
hashset() {
  local f line digest
  for f in "${HASHED[@]}"; do
    line=$(sha256sum "$f" 2>/dev/null) || return 1
    digest=${line%% *}
    case "$digest" in *[!0-9a-f]*) return 1 ;; esac
    [ "${#digest}" -eq 64 ] || return 1
    printf '%s\n' "$line" || return 1
  done
}

[ "$#" -eq 0 ] || die 70 "this runner takes no arguments (got $#)"

# ---------------------------------------------------------------- 0. preflight
command -v systemd-run >/dev/null 2>&1 || die 70 "systemd-run missing"
command -v flock >/dev/null 2>&1 || die 70 "flock missing"
command -v bwrap >/dev/null 2>&1 || die 70 "bwrap missing"
command -v journalctl >/dev/null 2>&1 || die 70 "journalctl missing"
[ -x "$NODE" ] || die 70 "node binary missing: $NODE"
for f in "$RUNNER" "$PAYLOAD"; do [ -f "$f" ] || die 70 "batch file missing: $f"; done
missing=''
for f in "${HASHED[@]}"; do [ -f "$f" ] || missing="$missing $f"; done
[ -z "$missing" ] || die 70 "selected input missing:${missing}"

mkdir -p "$RUNS" || die 73 "cannot create $RUNS"

# One acceptance batch at a time, through the SAME lock every other batch uses.
[ -e "$LOCKFILE" ] || die 70 "shared lock file missing: $LOCKFILE"
exec 9>"$LOCKFILE" || die 73 "cannot open lock file $LOCKFILE"
# A held lock is a refusal, never a wait: this batch does not queue behind others.
flock -n 9 || die 75 "another acceptance batch holds the shared lock $LOCKFILE"

STAMP=$(date -u +%Y%m%dT%H%M%SZ) || die 73 "cannot read the clock"
# The unit name carries the .service suffix: the payload checks it and derives the
# busctl object path from it, and a suffixless name addresses the wrong object.
UNIT="$UNIT_PREFIX-$STAMP-$$-$RANDOM.service"
RUN="$RUNS/$STAMP-$UNIT_PREFIX-$$-$RANDOM"
[ -e "$RUN" ] && die 76 "run directory already exists: $RUN"
mkdir "$RUN" || die 73 "cannot create run directory: $RUN"
chmod 700 "$RUN" 2>/dev/null || addwf chmod-run

refuse() { # code reason
  if ! printf 'acceptance_exit=%s\nrefusal=%s\nworkload_started=no\nunit=%s\nrun_dir=%s\n' \
      "$1" "$2" "$UNIT" "$RUN" | wr "$RUN/status.txt"; then
    addwf status.txt
    printf 'run.sh: refusal could not be recorded (%s); exiting 73\n' "$2" >&2
    exit 73
  fi
  printf 'run_dir=%s\nacceptance_exit=%s\nrefusal=%s\n' "$RUN" "$1" "$2"
  exit "$1"
}

if ! hashset | wr "$RUN/hashes-before.txt"; then
  addwf hashes-before.txt
  refuse 73 snapshot_write_failed
fi
BEFORE_LINES=$(awk 'END { print NR }' "$RUN/hashes-before.txt")
if [ "$BEFORE_LINES" -ne "${#HASHED[@]}" ]; then
  addwf hashes-before-incomplete
  refuse 73 snapshot_incomplete
fi
printf 'selected_inputs=%s\n' "${#HASHED[@]}" > "$RUN/selection.txt" || addwf selection.txt

# The unit family query is evidence: a failed query is not "nothing is running".
UNITS_RAW=$(systemctl list-units --state=active,activating,deactivating --no-legend --plain \
  'repair-plan-batch-*' \
  'spec-test-batch-*' \
  'profile-dump-batch-*' 'profile-dump-install-*' 'diagnose-batch-*' 'diagnose-real-wiring-*' \
  'diagnostics-gui-*' 'dependency-shape-*' 'trusted-extraction-batch-*' \
  'driver-config-contract-batch-*' \
'p0-*' 'acc-*' 'admission-*' 2>"$RUN/active-units.err")
units_rc=$?
if [ "$units_rc" -ne 0 ]; then
  [ -s "$RUN/active-units.err" ] || addwf active-units.err
  refuse 70 "active_unit_query_failed(rc=$units_rc)"
fi
if [ -n "$UNITS_RAW" ]; then
  printf '%s\n' "$UNITS_RAW" | wr "$RUN/active-units.txt" || addwf active-units.txt
  refuse 70 active_units_present
fi
: > "$RUN/active-units.txt" || addwf active-units.txt

# ---------------------------------------------------------------- 1. one launch
ARGV=(systemd-run --wait --pipe --collect --unit="$UNIT"
  --property=Type=exec
  --property=MemoryMax="$EXPECT_MEM" --property=MemorySwapMax="$EXPECT_SWAP"
  --property=TasksMax="$EXPECT_TASKS" --property=RuntimeMaxSec="$EXPECT_RUNTIME"
  --property=CPUQuota="$EXPECT_CPU"
  --working-directory="$SLICE"
  -- /bin/bash "$PAYLOAD" "$UNIT" "$RUN")

if ! printf '%q ' "${ARGV[@]}" | wr "$RUN/argv.txt"; then
  addwf argv.txt
  refuse 73 argv_write_failed
fi

: > "$RUN/unit.log" || { addwf unit.log; refuse 73 unit_log_unwritable; }
if ! printf 'probe\n' >> "$RUN/unit.log"; then addwf unit.log-probe; refuse 73 unit_log_unwritable; fi
: > "$RUN/unit.log" || { addwf unit.log; refuse 73 unit_log_unwritable; }

printf 'unit=%s\nrun_dir=%s\nlaunch=started\n' "$UNIT" "$RUN" > "$RUN/launch.txt" \
  || { addwf launch.txt; refuse 73 launch_write_failed; }

# Every artefact a launch would rely on must exist before the launch happens.
if [ "$write_fail" -ne 0 ]; then
  refuse 73 prelaunch_evidence_write_failed
fi

timeout 200 "${ARGV[@]}" > "$RUN/unit.log" 2>&1
launch_rc=$?
printf '%s\n' "$launch_rc" > "$RUN/systemd-run.rc" || addwf systemd-run.rc

timeout 30 journalctl -u "$UNIT" --no-pager -o cat > "$RUN/journal.txt" 2>&1
journal_rc=$?
printf 'journal_rc=%s\n' "$journal_rc" >> "$RUN/journal.txt" || addwf journal-rc-line
if [ "$journal_rc" -ne 0 ]; then addwf "journalctl_rc:$journal_rc"; fi
[ -s "$RUN/journal.txt" ] || addwf journal-empty

# ---------------------------------------------------------------- 2. terminal state
tq_raw=$(timeout 30 systemctl show "$UNIT" -p LoadState -p ActiveState -p SubState -p MainPID 2>&1)
tq_rc=$?
printf '%s\n' "$tq_raw" > "$RUN/terminal-query-raw.txt" || addwf terminal-query-raw.txt
load=$(show_field "$tq_raw" LoadState)
active=$(show_field "$tq_raw" ActiveState)
sub=$(show_field "$tq_raw" SubState)
pid=$(show_field "$tq_raw" MainPID)

stop_attempted=no; stop_rc=not-attempted
confirm=unconfirmed; terminal_ok=no
if settled_read "$tq_rc" "$load" "$active" "$sub" "$pid"; then
  terminal_ok=yes; confirm=settled
else
  if [ "$tq_rc" -eq 0 ] && is_num "$pid" && [ "$pid" -gt 0 ]; then
    case "$load:$active" in
      loaded:active|loaded:activating|loaded:reloading|loaded:deactivating|merged:active)
        stop_attempted=yes
        timeout 20 systemctl stop "$UNIT" 2>/dev/null; stop_rc=$?
        c1=$(timeout 30 systemctl show "$UNIT" -p LoadState -p ActiveState -p SubState -p MainPID 2>&1); c1_rc=$?
        printf '%s\n' "$c1" > "$RUN/stop-confirm-1.txt" || addwf stop-confirm-1.txt
        if settled_read "$c1_rc" "$(show_field "$c1" LoadState)" "$(show_field "$c1" ActiveState)" "$(show_field "$c1" SubState)" "$(show_field "$c1" MainPID)"; then
          terminal_ok=yes; confirm=stopped-and-settled
          tq_rc=$c1_rc
          load=$(show_field "$c1" LoadState); active=$(show_field "$c1" ActiveState)
          sub=$(show_field "$c1" SubState); pid=$(show_field "$c1" MainPID)
        else
          confirm=stop-did-not-settle
        fi
        ;;
      *) confirm=not-confirmed-live ;;
    esac
  else
    confirm=query-failed-or-unreadable
  fi
fi

printf 'terminal_query_rc=%s\nload_state=%s\nactive_state=%s\nsub_state=%s\nmain_pid=%s\nterminal_ok=%s\nconfirmation=%s\nstop_attempted=%s\nstop_rc=%s\nlaunch_rc=%s\n' \
  "$tq_rc" "$load" "$active" "$sub" "$pid" "$terminal_ok" "$confirm" "$stop_attempted" "$stop_rc" "$launch_rc" \
  > "$RUN/terminal-query.txt" || addwf terminal-query.txt

# ---------------------------------------------------------------- 3. post-run hashes
hash_rc=0
if ! hashset | wr "$RUN/hashes-after.txt"; then
  addwf hashes-after.txt
  hash_rc=77
else
  diff -q "$RUN/hashes-before.txt" "$RUN/hashes-after.txt" > "$RUN/hashes-diff.txt" 2>&1
  diff_rc=$?
  if [ "$diff_rc" -eq 1 ]; then hash_rc=78; elif [ "$diff_rc" -ne 0 ]; then hash_rc=77; fi
fi

# ---------------------------------------------------------------- 4. verdict
payload_rc=$launch_rc
exit_rc=0
case "$payload_rc" in
  0) exit_rc=0 ;;
  70|71|72|73) exit_rc=$payload_rc ;;
  124) exit_rc=74 ;;
  *) exit_rc=70 ;;
esac
[ "$terminal_ok" = yes ] || exit_rc=74
[ "$hash_rc" -ne 0 ] && exit_rc=$hash_rc
# An unrecorded run is not a green one: a write failure outranks every verdict.
[ "$write_fail" -ne 0 ] && exit_rc=73

launch_state=completed
[ "$launch_rc" -eq 124 ] && launch_state=timed_out

if ! printf '%s\n' \
  "unit=$UNIT" \
  "run_dir=$RUN" \
  "launch=$launch_state" \
  "systemd_run_rc=$launch_rc" \
  "payload_rc=$payload_rc" \
  "terminal_ok=$terminal_ok" \
  "terminal_confirmation=$confirm" \
  "hashes=$([ "$hash_rc" -eq 0 ] && echo identical || echo not-identical)" \
  "hash_rc=$hash_rc" \
  "selected_inputs=${#HASHED[@]}" \
  "write_failures=$write_fail" \
  "acceptance_exit=$exit_rc" | wr "$RUN/status.txt"; then
  addwf status.txt
  printf 'run_dir=%s\nacceptance_exit=73\nrefusal=final_status_write_failed\n' "$RUN"
  exit 73
fi
printf 'run_dir=%s\nacceptance_exit=%s\nwrite_failures=%s\n' "$RUN" "$exit_rc" "$write_fail"
if [ "$write_fail" -ne 0 ]; then exit 73; fi
exit "$exit_rc"
