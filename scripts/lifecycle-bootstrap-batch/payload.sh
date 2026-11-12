#!/bin/bash
# Bounded slice payload for packages/lifecycle-bootstrap. Prepared, not yet
# executed: the unit base `lifecycle-bootstrap-batch` must be added to
# policy.sh br_prefix_allowed first (exact match).
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/lifecycle-bootstrap
SLICE=$REPO/scripts/lifecycle-bootstrap-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
EXPECT_EXPORTS='|./src/index.js|./src/lifecycle-manifest.js|./src/lifecycle-runner.js|./src/patch-merge.js|./src/lifecycle-bootstrap.js|'
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
lifecycle_payload() {
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
say(`name_exact=${manifest.name === 'dsh-compat-lifecycle-bootstrap' ? 'pass' : 'fail'}`);
if (manifest.name !== 'dsh-compat-lifecycle-bootstrap') fail.push('name');
say(`private_absent=${manifest.private === undefined ? 'pass' : 'fail'}`);
if (manifest.private !== undefined) fail.push('private');
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
const wanted = expectExports.split('|').filter(Boolean).map((p) => p.replace(/^\.\//, ''));
for (const need of wanted) {
  const present = seen.includes(need);
  say(`export_declared ${need}=${present ? 'pass' : 'fail'}`);
  if (!present) fail.push(`declared:${need}`);
}
// This plugin is a host entry, not a browser contribution: the manifest declares a
// single entry that requires the plugin manager service.
const entries = Object.keys(manifest.dsh ?? {});
say(`dsh_entries=${entries.join(',') || 'none'}`);
if (entries.join(',') !== 'lifecycle-bootstrap') fail.push('dsh-entries');
say(`entry_inject=${(manifest.dsh?.['lifecycle-bootstrap']?.inject ?? []).join(',') || 'none'}`);
if ((manifest.dsh?.['lifecycle-bootstrap']?.inject ?? []).join(',') !== 'pluginManager') {
  fail.push('entry-inject');
}

// Zero-dependency claim, checked against the sources rather than the manifest alone.
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

const bootstrap = await import(join(pkgDir, 'src/lifecycle-bootstrap.js'));
const runner = await import(join(pkgDir, 'src/lifecycle-runner.js'));
const merge = await import(join(pkgDir, 'src/patch-merge.js'));
const manifestModule = await import(join(pkgDir, 'src/lifecycle-manifest.js'));
const entry = await import(join(pkgDir, 'src/index.js'));

say(`state_event=${bootstrap.LIFECYCLE_EVENTS.STATE}`);
if (bootstrap.LIFECYCLE_EVENTS.STATE !== 'dsh-compat/lifecycle-state') fail.push('state-event');
say(`log_event=${bootstrap.LIFECYCLE_EVENTS.LOG}`);
if (bootstrap.LIFECYCLE_EVENTS.LOG !== 'dsh-compat/lifecycle-log') fail.push('log-event');
say(`patch_event=${bootstrap.LIFECYCLE_EVENTS.PATCH}`);
if (bootstrap.LIFECYCLE_EVENTS.PATCH !== 'dsh-compat/lifecycle-patch') fail.push('patch-event');
say(`signals=${bootstrap.LIFECYCLE_SIGNALS.join(',')}`);
if (!bootstrap.LIFECYCLE_SIGNALS.includes('plugin-manager/install-state')) fail.push('signals');
say(`bundle_patch_path=${bootstrap.DEFAULT_BUNDLE_PATCH_PATH}`);
if (bootstrap.DEFAULT_BUNDLE_PATCH_PATH !== 'dist/.dsh-patch.yml') fail.push('bundle-patch-path');
say(`hmr_is_a_request=${bootstrap.BOOTSTRAP_LIMITATIONS.includes('HMR_IS_REQUESTED_NOT_VERIFIED') ? 'pass' : 'fail'}`);
if (!bootstrap.BOOTSTRAP_LIMITATIONS.includes('HMR_IS_REQUESTED_NOT_VERIFIED')) fail.push('hmr-limitation');
say(`no_sandbox_claim=${runner.RUNNER_LIMITATIONS.includes('KILL_IS_NOT_A_SANDBOX') ? 'pass' : 'fail'}`);
if (!runner.RUNNER_LIMITATIONS.includes('KILL_IS_NOT_A_SANDBOX')) fail.push('sandbox-claim');
say(`env_allow_list_withholds_secrets=${runner.RUNNER_ENV_ALLOW_LIST.includes('DSH_TOKEN') ? 'fail' : 'pass'}`);
if (runner.RUNNER_ENV_ALLOW_LIST.includes('DSH_TOKEN')) fail.push('env-allow-list');

// The declaration is a file path: a shell command line must be refused, not executed.
const refused = manifestModule.readLifecyclePlan(
  { dsh: { lifecycle: { postInstall: 'npm run build' } } },
  { packageDir: join(pkgDir, 'fixture') },
);
say(`shell_string_refused=${refused.plan === null && refused.issues.includes('SCRIPT_EXTENSION_UNSUPPORTED') ? 'pass' : 'fail'}`);
if (refused.plan !== null || !refused.issues.includes('SCRIPT_EXTENSION_UNSUPPORTED')) fail.push('shell-string');

// Append-only merge: a fresh home gets the block, a satisfied home is skipped,
// a partial overlap is refused.
const BLOCK = "- insert:\n    - id: 'contract:demo'\n      name: 'demo'\n";
const fresh = merge.mergePatchBlock({ homeText: null, block: BLOCK });
say(`merge_fresh_appended=${fresh.status === 'appended' && fresh.text.includes('contract:demo') ? 'pass' : 'fail'}`);
if (fresh.status !== 'appended' || !fresh.text.includes('contract:demo')) fail.push('merge-fresh');
const satisfied = merge.mergePatchBlock({ homeText: "- id: 'contract:demo'\n", block: BLOCK });
say(`merge_satisfied_skipped=${satisfied.status === 'skipped' && satisfied.text === null ? 'pass' : 'fail'}`);
if (satisfied.status !== 'skipped' || satisfied.text !== null) fail.push('merge-satisfied');
const partial = merge.mergePatchBlock({
  homeText: '- id: one\n',
  block: '- insert:\n    - id: one\n    - id: two\n',
});
say(`merge_partial_refused=${partial.status === 'refused' && partial.code === 'PARTIAL_OVERLAP' ? 'pass' : 'fail'}`);
if (partial.status !== 'refused' || partial.code !== 'PARTIAL_OVERLAP') fail.push('merge-partial');

// Config is a closed set, and the entry publishes exactly one service.
say(`entry_name=${entry.name}`);
if (entry.name !== 'dsh-compat-lifecycle-bootstrap') fail.push('entry-name');
say(`forward_default=${entry.readOptions(undefined).emitInstallLog === true ? 'pass' : 'fail'}`);
if (entry.readOptions(undefined).emitInstallLog !== true) fail.push('forward-default');
let unknownRefused = false;
try {
  entry.readOptions({ forwarding: true });
} catch {
  unknownRefused = true;
}
say(`unknown_config_refused=${unknownRefused ? 'pass' : 'fail'}`);
if (!unknownRefused) fail.push('unknown-config');
const provided = new Map();
const fakeCtx = {
  provide: (key, value) => provided.set(key, value),
  on: () => () => {},
  get: (serviceName) => (serviceName === 'pluginManager' ? { listBundles: async () => [], listPlugins: async () => [] } : undefined),
  emit: () => {},
};
entry.apply(fakeCtx, {});
say(`service_published=${provided.has('compatLifecycle') ? 'pass' : 'fail'}`);
if (!provided.has('compatLifecycle')) fail.push('service-published');

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
lifecycle_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
