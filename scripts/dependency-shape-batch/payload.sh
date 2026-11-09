#!/bin/bash
# Source-only migration; awaiting Lead bounded verification. Host alone owns unit.log.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/analyzer
SLICE=$REPO/scripts/dependency-shape-batch
CORE=$REPO/scripts/bounded-runner
EXAMPLE=$REPO/examples/dependency-shape/profile.yml
NODE=/www/server/nodejs/v24.21.0/bin/node
EXPECT_TEST_SCRIPT='node --test --test-concurrency=1 "tests/*.test.js" "tests/*.test.mjs"'
EXPECT_YAML_VERSION='2.9.1'
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
yaml_manifest() {
  [ -d "$yaml_dir" ] && [ ! -L "$yaml_dir" ] || return 1
  local links
  links=$(find "$yaml_dir" -type l -print -quit 2>/dev/null)
  [ $? -eq 0 ] && [ -z "$links" ] || return 1
  ( cd "$yaml_dir" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum ) || return 1
}
dependency_payload() {
  local rc static_rc node_rc tap_rc k value state acc_syntax_run_sh_rc acc_syntax_payload_sh_rc
  local example_out example_rc example_verdict yaml_dir yaml_before_count=0 yaml_snapshot=unreadable verdict
  source "$CORE/tap.sh" || return 70
  br_envelope_enter "$BR_UNIT" "$BR_RUN"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  [ -d "$PKG" ] && [ -x "$NODE" ] || return 70
  command -v bwrap >/dev/null 2>&1 || return 70
  capture "$RUN/syntax-run.log" "$RUN/syntax-run.err" /bin/bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
  br_record "$RUN/syntax-run.txt" 'acc_syntax_run_sh_rc=%s\n' "$acc_syntax_run_sh_rc" || :
  br_evidence_gate || return 73
  capture "$RUN/syntax-payload.log" "$RUN/syntax-payload.err" /bin/bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ] || return 71
  if ! cat > "$RUN/static-contract.mjs" <<'CONTRACT'
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const pkgDir = process.env.EXPECT_PKG_DIR;
const expectedTest = process.env.EXPECT_TEST_SCRIPT;
const expectedYaml = process.env.EXPECT_YAML_VERSION;
const fail = [];
const say = (line) => process.stdout.write(`${line}\n`);
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
} catch (error) {
  say('manifest_parse=fail');
  process.exit(1);
}
say('manifest_parse=pass');
say(`manifest_test_script_exact=${manifest.scripts?.test === expectedTest ? 'pass' : 'fail'}`);
if (manifest.scripts?.test !== expectedTest) fail.push('scripts.test');
const deps = manifest.dependencies ?? {};
const depNames = Object.keys(deps);
say(`dependency_count=${depNames.length}`);
say(`dependency_yaml_exact=${deps.yaml === expectedYaml ? 'pass' : 'fail'}`);
if (deps.yaml !== expectedYaml) fail.push('dependencies.yaml');
if (depNames.some((name) => name !== 'yaml')) fail.push('extra-dependency');
const binPath = manifest.bin?.['dsh-compat-dependency-shape'];
say(`bin_present=${binPath === './src/dependency-shape-cli.js' ? 'pass' : 'fail'}`);
if (binPath !== './src/dependency-shape-cli.js') fail.push('bin');
const exportEntry = manifest.exports?.['./dependency-shape'];
say(`export_types=${exportEntry?.types === './src/dependency-shape.d.ts' ? 'pass' : 'fail'}`);
say(`export_default=${exportEntry?.default === './src/dependency-shape.js' ? 'pass' : 'fail'}`);
if (exportEntry?.types !== './src/dependency-shape.d.ts' || exportEntry?.default !== './src/dependency-shape.js') {
  fail.push('exports');
}
for (const rel of ['src/dependency-shape.js', 'src/dependency-shape.d.ts', 'src/dependency-shape-cli.js', 'tests/dependency-shape.test.js']) {
  say(`file_present ${rel}=${existsSync(join(pkgDir, rel)) ? 'yes' : 'no'}`);
  if (!existsSync(join(pkgDir, rel))) fail.push(rel);
}
const declared = manifest.scripts?.test?.match(/tests\/\*\.test\.(js|mjs)/g) ?? [];
const present = readdirSync(join(pkgDir, 'tests'))
  .filter((name) => /\.test\.(js|mjs)$/.test(name)).map((name) => `tests/${name}`).sort();
say(`test_files_present=${present.length}`);
say(`test_files=${present.join(',')}`);
if (!declared.length) fail.push('test-glob');
const yamlManifest = join(pkgDir, 'node_modules', 'yaml', 'package.json');
if (!existsSync(yamlManifest)) {
  say('dependency_resolution=absent');
  say('dependency_note=not installed; this batch does not install');
  process.exit(3);
}
let installed;
try { installed = JSON.parse(readFileSync(yamlManifest, 'utf8')).version; }
catch { say('dependency_resolution=unreadable'); process.exit(3); }
say(`dependency_resolution=${installed === expectedYaml ? 'exact' : 'mismatch'}`);
say(`dependency_installed_version=${installed}`);
if (installed !== expectedYaml) process.exit(3);
say(`static_contract=${fail.length === 0 ? 'pass' : 'fail'}`);
say(`static_contract_failures=${fail.join(',') || 'none'}`);
process.exit(fail.length === 0 ? 0 : 1);
CONTRACT
  then br_write_failure static-contract-write; return 73; fi
  capture "$RUN/static-contract.log" "$RUN/static-contract.err" \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    EXPECT_PKG_DIR="$PKG" EXPECT_TEST_SCRIPT="$EXPECT_TEST_SCRIPT" EXPECT_YAML_VERSION="$EXPECT_YAML_VERSION" \
    "$NODE" "$RUN/static-contract.mjs"; static_rc=$?
  br_record "$RUN/static-contract.rc" 'static_contract_rc=%s\n' "$static_rc" || :
  cat "$RUN/static-contract.log" || br_write_failure static-log-relay
  br_evidence_gate || return 73
  if [ "$static_rc" -eq 3 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=blocked\nacc_block_reason=yaml_dependency_not_installed\n' || :
    return 71
  fi
  if [ "$static_rc" -ne 0 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=fail\n' || :
    return 71
  fi
  br_record "$RUN/static-verdict.txt" 'acc_static_contract=pass\n' || :
  # Two-point regular-file snapshot only; not provenance, integrity or closure.
  yaml_dir="$PKG/node_modules/yaml"
  capture "$RUN/yaml-manifest-before.txt" "$RUN/yaml-manifest-before.err" yaml_manifest; rc=$?
  if [ "$rc" -ne 0 ] || [ ! -s "$RUN/yaml-manifest-before.txt" ]; then
    br_write_failure yaml-manifest-before.txt; return 73
  fi
  yaml_before_count=$(awk 'END { print NR }' "$RUN/yaml-manifest-before.txt") || { br_write_failure yaml-manifest-count; return 73; }
  br_uint "$yaml_before_count" && [ "$yaml_before_count" != 0 ] || { br_write_failure yaml-manifest-count; return 73; }
  example_out="$RUN/example.stdout.json"
  capture "$example_out" "$RUN/example.stderr.txt" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" src/dependency-shape-cli.js "$EXAMPLE"; example_rc=$?
  br_record "$RUN/example.rc" 'example_rc=%s\n' "$example_rc" || :
  br_evidence_gate || return 73
  example_verdict=fail
  if [ "$example_rc" -eq 0 ] && [ -s "$example_out" ]; then
    capture "$RUN/example-check.log" "$RUN/example-check.err.txt" \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" "$NODE" -e '
const fs = require("node:fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const counts = doc.counts ?? {};
const want = {
  rows: 4, rowsWithInject: 3, injectAbsent: 1, injectNull: 1,
  injectSequence: 1, injectMapping: 1, injectOther: 0,
  injectSequenceItems: 2, injectNames: 2, injectMappingKeys: 1,
  injectEmptyMappings: 0, injectNonScalarItems: 0, injectTaggedItems: 0,
};
const wrong = Object.entries(want).filter(([key, value]) => counts[key] !== value);
const shapeOk =
  doc.dependencyShapeSummary === "dependency-shape-summary/0.1-draft.1" &&
  doc.certification === false && doc.completeness === "unknown" &&
  doc.runtimeValidation === "not-performed" &&
  Array.isArray(doc.diagnostics) && doc.diagnostics.length === 0 &&
  Array.isArray(doc.notDerived) && doc.notDerived.length === 6 &&
  Array.isArray(doc.limitations) && doc.limitations.length === 9;
if (wrong.length > 0 || !shapeOk) {
  console.error("example counter mismatch:", JSON.stringify(wrong), "shape_ok=" + shapeOk);
  process.exit(1);
}
' "$example_out"; rc=$?
    br_record "$RUN/example-check.rc" 'example_check_rc=%s\n' "$rc" || :
    [ "$rc" -ne 0 ] || example_verdict=pass
  fi
  br_record "$RUN/example-verdict.txt" 'example_verdict=%s\n' "$example_verdict" || :
  br_record "$RUN/workload.txt" 'node=%s\nworkdir=%s\ntest_files=%s\n' "$NODE" "$PKG" 'tests/dependency-shape.test.js' || :
  capture "$RUN/node-tap.log" "$RUN/node-stderr.log" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" --test --test-concurrency=1 --test-reporter=tap tests/dependency-shape.test.js; node_rc=$?
  br_record "$RUN/node.rc" 'node_rc=%s\n' "$node_rc" || :
  cat "$RUN/node-tap.log" || br_write_failure tap-relay
  br_evidence_gate || return 73
  capture "$RUN/yaml-manifest-after.txt" "$RUN/yaml-manifest-after.err" yaml_manifest; rc=$?
  if [ "$rc" -eq 0 ] && [ -s "$RUN/yaml-manifest-after.txt" ]; then
    capture "$RUN/yaml-manifest-diff.txt" "$RUN/yaml-manifest-diff.err" \
      diff -q "$RUN/yaml-manifest-before.txt" "$RUN/yaml-manifest-after.txt"; rc=$?
    case "$rc" in 0) yaml_snapshot=identical;; 1) yaml_snapshot=changed;; *) br_write_failure yaml-manifest-diff;; esac
  else br_write_failure yaml-manifest-after.txt
  fi
  br_record "$RUN/yaml-manifest.txt" 'yaml_dir=%s\nyaml_manifest_files_before=%s\nyaml_manifest_snapshot_state=%s\n' "$yaml_dir" "$yaml_before_count" "$yaml_snapshot" || :
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
  [ "$example_verdict" = pass ] || verdict="example_$example_verdict"
  [ "$yaml_snapshot" = identical ] || verdict="yaml_snapshot_$yaml_snapshot"
  br_record "$RUN/tap-verdict.txt" 'acc_smoke_verdict=%s\nacc_yaml_snapshot=%s\nacc_example=%s\ntap_check_rc=%s\n' "$verdict" "$yaml_snapshot" "$example_verdict" "$tap_rc" || :
  [ "$verdict" = pass ] || return 72
  return 0
}
dependency_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
