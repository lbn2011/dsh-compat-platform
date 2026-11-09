#!/bin/bash
# PREPARED ONLY. No imports from the unqualified core.
set -uo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
unset BASH_ENV ENV
umask 077
CORE=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner
SLICE=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner-qualification
UNIT=${1:-} RUN=${2:-}
fail() { printf 'payload: %s\n' "$2" >&2; exit "$1"; }
record() { local f=$1; shift; printf "$@" > "$RUN/$f" || fail 73 "evidence write failed: $f"; }
# Read the complete file without command-substitution newline loss; reject NUL.
single() {
  local value rc
  IFS= read -r -d '' value < "$1"; rc=$?
  [ "$rc" = 1 ] || return 1
  [[ $value = *$'\n' ]] || return 1
  value=${value%$'\n'}
  [[ -n $value && $value != *$'\n'* && $value != *$'\r'* ]] || return 1
  printf '%s\n' "$value"
}
[ "$#" = 2 ] || fail 70 'invalid arity'
[[ $UNIT =~ ^bounded-runner-qualification-[a-z0-9-]+\.service$ ]] || fail 70 'invalid unit'
[[ $RUN = /data/dsh-ecosystem-test-artifacts/runs/* && $RUN != *$'\n'* && $RUN != *'/../'* ]] || fail 70 'invalid run path'
[ -d "$RUN" ] && [ ! -L "$RUN" ] && [ -w "$RUN" ] || fail 70 'invalid run directory'
CG=/sys/fs/cgroup/system.slice/$UNIT
membership=$(single /proc/self/cgroup) || fail 70 'ambiguous membership'
[ "$membership" = "0::/system.slice/$UNIT" ] || fail 70 'foreign cgroup'
mem=$(single "$CG/memory.max") || fail 70 'memory knob unavailable'
swap=$(single "$CG/memory.swap.max") || fail 70 'swap knob unavailable'
pids=$(single "$CG/pids.max") || fail 70 'pids knob unavailable'
cpu=$(single "$CG/cpu.max") || fail 70 'cpu knob unavailable'
raw=$(timeout -k 2s 5s systemctl show "$UNIT" -p Type 2>&1; rc=$?; printf '\034'; exit "$rc"); rc=$?
raw=${raw%$'\034'}
record envelope-systemctl.txt 'query_rc=%s\n%s' "$rc" "$raw"
[ "$rc" = 0 ] && [ "${raw%$'\n'}" = Type=exec ] || fail 70 'Type must be exec'
raw=$(timeout -k 2s 5s busctl --system call org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager GetUnit s "$UNIT" 2>&1; rc=$?; printf '\034'; exit "$rc"); rc=$?
raw=${raw%$'\034'}
record envelope-getunit.txt 'query_rc=%s\n%s' "$rc" "$raw"
[ "$rc" = 0 ] || fail 70 'GetUnit failed'
reply=${raw%$'\n'}
path_re='^o "(/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+)"$'
[[ $reply =~ $path_re ]] || fail 70 'ambiguous GetUnit reply'
path=${BASH_REMATCH[1]}
raw=$(timeout -k 2s 5s busctl --system get-property org.freedesktop.systemd1 "$path" org.freedesktop.systemd1.Service RuntimeMaxUSec 2>&1; rc=$?; printf '\034'; exit "$rc"); rc=$?
raw=${raw%$'\034'}
record envelope-runtime.txt 'query_rc=%s\n%s' "$rc" "$raw"
[ "$rc" = 0 ] && [ "${raw%$'\n'}" = 't 120000000' ] || fail 70 'RuntimeMaxUSec must be exactly 120000000'
record envelope-effective.txt 'membership=%s\nmemory.max=%s\nmemory.swap.max=%s\npids.max=%s\ncpu.max=%s\nType=exec\nRuntimeMaxUSec=120000000\n' "$membership" "$mem" "$swap" "$pids" "$cpu"
[ "$mem" = 402653184 ] && [ "$swap" = 0 ] && [ "$pids" = 32 ] && [ "$cpu" = '50000 100000' ] || fail 70 'resource envelope mismatch'
# The sole real memory gate: before bash -n, fixtures, or any mock test.
available=$(awk '$1=="MemAvailable:" {n++;if(NF!=3 || $2 !~ /^(0|[1-9][0-9]*)$/ || $3!="kB")bad=1;v=$2} END {if(n!=1 || bad)exit 1;print v}' /proc/meminfo); rc=$?
record memory-gate.txt 'read_rc=%s\nMemAvailableKiB=%s\nminimum_kib=819200\n' "$rc" "$available"
[ "$rc" = 0 ] && [[ $available =~ ^[0-9]{1,15}$ ]] && [ "$available" -ge 819200 ] || fail 70 'memory gate refused'
export NODE_OPTIONS=--max-old-space-size=192
WORK=$RUN/work
mkdir -m 700 -- "$WORK" "$WORK/scratch" "$WORK/home" "$WORK/stubs" || fail 73 'scratch creation failed'
# Stub command fallbacks must NOT silently count as mocked successful coverage.
printf '%s\n' '#!/bin/bash' 'printf "denied system command: %s\n" "$0" >> /tmp/qualification/denied.log' 'printf "unmocked system command denied: %s\n" "$0" >&2' 'exit 97' > "$WORK/stubs/deny" || fail 73 'stub write failed'
chmod 500 "$WORK/stubs/deny" || fail 73 'stub mode failed'
: > "$WORK/denied.log" || fail 73 'denial log failed'
# Read-only host metadata is not a fixture. Hide runtime sockets and mutable host
# state; /proc is private, /sys hidden. Persistent writes stay under /tmp/qualification.
sandbox=(bwrap --unshare-user --uid 0 --gid 0 --unshare-net --unshare-pid --unshare-ipc --unshare-uts
  --die-with-parent --new-session --cap-drop ALL --ro-bind / /
  --tmpfs /run --tmpfs /var --tmpfs /sys --dev /dev --proc /proc
  --tmpfs /tmp --bind "$WORK" /tmp/qualification --chdir /tmp/qualification)
for cmd in systemctl systemd-run busctl journalctl loginctl machinectl; do
  ln -s deny "$WORK/stubs/$cmd" || fail 73 'stub link failed'
  # Mask canonical absolute binaries too (including merged-/usr symlink layouts).
  binary=$(command -v "$cmd") || continue
  binary=$(readlink -f -- "$binary") || fail 70 'cannot resolve system command'
  [ -f "$binary" ] || fail 70 'system command is not a file'
  sandbox+=(--ro-bind "$WORK/stubs/deny" "$binary")
done
sandbox+=(--ro-bind "$WORK/stubs" /tmp/qualification/stubs -- /usr/bin/env -i
  PATH=/tmp/qualification/stubs:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/qualification/home TMPDIR=/tmp/qualification/scratch
  LC_ALL=C NODE_OPTIONS=--max-old-space-size=192)
# Syntax and both suites run serially. No retry and no second suite on failure.
timeout -k 2s 20s "${sandbox[@]}" /bin/bash --noprofile --norc -c '
  for file in "$@"; do /bin/bash -n "$file" || exit 71; printf "syntax-ok=%s\n" "$file"; done
' qualification-syntax "$CORE/common.sh" "$CORE/policy.sh" "$CORE/host.sh" "$CORE/envelope.sh" "$CORE/tap.sh" \
  "$CORE/negative-tests.sh" "$CORE/host-negative-tests.sh" "$SLICE/run.sh" "$SLICE/payload.sh" > "$RUN/syntax.log" 2>&1
rc=$?; record syntax.rc '%s\n' "$rc"
[ "$rc" = 0 ] || fail 71 'syntax failed or timed out'
[ ! -s "$WORK/denied.log" ] || fail 72 'unmocked system command during syntax'
for test in negative-tests host-negative-tests; do
  timeout -k 2s 30s "${sandbox[@]}" /bin/bash --noprofile --norc "$CORE/$test.sh" > "$RUN/$test.log" 2>&1
  rc=$?; record "$test.rc" '%s\n' "$rc"
  [ "$rc" = 0 ] || fail 72 "$test failed or timed out; no retry"
  [ -s "$RUN/$test.log" ] || fail 73 "$test output missing"
  [ ! -s "$WORK/denied.log" ] || fail 72 "$test reached unmocked system command"
done
record payload-verdict.txt 'qualification=complete\n'
exit 0
