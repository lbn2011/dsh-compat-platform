#!/bin/bash
# In-envelope payload for the retained-export acceptance batch.
#
# STATUS: PREPARED, NEVER EXECUTED. Nothing in this file has been run.
#
# Runs INSIDE the transient unit. It verifies its own envelope, refuses to start
# the workload if anything is off, and only then runs the verifier once.
#
# Logging: this payload NEVER writes unit.log. The launcher is the single writer
# of unit.log and redirects this process's stdout/stderr there; the payload only
# relays its logs to stdout. Every record this payload keeps lives under $RUN.
#
# What it can establish: that three retained captures match their pins, and that
# the committed CLI reproduces the fixed summary counters on those bytes under
# these limits.
#
# What it cannot establish: where those captures came from beyond the pins
# themselves (the pins are a content digest, not a provenance chain), that a
# build corresponds to a commit, that the export is complete, that any plugin
# would load, or what any `!!js` expression evaluates to. Nothing here reads a
# host profile, exports a profile, or evaluates an expression.
#
# Exit codes: 0 green; 70 envelope refusal; 71 dependency precondition failed;
# 72 verifier ran but the batch is not green; 73 an evidence write failed. The
# verifier's own 60-66 codes are passed through unchanged when it fails early.

set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
ARTIFACT_ROOT=${3:-}
SLICE=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export
PKG=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer
NODE=/www/server/nodejs/v24.21.0/bin/node
VERIFIER=$SLICE/retained-export.mjs

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200
EXPECT_YAML_VERSION='2.9.1'

SAMPLE_RELS=(
  1-probe/out/run-root/out/stdout.bin
  2-denied/out/run-root/out/stdout.bin
  3-script-probe/out/run-root/out/stdout.bin
)

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
[ -n "$ARTIFACT_ROOT" ] || die 70 "artifact root argument missing"
case "$ARTIFACT_ROOT" in
  /*) ;;
  *) die 70 "artifact root must be absolute: $ARTIFACT_ROOT" ;;
esac
# Component check, not a substring test: reject `/../`, a trailing `/..`, and a
# doubled slash. Same rule as the runner's, applied again because the payload is
# handed the value independently.
case "$ARTIFACT_ROOT" in
  */../*|*/..|*//*) die 70 "artifact root must not contain a traversal or empty component: $ARTIFACT_ROOT" ;;
esac
[ -d "$ARTIFACT_ROOT" ] || die 70 "artifact root is not a directory: $ARTIFACT_ROOT"
[ -d "$PKG" ] || die 70 "analyzer package missing: $PKG"
[ -x "$NODE" ] || die 70 "node binary missing: $NODE"
[ -f "$VERIFIER" ] || die 70 "verifier missing: $VERIFIER"

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

# RuntimeMaxUSec is read through busctl, in two steps: `GetUnit` yields the
# object path, then `get-property` asks for exactly one property of that object.
# A single-shot `busctl show` with a property list is not a get-property call.
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

# A reply is accepted only when the WHOLE output is exactly one `t <digits>`
# line: extra lines or trailing garbage disqualify it, so a stray diagnostic
# cannot be counted as a match the way a line-counting parse would allow.
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
# Not "compare if we happened to read something": an unreadable or ambiguous
# value is itself a mismatch. A failed query must never widen the accepted set.
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

# ---------------------------------------------------------------- 4. syntax
# Gate BEFORE the syntax checks: bash -n must not run on top of an already-broken
# evidence set. A failure here is itself recorded best-effort, then 73.
if [ "$write_fail" -ne 0 ]; then evidence_stop before-syntax; fi
bash -n "$SLICE/run.sh"
acc_syntax_run_sh_rc=$?
bash -n "$SLICE/payload.sh"
acc_syntax_payload_sh_rc=$?
printf 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
  "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" > "$RUN/syntax.txt" || addwf syntax.txt
[ "$acc_syntax_run_sh_rc" -eq 0 ] || die 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"
[ "$acc_syntax_payload_sh_rc" -eq 0 ] || die 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"

# ---------------------------------------------------------------- 5. dependency precondition
# This batch never installs. If `yaml` does not already resolve to exactly 2.9.1
# from the analyzer package, refuse before the workload starts.
#
# Gate BEFORE the dependency probe: syntax.txt may have failed to land, so the
# evidence set is not known-good yet. The probe below starts a Node process, and
# no process of any kind may start on top of an unrecorded envelope.
if [ "$write_fail" -ne 0 ]; then evidence_stop before-dependency; fi
yaml_manifest_json="$PKG/node_modules/yaml/package.json"
yaml_state=absent
yaml_version=
if [ -f "$yaml_manifest_json" ]; then
  # Strict JSON parse, not a text scrape. `sed`+`head` cannot distinguish the
  # top-level "version" from a nested or escaped one, and silently takes the
  # first textual match. This reads the field with the same interpreter the
  # workload uses, under the same heap cap and a minimal environment. It parses
  # one JSON file; it does not load, require or execute anything from the
  # package, and no install is attempted or possible here.
  yaml_probe=$(
    env -i PATH=/usr/bin:/bin HOME="$RUN" TMPDIR="$RUN" \
      NODE_OPTIONS=--max-old-space-size=192 \
      "$NODE" -e '
        const fs = require("node:fs");
        const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const v = doc === null || typeof doc !== "object" ? undefined : doc.version;
        process.stdout.write(typeof v === "string" ? v : "<not-a-string>");
      ' "$yaml_manifest_json" 2>/dev/null
  )
  yaml_probe_rc=$?
  if [ "$yaml_probe_rc" -ne 0 ]; then
    yaml_state=unparsable
  elif [ "$yaml_probe" = "$EXPECT_YAML_VERSION" ]; then
    yaml_version=$yaml_probe
    yaml_state=exact
  else
    yaml_version=$yaml_probe
    yaml_state=mismatch
  fi
fi
printf 'yaml_state=%s\nyaml_version=%s\nexpected_version=%s\n' \
  "$yaml_state" "${yaml_version:-<none>}" "$EXPECT_YAML_VERSION" > "$RUN/dependency.txt" \
  || addwf dependency.txt
if [ "$yaml_state" != exact ]; then
  printf 'acc_dependency=blocked\n' > "$RUN/dependency-verdict.txt" || addwf dependency-verdict.txt
  say "payload: refusing — yaml@$EXPECT_YAML_VERSION does not resolve from the analyzer package."
  say 'payload: installing is out of scope for this batch and was not attempted.'
  exit 71
fi
printf 'acc_dependency=ok\n' > "$RUN/dependency-verdict.txt" || addwf dependency-verdict.txt

# ---------------------------------------------------------------- 5b. evidence gate
# Every record written so far must have landed BEFORE the workload starts. An
# unrecorded envelope is not something a later verdict may paper over.
if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s) before the workload; refusing to start it"
  exit 73
fi

# Snapshot of the three retained inputs and of the yaml regular files, taken
# before the workload. The input snapshot is a two-point content snapshot of
# files the verifier also pins internally; it says the bytes were identical at
# these two moments, not that they are authentic or complete as an export.
sample_manifest() {
  local rel
  for rel in "${SAMPLE_RELS[@]}"; do
    sha256sum "$ARTIFACT_ROOT/$rel" 2>/dev/null || return 1
  done
}
if ! sample_manifest | wr "$RUN/samples-before.txt"; then
  addwf samples-before.txt
  say 'payload: cannot snapshot the retained inputs; refusing to start the workload'
  exit 73
fi
sample_before_count=$(awk 'END { print NR }' "$RUN/samples-before.txt")
if [ "$sample_before_count" -ne "${#SAMPLE_RELS[@]}" ]; then
  addwf samples-before-incomplete
  say 'payload: retained-input snapshot is short; refusing to start the workload'
  exit 73
fi

yaml_dir="$PKG/node_modules/yaml"
# A snapshot of the regular files under node_modules/yaml at two instants, not a
# provenance claim: equality says the file list and contents were identical at
# those moments, and nothing more. A symlinked directory or any symlink inside it
# is refused: `find -type f` does not follow symlinks, so a linked file would drop
# out of the snapshot and leave an imported file unhashed.
yaml_manifest() {
  [ -d "$yaml_dir" ] || return 1
  [ -L "$yaml_dir" ] && return 1
  local links
  links=$(find "$yaml_dir" -type l -print -quit 2>/dev/null)
  [ $? -eq 0 ] || return 1
  [ -z "$links" ] || return 1
  ( cd "$yaml_dir" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum ) || return 1
}
yaml_before_count=0
if yaml_manifest > "$RUN/yaml-manifest-before.txt" 2>/dev/null && [ -s "$RUN/yaml-manifest-before.txt" ]; then
  yaml_before_count=$(awk 'END { print NR }' "$RUN/yaml-manifest-before.txt")
else
  addwf yaml-manifest-before.txt
  say 'payload: cannot snapshot the yaml dependency regular-file list; refusing to start the workload'
  exit 73
fi

# ---------------------------------------------------------------- 6. the workload
# The verifier is NOT wrapped in a second bwrap here: it spawns one bwrap per
# CLI child itself, and nesting user namespaces would only add a failure mode.
# Its own heap cap is the same 192 MiB; the child gets its own cap inside bwrap.
{
  printf 'node=%s\n' "$NODE"
  printf 'verifier=%s\n' "$VERIFIER"
  printf 'workdir=%s\n' "$SLICE"
  printf 'artifact_root=%s\n' "$ARTIFACT_ROOT"
  printf 'samples=%s\n' "${#SAMPLE_RELS[@]}"
} > "$RUN/workload.txt" || addwf workload.txt

if [ "$write_fail" -ne 0 ]; then
  say 'payload: evidence write failed before the workload; not starting it'
  exit 73
fi

say 'payload: starting the workload'
env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
  NODE_OPTIONS=--max-old-space-size=192 \
  "$NODE" "$VERIFIER" --out "$RUN" --artifact-root "$ARTIFACT_ROOT" \
  > "$RUN/verifier.log" 2>&1
verifier_rc=$?
printf '%s\n' "$verifier_rc" > "$RUN/verifier.rc" || addwf verifier.rc
# Relay to stdout only; the launcher owns unit.log.
cat "$RUN/verifier.log" 2>/dev/null || addwf verifier-log-relay

# ---------------------------------------------------------------- 6b. snapshots after
sample_snapshot=unreadable
if sample_manifest | wr "$RUN/samples-after.txt"; then
  if diff -q "$RUN/samples-before.txt" "$RUN/samples-after.txt" > "$RUN/samples-diff.txt" 2>&1; then
    sample_snapshot=identical
  else
    sample_snapshot=changed
  fi
else
  addwf samples-after.txt
fi

yaml_snapshot=unreadable
if yaml_manifest > "$RUN/yaml-manifest-after.txt" 2>/dev/null && [ -s "$RUN/yaml-manifest-after.txt" ]; then
  if diff -q "$RUN/yaml-manifest-before.txt" "$RUN/yaml-manifest-after.txt" > "$RUN/yaml-manifest-diff.txt" 2>&1; then
    yaml_snapshot=identical
  else
    yaml_snapshot=changed
  fi
else
  addwf yaml-manifest-after.txt
fi

{
  printf 'samples_dir=%s\n' "$ARTIFACT_ROOT"
  printf 'samples_before=%s\n' "$sample_before_count"
  printf 'samples_snapshot_state=%s\n' "$sample_snapshot"
  printf 'yaml_dir=%s\n' "$yaml_dir"
  printf 'yaml_manifest_files_before=%s\n' "$yaml_before_count"
  printf 'yaml_manifest_snapshot_state=%s\n' "$yaml_snapshot"
} > "$RUN/snapshots.txt" || addwf snapshots.txt

# ---------------------------------------------------------------- 7. peaks
{
  printf 'memory_peak=%s\n' "$(read1 "$CGROUP/memory.peak")"
  printf 'pids_peak=%s\n' "$(read1 "$CGROUP/pids.peak")"
} > "$RUN/peaks.txt" || addwf peaks.txt

# ---------------------------------------------------------------- 8. verdict
verdict=pass
if [ "$sample_snapshot" != identical ]; then
  verdict="samples_snapshot_${sample_snapshot}"
elif [ "$yaml_snapshot" != identical ]; then
  verdict="yaml_snapshot_${yaml_snapshot}"
elif [ "$verifier_rc" -ne 0 ]; then
  verdict="verifier_rc_${verifier_rc}"
fi
printf 'acc_retained_export_verdict=%s\nacc_samples_snapshot=%s\nacc_yaml_snapshot=%s\nacc_verifier_rc=%s\n' \
  "$verdict" "$sample_snapshot" "$yaml_snapshot" "$verifier_rc" > "$RUN/retained-export-verdict.txt" \
  || addwf retained-export-verdict.txt

if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s)"
  exit 73
fi
if [ "$verdict" != pass ]; then
  say "payload: verdict=$verdict verifier_rc=$verifier_rc"
  # A verifier that stopped early reports its own fixed code (60-66). Anything
  # else — including a later snapshot mismatch — is a non-green verdict (72).
  case "$verifier_rc" in
    60|61|62|63|64|65|66) [ "$sample_snapshot" = identical ] && [ "$yaml_snapshot" = identical ] && exit "$verifier_rc" ;;
  esac
  exit 72
fi
say "payload: verdict=pass samples=3 verifier_rc=0"
exit 0
