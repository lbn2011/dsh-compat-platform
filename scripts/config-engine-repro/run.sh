#!/bin/bash
# PREPARED ONLY. Independent adapter; no shared-core source, acquisition or patch.
# Invoke explicitly with bash. No execution/syntax qualification is claimed.
# 0 not-reproduced; 2 reproduced (NOT test failure); 70 setup/control failure;
# 73 evidence; 74 unsettled; 75 lock held; 77 hash failure; 78 input drift.
set -uo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C
unset BASH_ENV ENV NODE_OPTIONS NODE_PATH
ROOT=/root/dsh-ecosystem-spec
SLICE=$ROOT/projects/dsh-compat-platform/scripts/config-engine-repro
NODE=/www/server/nodejs/v24.21.0/bin/node
RUNS=/data/dsh-ecosystem-test-artifacts/runs
LOCK=$ROOT/experiments/acceptance/runs/.acceptance.lock
BASE=${1:-}; MANIFEST_SHA=${2:-}; LOCK_SHA=${3:-}
fail() { printf 'setup-failure: %s\n' "$2" >&2; exit "$1"; }
pathok() { [[ $1 =~ ^/[A-Za-z0-9_./-]+$ && $1 != / ]]; }
within() { [[ $2 = "$1" || $2 = "$1/"* ]]; }
[ "$#" = 3 ] || fail 70 'usage: bash run.sh ABSOLUTE_ACQUIRED_BASE MANIFEST_SHA256 LOCK_SHA256'
pathok "$BASE" || fail 70 'base must be a simple absolute path'
[[ $MANIFEST_SHA =~ ^[0-9a-f]{64}$ && $LOCK_SHA =~ ^[0-9a-f]{64}$ ]] || fail 70 'expected SHA256 values required'
canonical=$(realpath -e -- "$BASE") || fail 70 'base missing'
[ "$canonical" = "$BASE" ] && [ -d "$BASE/node_modules" ] || fail 70 'base must be canonical with acquired node_modules'
# Refuse bind overlap/ancestor shadowing of controls, toolchain or run storage.
for protected in "$ROOT" /usr /bin /lib /lib64 /www /dev /proc /etc; do
  if within "$protected" "$BASE" || within "$BASE" "$protected"; then fail 70 'base overlaps reserved mounts'; fi
done
within "$BASE" "$RUNS" && fail 70 'base contains output root'
for f in package.json package-lock.json; do
  [ -f "$BASE/$f" ] && [ ! -L "$BASE/$f" ] || fail 70 "missing/nonregular acquired $f"
done
for cmd in systemd-run systemctl journalctl flock timeout bwrap sha256sum diff realpath date awk stat; do
  command -v "$cmd" >/dev/null || fail 70 "missing $cmd"
done
[ -x "$NODE" ] || fail 70 'node unavailable'
# Pin selected controls and the actual executable tools, not dependency closure.
HASHED=("$SLICE/run.sh" "$SLICE/payload.sh" "$SLICE/cases.mjs" "$BASE/package.json" "$BASE/package-lock.json" "$NODE")
for cmd in bash systemd-run systemctl busctl journalctl flock timeout bwrap sha256sum diff realpath date awk stat mkdir env; do
  resolved=$(command -v "$cmd") || fail 70 'tool missing'
  resolved=$(realpath -e -- "$resolved") || fail 70 'tool resolution failed'
  HASHED+=("$resolved")
done
[ -f "$LOCK" ] && [ ! -L "$LOCK" ] || fail 70 'existing shared lock required'
exec 9<>"$LOCK" || fail 73 'lock open failed'
flock -n 9 || fail 75 'shared lock held'
mkdir -p -- "$RUNS" || fail 73 'output root unavailable'
[ "$(realpath -e -- "$RUNS")" = "$RUNS" ] || fail 70 'output root not canonical'
stamp=$(date -u +%Y%m%dT%H%M%SZ) || fail 70 'clock unavailable'
UNIT="config-engine-repro-${stamp,,}-$$-$RANDOM.service"
RUN="$RUNS/$UNIT"
within "$BASE" "$RUN" && fail 70 'output inside acquired base'
within "$ROOT" "$RUN" && fail 70 'output inside checkout'
mkdir -m 700 -- "$RUN" || fail 73 'fresh output creation failed'
wf=0
record() { local dest=$1; shift; printf "$@" > "$RUN/$dest" || { wf=1; return 73; }; }
snapshot() {
  local out=$1 f line
  record "$out" '%s' '' || return 73
  for f in "${HASHED[@]}"; do
    line=$(sha256sum -- "$f") || return 77
    [[ ${line%% *} =~ ^[0-9a-f]{64}$ ]] || return 77
    printf '%s\n' "$line" >> "$RUN/$out" || { wf=1; return 73; }
  done
}
finish() {
  local rc=$1 status=$2
  [ "$wf" = 0 ] || { rc=73; status=setup-failure; }
  record status.txt 'status=%s\nexit=%s\nunit=%s\nrun_dir=%s\nlaunch_rc=%s\nterminal_ok=%s\nhash_rc=%s\nevidence_failure=%s\nconformance_claim=no\npatch_performed=no\n' \
    "$status" "$rc" "$UNIT" "$RUN" "${launch_rc:-not-launched}" "${terminal:-not-queried}" "${hash_rc:-not-checked}" "$wf" || rc=73
  printf 'run_dir=%s\nstatus=%s\nexit=%s\n' "$RUN" "$status" "$rc"
  exit "$rc"
}
snapshot hashes-before.txt; rc=$?
[ "$rc" = 0 ] || finish "$rc" setup-failure
# Verify supplied digests against the snapshot actually recorded BEFORE launch.
manifest_actual=$(awk -v p="$BASE/package.json" '$2==p {n++; v=$1} END {if(n!=1) exit 1; print v}' "$RUN/hashes-before.txt") || finish 77 setup-failure
lock_actual=$(awk -v p="$BASE/package-lock.json" '$2==p {n++; v=$1} END {if(n!=1) exit 1; print v}' "$RUN/hashes-before.txt") || finish 77 setup-failure
[ "$manifest_actual" = "$MANIFEST_SHA" ] && [ "$lock_actual" = "$LOCK_SHA" ] || finish 78 setup-failure
record selection.txt 'dependency_base=%s\nmanifest_sha256=%s\nlock_sha256=%s\nselected_count=%s\ndependency_closure=no\n' "$BASE" "$MANIFEST_SHA" "$LOCK_SHA" "${#HASHED[@]}" || finish 73 setup-failure
families=('config-engine-*' 'profile-dump-*' 'diagnose-*' 'dependency-shape-*' 'correspondence-*' 'repair-plan-*' 'diagnostics-gui-*' 'profile-dump-install-*' 'package-install-*' 'trusted-extraction-*' 'spec-test-*' 'driver-config-contract-*' 'analyzer-test-script-*' 'profile-export-*' 'snapshot-compare-*' 'combined-report-*' 'hbl-*' 'tkl-*' 'harbor-*' 'lfx-*' 'rbk-*' 'tkb-*' 'cpy-*' 'exc-*' 'acq-*' 'p0-*' 'acc-*' 'admission-*')
raw=$(timeout -k 1s 3s systemctl list-units --state=active,activating,deactivating --no-legend --plain "${families[@]}" 2>&1); rc=$?
record active-units.txt 'query_rc=%s\n%s\n' "$rc" "$raw" || finish 73 setup-failure
[ "$rc" = 0 ] && [ -z "$raw" ] || finish 70 setup-failure
argv=(systemd-run --wait --pipe --collect --unit="$UNIT" --property=Type=exec
  --property=MemoryMax=384M --property=MemorySwapMax=0 --property=TasksMax=32
  --property=CPUQuota=50% --property=CPUQuotaPeriodSec=100ms --property=RuntimeMaxSec=120
  --property=KillMode=control-group --property=TimeoutStopSec=1s
  --working-directory="$SLICE" -- /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C
  /bin/bash "$SLICE/payload.sh" "$UNIT" "$RUN" "$BASE" "$MANIFEST_SHA" "$LOCK_SHA")
record argv.txt '%q ' "${argv[@]}" || finish 73 setup-failure
record launch.txt 'launch=about-to-attempt\n' || finish 73 setup-failure
# Per-file 1 MiB ceiling, inherited by launcher/payload; not an aggregate disk quota.
# This may SIGXFSZ a noisy process; such a run is setup failure, never reproduction.
exec 7>"$RUN/unit.stdout" 8>"$RUN/unit.stderr" || finish 73 setup-failure
(ulimit -f 1024 || exit 73; timeout -k 1s 130s "${argv[@]}") >&7 2>&8
launch_rc=$?
exec 7>&- 8>&-
record systemd-run.rc '%s\n' "$launch_rc" || :
(ulimit -f 1024 || exit 73; timeout -k 1s 3s journalctl -u "$UNIT" -n 200 --no-pager -o cat) > "$RUN/journal.txt" 2>&1
rc=$?; record journal.rc '%s\n' "$rc" || :
[ "$rc" = 0 ] || wf=1
raw=$(timeout -k 1s 3s systemctl show "$UNIT" -p LoadState -p ActiveState -p SubState -p MainPID 2>&1); rc=$?
record terminal.txt 'query_rc=%s\n%s\nstop_attempted=no\n' "$rc" "$raw" || :
field() { printf '%s\n' "$raw" | awk -v k="$1" 'index($0,k "=")==1 {n++;v=substr($0,length(k)+2)} END {if(n!=1) exit 1;print v}'; }
terminal=no
load=$(field LoadState); active=$(field ActiveState); sub=$(field SubState); pid=$(field MainPID)
if [ "$rc" = 0 ] && [ "$pid" = 0 ]; then
  case "$load:$active:$sub" in loaded:inactive:dead|merged:inactive:dead|not-found:inactive:dead|loaded:failed:failed|merged:failed:failed) terminal=yes;; esac
fi
# Never stop/reset-failed/kill a named unit, even when terminal evidence is absent.
hash_rc=0
case "$launch_rc" in 77|78) hash_rc=$launch_rc;; esac
snapshot hashes-after.txt; rc=$?
[ "$rc" = 0 ] || hash_rc=77
if [ "$hash_rc" = 0 ]; then
  diff -u "$RUN/hashes-before.txt" "$RUN/hashes-after.txt" > "$RUN/hashes-diff.txt"; rc=$?
  case "$rc" in 0) ;; 1) hash_rc=78;; *) hash_rc=77;; esac
fi
payload_evidence=$(awk 'END {if(NR!=1) exit 1} {print}' "$RUN/payload-evidence.txt" 2>/dev/null) || wf=1
[ "$payload_evidence" = 'write_failures=0' ] || wf=1
status=setup-failure; result=70
case "$launch_rc" in 0) status=not-reproduced; result=0;; 2) status=reproduced; result=2;; esac
[ "$terminal" = yes ] || { result=74; status=setup-failure; }
[ "$hash_rc" = 0 ] || { result=$hash_rc; status=setup-failure; }
[ "$launch_rc" != 73 ] || wf=1
finish "$result" "$status"
