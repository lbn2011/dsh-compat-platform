#!/bin/bash
# Source after common.sh and policy.sh; no workload commands are accepted here.
BR_HOST_USED=no
BR_LAUNCHED=no

# Wrapper must enumerate ALL additional sourced control files (host AND payload).
# No dependency-closure claim is made about BR_SELECTED_INPUTS.
br_control_closure() { # absolute core directory, wrapper, payload
  local core=$1 wrapper=$2 payload=$3 f line digest rel actual
  BR_CONTROL_FILES=("$core/core.manifest" "$wrapper" "$payload")
  [ -f "$core/core.manifest" ] || return 77
  local -A seen=()
  {
    # The header and every module row must end with a newline.
    IFS= read -r line || return 77
    [ "$line" = 'bounded-runner/1 source-review-unreleased' ] || return 77
    while :; do
      line=
      if ! IFS= read -r line; then
        [ -z "$line" ] || return 77 # Reject an unterminated final record.
        break
      fi
      [[ $line =~ ^([0-9a-f]{64})\ \ ([a-z]+\.sh)$ ]] || return 77
      digest=${BASH_REMATCH[1]}; rel=${BASH_REMATCH[2]}
      case "$rel" in common.sh|policy.sh|host.sh|envelope.sh|tap.sh) ;; *) return 77;; esac
      [ -z "${seen[$rel]+present}" ] || return 77
      seen[$rel]=yes
      actual=$(br_digest "$core/$rel") || return 77
      [ "${actual%% *}" = "$digest" ] || return 78
      BR_CONTROL_FILES+=("$core/$rel")
    done
  } < "$core/core.manifest" || return 77
  [ "${#seen[@]}" -eq 5 ] || return 77
  for f in "${BR_EXTRA_CONTROL[@]}"; do BR_CONTROL_FILES+=("$f"); done
  for f in "${BR_CONTROL_FILES[@]}" "${BR_SELECTED_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || return 77
  done
  # Every active source frame must have been declared. Earlier/future sources
  # cannot be discovered by Bash: wrappers must declare and audit that closure.
  local source found
  for source in "${BASH_SOURCE[@]}"; do
    found=no
    for f in "${BR_CONTROL_FILES[@]}"; do [ "$source" != "$f" ] || found=yes; done
    [ "$found" = yes ] || return 77
  done
}
# Closed receipt schema: exactly two newline-terminated singleton fields, in order.
# Read in this shell (not command substitution) so NULs cannot disappear silently.
br_ownership_receipt() { # current manager InvocationID
  local current=$1 receipt read_rc
  [[ $current =~ ^[0-9a-f]{32}$ ]] || return 1
  [ -f "$BR_RUN/ownership.txt" ] && [ ! -L "$BR_RUN/ownership.txt" ] || return 1
  # Empty delimiter means NUL: success indicates forbidden embedded NUL.
  # EOF status 1 retains all newline bytes, unlike command substitution.
  IFS= read -r -d '' receipt < "$BR_RUN/ownership.txt"; read_rc=$?
  [ "$read_rc" = 1 ] || return 1
  [ "$receipt" = "unit=$BR_UNIT"$'\n'"invocation_id=$current"$'\n' ]
}
br_terminal() {
  local raw rc load active pid invocation confirm=unconfirmed stop_rc=not-attempted
  BR_TERMINAL_OK=no
  raw=$(timeout 30 systemctl show "$BR_UNIT" -p LoadState -p ActiveState -p SubState -p MainPID -p InvocationID 2>&1); rc=$?
  br_record "$BR_RUN/terminal-before.txt" 'query_rc=%s\n%s\n' "$rc" "$raw" || :
  invocation=$(br_field "$raw" InvocationID) || invocation=invalid
  # An attempted launch (including StartTransientUnit failure) proves nothing.
  if br_settled "$rc" "$raw"; then
    BR_TERMINAL_OK=yes; confirm=settled
  elif [ "$rc" != 0 ] || ! br_ownership_receipt "$invocation"; then
    confirm=ownership-unconfirmed
  else
    load=$(br_field "$raw" LoadState) || load=unknown
    active=$(br_field "$raw" ActiveState) || active=unknown
    pid=$(br_field "$raw" MainPID) || pid=unknown
    # Never broad stop/reset-failed/kill, never stop an unconfirmed or foreign unit.
    if br_uint "$pid" && [ "$pid" != 0 ]; then
      case "$load:$active" in
        loaded:active|loaded:activating|loaded:reloading|loaded:deactivating|merged:active)
          if exec 8>"$BR_RUN/stop.txt"; then
            timeout 20 systemctl stop "$BR_UNIT" >&8 2>&1; stop_rc=$?
            exec 8>&-
          else
            br_write_failure stop.txt
            # Cleanup is still necessary; evidence failure remains the verdict.
            timeout 20 systemctl stop "$BR_UNIT"; stop_rc=$?
          fi
          raw=$(timeout 30 systemctl show "$BR_UNIT" -p LoadState -p ActiveState -p SubState -p MainPID -p InvocationID 2>&1); rc=$?
          br_record "$BR_RUN/terminal-after-stop.txt" 'query_rc=%s\n%s\n' "$rc" "$raw" || :
          confirm=stop-did-not-settle
          invocation=$(br_field "$raw" InvocationID) || invocation=invalid
          if br_settled "$rc" "$raw"; then
            BR_TERMINAL_OK=yes; confirm=stopped-and-settled
          fi
          ;;
      esac
    fi
  fi
  br_record "$BR_RUN/terminal.txt" 'terminal_ok=%s\nconfirmation=%s\nstop_rc=%s\n' "$BR_TERMINAL_OK" "$confirm" "$stop_rc" || :
}
br_host_status() { # exit code and phase; also usable for prelaunch refusal
  local rc=$1 phase=$2
  br_evidence_gate || rc=73
  br_record "$BR_RUN/status.txt" 'abi=%s\nunit=%s\nlaunch_attempted=%s\nphase=%s\nlaunch_rc=%s\nterminal_ok=%s\nhash_rc=%s\nwrite_failures=%s\nacceptance_exit=%s\n' \
    "$BR_ABI" "$BR_UNIT" "$BR_LAUNCHED" "$phase" "${BR_LAUNCH_RC:-not-launched}" "${BR_TERMINAL_OK:-not-queried}" "${BR_HASH_RC:-not-checked}" "$BR_WRITE_FAILURES" "$rc" || return 73
  br_finish "$rc"
}
# Call in a dedicated subshell with set -uo pipefail (NOT errexit). This owns FD9
# until return. Wrapper forwards the return status and does not retry.
br_host_run() { # core-dir wrapper payload runs-root approved-prefix
  [ "$BR_HOST_USED" = no ] || return 70
  BR_HOST_USED=yes
  local core=$1 wrapper=$2 payload=$3 runs=$4 prefix=$5 rc stamp raw before_rc after_rc diff_rc
  br_path "$core" && br_path "$runs" && br_prefix_allowed "$prefix" || return 70
  br_workload_policy_valid || return 70
  br_control_closure "$core" "$wrapper" "$payload" || return $?
  local command
  for command in timeout systemd-run systemctl journalctl flock sha256sum diff awk date mkdir chmod cat; do
    command -v "$command" >/dev/null 2>&1 || return 70
  done
  [ -f "$BR_LOCK" ] || return 70
  exec 9>"$BR_LOCK" || return 73
  flock -n 9 || return 75
  stamp=$(date -u +%Y%m%dT%H%M%SZ) || return 73
  BR_UNIT="$prefix-$stamp-$$-$RANDOM.service"
  # Unit regex permits lower case only; timestamp is deliberately normalized.
  BR_UNIT=${BR_UNIT,,}
  br_unit "$BR_UNIT" || return 70
  BR_RUN="$runs/$stamp-$prefix-$$-$RANDOM"
  mkdir -p -- "$runs" || return 73
  [ ! -e "$BR_RUN" ] || return 76
  mkdir -m 700 -- "$BR_RUN" || return 73
  br_record "$BR_RUN/selection.txt" 'control_files=%s\nselected_workload_files=%s\nworkload_dependency_closure=no\n' "${#BR_CONTROL_FILES[@]}" "${#BR_SELECTED_INPUTS[@]}" || :
  br_snapshot "$BR_RUN/control-before.txt" "${BR_CONTROL_FILES[@]}"; before_rc=$?
  if [ "$before_rc" != 0 ]; then br_host_status "$before_rc" control-snapshot; return $?; fi
  # Empty workload selection is allowed, and is still an explicit recorded set.
  br_record "$BR_RUN/selected-before.txt" '%s' '' || :
  if [ "${#BR_SELECTED_INPUTS[@]}" -gt 0 ]; then
    br_snapshot "$BR_RUN/selected-before.txt" "${BR_SELECTED_INPUTS[@]}"; before_rc=$?
    if [ "$before_rc" != 0 ]; then br_host_status "$before_rc" selected-snapshot; return $?; fi
  fi
  raw=$(timeout 30 systemctl list-units --state=active,activating,deactivating --no-legend --plain "${BR_UNIT_FAMILIES[@]}" 2>&1); rc=$?
  br_record "$BR_RUN/active-units.txt" 'query_rc=%s\n%s\n' "$rc" "$raw" || :
  if [ "$rc" != 0 ] || [ -n "$raw" ]; then br_host_status 70 active-unit-guard; return $?; fi
  local -a argv=(systemd-run --wait --pipe --collect --unit="$BR_UNIT"
    --property=Type=exec --property=MemoryMax=384M --property=MemorySwapMax=0
    --property=TasksMax=32 --property=CPUQuota=50% --property=RuntimeMaxSec=120
    --working-directory="${payload%/*}" -- /bin/bash "$payload" "$BR_UNIT" "$BR_RUN")
  br_record "$BR_RUN/argv.txt" '%q ' "${argv[@]}" || :
  br_record "$BR_RUN/requested.txt" 'Type=exec\nMemoryMax=402653184\nMemorySwapMax=0\nTasksMax=32\nCPUQuota=50%%\nRuntimeMaxUSec=120000000\nNodeHeapMiB=192\nMemAvailableMinKiB=819200\n' || :
  br_record "$BR_RUN/unit.log" '%s' '' || :
  br_record "$BR_RUN/launch.txt" 'launch=about-to-attempt\nunit=%s\n' "$BR_UNIT" || :
  if ! br_evidence_gate; then br_host_status 73 prelaunch-evidence; return $?; fi
  if ! exec 8>"$BR_RUN/unit.log"; then
    br_write_failure unit.log
    br_host_status 73 launch-log-open; return $?
  fi
  BR_LAUNCHED=yes
  timeout 200 "${argv[@]}" >&8 2>&1; BR_LAUNCH_RC=$?
  exec 8>&-
  br_record "$BR_RUN/systemd-run.rc" '%s\n' "$BR_LAUNCH_RC" || :
  timeout 30 journalctl -u "$BR_UNIT" --no-pager -o cat > "$BR_RUN/journal.txt" 2>&1; rc=$?
  [ "$rc" = 0 ] || br_write_failure journal-query
  br_record "$BR_RUN/journal.rc" '%s\n' "$rc" || :
  br_terminal
  BR_HASH_RC=0
  br_snapshot "$BR_RUN/control-after.txt" "${BR_CONTROL_FILES[@]}"; after_rc=$?
  [ "$after_rc" = 0 ] || BR_HASH_RC=77
  br_record "$BR_RUN/selected-after.txt" '%s' '' || :
  if [ "${#BR_SELECTED_INPUTS[@]}" -gt 0 ]; then
    br_snapshot "$BR_RUN/selected-after.txt" "${BR_SELECTED_INPUTS[@]}"; after_rc=$?
    [ "$after_rc" = 0 ] || BR_HASH_RC=77
  fi
  if [ "$BR_HASH_RC" = 0 ]; then
    for raw in control selected; do
      if ! exec 8>"$BR_RUN/$raw-diff.txt"; then
        BR_HASH_RC=77
        br_write_failure "$raw-diff"
        continue
      fi
      diff -u "$BR_RUN/$raw-before.txt" "$BR_RUN/$raw-after.txt" >&8 2>&1; diff_rc=$?
      exec 8>&-
      case "$diff_rc" in 0) ;; 1) [ "$BR_HASH_RC" = 77 ] || BR_HASH_RC=78;; *) BR_HASH_RC=77; br_write_failure "$raw-diff";; esac
    done
  fi
  # Payload must finalize even on refusal; absent/failed evidence is never green.
  raw=$(br_single "$BR_RUN/payload-evidence.txt") || raw=missing
  [ "$raw" = 'write_failures=0' ] || br_write_failure payload-evidence
  br_verdict "$BR_LAUNCH_RC" "$BR_TERMINAL_OK" "$BR_HASH_RC"; rc=$?
  br_host_status "$rc" completed
}
