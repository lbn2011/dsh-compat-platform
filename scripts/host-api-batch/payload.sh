#!/bin/bash
# Bounded slice payload for packages/host. Prepared, not yet executed: the unit base
# `host-api-batch` must be added to policy.sh br_prefix_allowed first (exact match).
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/host
SLICE=$REPO/scripts/host-api-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
EXPECT_EXPORTS='|./src/index.js|./src/page.js|./src/envelope.js|./src/client.js|./src/page-snapshot.js|./src/frontend-log.js|./src/api.js|'
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
host_payload() {
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
say(`name_exact=${manifest.name === 'dsh-compat-diagnostics-ui' ? 'pass' : 'fail'}`);
if (manifest.name !== 'dsh-compat-diagnostics-ui') fail.push('name');
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
// The client contribution is declared in the manifest, not registered at runtime.
say(`client_platform=${manifest.dsh?.client?.platform ?? 'absent'}`);
if (manifest.dsh?.client?.platform !== 'web') fail.push('client-platform');
say(`client_inject=${(manifest.dsh?.client?.inject ?? []).join(',') || 'none'}`);
if ((manifest.dsh?.client?.inject ?? []).join(',') !== '@deepseek-ai/dsh-client-ui-settings') fail.push('client-inject');

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

const snapshot = await import(join(pkgDir, 'src/page-snapshot.js'));
const log = await import(join(pkgDir, 'src/frontend-log.js'));
const api = await import(join(pkgDir, 'src/api.js'));

say(`snapshot_schema=${snapshot.PAGE_SNAPSHOT_SCHEMA}`);
if (snapshot.PAGE_SNAPSHOT_SCHEMA !== 'page-snapshot-summary/0.1-draft.1') fail.push('snapshot-schema');
say(`snapshot_not_a_dom=${snapshot.PAGE_SNAPSHOT_LIMITATIONS.includes('SNAPSHOT_IS_STRUCTURE_NOT_A_DOM_OR_A_SCREENSHOT') ? 'pass' : 'fail'}`);
if (!snapshot.PAGE_SNAPSHOT_LIMITATIONS.includes('SNAPSHOT_IS_STRUCTURE_NOT_A_DOM_OR_A_SCREENSHOT')) fail.push('snapshot-not-a-dom');
say(`snapshot_message_cap=${snapshot.PAGE_SNAPSHOT_LIMITS.maxMessages}`);
if (snapshot.PAGE_SNAPSHOT_LIMITS.maxMessages !== 50) fail.push('message-cap');
const empty = snapshot.buildPageSnapshot({});
say(`absent_source_is_not_empty=${empty.sources.sessions === 'unavailable' && empty.messages.length === 0 && empty.sources.sessions !== 'provided' ? 'pass' : 'fail'}`);
if (empty.sources.sessions !== 'unavailable') fail.push('absent-source');
say(`withheld_by_default=${empty.messageTextIncluded === false ? 'pass' : 'fail'}`);
if (empty.messageTextIncluded !== false) fail.push('withheld');
say(`snapshot_certification=${empty.certification === false ? 'pass' : 'fail'}`);
if (empty.certification !== false) fail.push('certification');

say(`log_ring=${log.MAX_LOG_ENTRIES}`);
if (log.MAX_LOG_ENTRIES !== 100) fail.push('log-ring');
say(`frame_ceiling=${log.MAX_FRAME_PAYLOAD}`);
if (log.MAX_FRAME_PAYLOAD !== 65536) fail.push('frame-ceiling');
say(`ws_guid=${log.WS_GUID === '258EAFA5-E914-47DA-95CA-C5AB0DC85B11' ? 'pass' : 'fail'}`);
if (log.WS_GUID !== '258EAFA5-E914-47DA-95CA-C5AB0DC85B11') fail.push('ws-guid');
say(`rfc_accept_example=${log.acceptKey('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=' ? 'pass' : 'fail'}`);
if (log.acceptKey('dGhlIHNhbXBsZSBub25jZQ==') !== 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=') fail.push('rfc-accept');

say(`snapshot_path=${api.PAGE_SNAPSHOT_PATH}`);
if (api.PAGE_SNAPSHOT_PATH !== '/api/page-snapshot') fail.push('snapshot-path');
say(`log_path=${api.FRONTEND_LOG_PATH}`);
if (api.FRONTEND_LOG_PATH !== '/api/frontend-log') fail.push('log-path');
// A composition without a connection service must mount nothing rather than invent a
// carrier: the routes inherit that carrier's trust policy, so there is no safe fallback.
const bare = api.applyHostApi({ webServer: { registerUpgrade: () => () => {} }, on: () => () => {} });
say(`mounts_nothing_without_connection=${bare === null || bare === undefined ? 'pass' : 'fail'}`);
if (bare !== null && bare !== undefined) fail.push('mounts-without-connection');

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
host_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
