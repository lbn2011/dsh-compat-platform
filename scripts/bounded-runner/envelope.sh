#!/bin/bash
# Payload helpers; source common/policy/envelope by explicit repository-local paths.
BR_ENVELOPE_USED=no
BR_MEMORY_GATE_USED=no
br_memory_available() { # strict singleton MemAvailable with exact kB unit
  awk '$1=="MemAvailable:" {n++; if(NF!=3 || $2 !~ /^(0|[1-9][0-9]*)$/ || $3!="kB") bad=1; v=$2}
    END {if(n!=1 || bad) exit 1; print v}' "$1"
}
br_memory_gate() {
  [ "$BR_MEMORY_GATE_USED" = no ] || return 70
  BR_MEMORY_GATE_USED=yes
  local available rc
  available=$(br_memory_available /proc/meminfo); rc=$?
  br_record "$BR_RUN/memory-gate.txt" 'read_rc=%s\nMemAvailableKiB=%s\nminimum_kib=%s\n' "$rc" "$available" "$BR_MEMORY_GATE_KIB" || :
  br_evidence_gate || return 73
  [ "$rc" = 0 ] && br_uint "$available" && [ "${#available}" -le 15 ] || return 70
  [ "$available" -ge "$BR_MEMORY_GATE_KIB" ] || return 70
}
br_envelope_enter() { # unit run-dir; call before ANY workload or syntax subprocess
  [ "$BR_ENVELOPE_USED" = no ] || return 70
  BR_ENVELOPE_USED=yes
  BR_UNIT=$1 BR_RUN=$2
  br_unit "$BR_UNIT" && br_path "$BR_RUN" && [ -d "$BR_RUN" ] || return 70
  BR_CGROUP="/sys/fs/cgroup/system.slice/$BR_UNIT"
  local raw rc type path bus runtime mem swap pids cpu membership invocation identity_bad=0 bad=0
  # Bind readback to this payload's actual unified cgroup, not just a named unit.
  membership=$(br_single /proc/self/cgroup) || membership=unreadable
  [ "$membership" = "0::/system.slice/$BR_UNIT" ] || identity_bad=1
  # Establish cooperative ownership before any workload, independently of limits.
  raw=$(timeout 20 systemctl show "$BR_UNIT" -p InvocationID 2>&1; rc=$?; printf '\034'; exit "$rc"); rc=$?
  raw=${raw%$'\034'}
  br_record "$BR_RUN/ownership-systemctl.txt" 'query_rc=%s\n%s\n' "$rc" "$raw" || :
  invocation=${raw%$'\n'}
  [[ $invocation =~ ^InvocationID=([0-9a-f]{32})$ ]] || identity_bad=1
  invocation=${invocation#InvocationID=}
  [[ ${INVOCATION_ID:-} =~ ^[0-9a-f]{32}$ ]] || identity_bad=1
  [ "$rc" = 0 ] && [ "$invocation" = "${INVOCATION_ID:-}" ] || identity_bad=1
  br_evidence_gate || return 73
  [ "$identity_bad" = 0 ] || return 70
  # Fresh host directory, exclusive receipt creation; never replace an old proof.
  if ! (set -o noclobber; printf 'unit=%s\ninvocation_id=%s\n' "$BR_UNIT" "$invocation" > "$BR_RUN/ownership.txt"); then
    br_write_failure ownership.txt
    return 73
  fi
  mem=$(br_single "$BR_CGROUP/memory.max") || bad=1
  swap=$(br_single "$BR_CGROUP/memory.swap.max") || bad=1
  pids=$(br_single "$BR_CGROUP/pids.max") || bad=1
  cpu=$(br_single "$BR_CGROUP/cpu.max") || bad=1
  raw=$(timeout 20 systemctl show "$BR_UNIT" -p Type 2>&1); rc=$?
  br_record "$BR_RUN/envelope-systemctl.txt" 'query_rc=%s\n%s\n' "$rc" "$raw" || :
  [ "$rc" = 0 ] || bad=1
  type=$(br_field "$raw" Type) || bad=1
  # Sentinel preserves trailing blank lines that command substitution otherwise
  # removes. Preserve the command's own rc, not printf's rc.
  raw=$(timeout 20 busctl --system call org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager GetUnit s "$BR_UNIT" 2>&1; rc=$?; printf '\034'; exit "$rc"); rc=$?
  raw=${raw%$'\034'}
  br_record "$BR_RUN/envelope-getunit.txt" 'query_rc=%s\n%s\n' "$rc" "$raw" || :
  path=''; runtime=''; bus=''; local bus_rc=not-attempted
  if [ "$rc" = 0 ] && path=$(br_bus_path "$raw"); then
    bus=$(timeout 20 busctl --system get-property org.freedesktop.systemd1 "$path" org.freedesktop.systemd1.Service RuntimeMaxUSec 2>&1; rc=$?; printf '\034'; exit "$rc"); bus_rc=$?
    bus=${bus%$'\034'}
    if [ "$bus_rc" = 0 ]; then runtime=$(br_bus_u64 "$bus") || bad=1; else bad=1; fi
  else bad=1
  fi
  br_record "$BR_RUN/envelope-runtime.txt" 'query_rc=%s\n%s\n' "$bus_rc" "$bus" || :
  [ "$mem" = "$BR_MEMORY_BYTES" ] || bad=1
  [ "$swap" = "$BR_SWAP_BYTES" ] || bad=1
  [ "$pids" = "$BR_TASKS" ] || bad=1
  [ "$cpu" = "$BR_CPU_MAX" ] || bad=1
  [ "$type" = exec ] || bad=1
  [ "$runtime" = "$BR_RUNTIME_USEC" ] || bad=1
  br_record "$BR_RUN/envelope-effective.txt" 'membership=%s\nmemory.max=%s\nmemory.swap.max=%s\npids.max=%s\ncpu.max=%s\nType=%s\nRuntimeMaxUSec=%s\nmismatch=%s\n' "$membership" "$mem" "$swap" "$pids" "$cpu" "$type" "$runtime" "$bad" || :
  br_evidence_gate || return 73
  [ "$bad" = 0 ] || return 70
  br_memory_gate || return $?
  # Workload must explicitly pass this same value through env -i / its sandbox.
  export NODE_OPTIONS="$BR_NODE_OPTIONS"
  br_evidence_gate
}
br_peaks() { # Capture before the service cgroup can disappear; missing is explicit.
  local memory pids memory_state=measured pids_state=measured
  memory=$(br_single "$BR_CGROUP/memory.peak") || memory=unavailable
  pids=$(br_single "$BR_CGROUP/pids.peak") || pids=unavailable
  br_uint "$memory" || { memory=unavailable; memory_state=unavailable; }
  br_uint "$pids" || { pids=unavailable; pids_state=unavailable; }
  br_record "$BR_RUN/peaks.txt" 'memory_peak=%s\nmemory_peak_state=%s\npids_peak=%s\npids_peak_state=%s\n' "$memory" "$memory_state" "$pids" "$pids_state"
}
br_payload_finish() { # original verdict; call on EVERY exit after valid args
  local rc=$1
  if [ -n "${BR_CGROUP:-}" ]; then br_peaks || :; fi
  br_record "$BR_RUN/payload-result.txt" 'original_exit=%s\nwrite_failures=%s\n' "$rc" "$BR_WRITE_FAILURES" || :
  br_record "$BR_RUN/payload-evidence.txt" 'write_failures=%s\n' "$BR_WRITE_FAILURES" || return 73
  br_finish "$rc"
}
