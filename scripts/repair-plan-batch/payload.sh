#!/bin/bash
# Source-only migration; awaiting Lead bounded verification. Never writes unit.log.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/repair
SLICE=$REPO/scripts/repair-plan-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
EXPECT_EXPORTS='|./src/repair-plan.js|./src/repair-preview.js|./src/repair-approval.js|./src/repair-apply.js|./src/fixture-applier.js|'
EXPECT_PLAN_VERSION='repair-plan/0.1-draft.1'
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70
[ "$#" -eq 2 ] || exit 70
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1 BR_RUN=$2
RUN=$BR_RUN

# Opens evidence BEFORE each command; failed opens are 73, not workload exits.
# Runs in this shell so the core evidence counter cannot be lost in a subshell.
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
repair_payload() {
  local rc static_rc node_rc tap_rc k value state example_before example_after example_rc example_verdict
  local fp_before fp_after fp_rc four_verdict acc_syntax_run_sh_rc acc_syntax_payload_sh_rc
  source "$CORE/tap.sh" || return 70
  br_envelope_enter "$BR_UNIT" "$BR_RUN"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  [ -d "$PKG" ] && [ -x "$NODE" ] || return 70
  command -v bwrap >/dev/null 2>&1 || return 70
  # Retained future in-envelope checks; NOT executed by this source migration.
  capture "$RUN/syntax-run.log" "$RUN/syntax-run.err" /bin/bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
  br_record "$RUN/syntax-run.txt" 'acc_syntax_run_sh_rc=%s\n' "$acc_syntax_run_sh_rc" || :
  br_evidence_gate || return 73
  capture "$RUN/syntax-payload.log" "$RUN/syntax-payload.err" /bin/bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ] || return 71
  if ! cat > "$RUN/static-contract.mjs" <<'CONTRACT'
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = process.env.EXPECT_PKG_DIR;
const expectExports = process.env.EXPECT_EXPORTS;
const expectPlanVersion = process.env.EXPECT_PLAN_VERSION;
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
say(`name_exact=${manifest.name === 'dsh-compat-repair' ? 'pass' : 'fail'}`);
say(`private=${manifest.private === true ? 'pass' : 'fail'}`);
say(`type_module=${manifest.type === 'module' ? 'pass' : 'fail'}`);
if (manifest.name !== 'dsh-compat-repair') fail.push('name');
if (manifest.private !== true) fail.push('private');
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
const plan = await import(join(pkgDir, 'src/repair-plan.js'));
const preview = await import(join(pkgDir, 'src/repair-preview.js'));
say(`plan_version_exact=${plan.PLAN_VERSION === expectPlanVersion ? 'pass' : 'fail'}`);
if (plan.PLAN_VERSION !== expectPlanVersion) fail.push('plan-version');
say(`operation_vocabulary_width=${plan.OPERATION_KINDS.length}`);
if (plan.OPERATION_KINDS.length !== 1) fail.push('vocabulary-width');
say(`flag_fields=${plan.FLAG_FIELDS.join(',')}`);
if (plan.FLAG_FIELDS.join(',') !== 'disabled') fail.push('flag-fields');
say(`confined_apply_limitation=${plan.PLAN_LIMITATIONS.includes('APPLY_PATH_IS_CONFINED_TO_A_FIXTURE_DIRECTORY') ? 'pass' : 'fail'}`);
if (!plan.PLAN_LIMITATIONS.includes('APPLY_PATH_IS_CONFINED_TO_A_FIXTURE_DIRECTORY')) fail.push('confined-apply-limitation');
say(`stale_no_apply_claim=${plan.PLAN_LIMITATIONS.includes('NO_APPLY_PATH_EXISTS_IN_THIS_DELIVERY') ? 'fail' : 'pass'}`);
if (plan.PLAN_LIMITATIONS.includes('NO_APPLY_PATH_EXISTS_IN_THIS_DELIVERY')) fail.push('stale-no-apply-claim');
const approval = await import(join(pkgDir, 'src/repair-approval.js'));
const apply = await import(join(pkgDir, 'src/repair-apply.js'));
const applier = await import(join(pkgDir, 'src/fixture-applier.js'));
const forbidden = /^(apply|write|save|commit|install|exec|run)/i;
for (const [moduleName, module] of Object.entries({ plan, preview, approval, apply })) {
  for (const [name, value] of Object.entries(module)) {
    if (typeof value !== 'function') continue;
    if (forbidden.test(name)) { say(`writer_export ${moduleName}.${name}=fail`); fail.push(`writer:${moduleName}.${name}`); }
  }
}
const writers = Object.keys(applier)
  .filter((name) => typeof applier[name] === 'function' && /^(apply|write|restore|save|commit)/i.test(name))
  .sort();
say(`applier_writers=${writers.join(',') || 'none'}`);
if (writers.join(',') !== 'applyApproved,restoreFixture') fail.push('applier-writers');
say(`applier_byte_ceiling=${applier.MAX_FIXTURE_BYTES}`);
if (applier.MAX_FIXTURE_BYTES !== 1048576) fail.push('applier-ceiling');
say(`static_contract=${fail.length === 0 ? 'pass' : 'fail'}`);
say(`static_contract_failures=${fail.join(',') || 'none'}`);
process.exit(fail.length === 0 ? 0 : 1);
CONTRACT
  then br_write_failure static-contract-write; return 73; fi
  capture "$RUN/static-contract.log" "$RUN/static-contract.err" \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    EXPECT_PKG_DIR="$PKG" EXPECT_EXPORTS="$EXPECT_EXPORTS" EXPECT_PLAN_VERSION="$EXPECT_PLAN_VERSION" \
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
  example_before=$(sha256sum "$REPO/examples/repair/profile.yml" 2>/dev/null | awk '{print $1}')
  capture "$RUN/example-preview.txt" "$RUN/example-preview.err" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$REPO" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" examples/repair/preview.mjs; example_rc=$?
  br_evidence_gate || return 73
  example_after=$(sha256sum "$REPO/examples/repair/profile.yml" 2>/dev/null | awk '{print $1}')
  example_verdict=pass
  [ "$example_rc" -eq 0 ] || example_verdict="rc_$example_rc"
  grep -q '^preview: ready$' "$RUN/example-preview.txt" || example_verdict=fail_preview
  grep -q '^nothing was written; no apply path exists$' "$RUN/example-preview.txt" || example_verdict=fail_no_write_line
  [ -n "$example_before" ] && [ "$example_before" = "$example_after" ] || example_verdict=fixture_changed
  br_record "$RUN/example-verdict.txt" 'example_rc=%s\nexample_verdict=%s\nfixture_before=%s\nfixture_after=%s\n' \
    "$example_rc" "$example_verdict" "${example_before:-<unreadable>}" "${example_after:-<unreadable>}" || :
  [ "$example_verdict" = pass ] || return 72
  br_evidence_gate || return 73
  fp_before=$(sha256sum "$REPO/examples/repair/profile.yml" 2>/dev/null | awk '{print $1}')
  capture "$RUN/four-paths.txt" "$RUN/four-paths.err" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$REPO" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" examples/repair/four-paths.mjs; fp_rc=$?
  br_evidence_gate || return 73
  fp_after=$(sha256sum "$REPO/examples/repair/profile.yml" 2>/dev/null | awk '{print $1}')
  four_verdict=pass
  [ "$fp_rc" -eq 0 ] || four_verdict="rc_$fp_rc"
  grep -q '^four-paths: pass ' "$RUN/four-paths.txt" || four_verdict=fail_not_pass
  grep -q '"status": "refused"' "$RUN/four-paths.txt" || four_verdict=fail_no_refusal
  grep -q '"status": "partial"' "$RUN/four-paths.txt" || four_verdict=fail_no_partial
  grep -q '"status": "restored"' "$RUN/four-paths.txt" || four_verdict=fail_no_recovery
  grep -q '"untouched": true' "$RUN/four-paths.txt" || four_verdict=fail_touched
  [ -n "$fp_before" ] && [ "$fp_before" = "$fp_after" ] || four_verdict=fixture_changed
  br_record "$RUN/four-paths-verdict.txt" 'four_paths_rc=%s\nfour_paths_verdict=%s\nfixture_before=%s\nfixture_after=%s\n' \
    "$fp_rc" "$four_verdict" "${fp_before:-<unreadable>}" "${fp_after:-<unreadable>}" || :
  [ "$four_verdict" = pass ] || return 72
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
repair_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
