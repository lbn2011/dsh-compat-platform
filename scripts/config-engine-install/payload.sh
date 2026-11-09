#!/bin/bash
# PREPARED, NOT EXECUTED. Online acquisition only; never executes checker code.
set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
STAGE=${3:-}
REVIEWED_LOCK=${4:-}
REVIEWED_SHA=${5:-}
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/config-check
SLICE=$REPO/scripts/config-engine-install
NODE=/www/server/nodejs/v24.21.0/bin/node
NPM=/www/server/nodejs/v24.21.0/lib/node_modules/npm/bin/npm-cli.js

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200

write_fail=0
addwf() { write_fail=$((write_fail + 1)); printf 'payload: evidence write failed: %s\n' "$1" >&2; }
die() { printf 'payload: %s\n' "$2" >&2; exit "$1"; }
wr() { cat > "$1" || return 1; [ -s "$1" ] || return 1; }
say() { printf '%s\n' "$*"; }
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }
read1() { # path -> first line for non-verdict display only (never compared)
  [ -r "$1" ] || { printf ''; return 1; }
  head -n 1 "$1" 2>/dev/null
}
# Strict single-value readback for anything that is COMPARED against a limit. A
# file must yield EXACTLY one non-empty line; `head -n 1` would silently accept
# the first of several differing lines, and an empty read is reported as
# unreadable instead of being allowed to compare equal to an expected value.
knob1() { # path -> value if exactly one non-empty line, else <ambiguous-or-missing:...>
  local path=$1 n v
  [ -r "$path" ] || { printf '<ambiguous-or-missing:unreadable>'; return; }
  n=$(awk 'END { print NR }' "$path" 2>/dev/null)
  case "$n" in ''|*[!0-9]*) printf '<ambiguous-or-missing:unreadable>'; return ;; esac
  [ "$n" -eq 1 ] || { printf '<ambiguous-or-missing:%s>' "$n"; return; }
  v=$(sed -n '1p' "$path" 2>/dev/null)
  [ -n "$v" ] || { printf '<ambiguous-or-missing:empty>'; return; }
  printf '%s' "$v"
}

say "payload: unit=$UNIT run=$RUN"

# ---------------------------------------------------------------- 0. arguments
case "$UNIT" in
  *.service) ;;
  *) die 70 "unit name does not end in .service: '${UNIT}'" ;;
esac
[ -n "$RUN" ] || die 70 "run directory argument missing"
[ -d "$RUN" ] || die 70 "run directory does not exist: $RUN"
[ -w "$RUN" ] || die 70 "run directory is not writable: $RUN"
[ -d "$PKG" ] || die 70 "analyzer package missing: $PKG"
[ -x "$NODE" ] || die 70 "node binary missing: $NODE"
[ -f "$NPM" ] && [ -r "$NPM" ] || die 70 "npm CLI missing or unreadable: $NPM"
[ "$#" -eq 5 ] || die 70 "wrong payload arity"
case "$STAGE" in resolve|acquire) ;; *) die 70 "invalid stage" ;; esac
# ---------------------------------------------------------------- 1. envelope readback
CGROUP="/sys/fs/cgroup/system.slice/$UNIT"
{
  printf 'unit=%s\n' "$UNIT"
  printf 'cgroup=%s\n' "$CGROUP"
  printf 'cgroup_exists=%s\n' "$([ -d "$CGROUP" ] && echo yes || echo no)"
  printf 'memory.max=%s\n' "$(knob1 "$CGROUP/memory.max")"
  printf 'memory.swap.max=%s\n' "$(knob1 "$CGROUP/memory.swap.max")"
  printf 'pids.max=%s\n' "$(knob1 "$CGROUP/pids.max")"
  printf 'cpu.max=%s\n' "$(knob1 "$CGROUP/cpu.max")"
} > "$RUN/envelope-cgroup.txt" || addwf envelope-cgroup.txt

show_raw=$(timeout 20 systemctl show "$UNIT" -p Type -p CPUQuotaPerSecUSec -p MemoryMax -p TasksMax 2>&1)
show_rc=$?
printf 'systemctl_show_rc=%s\n%s\n' "$show_rc" "$show_raw" > "$RUN/envelope-systemctl.txt" \
  || addwf envelope-systemctl.txt
[ "$show_rc" -eq 0 ] || die 70 "systemctl show failed (rc=$show_rc)"

# RuntimeMaxUSec is read through busctl, in two steps. Static review of an earlier draft found
# `busctl show` with a property list is not a get-property call at all, so it could not have
# returned the property. `GetUnit` yields the object path, then `get-property` asks for exactly
# one property of that object.
#
# Step 1 — GetUnit. The rc must be 0 (captured from busctl itself, not from a trailing filter)
# and the whole reply must be a single legal object path. Anything else leaves unit_path_ok=no,
# which forces the RuntimeMaxUSec value to read as unavailable below instead of being guessed.
getunit_raw=$(timeout 20 busctl --system call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
  org.freedesktop.systemd1.Manager GetUnit s "$UNIT" 2>&1)
unit_path_rc=$?
getunit_nonempty_lines=$(printf '%s\n' "$getunit_raw" | grep -c '[^[:space:]]')
getunit_path_lines=$(printf '%s\n' "$getunit_raw" \
  | grep -cE '^o "/org/freedesktop/systemd1/unit/[A-Za-z0-9_/]*"$')
unit_paths_seen=$(printf '%s\n' "$getunit_raw" | sed -n 's/^o "\(.*\)"$/\1/p' | wc -l)
unit_path=
unit_path_ok=no
if [ "$unit_path_rc" -eq 0 ] \
   && [ "$getunit_nonempty_lines" -eq 1 ] \
   && [ "$getunit_path_lines" -eq 1 ] \
   && [ "$unit_paths_seen" -eq 1 ]; then
  unit_path=$(printf '%s\n' "$getunit_raw" | sed -n 's/^o "\(.*\)"$/\1/p')
  unit_path_ok=yes
fi
printf 'unit_path=%s\nunit_path_rc=%s\nunit_path_ok=%s\ngetunit_nonempty_lines=%s\n' \
  "${unit_path:-<none>}" "$unit_path_rc" "$unit_path_ok" "$getunit_nonempty_lines" \
  > "$RUN/envelope-busctl-path.txt" || addwf envelope-busctl-path.txt

# Step 2 — get-property, only against a validated object path. A reply is accepted only when the
# WHOLE output is exactly one `t <number>` line: extra lines or trailing garbage disqualify it,
# so a stray diagnostic cannot be silently counted as a match the way a line-counting parse would.
bus_raw=''
bus_rc=1
if [ "$unit_path_ok" = yes ]; then
  bus_raw=$(timeout 20 busctl --system get-property org.freedesktop.systemd1 "$unit_path" \
    org.freedesktop.systemd1.Service RuntimeMaxUSec 2>&1)
  bus_rc=$?
fi
printf 'busctl_rc=%s\nbusctl_bus_raw<<%s\n' "$bus_rc" "$bus_raw" > "$RUN/envelope-busctl.txt" \
  || addwf envelope-busctl.txt

acc_runtime_usec=
acc_runtime_usec_source=unavailable
if [ "$bus_rc" -eq 0 ]; then
  # Outer match takes any `t `-prefixed reply; the inner negative class then rejects it unless
  # the remainder is non-empty AND all digits. A shell glob `[0-9]*` would NOT be a pure-digit
  # test (it is one digit followed by anything), so the digit check is done by exclusion here.
  case "$bus_raw" in
    't '*)
      val=${bus_raw#t }
      case "$val" in
        ''|*[!0-9]*) : ;;
        *) acc_runtime_usec=$val; acc_runtime_usec_source=busctl ;;
      esac
      ;;
  esac
fi
# Result: the value is set only when the entire reply is `t ` followed exclusively by digits, so a
# second line, an error string or trailing text leaves it empty — and empty is a refusal, never a
# reason to skip the comparison.

memory_max=$(knob1 "$CGROUP/memory.max")
swap_max=$(knob1 "$CGROUP/memory.swap.max")
pids_max=$(knob1 "$CGROUP/pids.max")
cpu_max=$(knob1 "$CGROUP/cpu.max")
# One occurrence only. `head -n 1` would quietly accept a reply that said two different things.
unit_type=$(printf '%s\n' "$show_raw" | sed -n 's/^Type=//p')
unit_type_replies=$(printf '%s\n' "$show_raw" | sed -n 's/^Type=//p' | wc -l)
[ "$unit_type_replies" -eq 1 ] || unit_type="<ambiguous-or-missing:$unit_type_replies>"

{
  printf 'memory_max=%s\n' "$memory_max"
  printf 'swap_max=%s\n' "$swap_max"
  printf 'pids_max=%s\n' "$pids_max"
  printf 'cpu_max=%s\n' "$cpu_max"
  printf 'unit_type=%s\n' "$unit_type"
  printf 'acc_runtime_usec=%s\n' "$acc_runtime_usec"
  printf 'acc_runtime_usec_source=%s\n' "$acc_runtime_usec_source"
} > "$RUN/envelope-effective.txt" || addwf envelope-effective.txt

# ---------------------------------------------------------------- 2. envelope must match
mismatch=''
[ "$memory_max" = "$EXPECT_MEM_BYTES" ] || mismatch="$mismatch memory.max=$memory_max"
[ "$swap_max" = "$EXPECT_SWAP_BYTES" ] || mismatch="$mismatch memory.swap.max=$swap_max"
[ "$pids_max" = "$EXPECT_PIDS" ] || mismatch="$mismatch pids.max=$pids_max"
[ "$cpu_max" = "$EXPECT_CPU_MAX" ] || mismatch="$mismatch cpu.max=$cpu_max"
[ "$unit_type" = exec ] || mismatch="$mismatch Type=$unit_type"
# Not "compare if we happened to read something": an unreadable or ambiguous value is itself a
# mismatch. A query that failed must never widen the set of envelopes this batch accepts.
[ "$acc_runtime_usec" = "$EXPECT_RUNTIME_USEC" ] || mismatch="$mismatch RuntimeMaxUSec=${acc_runtime_usec:-<unreadable>}"
printf 'envelope_mismatch=%s\n' "${mismatch:-none}" > "$RUN/envelope-verdict.txt" || addwf envelope-verdict.txt
[ -z "$mismatch" ] || die 70 "envelope does not match the approved limits:$mismatch"

# ---------------------------------------------------------------- 3. memory gate, once
meminfo_rc=0
mem_available=$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo 2>/dev/null) || meminfo_rc=$?
is_num "$mem_available" || meminfo_rc=1
printf 'mem_available_kib=%s\nthreshold_kib=%s\nmeminfo_rc=%s\n' \
  "$mem_available" "$EXPECT_MEMAVAILABLE_KIB" "$meminfo_rc" > "$RUN/memory-gate.txt" \
  || addwf memory-gate.txt
[ "$meminfo_rc" -eq 0 ] || die 70 "MemAvailable could not be read"
[ "$mem_available" -ge "$EXPECT_MEMAVAILABLE_KIB" ] || die 70 "MemAvailable ${mem_available} KiB is below ${EXPECT_MEMAVAILABLE_KIB} KiB"

# A stop that records the write failure best-effort before exiting 73, so the
# failure itself is evidenced rather than merely announced on stderr.
evidence_stop() { # marker
  printf 'acc_evidence_write_failures=%s\nacc_stop_at=%s\nacc_workload_started=no\n' \
    "$write_fail" "$1" > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say "payload: $write_fail evidence write failure(s) at $1; stopping (73) before proceeding"
  exit 73
}

# Evidence gate BEFORE any Node/npm process.
[ "$write_fail" -eq 0 ] || evidence_stop before-acquisition
WORK=$RUN/work
mkdir "$WORK" || die 73 "cannot create isolated work directory"
mkdir "$WORK/home" "$WORK/cache" "$WORK/tmp" "$WORK/prefix" || die 73 "cannot create clean npm paths"
: > "$WORK/user.npmrc" || die 73 "user config creation failed"
: > "$WORK/global.npmrc" || die 73 "global config creation failed"
cp "$PKG/package.json" "$WORK/package.json" || die 73 "manifest copy failed"
cmp -s "$PKG/package.json" "$WORK/package.json" || die 78 "manifest copy differs"
if [ "$STAGE" = acquire ]; then
  [ -f "$REVIEWED_LOCK" ] && [ ! -L "$REVIEWED_LOCK" ] || die 70 "reviewed lock missing"
  cp "$REVIEWED_LOCK" "$WORK/package-lock.json" || die 73 "lock copy failed"
  digest=$(sha256sum "$WORK/package-lock.json") || die 77 "lock hash failed"
  [ "${digest%% *}" = "$REVIEWED_SHA" ] || die 78 "copied lock is not reviewed bytes"
fi
printf 'stage=%s\nnetwork=online\nmutable=%s\nreviewed_sha256=%s\n' \
  "$STAGE" "$WORK" "$REVIEWED_SHA" > "$RUN/workload.txt" || die 73 "workload evidence failed"
# Minimal filesystem, not a root bind: host homes, credentials, production files,
# repository and system bus are absent. Network deliberately shared for registry.
# npm's persistent writable bind is WORK; /dev and /proc are private mounts.
# No disk quota or egress firewall is provided. Host-side launcher/systemd effects
# are outside this sandbox and are not confined to the run directory.
bwrap --unshare-user --uid 0 --gid 0 \
  --unshare-pid --unshare-ipc --unshare-uts --die-with-parent --new-session \
  --cap-drop ALL --ro-bind /usr /usr --ro-bind /bin /bin \
  --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --dir /etc --ro-bind /etc/ssl /etc/ssl \
  --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/hosts /etc/hosts \
  --dir /opt --ro-bind /www/server/nodejs/v24.21.0 /opt/node \
  --ro-bind "$SLICE" /controls --bind "$WORK" /work \
  --dev /dev --proc /proc --chdir /work \
  -- /usr/bin/env -i /bin/bash /controls/acquire.sh "$STAGE" \
  > "$RUN/acquisition.log" 2>&1
acquire_rc=$?
printf 'acquisition_rc=%s\n' "$acquire_rc" > "$RUN/acquisition.rc" || addwf acquisition.rc
[ "$write_fail" -eq 0 ] || exit 73
[ "$acquire_rc" -eq 0 ] || die 72 "acquisition failed, no retry"
for artifact in operation-complete.txt package-lock.json lock-inventory.json output-hashes.txt \
  npm-metadata-json-schema.json npm-metadata-browser.json npm-effective-config.json \
  node-version.txt npm-version.txt manifest-review.json; do
  [ -s "$WORK/$artifact" ] || die 73 "required evidence missing: $artifact"
done
cmp -s "$PKG/package.json" "$WORK/package.json" || die 78 "manifest mutated"
if [ "$STAGE" = acquire ]; then
  digest=$(sha256sum "$WORK/package-lock.json") || die 77 "final lock hash failed"
  [ "${digest%% *}" = "$REVIEWED_SHA" ] || die 78 "reviewed lock changed"
  [ -s "$WORK/npm-installed-tree.json" ] || die 73 "installed tree evidence missing"
fi
printf 'memory_peak=%s\npids_peak=%s\n' "$(read1 "$CGROUP/memory.peak")" \
  "$(read1 "$CGROUP/pids.peak")" > "$RUN/peaks.txt" || die 73 "peaks write failed"
printf 'stage=%s\nacquisition=complete\nchecker_executed=no\n' "$STAGE" > "$RUN/payload-verdict.txt" || die 73 "verdict write failed"
exit 0
