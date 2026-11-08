#!/bin/bash
# Payload for one bounded trusted-extraction observation round.
#
# STATUS: prepared for review; executed by run.sh under the standard envelope.
set -u

REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/runtime
NODE=/www/server/nodejs/v24.21.0/bin/node
INSTALLATION=/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh
MODULES_ROOT=/www/server/nodejs/v24.21.0/lib/node_modules
CONFIG=$REPO/examples/trusted-extraction/config.yml
HANG_CONFIG=$REPO/examples/trusted-extraction/config-hang.yml
OUT=$1
fail() { printf '%s\n' "$1" > "$OUT/reason.txt"; exit "$2"; }

# 0. envelope self-check ------------------------------------------------
CG=$(awk -F: '{print $3}' /proc/self/cgroup)
knob() { cat "/sys/fs/cgroup$CG/$1" 2>/dev/null; }
[ "$(knob memory.max)" = "402653184" ] || fail "envelope_memory" 70
[ "$(knob pids.max)" = "32" ] || fail "envelope_pids" 70
[ "$(knob cpu.max)" = "50000 100000" ] || fail "envelope_cpu" 70
[ "$(cat /proc/self/swapusage 2>/dev/null || echo 0)" = "0" ] || true

avail=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
[ "$avail" -ge 819200 ] || fail "memory_gate" 70
printf 'mem_available_kib=%s\n' "$avail" > "$OUT/memory-gate.txt"

# 1. syntax -------------------------------------------------------------
bash -n "$REPO/scripts/trusted-extraction-batch/run.sh" || fail "syntax_run" 70
bash -n "$REPO/scripts/trusted-extraction-batch/payload.sh" || fail "syntax_payload" 70
for f in isolation-policy.js child-probe.js trusted-extraction-adapter.js trusted-extraction-receipt.js trusted-extraction-supervisor.js; do
  "$NODE" --check "$PKG/src/$f" || fail "syntax_$f" 70
done
"$NODE" --check "$REPO/scripts/trusted-extraction-batch/failure-paths.mjs" || fail "syntax_failure_paths" 70
"$NODE" --check "$REPO/examples/trusted-extraction/plugin-hang.mjs" || fail "syntax_plugin_hang" 70

# 2. static contract ----------------------------------------------------
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
" || fail "static_contract" 70
printf 'static_contract=pass\n' > "$OUT/static-contract.txt"

# 3. unit tests ---------------------------------------------------------
"$NODE" --test --test-concurrency=1 "$PKG/tests/"*.test.js > "$OUT/tests.tap" 2> "$OUT/tests.err"
rc=$?
printf 'tests_exit=%s\n' "$rc" > "$OUT/tests-exit.txt"
grep -E '^ℹ (tests|pass|fail) ' "$OUT/tests.tap" > "$OUT/tests-summary.txt" || true
[ "$rc" -eq 0 ] || fail "unit_tests" 72

# 4. isolation gates ----------------------------------------------------
"$NODE" --input-type=module -e "
import { probeIsolation } from '$PKG/src/trusted-extraction-supervisor.js'
const supervisorPath = '$REPO/scripts/runtime-receipt/README.md'
const sentinel = '/root/.dsh/profiles/web/package.json'
const r = probeIsolation({ supervisorPaths: [supervisorPath], sentinels: [sentinel], keepDir: '$OUT/isolation' })
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
" > "$OUT/isolation.txt" 2>&1
iso=$?
printf 'isolation_exit=%s\n' "$iso" >> "$OUT/isolation.txt"
[ "$iso" -eq 0 ] || fail "isolation_gates" 73

# 5. fixture observation ------------------------------------------------
"$NODE" --input-type=module -e "
import { observeFixture } from '$PKG/src/trusted-extraction-supervisor.js'
import { checkReceipt } from '$PKG/src/trusted-extraction-receipt.js'
const r = observeFixture({
  installationRoot: '$INSTALLATION',
  modulesRoot: '$MODULES_ROOT',
  configPath: '$CONFIG',
  supervisorPaths: ['$REPO/scripts/runtime-receipt/README.md'],
  sentinels: ['/root/.dsh/profiles/web/package.json'],
  keepDir: '$OUT/fixture',
})
if (r.refused !== null) { process.stdout.write('refused=' + r.refused + '\n'); process.exit(1) }
const shape = checkReceipt(r.receipt)
process.stdout.write(JSON.stringify({ shape, status: r.receipt.status, phases: r.receipt.phases, cleanup: r.receipt.cleanup, entries: r.receipt.entries, process: r.receipt.process, runtime: r.receipt.runtime, inputWitness: r.receipt.inputWitness }, null, 2) + '\n')
process.exit(shape === null && r.receipt.status === 'observed' ? 0 : 1)
" > "$OUT/fixture.json" 2> "$OUT/fixture.err"
fx=$?
printf 'fixture_exit=%s\n' "$fx" > "$OUT/fixture-exit.txt"
[ "$fx" -eq 0 ] || fail "fixture_observation" 72

# 5b. failure paths ------------------------------------------------------
# Two claims the first round only asserted: the network verdict is observed from
# inside the sandbox, and the phase budget really kills and reaps a wedged
# target. The kill is demonstrated with a 3 s demo budget; the shipped 80 s
# budget remains covered only by the arithmetic check.
mkdir -p "$OUT/failure-paths"
"$NODE" "$REPO/scripts/trusted-extraction-batch/failure-paths.mjs" \
  --installation "$INSTALLATION" --modules-root "$MODULES_ROOT" \
  --hang-config "$HANG_CONFIG" --out "$OUT/failure-paths" \
  --sentinel /root/.dsh/profiles/web/package.json \
  > "$OUT/failure-paths/report.txt" 2>&1
fp=$?
printf 'failure_paths_exit=%s\n' "$fp" >> "$OUT/failure-paths/report.txt"
cp "$OUT/failure-paths/failure-paths.json" "$OUT/failure-paths.json" 2>/dev/null || true
grep -E '"(networkAttempt|code|attempted)"|"failed"|"network"|"hang"' "$OUT/failure-paths.json" > "$OUT/failure-paths-summary.txt" 2>/dev/null || true
[ "$fp" -eq 0 ] || fail "failure_paths" 74

# 6. yaml snapshot ------------------------------------------------------
"$NODE" -e "
const {readFileSync}=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const dir='$REPO/packages/analyzer/node_modules/yaml';
const pkg=JSON.parse(readFileSync(path.join(dir,'package.json'),'utf8'));
const h=crypto.createHash('sha256').update(readFileSync(path.join(dir,'dist/index.js'))).digest('hex');
console.log('yaml_version='+pkg.version); console.log('yaml_index_sha256='+h);
" > "$OUT/yaml.txt" 2>&1 || fail "yaml_lookup" 70

# 7. peaks --------------------------------------------------------------
printf 'memory_peak=%s\n' "$(knob memory.peak)" > "$OUT/peaks.txt"
printf 'pids_peak=%s\n' "$(knob pids.peak)" >> "$OUT/peaks.txt"
grep -E '^ℹ (tests|pass|fail) ' "$OUT/tests.tap" >> "$OUT/peaks.txt" 2>/dev/null || true
printf 'verdict=pass\n' > "$OUT/verdict.txt"
exit 0
