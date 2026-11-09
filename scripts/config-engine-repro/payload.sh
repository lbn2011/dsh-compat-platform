#!/bin/bash
# PREPARED ONLY. Independent fixed offline reproduction payload; never patches.
set -uo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C
unset BASH_ENV ENV NODE_OPTIONS NODE_PATH
UNIT=${1:-}; RUN=${2:-}; BASE=${3:-}; MANIFEST_SHA=${4:-}; LOCK_SHA=${5:-}
ROOT=/root/dsh-ecosystem-spec
PROBE=$ROOT/projects/dsh-compat-platform/scripts/config-engine-repro/cases.mjs
NODE=/www/server/nodejs/v24.21.0/bin/node
[ "$#" = 5 ] && [[ $UNIT =~ ^config-engine-repro-[a-z0-9-]+\.service$ ]] || exit 70
[[ $RUN = /data/dsh-ecosystem-test-artifacts/runs/"$UNIT" && $BASE =~ ^/[A-Za-z0-9_./-]+$ ]] || exit 70
[ -d "$RUN" ] && [ ! -L "$RUN" ] || exit 70
wf=0; completed=0; reproduced=0; phase=setup; outcome=setup-failure
record() { local f=$1; shift; printf "$@" > "$RUN/$f" || { wf=1; return 73; }; }
finish() {
  local rc=$?
  trap - EXIT
  record payload-verdict.txt 'status=%s\nphase=%s\ncompleted_cases=%s\nreproduced_cases=%s\noriginal_exit=%s\nconformance_claim=no\n' "$outcome" "$phase" "$completed" "$reproduced" "$rc" || :
  record payload-evidence.txt 'write_failures=%s\n' "$wf" || :
  [ "$wf" = 0 ] || rc=73
  exit "$rc"
}
trap finish EXIT
single() { awk 'NR==1 {v=$0} END {if(NR!=1 || v=="" || v~/\r/) exit 1;print v}' "$1"; }
CG=/sys/fs/cgroup/system.slice/$UNIT
membership=$(single /proc/self/cgroup) || exit 70
mem=$(single "$CG/memory.max") || exit 70
swap=$(single "$CG/memory.swap.max") || exit 70
pids=$(single "$CG/pids.max") || exit 70
cpu=$(single "$CG/cpu.max") || exit 70
record envelope-cgroup.txt 'membership=%s\nmemory.max=%s\nmemory.swap.max=%s\npids.max=%s\ncpu.max=%s\n' "$membership" "$mem" "$swap" "$pids" "$cpu" || exit 73
[ "$membership" = "0::/system.slice/$UNIT" ] && [ "$mem" = 402653184 ] && [ "$swap" = 0 ] && [ "$pids" = 32 ] && [ "$cpu" = '50000 100000' ] || exit 70
# Sentinel preserves trailing newlines for strict complete-reply checks.
raw=$(timeout -k 1s 3s systemctl show "$UNIT" -p Type 2>&1; rc=$?; printf '\034'; exit "$rc"); rc=$?; raw=${raw%$'\034'}
record envelope-type.txt 'query_rc=%s\n%s' "$rc" "$raw" || exit 73
[ "$rc" = 0 ] && [ "$raw" = $'Type=exec\n' ] || exit 70
raw=$(timeout -k 1s 3s busctl --system call org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager GetUnit s "$UNIT" 2>&1; rc=$?; printf '\034'; exit "$rc"); rc=$?; raw=${raw%$'\034'}
record envelope-getunit.txt 'query_rc=%s\n%s' "$rc" "$raw" || exit 73
reply=${raw%$'\n'}; regex='^o "(/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+)"$'
[ "$rc" = 0 ] && [[ $reply =~ $regex ]] || exit 70
unit_path=${BASH_REMATCH[1]}
raw=$(timeout -k 1s 3s busctl --system get-property org.freedesktop.systemd1 "$unit_path" org.freedesktop.systemd1.Service RuntimeMaxUSec 2>&1; rc=$?; printf '\034'; exit "$rc"); rc=$?; raw=${raw%$'\034'}
record envelope-runtime.txt 'query_rc=%s\n%s' "$rc" "$raw" || exit 73
[ "$rc" = 0 ] && [ "$raw" = $'t 120000000\n' ] || exit 70
available=$(awk '$1=="MemAvailable:" {n++;if(NF!=3 || $2!~/^[0-9]+$/ || $3!="kB") bad=1;v=$2} END {if(n!=1 || bad) exit 1;print v}' /proc/meminfo); rc=$?
record memory-gate.txt 'read_rc=%s\navailable_kib=%s\nminimum_kib=819200\n' "$rc" "$available" || exit 73
[ "$rc" = 0 ] && [[ $available =~ ^[0-9]{1,15}$ ]] && [ "$available" -ge 819200 ] || exit 70
# Recheck expected selected inputs inside the unit before any Node workload.
actual=$(sha256sum -- "$BASE/package.json") || exit 77
[ "${actual%% *}" = "$MANIFEST_SHA" ] || exit 78
actual=$(sha256sum -- "$BASE/package-lock.json") || exit 77
[ "${actual%% *}" = "$LOCK_SHA" ] || exit 78
record schedule.txt 'cases=22\nserial=yes\nnode_heap_mib=192\ntimeout_seconds=3\nkill_grace_seconds=1\nmax_case_windows_seconds=88\nmax_manager_readbacks_seconds=12\nunit_runtime_seconds=120\nnetwork=unshared\nper_file_limit_bytes=1048576\naggregate_disk_quota=no\n' || exit 73
# Static closed list; never accepts caller case IDs, executable fragments or fixtures.
ids=(const-anchor-equal const-anchor-different const-id-equal const-id-different
 const-schema-known-equal const-schema-known-different const-schema-unknown-equal const-schema-unknown-different
 enum-anchor-equal enum-anchor-different enum-id-equal enum-id-different
 enum-schema-known-equal enum-schema-known-different enum-schema-unknown-equal enum-schema-unknown-different
 scalar-equal scalar-different default-schema-unknown examples-schema-unknown dynamic-uri-integer dynamic-uri-string)
[ "${#ids[@]}" = 22 ] || exit 70
phase=cases
record case-index.tsv 'case\tprocess_exit\tstatus\n' || exit 73
for id in "${ids[@]}"; do
  case_dir=$RUN/$id
  mkdir -m 700 -- "$case_dir" || { wf=1; exit 73; }
  # Each sandbox sees ONLY its report directory as persistent writable storage.
  # Preserve original probe path so its ../../../../ checkout boundary remains valid.
  # Preserve BASE verbatim for createRequire and canonical-path checks.
  sandbox=(bwrap --unshare-user --uid 0 --gid 0 --unshare-pid --unshare-ipc
    --unshare-uts --unshare-net --die-with-parent --new-session --cap-drop ALL
    --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64
    --ro-bind /www/server/nodejs/v24.21.0 /www/server/nodejs/v24.21.0
    --ro-bind "$BASE" "$BASE" --ro-bind "$PROBE" "$PROBE"
    --bind "$case_dir" "$case_dir" --proc /proc --dev /dev --chdir "$case_dir"
    --remount-ro / -- /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C
    HOME="$case_dir" TMPDIR="$case_dir" NODE_OPTIONS=--max-old-space-size=192
    "$NODE" "$PROBE" "$BASE" "$id" "$case_dir/report.json")
  record "$id.argv.txt" '%q ' "${sandbox[@]}" || exit 73
  # timeout wraps the entire bwrap process tree. Its raw status is never rewritten;
  # 124/137, bwrap launch failure, crash or missing report are setup failures.
  exec 7>"$RUN/$id.stdout" 8>"$RUN/$id.stderr" || { wf=1; exit 73; }
  (ulimit -f 1024 || exit 73; timeout --signal=TERM --kill-after=1s 3s "${sandbox[@]}") >&7 2>&8
  process_rc=$?
  exec 7>&- 8>&-
  record "$id.process-exit.txt" '%s\n' "$process_rc" || exit 73
  case "$process_rc" in 0|2) ;; 73) wf=1; exit 73;; *) exit 70;; esac
  report=$case_dir/report.json
  [ -f "$report" ] && [ ! -L "$report" ] || exit 70
  size=$(stat -c %s -- "$report") || exit 70
  [[ $size =~ ^[0-9]+$ ]] && [ "$size" -le 1024 ] || exit 70
  # Probe emits compact fixed-field JSON. Validate its complete closed shape without
  # launching another Node process or importing any package for result parsing.
  text=$(single "$report") || exit 70
  expected=true
  case "$id" in *-different|dynamic-uri-string) expected=false;; esac
  regex='^\{"case":"'"$id"'","expected":\{"valid":'"$expected"'\},"actual":\{("valid":(true|false)|"error":"(REGISTER_ERROR|COMPILE_ERROR|VALIDATE_ERROR|RESULT_SHAPE_ERROR)")\},"status":"(reproduced|not-reproduced|control-mismatch)"\}$'
  [[ $text =~ $regex ]] || exit 70
  actual=${BASH_REMATCH[2]}; state=${BASH_REMATCH[4]}
  control=no
  case "$id" in scalar-*|dynamic-uri-*) control=yes;; esac
  if [ "$actual" = "$expected" ]; then
    [ "$state" = not-reproduced ] && [ "$process_rc" = 0 ] || exit 70
  else
    [ "$process_rc" = 2 ] || exit 70
    if [ "$control" = yes ]; then
      [ "$state" = control-mismatch ] || exit 70
    else
      [ "$state" = reproduced ] || exit 70
      reproduced=$((reproduced + 1))
    fi
  fi
  printf '%s\t%s\t%s\n' "$id" "$process_rc" "$state" >> "$RUN/case-index.tsv" || { wf=1; exit 73; }
  completed=$((completed + 1))
  # A control mismatch invalidates this batch's reproduction interpretation.
  [ "$state" != control-mismatch ] || { phase=control-failure; exit 70; }
done
phase=complete
outcome=not-reproduced
if [ "$reproduced" -gt 0 ]; then outcome=reproduced; exit 2; fi
exit 0
