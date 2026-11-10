#!/bin/bash
# Payload for one bounded observation of the SHIPPED phase budget.
#
# Why this batch exists: the trusted-extraction batch demonstrates the kill path
# with a 3 s demo budget, so the number the product would actually enforce (the
# policy's own BUDGET, phaseSeconds 80) was only covered by an arithmetic check.
# Here the wedged fixture is run under the real budget and the measurement, not
# the inequality, is the evidence.
#
# It is a separate slice because the timing does not fit: 80 s of phase budget
# plus kill grace and read-back cannot share a 120 s envelope with unit tests and
# a full fixture observation. Nothing else is skipped for convenience — the
# isolation probe still runs, because the hang case is only meaningful inside a
# boundary that was verified in the same round.
#
# The shipped budget is imported from the policy module, never restated, so this
# batch cannot drift from what the product enforces.
#
# Exit codes: 0 green; 70 envelope, syntax or static-contract refusal; 73 an
# isolation gate refused or an evidence write failed; 74 a failure-path check
# failed or the unit did not settle.

set +e
set -uo pipefail

REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
SLICE=$REPO/scripts/trusted-extraction-hang-budget
CORE=$REPO/scripts/bounded-runner
PKG=$REPO/packages/runtime
NODE=/www/server/nodejs/v24.21.0/bin/node
INSTALLATION=/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh
MODULES_ROOT=/www/server/nodejs/v24.21.0/lib/node_modules
HANG_CONFIG=$REPO/examples/trusted-extraction/config-hang.yml
SENTINEL=/root/.dsh/profiles/web/package.json

source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70
source "$CORE/tap.sh" || exit 70

[ "$#" -eq 2 ] || { printf 'usage: payload.sh UNIT RUN_DIR\n' >&2; exit 70; }
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1
BR_RUN=$2
RUN=$BR_RUN

refuse() {
  printf '%s\n' "$2" > "$RUN/reason.txt" 2>/dev/null || br_write_failure reason.txt
  printf 'payload: %s\n' "$2" >&2
  return "$1"
}
say() { printf '%s\n' "$*"; }

hang_budget_payload() {
  say "payload: unit=$BR_UNIT run=$RUN"

  # ------------------------------------------------------------ 0. envelope
  br_envelope_enter "$BR_UNIT" "$BR_RUN" || return $?

  # ------------------------------------------------------------ 1. syntax
  br_evidence_gate || return 73
  bash -n "$SLICE/run.sh" || { refuse 70 "syntax_run"; return 70; }
  bash -n "$SLICE/payload.sh" || { refuse 70 "syntax_payload"; return 70; }
  for f in isolation-policy.js child-probe.js trusted-extraction-supervisor.js trusted-extraction-receipt.js; do
    "$NODE" --check "$PKG/src/$f" || { refuse 70 "syntax_$f"; return 70; }
  done
  "$NODE" --check "$REPO/scripts/trusted-extraction-batch/failure-paths.mjs" || { refuse 70 "syntax_failure_paths"; return 70; }
  "$NODE" --check "$REPO/examples/trusted-extraction/plugin-hang.mjs" || { refuse 70 "syntax_plugin_hang"; return 70; }

  # ------------------------------------------------------------ 2. static contract
  # The point of this batch is that the shipped numbers are the ones exercised,
  # so the contract pins them explicitly and refuses a silent change.
  "$NODE" --input-type=module -e "
import { readFileSync } from 'node:fs'
const pol = await import('$PKG/src/isolation-policy.js')
const b = pol.BUDGET
const problems = []
if (b.outerSeconds !== 120) problems.push('outerSeconds')
if (b.phaseSeconds !== 80) problems.push('phaseSeconds')
if (b.killGraceSeconds !== 10) problems.push('killGraceSeconds')
if (b.readbackSeconds !== 20) problems.push('readbackSeconds')
if (!(b.outerSeconds > b.phaseSeconds + b.killGraceSeconds + b.readbackSeconds)) problems.push('budget-slack')
if (pol.checkBudget(b) !== null) problems.push('checkBudget')
const pkg = JSON.parse(readFileSync('$PKG/package.json', 'utf8'))
if (pkg.name !== 'dsh-compat-trusted-extraction') problems.push('name')
if (pkg.private !== true) problems.push('private')
process.stdout.write(problems.length === 0 ? 'static-contract=pass\nshipped_phase_seconds=' + String(b.phaseSeconds) + '\n' : 'static-contract=FAIL:' + problems.join(',') + '\n')
process.exit(problems.length === 0 ? 0 : 1)
" > "$RUN/static-contract.txt" 2>&1 || { refuse 70 "static_contract"; return 70; }
  br_record "$RUN/static-contract.txt" 'static_contract=pass\n' || :

  # ------------------------------------------------------------ 3. isolation gates
  # Same probe as the main batch: the kill path is only meaningful inside a
  # boundary that was verified in this same run.
  "$NODE" --input-type=module -e "
import { probeIsolation } from '$PKG/src/trusted-extraction-supervisor.js'
const r = probeIsolation({ supervisorPaths: ['$REPO/scripts/runtime-receipt/README.md'], sentinels: ['$SENTINEL'], keepDir: '$RUN/isolation' })
const lines = [
  'gate=' + (r.gates.gate ?? 'none'),
  'refusal=' + (r.gates.refusal ?? 'none'),
  'uid=' + (r.observations?.identity?.uid ?? 'unread'),
  'capEff=' + (r.observations?.identity?.capEff ?? 'unread'),
  'noNewPrivs=' + (r.observations?.identity?.noNewPrivs ?? 'unread'),
  'mounts=' + (r.observations?.childMounts?.length ?? 0),
  'sentinels=' + JSON.stringify(r.observations?.sentinelVerdict ?? null),
]
process.stdout.write(lines.join('\n') + '\n')
process.exit(r.gates.refusal === null ? 0 : 1)
" > "$RUN/isolation.txt" 2>&1
  local iso=$?
  printf 'isolation_exit=%s\n' "$iso" >> "$RUN/isolation.txt"
  [ "$iso" -eq 0 ] || { refuse 73 "isolation_gates"; return 73; }

  # ------------------------------------------------------------ 4. shipped-budget hang
  # --budget-profile shipped selects the policy's own BUDGET. The checks require
  # the receipt to say incomplete/unconfirmed/timedOut AND the recorded budget to
  # be the shipped 80 s, so a demo-sized run cannot masquerade as this evidence.
  mkdir -p "$RUN/hang-budget" || { refuse 73 "cannot create hang-budget directory"; return 73; }
  say "payload: running the wedged fixture under the shipped phase budget (80 s)"
  "$NODE" "$REPO/scripts/trusted-extraction-batch/failure-paths.mjs" \
    --installation "$INSTALLATION" --modules-root "$MODULES_ROOT" \
    --hang-config "$HANG_CONFIG" --out "$RUN/hang-budget" \
    --sentinel "$SENTINEL" --budget-profile shipped \
    > "$RUN/hang-budget/report.txt" 2>&1
  local fp=$?
  printf 'hang_budget_exit=%s\n' "$fp" >> "$RUN/hang-budget/report.txt"
  cp "$RUN/hang-budget/failure-paths.json" "$RUN/failure-paths.json" 2>/dev/null || true
  cp "$RUN/hang-budget/hang-budget.json" "$RUN/hang-budget-used.json" 2>/dev/null || true
  cp "$RUN/hang-budget/hang.json" "$RUN/hang.json" 2>/dev/null || true
  [ "$fp" -eq 0 ] || { refuse 74 "failure_paths"; return 74; }

  # ------------------------------------------------------------ 5. shipped-budget attestation
  "$NODE" --input-type=module -e "
import { readFileSync } from 'node:fs'
const used = JSON.parse(readFileSync('$RUN/hang-budget-used.json', 'utf8'))
const report = JSON.parse(readFileSync('$RUN/failure-paths.json', 'utf8'))
const receipt = JSON.parse(readFileSync('$RUN/hang.json', 'utf8'))
const problems = []
if (used.profile !== 'shipped') problems.push('profile')
if (used.phaseSeconds !== 80) problems.push('phaseSeconds')
if (report.budgetProfile !== 'shipped') problems.push('report-profile')
if (receipt.status !== 'incomplete') problems.push('status')
if (receipt.cleanup !== 'unconfirmed') problems.push('cleanup')
if (receipt.process?.timedOut !== true) problems.push('timedOut')
if (receipt.process?.signal !== 'SIGKILL') problems.push('signal')
process.stdout.write([
  'budget_profile=' + String(used.profile),
  'phase_seconds=' + String(used.phaseSeconds),
  'status=' + String(receipt.status),
  'cleanup=' + String(receipt.cleanup),
  'timed_out=' + String(receipt.process?.timedOut),
  'signal=' + String(receipt.process?.signal ?? 'none'),
  'checks=' + JSON.stringify(report.checks),
].join('\n') + '\n')
process.exit(problems.length === 0 ? 0 : 1)
" > "$RUN/attestation.txt" 2>&1 || { refuse 74 "shipped_budget_attestation"; return 74; }

  br_evidence_gate || return 73
  br_record "$RUN/verdict.txt" 'verdict=pass\n' || :
  say 'payload: verdict=pass'
  return 0
}

hang_budget_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
