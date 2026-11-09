#!/bin/bash
# In-envelope payload for the retained-export acceptance batch.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1, core
# commit c8123de). Awaiting Lead bounded verification. These bytes have not been
# executed, syntax-qualified or sourced.
#
# Runs INSIDE the transient unit. After the core's envelope receipt it refuses to
# start the workload if anything is off, and only then runs the verifier once.
#
# Logging: this payload NEVER writes unit.log. The host is the single writer of
# unit.log and captures this process's stdout/stderr there; the payload only relays
# its logs. Every record this payload keeps lives under $RUN.
#
# What it can establish: that three retained captures match their pins, and that
# the committed CLI reproduces the fixed summary counters on those bytes under
# these limits.
#
# What it cannot establish: where those captures came from beyond the pins
# themselves (the pins are a content digest, not a provenance chain), that a build
# corresponds to a commit, that the export is complete, that any plugin would load,
# or what any `!!js` expression evaluates to. Nothing here reads a host profile,
# exports a profile, or evaluates an expression.
#
# The historical evidence root used to arrive as a third argument. The canonical
# host launches payloads with exactly two (`unit`, `run`) and a transient service
# gets a detached environment, so the root is now PINNED here as a constant; the
# launcher refuses (70) rather than let a different override be silently ignored.
# See the README, "Artifact root".
#
# Payload exit codes: 0 green; 70 envelope/argument refusal; 71 dependency or
# syntax precondition failed; 72 the verifier ran but the batch is not green; 73 an
# evidence write failed. The verifier's own 60-66 codes are passed through
# unchanged when it fails early and both snapshots are identical.

set +e
set -uo pipefail
SLICE=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export
PKG=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer
CORE=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
VERIFIER=$SLICE/retained-export.mjs
EXPECT_YAML_VERSION='2.9.1'
# The historical evidence root. Pinned, not passed: the canonical launch has two
# arguments and no inherited environment, so this is the only faithful carrier
# left. The launcher refuses (70) when the caller asks for a different one.
ARTIFACT_ROOT=/data/dsh-ecosystem-test-artifacts/experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141
SAMPLE_RELS=(
  1-probe/out/run-root/out/stdout.bin
  2-denied/out/run-root/out/stdout.bin
  3-script-probe/out/run-root/out/stdout.bin
)
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70
# The canonical host launches the payload with exactly two arguments.
[ "$#" -eq 2 ] || exit 70
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1
BR_RUN=$2
RUN=$BR_RUN
say() { printf '%s\n' "$*"; }

# Snapshot of the three retained inputs. A two-point content snapshot of files the
# verifier also pins internally: it says the bytes were identical at these two
# moments, not that they are authentic or complete as an export.
sample_manifest() {
  local rel
  for rel in "${SAMPLE_RELS[@]}"; do
    sha256sum "$ARTIFACT_ROOT/$rel" 2>/dev/null || return 1
  done
}

# A snapshot of the regular files under node_modules/yaml at two instants, not a
# provenance claim: equality says the file list and contents were identical at
# those moments, and nothing more. A symlinked directory or any symlink inside it
# is refused: `find -type f` does not follow symlinks, so a linked file would drop
# out of the snapshot and leave an imported file unhashed.
snapshot_yaml() { # destination yaml_dir
  local out=$1
  local yaml_dir=$2
  [ -d "$yaml_dir" ] || return 1
  [ -L "$yaml_dir" ] && return 1
  local links
  links=$(find "$yaml_dir" -type l -print -quit 2>/dev/null) || return 1
  [ -z "$links" ] || return 1
  ( cd "$yaml_dir" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum ) > "$out"
}

profile_dump_retained_export_payload() {
  # Envelope first: nothing below may run outside the accounted cgroup.
  br_envelope_enter "$BR_UNIT" "$BR_RUN"
  local rc=$?
  [ "$rc" -eq 0 ] || return "$rc"

  # --- 0. paths ----------------------------------------------------------
  # The artifact root is re-validated here exactly as before the migration, even
  # though it is now a constant: an absolute path, no `/../`, no trailing `/..`,
  # no doubled slash, and a directory. It is checked again because the payload is
  # the process that reads the samples.
  br_path "$ARTIFACT_ROOT" || { say "payload: artifact root must be absolute: $ARTIFACT_ROOT"; return 70; }
  case "$ARTIFACT_ROOT" in
    */../*|*/..|*//*) say "payload: artifact root must not contain a traversal or empty component: $ARTIFACT_ROOT"; return 70 ;;
  esac
  [ -d "$ARTIFACT_ROOT" ] || { say "payload: artifact root is not a directory: $ARTIFACT_ROOT"; return 70; }
  [ -d "$PKG" ] || { say "payload: analyzer package missing: $PKG"; return 70; }
  [ -x "$NODE" ] || { say "payload: node binary missing: $NODE"; return 70; }
  [ -f "$VERIFIER" ] || { say "payload: verifier missing: $VERIFIER"; return 70; }
  command -v sha256sum >/dev/null 2>&1 || return 70

  # --- 1. syntax ---------------------------------------------------------
  # bash -n runs only on top of an evidence set that is still good; a failure here
  # is recorded, then 71.
  br_evidence_gate || return 73
  bash -n "$SLICE/run.sh"
  local acc_syntax_run_sh_rc=$?
  bash -n "$SLICE/payload.sh"
  local acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax.txt" \
    'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] || { say "payload: run.sh does not parse (rc=$acc_syntax_run_sh_rc)"; return 71; }
  [ "$acc_syntax_payload_sh_rc" -eq 0 ] || { say "payload: payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"; return 71; }

  # --- 2. dependency precondition ----------------------------------------
  # This batch never installs. If `yaml` does not already resolve to exactly 2.9.1
  # from the analyzer package, refuse before the workload starts.
  #
  # Strict JSON parse, not a text scrape: `sed`+`head` cannot distinguish the
  # top-level "version" from a nested or escaped one, and silently takes the first
  # textual match. This reads the field with the same interpreter the workload
  # uses, under the same heap cap and a minimal environment. It parses one JSON
  # file; it does not load, require or execute anything from the package, and no
  # install is attempted or possible here.
  br_evidence_gate || return 73
  local yaml_manifest_json=$PKG/node_modules/yaml/package.json
  local yaml_state=absent
  local yaml_version=''
  if [ -f "$yaml_manifest_json" ]; then
    local yaml_probe
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
    local yaml_probe_rc=$?
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
  br_record "$RUN/dependency.txt" 'yaml_state=%s\nyaml_version=%s\nexpected_version=%s\n' \
    "$yaml_state" "${yaml_version:-<none>}" "$EXPECT_YAML_VERSION" || :
  br_evidence_gate || return 73
  if [ "$yaml_state" != exact ]; then
    br_record "$RUN/dependency-verdict.txt" 'acc_dependency=blocked\n' || :
    say "payload: refusing — yaml@$EXPECT_YAML_VERSION does not resolve from the analyzer package."
    say 'payload: installing is out of scope for this batch and was not attempted.'
    return 71
  fi
  br_record "$RUN/dependency-verdict.txt" 'acc_dependency=ok\n' || :

  # --- 3. before snapshots ------------------------------------------------
  br_evidence_gate || return 73
  if ! sample_manifest > "$RUN/samples-before.txt" 2>/dev/null \
     || [ ! -s "$RUN/samples-before.txt" ]; then
    br_write_failure samples-before.txt
    say 'payload: cannot snapshot the retained inputs; refusing to start the workload'
    return 73
  fi
  local sample_before_count
  sample_before_count=$(awk 'END { print NR }' "$RUN/samples-before.txt") || sample_before_count=0
  if [ "$sample_before_count" -ne "${#SAMPLE_RELS[@]}" ]; then
    br_write_failure samples-before-incomplete
    say 'payload: retained-input snapshot is short; refusing to start the workload'
    return 73
  fi

  local yaml_dir=$PKG/node_modules/yaml
  if ! snapshot_yaml "$RUN/yaml-manifest-before.txt" "$yaml_dir" 2>/dev/null \
     || [ ! -s "$RUN/yaml-manifest-before.txt" ]; then
    br_write_failure yaml-manifest-before.txt
    say 'payload: cannot snapshot the yaml dependency regular-file list; refusing to start the workload'
    return 73
  fi
  local yaml_before_count
  yaml_before_count=$(awk 'END { print NR }' "$RUN/yaml-manifest-before.txt") || yaml_before_count=0

  # --- 4. the workload ----------------------------------------------------
  br_evidence_gate || return 73
  br_record "$RUN/workload.txt" \
    'node=%s\nverifier=%s\nworkdir=%s\nartifact_root=%s\nsamples=%s\n' \
    "$NODE" "$VERIFIER" "$SLICE" "$ARTIFACT_ROOT" "${#SAMPLE_RELS[@]}" || :
  br_evidence_gate || return 73

  # The verifier is NOT wrapped in a second bwrap here: it spawns one bwrap per CLI
  # child itself, and nesting user namespaces would only add a failure mode. Its
  # own heap cap is the same 192 MiB; the child gets its own cap inside bwrap.
  say 'payload: starting the workload'
  if ! exec 7>"$RUN/verifier.log"; then
    br_write_failure verifier.log
    return 73
  fi
  env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
    NODE_OPTIONS=--max-old-space-size=192 \
    "$NODE" "$VERIFIER" --out "$RUN" --artifact-root "$ARTIFACT_ROOT" >&7 2>&1
  local verifier_rc=$?
  exec 7>&-
  br_record "$RUN/verifier.rc" '%s\n' "$verifier_rc" || :
  # Relay to stdout only; the host owns unit.log.
  if ! cat "$RUN/verifier.log"; then
    br_write_failure verifier-log-relay
  fi

  # --- 5. after snapshots -------------------------------------------------
  local sample_snapshot=unreadable
  if sample_manifest > "$RUN/samples-after.txt" 2>/dev/null \
     && [ -s "$RUN/samples-after.txt" ]; then
    if diff -q "$RUN/samples-before.txt" "$RUN/samples-after.txt" \
        > "$RUN/samples-diff.txt" 2>&1; then
      sample_snapshot=identical
    else
      sample_snapshot=changed
    fi
  else
    br_write_failure samples-after.txt
  fi

  local yaml_snapshot=unreadable
  if snapshot_yaml "$RUN/yaml-manifest-after.txt" "$yaml_dir" 2>/dev/null \
     && [ -s "$RUN/yaml-manifest-after.txt" ]; then
    if diff -q "$RUN/yaml-manifest-before.txt" "$RUN/yaml-manifest-after.txt" \
        > "$RUN/yaml-manifest-diff.txt" 2>&1; then
      yaml_snapshot=identical
    else
      yaml_snapshot=changed
    fi
  else
    br_write_failure yaml-manifest-after.txt
  fi

  br_record "$RUN/snapshots.txt" \
    'samples_dir=%s\nsamples_before=%s\nsamples_snapshot_state=%s\nyaml_dir=%s\nyaml_manifest_files_before=%s\nyaml_manifest_snapshot_state=%s\n' \
    "$ARTIFACT_ROOT" "$sample_before_count" "$sample_snapshot" \
    "$yaml_dir" "$yaml_before_count" "$yaml_snapshot" || :
  br_evidence_gate || return 73

  # --- 6. verdict ---------------------------------------------------------
  local verdict=pass
  if [ "$sample_snapshot" != identical ]; then
    verdict="samples_snapshot_${sample_snapshot}"
  elif [ "$yaml_snapshot" != identical ]; then
    verdict="yaml_snapshot_${yaml_snapshot}"
  elif [ "$verifier_rc" -ne 0 ]; then
    verdict="verifier_rc_${verifier_rc}"
  fi
  br_record "$RUN/retained-export-verdict.txt" \
    'acc_retained_export_verdict=%s\nacc_samples_snapshot=%s\nacc_yaml_snapshot=%s\nacc_verifier_rc=%s\n' \
    "$verdict" "$sample_snapshot" "$yaml_snapshot" "$verifier_rc" || :
  br_evidence_gate || return 73
  if [ "$verdict" = pass ]; then
    say "payload: verdict=pass samples=${#SAMPLE_RELS[@]} verifier_rc=0"
    return 0
  fi
  say "payload: verdict=$verdict verifier_rc=$verifier_rc"
  # A verifier that stopped early reports its own fixed code (60-66). Anything
  # else — including a later snapshot mismatch — is a non-green verdict (72). The
  # special codes survive only when both snapshots are identical: otherwise the
  # evidence itself is in doubt and 72 is the honest answer.
  case $verifier_rc in
    60|61|62|63|64|65|66)
      if [ "$sample_snapshot" = identical ] && [ "$yaml_snapshot" = identical ]; then
        return "$verifier_rc"
      fi
      ;;
  esac
  return 72
}

profile_dump_retained_export_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
