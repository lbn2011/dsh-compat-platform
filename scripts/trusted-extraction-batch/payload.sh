#!/bin/bash
# Payload for one bounded trusted-extraction observation round.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1,
# core commit c8123de). Awaiting Lead bounded verification. These bytes have not
# been executed, syntax-qualified, sourced or launched.
#
# THIS IS AN UPLIFT, NOT AN EQUIVALENCE REFACTOR. The workload — configure the
# supervisor, sandbox a child as uid 65534, probe sentinels, observe the network
# verdict, and demonstrate the phase budget's SIGKILL/hang path through six
# failure-path checks — is carried over unchanged. The bwrap sandbox itself is
# NOT built here and is NOT touched by this migration: it lives in
# packages/runtime/src/trusted-extraction-supervisor.js (`--unshare-user --uid
# 65534 --gid 65534`, cap-drop, `--unshare-net`, `--proc/--dev/--tmpfs /tmp`) and
# every refusal it produces is still the workload's own verdict, not the runner's.
#
# What the migration ADDS is the host layer this batch never had. The envelope
# (cgroup membership, InvocationID, memory.max/swap.max/pids.max/cpu.max,
# Type=exec, RuntimeMaxUSec, the memory gate) is read back by the core in
# `br_envelope_enter` instead of by a local `knob()` loop; `br_tap_check` now
# enforces a singleton `# tests/pass/fail/cancelled/skipped/todo` summary instead
# of trusting node's exit status; and every record below is written through
# `br_record`, so a write failure is counted and outranks the workload verdict.
#
# Logging: this payload NEVER writes unit.log. The host is the single writer; the
# payload only relays its logs to stdout. Every record lives under $RUN.
#
# Exit codes (unchanged from the pre-migration payload): 0 green; 70 envelope,
# syntax or static-contract refusal; 72 unit tests or the fixture observation
# failed; 73 an isolation gate refused or an evidence write failed; 74 a
# failure-path check failed (or the demo budget did not time out).

set +e
set -uo pipefail

REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
SLICE=$REPO/scripts/trusted-extraction-batch
CORE=$REPO/scripts/bounded-runner
PKG=$REPO/packages/runtime
NODE=/www/server/nodejs/v24.21.0/bin/node
INSTALLATION=/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh
MODULES_ROOT=/www/server/nodejs/v24.21.0/lib/node_modules
CONFIG=$REPO/examples/trusted-extraction/config.yml
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

refuse() { # code reason; keeps the pre-migration reason.txt artefact
  printf '%s\n' "$2" > "$RUN/reason.txt" 2>/dev/null || br_write_failure reason.txt
  printf 'payload: %s\n' "$2" >&2
  return "$1"
}
say() { printf '%s\n' "$*"; }
# The node spec reporter prints `ℹ tests 29`; the core's TAP policy reads
# singleton `# tests 29` comments. Bodies are rewritten only when the whole line
# is `<key> <decimal>`, so arbitrary test output cannot invent a summary line.
normalize_tap() { # source destination
  LC_ALL=C awk '
    /^# / { print; next }
    {
      line = $0
      sub(/^[^ \t]+[ \t]+/, "", line)
      if (line ~ /^(tests|pass|fail|cancelled|skipped|todo) (0|[1-9][0-9]*)$/) print "# " line
    }' "$1" > "$2"
}

trusted_extraction_payload() {
  say "payload: unit=$BR_UNIT run=$RUN"

  # ------------------------------------------------------------ 0. envelope
  # Membership, InvocationID, the four limits, Type=exec, RuntimeMaxUSec and the
  # MemAvailable gate are the core's; a non-zero return means no workload at all.
  br_envelope_enter "$BR_UNIT" "$BR_RUN" || return $?

  # ------------------------------------------------------------ 1. syntax
  br_evidence_gate || return 73
  bash -n "$SLICE/run.sh" || { refuse 70 "syntax_run"; return 70; }
  bash -n "$SLICE/payload.sh" || { refuse 70 "syntax_payload"; return 70; }
  for f in isolation-policy.js child-probe.js trusted-extraction-adapter.js trusted-extraction-receipt.js trusted-extraction-supervisor.js; do
    "$NODE" --check "$PKG/src/$f" || { refuse 70 "syntax_$f"; return 70; }
  done
  "$NODE" --check "$SLICE/failure-paths.mjs" || { refuse 70 "syntax_failure_paths"; return 70; }
  "$NODE" --check "$REPO/examples/trusted-extraction/plugin-hang.mjs" || { refuse 70 "syntax_plugin_hang"; return 70; }

  # ------------------------------------------------------------ 2. static contract
  "$NODE" --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs'
const pkg = JSON.parse(readFileSync('$PKG/package.json', 'utf8'))
const problems = []
if (pkg.name !== 'dsh-compat-trusted-extraction') problems.push('name')
if (pkg.private !== true) problems.push('private')
if (pkg.type !== 'module') problems.push('type')
for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
  if (pkg[field] !== undefined) problems.push('dependency:' + field)
}
for (const [key, target] of Object.entries(pkg.exports)) {
  if (key === './package.json') continue
  const path = '$PKG/' + target.replace('./', '')
  if (!existsSync(path)) problems.push('export-missing:' + key)
}
const pol = await import('$PKG/src/isolation-policy.js')
if (pol.BUDGET.outerSeconds <= pol.BUDGET.phaseSeconds + pol.BUDGET.killGraceSeconds + pol.BUDGET.readbackSeconds) problems.push('budget-slack')
const rec = await import('$PKG/src/trusted-extraction-receipt.js')
if (!rec.LIMITATIONS.includes('FAILURE_PHASE_READ_BY_REIMPORT')) problems.push('limitation')
if (rec.NOT_DERIVED.length !== 6) problems.push('notDerived')
process.stdout.write(problems.length === 0 ? 'static-contract=pass\n' : 'static-contract=FAIL:' + problems.join(',') + '\n')
process.exit(problems.length === 0 ? 0 : 1)
" || { refuse 70 "static_contract"; return 70; }
  br_record "$RUN/static-contract.txt" 'static_contract=pass\n' || :

  # ------------------------------------------------------------ 3. unit tests
  # Exit status is necessary but not sufficient: the summary is normalised and then
  # checked by the core's TAP policy (singleton keys, tests != 0, pass == tests, no
  # fail/cancelled/skipped/todo). A shape change is a 72 refusal, never a pass.
  "$NODE" --test --test-concurrency=1 "$PKG/tests/"*.test.js > "$RUN/tests.tap" 2> "$RUN/tests.err"
  local rc=$?
  br_record "$RUN/tests-exit.txt" 'tests_exit=%s\n' "$rc" || :
  grep -E '^ℹ (tests|pass|fail) ' "$RUN/tests.tap" > "$RUN/tests-summary.txt" 2>/dev/null || true
  if ! normalize_tap "$RUN/tests.tap" "$RUN/tests-normalized.tap"; then
    br_write_failure tests-normalized.tap
    refuse 73 "cannot normalise the TAP stream"
    return 73
  fi
  if ! br_tap_check "$RUN/tests-normalized.tap" "$rc"; then
    refuse 72 "unit_tests"
    return 72
  fi
  # Same six-field artifact as every other migrated runner. br_tap_check has already
  # refused a missing or duplicated field, so this read-back cannot invent one.
  if ! : > "$RUN/tests-fields.txt"; then
    br_write_failure tests-fields.txt
  else
    local _k _v
    for _k in tests pass fail cancelled skipped todo; do
      if _v=$(br_tap_value "$RUN/tests-normalized.tap" "$_k"); then
        printf '%s=%s\n' "$_k" "$_v" >> "$RUN/tests-fields.txt" ||
          br_write_failure "tests-fields.txt:$_k"
      else
        br_write_failure "tests-fields.txt:$_k"
      fi
    done
  fi

  # ------------------------------------------------------------ 4. isolation gates
  "$NODE" --input-type=module -e "
import { probeIsolation } from '$PKG/src/trusted-extraction-supervisor.js'
const supervisorPath = '$REPO/scripts/runtime-receipt/README.md'
const sentinel = '$SENTINEL'
const r = probeIsolation({ supervisorPaths: [supervisorPath], sentinels: [sentinel], keepDir: '$RUN/isolation' })
const lines = [
  'gate=' + (r.gates.gate ?? 'none'),
  'refusal=' + (r.gates.refusal ?? 'none'),
  'uid=' + (r.observations?.identity?.uid ?? 'unread'),
  'capEff=' + (r.observations?.identity?.capEff ?? 'unread'),
  'noNewPrivs=' + (r.observations?.identity?.noNewPrivs ?? 'unread'),
  'mounts=' + (r.observations?.childMounts?.length ?? 0),
  'sentinels=' + JSON.stringify(r.observations?.sentinelVerdict ?? null),
  'sentinel_read_codes=' + JSON.stringify((r.observations?.sentinelReads ?? []).map((row) => row.code ?? 'read')),
  'write_codes=' + JSON.stringify((r.observations?.writeAttempts ?? []).map((row) => row.label + ':' + (row.code ?? 'written'))),
  'child_exit=' + (r.observations?.run?.status ?? 'none'),
]
process.stdout.write(lines.join('\n') + '\n')
process.exit(r.gates.refusal === null ? 0 : 1)
" > "$RUN/isolation.txt" 2>&1
  local iso=$?
  printf 'isolation_exit=%s\n' "$iso" >> "$RUN/isolation.txt"
  [ "$iso" -eq 0 ] || { refuse 73 "isolation_gates"; return 73; }

  # ------------------------------------------------------------ 5. fixture observation
  "$NODE" --input-type=module -e "
import { observeFixture } from '$PKG/src/trusted-extraction-supervisor.js'
import { checkReceipt } from '$PKG/src/trusted-extraction-receipt.js'
const r = observeFixture({
  installationRoot: '$INSTALLATION',
  modulesRoot: '$MODULES_ROOT',
  configPath: '$CONFIG',
  supervisorPaths: ['$REPO/scripts/runtime-receipt/README.md'],
  sentinels: ['$SENTINEL'],
  keepDir: '$RUN/fixture',
})
if (r.refused !== null) { process.stdout.write('refused=' + r.refused + '\n'); process.exit(1) }
const shape = checkReceipt(r.receipt)
process.stdout.write(JSON.stringify({ shape, status: r.receipt.status, phases: r.receipt.phases, cleanup: r.receipt.cleanup, entries: r.receipt.entries, process: r.receipt.process, runtime: r.receipt.runtime, inputWitness: r.receipt.inputWitness }, null, 2) + '\n')
process.exit(shape === null && r.receipt.status === 'observed' ? 0 : 1)
" > "$RUN/fixture.json" 2> "$RUN/fixture.err"
  local fx=$?
  br_record "$RUN/fixture-exit.txt" 'fixture_exit=%s\n' "$fx" || :
  [ "$fx" -eq 0 ] || { refuse 72 "fixture_observation"; return 72; }

  # ------------------------------------------------------------ 5b. failure paths
  # Two claims the first round only asserted: the network verdict is observed from
  # inside the sandbox, and the phase budget really kills and reaps a wedged
  # target. The kill is demonstrated with a 3 s demo budget; the shipped 80 s
  # budget remains covered only by the arithmetic check.
  mkdir -p "$RUN/failure-paths" || { refuse 73 "cannot create failure-paths directory"; return 73; }
  "$NODE" "$SLICE/failure-paths.mjs" \
    --installation "$INSTALLATION" --modules-root "$MODULES_ROOT" \
    --hang-config "$HANG_CONFIG" --out "$RUN/failure-paths" \
    --sentinel "$SENTINEL" \
    > "$RUN/failure-paths/report.txt" 2>&1
  local fp=$?
  printf 'failure_paths_exit=%s\n' "$fp" >> "$RUN/failure-paths/report.txt"
  cp "$RUN/failure-paths/failure-paths.json" "$RUN/failure-paths.json" 2>/dev/null || true
  grep -E '"(networkAttempt|code|attempted)"|"failed"|"network"|"hang"' "$RUN/failure-paths.json" > "$RUN/failure-paths-summary.txt" 2>/dev/null || true
  [ "$fp" -eq 0 ] || { refuse 74 "failure_paths"; return 74; }

  # ------------------------------------------------------------ 6. yaml snapshot
  "$NODE" -e "
const {readFileSync}=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const dir='$REPO/packages/analyzer/node_modules/yaml';
const pkg=JSON.parse(readFileSync(path.join(dir,'package.json'),'utf8'));
const h=crypto.createHash('sha256').update(readFileSync(path.join(dir,'dist/index.js'))).digest('hex');
console.log('yaml_version='+pkg.version); console.log('yaml_index_sha256='+h);
" > "$RUN/yaml.txt" 2>&1 || { refuse 70 "yaml_lookup"; return 70; }

  br_evidence_gate || return 73
  br_record "$RUN/verdict.txt" 'verdict=pass\n' || :
  say 'payload: verdict=pass'
  return 0
}

trusted_extraction_payload
rc=$?
# The core records peaks and the payload receipt, and lets an evidence failure win.
br_payload_finish "$rc"
exit "$?"
