#!/bin/bash
# Source-only migration; awaiting Lead bounded verification. Host alone owns unit.log.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/analyzer
SLICE=$REPO/scripts/correspondence-batch
CORE=$REPO/scripts/bounded-runner
CORR=$REPO/examples/correspondence/correspondence.json
PROFILE_EX=$REPO/examples/correspondence/profile.yml
DECL_EX=$REPO/examples/correspondence/declaration.json
NODE=/www/server/nodejs/v24.21.0/bin/node
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70
[ "$#" -eq 2 ] || exit 70
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1 BR_RUN=$2
RUN=$BR_RUN
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
correspondence_payload() {
  local rc static_rc node_rc tap_rc k value state verdict
  local acc_syntax_run_sh_rc acc_syntax_payload_sh_rc acc_node_check_corr_rc acc_node_check_dts_rc acc_node_check_cli_rc acc_node_check_test_rc
  local demo_out demo_rc demo_verdict=fail stale_doc stale_out stale_rc stale_verdict=fail
  source "$CORE/tap.sh" || return 70
  br_envelope_enter "$BR_UNIT" "$BR_RUN"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  [ -d "$PKG" ] && [ -x "$NODE" ] || return 70
  command -v bwrap >/dev/null 2>&1 || return 70
  for k in "$CORR" "$PROFILE_EX" "$DECL_EX"; do [ -f "$k" ] || return 70; done
  capture "$RUN/syntax-run.log" "$RUN/syntax-run.err" /bin/bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
  br_record "$RUN/syntax-run.txt" 'acc_syntax_run_sh_rc=%s\n' "$acc_syntax_run_sh_rc" || :
  br_evidence_gate || return 73
  capture "$RUN/syntax-payload.log" "$RUN/syntax-payload.err" /bin/bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
  acc_node_check_corr_rc=skipped acc_node_check_dts_rc=skipped acc_node_check_cli_rc=skipped acc_node_check_test_rc=skipped
  br_evidence_gate || return 73
  if [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ]; then
    capture "$RUN/node-check-correspondence.log" "$RUN/node-check-correspondence.err" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" "$NODE" --check "$PKG/src/correspondence.js"; acc_node_check_corr_rc=$?
    br_record "$RUN/node-check-correspondence.rc" '%s\n' "$acc_node_check_corr_rc" || :
    br_evidence_gate || return 73
    capture "$RUN/node-check-correspondence-dts.log" "$RUN/node-check-correspondence-dts.err" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" "$NODE" --check "$PKG/src/correspondence.d.ts"; acc_node_check_dts_rc=$?
    br_record "$RUN/node-check-correspondence-dts.rc" '%s\n' "$acc_node_check_dts_rc" || :
    br_evidence_gate || return 73
    capture "$RUN/node-check-correspondence-cli.log" "$RUN/node-check-correspondence-cli.err" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" "$NODE" --check "$PKG/src/correspondence-cli.js"; acc_node_check_cli_rc=$?
    br_record "$RUN/node-check-correspondence-cli.rc" '%s\n' "$acc_node_check_cli_rc" || :
    br_evidence_gate || return 73
    capture "$RUN/node-check-correspondence-test.log" "$RUN/node-check-correspondence-test.err" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" "$NODE" --check "$PKG/tests/correspondence.test.js"; acc_node_check_test_rc=$?
  fi
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\nacc_node_check_correspondence_rc=%s\nacc_node_check_dts_rc=%s\nacc_node_check_cli_rc=%s\nacc_node_check_test_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" "$acc_node_check_corr_rc" "$acc_node_check_dts_rc" "$acc_node_check_cli_rc" "$acc_node_check_test_rc" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ] || return 71
  [ "$acc_node_check_corr_rc" -eq 0 ] && [ "$acc_node_check_dts_rc" -eq 0 ] && [ "$acc_node_check_cli_rc" -eq 0 ] && [ "$acc_node_check_test_rc" -eq 0 ] || return 71
  if ! cat > "$RUN/static-contract.mjs" <<'CONTRACT'
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const pkgDir = process.env.EXPECT_PKG_DIR;
const fail = [];
const say = (line) => process.stdout.write(`${line}\n`);
let manifest;
try { manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')); }
catch (error) { say('manifest_parse=fail'); process.exit(1); }
say('manifest_parse=pass');
const isPrivate = manifest.private === true;
say(`package_private=${isPrivate ? 'pass' : 'fail'}`);
if (!isPrivate) fail.push('private');
const isModule = manifest.type === 'module';
say(`package_type_module=${isModule ? 'pass' : 'fail'}`);
if (!isModule) fail.push('type-module');
const depNames = Object.keys(manifest.dependencies ?? {});
const onePinnedYaml = depNames.length === 1 && depNames[0] === 'yaml' && manifest.dependencies.yaml === '2.9.1';
say(`dependency_count=${depNames.length}`);
say(`only_pinned_yaml=${onePinnedYaml ? 'pass' : 'fail'}`);
if (!onePinnedYaml) fail.push('dependencies');
const exportCorr = manifest.exports?.['./correspondence'];
const exportCli = manifest.exports?.['./correspondence-cli'];
say(`export_correspondence_present=${exportCorr === undefined ? 'fail' : 'pass'}`);
say(`export_correspondence_cli_present=${exportCli === undefined ? 'fail' : 'pass'}`);
if (exportCorr === undefined) fail.push('exports-correspondence');
if (exportCli === undefined) fail.push('exports-correspondence-cli');
const srcPath = join(pkgDir, 'src/correspondence.js');
const dtsPath = join(pkgDir, 'src/correspondence.d.ts');
const cliPath = join(pkgDir, 'src/correspondence-cli.js');
const testPath = join(pkgDir, 'tests/correspondence.test.js');
for (const [rel, path] of [['src/correspondence.js', srcPath], ['src/correspondence.d.ts', dtsPath], ['src/correspondence-cli.js', cliPath], ['tests/correspondence.test.js', testPath]]) {
  say(`file_present ${rel}=${existsSync(path) ? 'yes' : 'no'}`);
  if (!existsSync(path)) fail.push(rel);
}
const read = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const src = read(srcPath);
const cli = read(cliPath);
const versionRe = /CORRESPONDENCE_VERSION\s*=\s*['"]profile-correspondence\/0\.1-draft\.1['"]/;
const summaryRe = /CORRESPONDENCE_SUMMARY\s*=\s*['"]correspondence-summary\/0\.1-draft\.1['"]/;
const versionOk = typeof src === 'string' && versionRe.test(src);
const summaryOk = typeof src === 'string' && summaryRe.test(src);
say(`version_literal_exact=${versionOk ? 'pass' : 'fail'}`);
say(`summary_literal_exact=${summaryOk ? 'pass' : 'fail'}`);
if (!versionOk) fail.push('CORRESPONDENCE_VERSION');
if (!summaryOk) fail.push('CORRESPONDENCE_SUMMARY');
const identityOk = typeof src === 'string' && /identityDisclosed\s*:\s*false/.test(src);
say(`identity_disclosed_false=${identityOk ? 'pass' : 'fail'}`);
if (!identityOk) fail.push('identityDisclosed');
const noStdout = typeof src === 'string' && !src.includes('process.stdout');
say(`module_never_writes_stdout=${noStdout ? 'pass' : 'fail'}`);
if (!noStdout) fail.push('process.stdout');
const binNameOk = typeof cli === 'string' && cli.includes('dsh-compat-correspondence');
say(`cli_declares_bin_name=${binNameOk ? 'pass' : 'fail'}`);
if (!binNameOk) fail.push('bin-name');
say(`static_contract=${fail.length === 0 ? 'pass' : 'fail'}`);
say(`static_contract_failures=${fail.join(',') || 'none'}`);
process.exit(fail.length === 0 ? 0 : 1);
CONTRACT
  then br_write_failure static-contract-write; return 73; fi
  capture "$RUN/static-contract.log" "$RUN/static-contract.err" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" EXPECT_PKG_DIR="$PKG" "$NODE" "$RUN/static-contract.mjs"; static_rc=$?
  br_record "$RUN/static-contract.rc" 'static_contract_rc=%s\n' "$static_rc" || :
  cat "$RUN/static-contract.log" || br_write_failure static-log-relay
  br_evidence_gate || return 73
  if [ "$static_rc" -ne 0 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=fail\n' || :
    return 71
  fi
  br_record "$RUN/static-verdict.txt" 'acc_static_contract=pass\n' || :
  br_evidence_gate || return 73
  if ! cat > "$RUN/check-output.mjs" <<'CHECKER'
import { readFileSync } from 'node:fs';
const [mode, path] = process.argv.slice(2);
let raw;
try { raw = readFileSync(path, 'utf8'); }
catch (error) { process.stderr.write(`unreadable: ${error.message}\n`); process.exit(1); }
if (raw.trim() === '') { process.stderr.write('empty document\n'); process.exit(1); }
let doc;
try { doc = JSON.parse(raw); }
catch (error) { process.stderr.write(`not json: ${error.message}\n`); process.exit(1); }
if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
  process.stderr.write('document is not a JSON object\n'); process.exit(1);
}
const flat = JSON.stringify(doc);
const problems = [];
const note = (line) => process.stdout.write(`${line}\n`);
if (mode === 'demo') {
  const counts = doc.counts ?? {};
  note(`demo_counts_pairs=${counts.pairs}`);
  note(`demo_counts_matched=${counts.matched}`);
  note(`demo_counts_refused=${counts.refused}`);
  note(`demo_counts_findings=${counts.findings}`);
  if (counts.pairs !== 3) problems.push(`counts.pairs=${JSON.stringify(counts.pairs)}`);
  if (counts.matched !== 3) problems.push(`counts.matched=${JSON.stringify(counts.matched)}`);
  if (counts.findings !== undefined && counts.findings !== 1) problems.push(`counts.findings=${JSON.stringify(counts.findings)}`);
  if (!Array.isArray(doc.findings) || doc.findings.length === 0) problems.push('findings is not a non-empty array');
  if (!flat.includes('CORRESPONDENCE_PLUGIN_NOT_DECLARED')) problems.push('no CORRESPONDENCE_PLUGIN_NOT_DECLARED finding');
  if (flat.includes('example.plugin-gamma') || flat.includes('example-a')) problems.push('identity text leaked into the output');
  if (doc.identityDisclosed !== false) problems.push(`identityDisclosed=${JSON.stringify(doc.identityDisclosed)}`);
} else if (mode === 'stale') {
  const refusedMarked = doc.refused === true || doc.status === 'refused' ||
    doc.code === 'CORRESPONDENCE_STALE' || doc.refusal === 'CORRESPONDENCE_STALE' ||
    (Array.isArray(doc.findings) && doc.findings.some((f) => JSON.stringify(f).includes('CORRESPONDENCE_STALE')));
  note(`stale_refused_marked=${refusedMarked ? 'yes' : 'no'}`);
  if (!refusedMarked) problems.push('document does not mark a refusal');
  if (!flat.includes('CORRESPONDENCE_STALE')) problems.push('no CORRESPONDENCE_STALE code');
  if (flat.includes('example.plugin-gamma')) problems.push('identity text leaked into the output');
} else { problems.push(`unknown mode: ${mode}`); }
if (problems.length > 0) { process.stderr.write(`check failed: ${problems.join('; ')}\n`); process.exit(1); }
note('check=pass');
process.exit(0);
CHECKER
  then br_write_failure checker-write; return 73; fi
  demo_out="$RUN/example.stdout.json"
  capture "$demo_out" "$RUN/example.stderr.txt" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" src/correspondence-cli.js "$CORR" --profile "$PROFILE_EX" --declaration "$DECL_EX"; demo_rc=$?
  br_record "$RUN/example.rc" 'example_rc=%s\n' "$demo_rc" || :
  br_evidence_gate || return 73
  if [ "$demo_rc" -eq 1 ] && [ -s "$demo_out" ]; then
    capture "$RUN/example-check.log" "$RUN/example-check.err.txt" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" "$NODE" "$RUN/check-output.mjs" demo "$demo_out"; rc=$?
    br_record "$RUN/example-check.rc" 'example_check_rc=%s\n' "$rc" || :
    [ "$rc" -ne 0 ] || demo_verdict=pass
    cat "$RUN/example-check.log" || br_write_failure example-check-relay
  fi
  br_record "$RUN/example-verdict.txt" 'example_verdict=%s\n' "$demo_verdict" || :
  br_evidence_gate || return 73
  if ! cat > "$RUN/make-stale.mjs" <<'STALE'
import { readFileSync, writeFileSync } from 'node:fs';
const [input, output] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(input, 'utf8'));
const digest = doc?.bindings?.profileSha256;
if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
  process.stderr.write('profileSha256 is not 64 lowercase hex characters\n'); process.exit(1);
}
const first = digest[0];
const flipped = first === '0' ? '1' : '0';
doc.bindings.profileSha256 = `${flipped}${digest.slice(1)}`;
try { writeFileSync(output, `${JSON.stringify(doc, null, 2)}\n`, 'utf8'); }
catch (error) { process.stderr.write(`stale evidence write failed: ${error.message}\n`); process.exit(73); }
process.stdout.write(`flipped=${first}->${flipped}\n`);
STALE
  then br_write_failure stale-writer; return 73; fi
  stale_doc="$RUN/stale-correspondence.json"
  # Preopen the generated document as well as logs before the writer workload.
  if ! exec 6>"$stale_doc"; then br_write_failure stale-correspondence.json; return 73; fi
  exec 6>&-
  capture "$RUN/stale-flip.log" "$RUN/stale-flip.err" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" "$NODE" "$RUN/make-stale.mjs" "$CORR" "$stale_doc"; rc=$?
  br_record "$RUN/stale-flip.rc" 'stale_flip_rc=%s\n' "$rc" || :
  [ "$rc" -ne 73 ] || br_write_failure stale-correspondence-write
  br_evidence_gate || return 73
  if [ "$rc" -eq 0 ]; then
    stale_out="$RUN/stale.stdout.json"
    capture "$stale_out" "$RUN/stale.stderr.txt" \
      bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
      --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$PKG" \
      -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
      "$NODE" src/correspondence-cli.js "$stale_doc" --profile "$PROFILE_EX" --declaration "$DECL_EX"; stale_rc=$?
    br_record "$RUN/stale.rc" 'stale_rc=%s\n' "$stale_rc" || :
    br_evidence_gate || return 73
    if [ "$stale_rc" -eq 2 ] && [ -s "$stale_out" ]; then
      capture "$RUN/stale-check.log" "$RUN/stale-check.err.txt" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" "$NODE" "$RUN/check-output.mjs" stale "$stale_out"; rc=$?
      br_record "$RUN/stale-check.rc" 'stale_check_rc=%s\n' "$rc" || :
      [ "$rc" -ne 0 ] || stale_verdict=pass
      cat "$RUN/stale-check.log" || br_write_failure stale-check-relay
    fi
  else
    br_record "$RUN/stale.rc" 'stale_flip=fail\n' || :
  fi
  br_record "$RUN/stale-verdict.txt" 'stale_verdict=%s\n' "$stale_verdict" || :
  br_record "$RUN/workload.txt" 'node=%s\nworkdir=%s\ntest_files=%s\n' "$NODE" "$PKG" 'tests/correspondence.test.js' || :
  capture "$RUN/node-tap.log" "$RUN/node-stderr.log" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" --test --test-concurrency=1 --test-reporter=tap tests/correspondence.test.js; node_rc=$?
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
  verdict=pass
  [ "$tap_rc" -eq 0 ] || verdict=tap_fail
  [ "$demo_verdict" = pass ] || verdict="example_$demo_verdict"
  [ "$stale_verdict" = pass ] || verdict="stale_$stale_verdict"
  br_record "$RUN/tap-verdict.txt" 'acc_smoke_verdict=%s\nacc_example=%s\nacc_stale=%s\ntap_check_rc=%s\n' "$verdict" "$demo_verdict" "$stale_verdict" "$tap_rc" || :
  [ "$verdict" = pass ] || return 72
  return 0
}
correspondence_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
