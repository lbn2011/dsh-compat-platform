#!/bin/bash
# Bounded slice payload for packages/conflict-arbiter. Executed once, green: the unit base
# `conflict-arbiter-batch` is in policy.sh br_prefix_allowed (added by the captain; exact match).
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/conflict-arbiter
SLICE=$REPO/scripts/conflict-arbiter-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
EXPECT_EXPORTS='|./src/index.js|./src/failure-classify.js|./src/arbiter-policy.js|./src/conflict-arbiter.js|'
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70
[ "$#" -eq 2 ] || exit 70
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1 BR_RUN=$2
RUN=$BR_RUN

# Opens evidence BEFORE each command; failed opens are 73, not workload exits.
capture() {
  local out=$1 err=$2 rc; shift 2
  br_evidence_gate || return 73
  if ! exec 7>"$out"; then br_write_failure "$out"; return 73; fi
  if ! exec 8>"$err"; then br_write_failure "$err"; exec 7>&-; return 73; fi
  br_evidence_gate || { exec 7>&- 8>&-; return 73; }
  "$@" >&7 2>&8; rc=$?
  exec 7>&- 8>&-
  return "$rc"
}
conflict_arbiter_payload() {
  local rc static_rc node_rc tap_rc k value state
  local acc_syntax_run_sh_rc acc_syntax_payload_sh_rc
  source "$CORE/tap.sh" || return 70
  br_envelope_enter "$BR_UNIT" "$BR_RUN"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  [ -d "$PKG" ] && [ -x "$NODE" ] || return 70
  command -v bwrap >/dev/null 2>&1 || return 70
  capture "$RUN/syntax-run.log" "$RUN/syntax-run.err" /bin/bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
  br_evidence_gate || return 73
  capture "$RUN/syntax-payload.log" "$RUN/syntax-payload.err" /bin/bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ] || return 71
  if ! cat > "$RUN/static-contract.mjs" <<'CONTRACT'
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = process.env.EXPECT_PKG_DIR;
const expectExports = process.env.EXPECT_EXPORTS;
const fail = [];
const say = (line) => process.stdout.write(`${line}\n`);
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
} catch {
  say('manifest_parse=fail');
  process.exit(1);
}
say('manifest_parse=pass');
say(`name_exact=${manifest.name === 'dsh-compat-conflict-arbiter' ? 'pass' : 'fail'}`);
if (manifest.name !== 'dsh-compat-conflict-arbiter') fail.push('name');
say(`type_module=${manifest.type === 'module' ? 'pass' : 'fail'}`);
if (manifest.type !== 'module') fail.push('type');
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const names = Object.keys(manifest[field] ?? {});
  say(`no_${field}=${names.length === 0 ? 'pass' : 'fail'}`);
  if (names.length !== 0) fail.push(field);
}
const seen = [];
for (const [key, value] of Object.entries(manifest.exports ?? {})) {
  if (typeof value !== 'string') { say(`export_not_string ${key}=fail`); fail.push(`export:${key}`); continue; }
  const target = value.replace(/^\.\//, '');
  const ok = existsSync(join(pkgDir, target));
  say(`export_target ${key}=${ok ? 'yes' : 'no'}`);
  if (!ok) fail.push(`target:${target}`);
  seen.push(target);
}
for (const need of expectExports.split('|').filter(Boolean).map((p) => p.replace(/^\.\//, ''))) {
  const present = seen.includes(need);
  say(`export_declared ${need}=${present ? 'pass' : 'fail'}`);
  if (!present) fail.push(`declared:${need}`);
}
const entries = Object.entries(manifest.dsh ?? {}).filter(([key]) => key !== 'bundle');
say(`dsh_entry_count=${entries.length}`);
if (entries.length !== 1) fail.push('dsh-entry-count');
const [entryId, entry] = entries[0] ?? ['absent', {}];
say(`dsh_entry_id=${entryId}`);
if (entryId !== 'conflict-arbiter') fail.push('dsh-entry-id');
say(`dsh_entry_inject=${(entry.inject ?? []).join(',') || 'none'}`);
if ((entry.inject ?? []).join(',') !== 'pluginManager') fail.push('dsh-inject');

const offenders = [];
for (const file of readdirSync(join(pkgDir, 'src')).filter((name) => name.endsWith('.js'))) {
  const text = readFileSync(join(pkgDir, 'src', file), 'utf8');
  for (const match of text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
    const spec = match[1];
    if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('node:')) {
      offenders.push(`${file}:${spec}`);
    }
  }
}
say(`non_builtin_imports=${offenders.join(',') || 'none'}`);
if (offenders.length !== 0) fail.push('non-builtin-imports');

const classify = await import(join(pkgDir, 'src/failure-classify.js'));
const policy = await import(join(pkgDir, 'src/arbiter-policy.js'));
const arbiter = await import(join(pkgDir, 'src/conflict-arbiter.js'));
const entryModule = await import(join(pkgDir, 'src/index.js'));

// The classifier must read the message cordis really throws.
const dup = classify.classifyFailure('service "catalog" has been registered at <shop-plugin>');
say(`classify_duplicate=${dup.kind}/${dup.service}/${dup.existingOwner}`);
if (dup.kind !== 'duplicate-service' || dup.service !== 'catalog' || dup.existingOwner !== 'shop-plugin') fail.push('classify-duplicate');
say(`classify_absent=${classify.classifyFailure(null).code === 'MESSAGE_ABSENT' ? 'pass' : 'fail'}`);
if (classify.classifyFailure(null).code !== 'MESSAGE_ABSENT') fail.push('classify-absent');
say(`classify_unclassified=${classify.classifyFailure('ENOENT').kind}`);
if (classify.classifyFailure('ENOENT').kind !== 'unclassified') fail.push('classify-unclassified');
say(`arbitrable_none=${classify.isArbitrable(undefined) === false ? 'pass' : 'fail'}`);
if (classify.isArbitrable(undefined) !== false) fail.push('arbitrable-none');

// report-only must change nothing; isolate must claim no repair.
const report = policy.decideArbitration({
  classification: dup,
  policy: { present: false, strategy: 'report-only', service: null },
  entry: { entryId: 'loser' },
  selfEntryId: 'arbiter',
});
say(`default_action=${report.action}/${report.strategy}`);
if (report.action !== 'report' || report.strategy !== 'report-only') fail.push('default-action');
const isolate = policy.decideArbitration({
  classification: dup,
  policy: { present: true, strategy: 'isolate', service: 'catalog' },
  entry: { entryId: 'loser' },
  selfEntryId: 'arbiter',
});
say(`isolate_action=${isolate.action}/${isolate.code}`);
if (isolate.action !== 'needs-isolated-loader' || isolate.code !== 'STRATEGY_NEEDS_ISOLATED_LOADER') fail.push('isolate-action');
const selfDisable = policy.decideArbitration({
  classification: dup,
  policy: { present: true, strategy: 'disable-later', service: 'catalog' },
  entry: { entryId: 'arbiter' },
  selfEntryId: 'arbiter',
});
say(`self_disable=${selfDisable.action}/${selfDisable.code}`);
if (selfDisable.action !== 'refuse' || selfDisable.code !== 'ARBITER_DOES_NOT_DISABLE_ITSELF') fail.push('self-disable');
const refused = policy.readConflictPolicy({ dsh: { conflicts: { strategy: 'auto-win' } } });
say(`unknown_strategy_refused=${refused.refused === true ? 'pass' : 'fail'}`);
if (refused.refused !== true || refused.strategy !== 'report-only') fail.push('unknown-strategy');
say(`post_failure_stated=${policy.ARBITER_POLICY_LIMITATIONS.includes('ARBITRATION_RUNS_AFTER_A_FAILURE_AND_CANNOT_PREVENT_ONE') ? 'pass' : 'fail'}`);
if (!policy.ARBITER_POLICY_LIMITATIONS.includes('ARBITRATION_RUNS_AFTER_A_FAILURE_AND_CANNOT_PREVENT_ONE')) fail.push('post-failure');

// The service must not copy the diagnostic text into its records.
const digest = arbiter.digestDiagnostic('service "a" has been registered at <b>');
say(`digest_length=${digest.digest.length}`);
if (digest.digest.length !== 32) fail.push('digest-length');
say(`failed_state_const=${arbiter.FIBER_STATE_FAILED}`);
if (arbiter.FIBER_STATE_FAILED !== 3) fail.push('failed-state');
say(`arbiter_signal=${arbiter.ARBITER_SIGNALS.join(',')}`);
if (arbiter.ARBITER_SIGNALS.join(',') !== 'internal/status') fail.push('arbiter-signal');
say(`plugin_name=${entryModule.name}`);
if (entryModule.name !== 'dsh-compat-conflict-arbiter') fail.push('plugin-name');
say(`service_name=${entryModule.SERVICE_NAME}`);
if (entryModule.SERVICE_NAME !== 'compatConflictArbiter') fail.push('service-name');

say(`static_contract=${fail.length === 0 ? 'pass' : 'fail'}`);
say(`static_contract_failures=${fail.join(',') || 'none'}`);
process.exit(fail.length === 0 ? 0 : 1);
CONTRACT
  then br_write_failure static-contract-write; return 73; fi
  capture "$RUN/static-contract.log" "$RUN/static-contract.err" \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    EXPECT_PKG_DIR="$PKG" EXPECT_EXPORTS="$EXPECT_EXPORTS" \
    "$NODE" "$RUN/static-contract.mjs"; static_rc=$?
  br_record "$RUN/static-contract.rc" 'static_contract_rc=%s\n' "$static_rc" || :
  cat "$RUN/static-contract.log" || br_write_failure static-log-relay
  br_evidence_gate || return 73
  if [ "$static_rc" -ne 0 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=fail\n' || :
    return 71
  fi
  br_record "$RUN/static-verdict.txt" 'acc_static_contract=pass\n' || :
  br_evidence_gate || return 73
  br_record "$RUN/workload.txt" 'node=%s\nworkdir=%s\ntest_glob=%s\n' "$NODE" "$PKG" 'tests/*.test.js' || :
  capture "$RUN/node-tap.log" "$RUN/node-stderr.log" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.js'; node_rc=$?
  br_record "$RUN/node.rc" 'node_rc=%s\n' "$node_rc" || :
  cat "$RUN/node-tap.log" || br_write_failure tap-relay
  br_evidence_gate || return 73
  br_tap_check "$RUN/node-tap.log" "$node_rc"; tap_rc=$?
  br_record "$RUN/tap-fields.txt" '%s' '' || :
  br_record "$RUN/tap-summary.txt" '%s' '' || :
  for k in tests pass fail cancelled skipped todo; do
    state=ok
    value=$(br_tap_value "$RUN/node-tap.log" "$k") || { state=invalid; value='<invalid>'; }
    printf 'tap_field_%s=%s\n' "$k" "$state" >> "$RUN/tap-fields.txt" || br_write_failure tap-fields.txt
    printf 'tap_%s=%s\n' "$k" "$value" >> "$RUN/tap-summary.txt" || br_write_failure tap-summary.txt
  done
  state=pass; [ "$tap_rc" -eq 0 ] || state=fail
  br_record "$RUN/tap-verdict.txt" 'tests_exit=%s\ntap_check_rc=%s\nverdict=%s\n' "$node_rc" "$tap_rc" "$state" || :
  return "$tap_rc"
}
conflict_arbiter_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
