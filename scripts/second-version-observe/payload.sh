#!/bin/bash
# In-envelope payload for the second-version observation batch.
#
# One question: do 0.2.2-rc.1 (installed) and 0.2.2-alpha.2 (pinned closure) reach the
# same per-entry verdicts for the same three fixtures under the same adapter?
#
# Network: NONE. The alpha.2 closure already exists at $CLOSURE and is verified by
# digest. Assembling it takes 3m26s, which is why it is not done inside the envelope.
#
# Exit codes: 0 green, 70 envelope/argument, 71 static contract, 72 a step failed,
# 73 evidence write failed.

set +e
set -uo pipefail
SLICE=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-observe
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
CLOSURE=/data/dsh-ecosystem-test-artifacts/closures/alpha2-0.2.2-alpha.2
CLOSURE_DIGEST=127632a801bf26e631160cedbc99c213acba48d2932aa48298b3d7d76ca58fc9
INSTALLED=/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh
CONFIG=$REPO/examples/trusted-extraction/config.yml
ADAPTER=$REPO/packages/runtime/src/trusted-extraction-adapter.js

source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70

[ "$#" -eq 2 ] || { printf 'usage: payload.sh UNIT RUN_DIR\n' >&2; exit 70; }
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1
BR_RUN=$2
RUN=$BR_RUN

refuse() { printf 'payload: %s\n' "$2" >&2; return "$1"; }
say() { printf '%s\n' "$*"; }
evidence_stop() {
  say "payload: $BR_WRITE_FAILURES evidence write failure(s) at $1; stopping (73) before proceeding"
  return 73
}

second_version_observe_payload() {
  br_envelope_enter "$BR_UNIT" "$BR_RUN" || return $?
  br_evidence_gate || { evidence_stop before-syntax; return 73; }

  bash -n "$SLICE/run.sh" && bash -n "$SLICE/payload.sh" \
    || { refuse 70 "payload: shell syntax check failed"; return 70; }
  "$NODE" --check "$SLICE/compare.mjs" > "$RUN/syntax-check.txt" 2>&1 \
    || { refuse 71 "payload: compare.mjs does not parse"; return 71; }

  # ---------------------------------------------------------------- 2. closure integrity
  # The closure is a pinned artefact, not something this payload builds. If its manifest
  # does not hash to the recorded digest, the observation would describe a different
  # runtime than the record claims, so the round stops here.
  [ -f "$CLOSURE/closure.json" ] || { refuse 72 "payload: closure manifest missing at $CLOSURE"; return 72; }
  local closure_digest
  closure_digest=$(sha256sum "$CLOSURE/closure.json" | cut -d' ' -f1)
  br_record "$RUN/closure.txt" 'closure=%s\nmanifest_sha256=%s\nexpected_sha256=%s\n' \
    "$CLOSURE" "$closure_digest" "$CLOSURE_DIGEST" || :
  [ "$closure_digest" = "$CLOSURE_DIGEST" ] \
    || { refuse 72 "payload: closure manifest digest does not match the recorded value"; return 72; }
  [ -d "$CLOSURE/node_modules/@deepseek-ai/dsh" ] \
    || { refuse 72 "payload: closure has no @deepseek-ai/dsh installation"; return 72; }
  [ -d "$INSTALLED" ] || { refuse 72 "payload: installed runtime missing at $INSTALLED"; return 72; }

  # ---------------------------------------------------------------- 3. observe both
  # The adapter is run exactly as the trusted-extraction batch runs it, once per runtime,
  # inside a sandbox that can read both trees but write only $RUN.
  local label inst out rc
  for label in installed alpha2; do
    if [ "$label" = installed ]; then inst=$INSTALLED; else inst=$CLOSURE/node_modules/@deepseek-ai/dsh; fi
    out=$RUN/observed-$label.json
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
      --bind "$RUN" "$RUN" \
      --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
      --chdir "$REPO" \
      -- /usr/bin/env -i PATH=/usr/bin:/bin:/www/server/nodejs/v24.21.0/bin \
         HOME=/tmp TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=192 \
         "$NODE" "$ADAPTER" \
           --installation "$inst" --modules-root "$inst" \
           --config "$CONFIG" --out "$out" \
      > "$RUN/observe-$label.out" 2> "$RUN/observe-$label.err"
    rc=$?
    br_record "$RUN/observe-$label.rc" 'observe_rc=%s\n' "$rc" || :
    # The adapter prints the runtime's own warnings; they are captured, not interpreted.
    [ "$rc" -eq 0 ] || { refuse 72 "payload: adapter failed for $label (rc=$rc)"; return 72; }
    [ -f "$out" ] || { refuse 73 "payload: adapter wrote no observation for $label"; return 73; }
  done

  # ---------------------------------------------------------------- 4. compare
  "$NODE" "$SLICE/compare.mjs" "$RUN/observed-installed.json" "$RUN/observed-alpha2.json" \
    "$RUN/comparison.json" > "$RUN/comparison.txt" 2> "$RUN/comparison.err"
  rc=$?
  br_record "$RUN/comparison.rc" 'comparison_rc=%s\n' "$rc" || :
  cat "$RUN/comparison.txt" 2>/dev/null || br_write_failure comparison-stdout
  [ "$rc" -eq 0 ] || { refuse 72 "payload: comparison failed (rc=$rc)"; return 72; }

  # A disagreement is a RESULT, not a failure: the record must be able to say "these two
  # runtimes differ" without the batch pretending the run was broken.
  "$NODE" --input-type=module -e '
    import { readFileSync } from "node:fs";
    const doc = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const lines = [
      `agree=${doc.agree}`,
      `differences=${doc.differences}`,
      `entries=${doc.entries.length}`,
      `installed_status=${doc.left.status}`,
      `alpha2_status=${doc.right.status}`,
    ];
    process.stdout.write(lines.join("\n") + "\n");
  ' "$RUN/comparison.json" > "$RUN/comparison-summary.txt" 2>&1 \
    || { refuse 73 "payload: cannot summarise the comparison"; return 73; }
  cat "$RUN/comparison-summary.txt" 2>/dev/null || br_write_failure comparison-summary

  br_payload_finish 0
}

second_version_observe_payload
rc=$?
exit "$rc"
