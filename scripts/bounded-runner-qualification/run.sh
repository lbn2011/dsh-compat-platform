#!/bin/bash
# PREPARED ONLY. Independent bootstrap: never source the core being qualified.
set -uo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
unset BASH_ENV ENV
umask 077
ROOT=/root/dsh-ecosystem-spec
CORE=$ROOT/projects/dsh-compat-platform/scripts/bounded-runner
SLICE=$ROOT/projects/dsh-compat-platform/scripts/bounded-runner-qualification
RUNS=/data/dsh-ecosystem-test-artifacts/runs
LOCK=$ROOT/experiments/acceptance/runs/.acceptance.lock
FILES=("$CORE/common.sh" "$CORE/policy.sh" "$CORE/host.sh" "$CORE/envelope.sh" "$CORE/tap.sh"
  "$CORE/core.manifest" "$CORE/negative-tests.sh" "$CORE/host-negative-tests.sh"
  "$SLICE/run.sh" "$SLICE/payload.sh" "$SLICE/README.md")
fail() { printf 'qualification: %s\n' "$2" >&2; exit "$1"; }
record() { local f=$1; shift; printf "$@" > "$RUN/$f" || return 73; }
snapshot() {
  local f line
  for f in "${FILES[@]}"; do
    [ -f "$f" ] && [ ! -L "$f" ] || return 77
    line=$(sha256sum -- "$f") || return 77
    [[ ${line%% *} =~ ^[0-9a-f]{64}$ ]] || return 77
    printf '%s\n' "$line" || return 73
  done
}
manifest() {
  local line digest rel actual
  local -A seen=()
  {
    IFS= read -r line || return 77
    [ "$line" = 'bounded-runner/1 source-review-unreleased' ] || return 77
    while :; do
      line=
      if ! IFS= read -r line; then [ -z "$line" ] || return 77; break; fi
      [[ $line =~ ^([0-9a-f]{64})\ \ ([a-z]+\.sh)$ ]] || return 77
      digest=${BASH_REMATCH[1]}; rel=${BASH_REMATCH[2]}
      case "$rel" in common.sh|policy.sh|host.sh|envelope.sh|tap.sh) ;; *) return 77;; esac
      [ -z "${seen[$rel]+present}" ] || return 77
      seen[$rel]=yes
      actual=$(sha256sum -- "$CORE/$rel") || return 77
      [ "${actual%% *}" = "$digest" ] || return 78
    done
  } < "$CORE/core.manifest"
  [ "${#seen[@]}" -eq 5 ] || return 77
}
field() {
  printf '%s\n' "$1" | awk -v k="$2" 'index($0,k "=")==1 {n++;v=substr($0,length(k)+2)} END {if(n!=1 || v=="")exit 1; print v}'
}
[ "$#" -eq 0 ] || fail 70 'no arguments accepted'
for cmd in timeout systemd-run systemctl journalctl flock bwrap busctl sha256sum diff awk date mkdir readlink chmod; do
  command -v "$cmd" >/dev/null 2>&1 || fail 70 "missing command: $cmd"
done
for f in "${FILES[@]}"; do [ -f "$f" ] && [ ! -L "$f" ] || fail 70 "missing/nonregular/symlink input: $f"; done
[ -f "$LOCK" ] && [ ! -L "$LOCK" ] || fail 70 'existing shared lock required'
exec 9<>"$LOCK" || fail 73 'cannot open lock'
flock -n 9 || fail 75 'shared lock held'
stamp=$(date -u +%Y%m%dT%H%M%SZ) || fail 73 'clock failed'
UNIT="bounded-runner-qualification-${stamp,,}-$$-$RANDOM.service"
RUN="$RUNS/$stamp-bounded-runner-qualification-$$-$RANDOM"
mkdir -p -- "$RUNS" || fail 73 'artifact root failed'
[ ! -e "$RUN" ] || fail 76 'run directory collision'
mkdir -m 700 -- "$RUN" || fail 73 'run directory failed'
printf 'run_dir=%s\nunit=%s\n' "$RUN" "$UNIT"
exec 8>"$RUN/hashes-before.txt" || fail 73 'before snapshot evidence open failed'
snapshot >&8; snapshot_rc=$?
exec 8>&-
[ "$snapshot_rc" = 0 ] || fail "$snapshot_rc" 'before snapshot failed'
manifest; rc=$?
record manifest-before.txt 'manifest_rc=%s\n' "$rc" || fail 73 'manifest evidence failed'
[ "$rc" = 0 ] || fail "$rc" 'manifest must match current core bytes; Lead refresh required'
# Read-only conflict guard. Failed queries are not an empty active set.
raw=$(timeout -k 2s 15s systemctl list-units --state=active,activating,deactivating --no-legend --plain \
  'bounded-runner-qualification-*' 'config-engine-install-*' 'profile-dump-*' 'diagnose-*' \
  'dependency-shape-*' 'correspondence-*' 'repair-plan-*' 'diagnostics-gui-*' \
  'package-install-*' 'trusted-extraction-*' 'spec-test-*' 'driver-config-contract-*' \
  'analyzer-test-script-*' 'profile-export-*' 'snapshot-compare-*' 'combined-report-*' \
  'hbl-*' 'tkl-*' 'harbor-*' 'lfx-*' 'rbk-*' 'tkb-*' 'cpy-*' 'exc-*' 'acq-*' \
  'p0-*' 'acc-*' 'admission-*' 2>&1); rc=$?
record active-units.txt 'query_rc=%s\n%s\n' "$rc" "$raw" || fail 73 'guard evidence failed'
[ "$rc" = 0 ] && [ -z "$raw" ] || fail 70 'active-unit guard refused'
argv=(systemd-run --wait --pipe --collect --unit="$UNIT"
  --property=Type=exec --property=MemoryMax=384M --property=MemorySwapMax=0
  --property=TasksMax=32 --property=CPUQuota=50% --property=CPUQuotaPeriodSec=100ms
  --property=RuntimeMaxSec=120 --property=KillMode=control-group --property=TimeoutStopSec=10s
  --working-directory="$SLICE" -- /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
  NODE_OPTIONS=--max-old-space-size=192 /bin/bash --noprofile --norc "$SLICE/payload.sh" "$UNIT" "$RUN")
record argv.txt '%q ' "${argv[@]}" || fail 73 'argv evidence failed'
record selection.txt 'selected_inputs=%s\ncore_imported_by_bootstrap=no\nautomatic_stop=never\n' "${#FILES[@]}" || fail 73 'selection evidence failed'
record launch.txt 'launch=about-to-attempt\nunit=%s\n' "$UNIT" || fail 73 'launch evidence failed'
exec 8>"$RUN/unit.log" || fail 73 'log open failed'
# Exactly one launch; timeout kills only its client process group, never stops a unit.
timeout -k 5s 160s "${argv[@]}" >&8 2>&1; launch_rc=$?
exec 8>&-
evidence=0
record systemd-run.rc '%s\n' "$launch_rc" || evidence=1
timeout -k 2s 15s journalctl -u "$UNIT" --no-pager -o cat > "$RUN/journal.txt" 2>&1; journal_rc=$?
record journal.rc '%s\n' "$journal_rc" || evidence=1
[ "$journal_rc" = 0 ] || evidence=1
raw=$(timeout -k 2s 15s systemctl show "$UNIT" -p LoadState -p ActiveState -p SubState -p MainPID 2>&1); query_rc=$?
record terminal-raw.txt 'query_rc=%s\n%s\n' "$query_rc" "$raw" || evidence=1
terminal=no
load=$(field "$raw" LoadState) || load=invalid
active=$(field "$raw" ActiveState) || active=invalid
sub=$(field "$raw" SubState) || sub=invalid
pid=$(field "$raw" MainPID) || pid=invalid
if [ "$query_rc" = 0 ] && [ "$pid" = 0 ]; then
  case "$load:$active:$sub" in loaded:inactive:dead|merged:inactive:dead|not-found:inactive:dead|loaded:failed:failed|merged:failed:failed|not-found:failed:failed) terminal=yes;; esac
fi
record terminal.txt 'terminal_ok=%s\nMainPID=%s\nautomatic_stop=never\n' "$terminal" "$pid" || evidence=1
hash_rc=0
if exec 8>"$RUN/hashes-after.txt"; then
  snapshot >&8; snapshot_rc=$?
  exec 8>&-
  if [ "$snapshot_rc" != 0 ]; then hash_rc=77; [ "$snapshot_rc" != 73 ] || evidence=1; fi
else hash_rc=77; evidence=1
fi
if [ "$hash_rc" = 0 ]; then
  if exec 8>"$RUN/hashes-diff.txt"; then
    diff -u "$RUN/hashes-before.txt" "$RUN/hashes-after.txt" >&8 2>&1; rc=$?
    exec 8>&-
    case "$rc" in 0) ;; 1) hash_rc=78;; *) hash_rc=77; evidence=1;; esac
  else evidence=1; hash_rc=77
  fi
fi
manifest; manifest_rc=$?
record manifest-after.txt 'manifest_rc=%s\n' "$manifest_rc" || evidence=1
[ "$manifest_rc" = 0 ] || hash_rc=$manifest_rc
result=$launch_rc
case "$result" in 0|70|71|72|73|77|78) ;; 124|137|143) result=74;; *) result=72;; esac
if [ "$launch_rc" = 0 ]; then
  for f in envelope-effective.txt envelope-systemctl.txt envelope-getunit.txt envelope-runtime.txt memory-gate.txt syntax.log negative-tests.log host-negative-tests.log payload-verdict.txt; do
    [ -s "$RUN/$f" ] || evidence=1
  done
  verdict=$(< "$RUN/payload-verdict.txt") || verdict=missing
  [ "$verdict" = 'qualification=complete' ] || evidence=1
fi
# Evidence > hash > terminal > workload; never erase evidence debt with timeout.
[ "$terminal" = yes ] || result=74
[ "$hash_rc" = 0 ] || result=$hash_rc
[ "$evidence" = 0 ] || result=73
record status.txt 'launch_rc=%s\nterminal_ok=%s\nhash_rc=%s\nevidence_failure=%s\nautomatic_stop=never\nacceptance_exit=%s\n' "$launch_rc" "$terminal" "$hash_rc" "$evidence" "$result" || exit 73
printf 'run_dir=%s\nacceptance_exit=%s\n' "$RUN" "$result"
exit "$result"
