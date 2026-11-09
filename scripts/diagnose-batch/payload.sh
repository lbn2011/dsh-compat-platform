#!/bin/bash
# Source-only migration; awaiting Lead bounded verification. Host alone owns unit.log.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/analyzer
SLICE=$REPO/scripts/diagnose-batch
CORE=$REPO/scripts/bounded-runner
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

yaml_dir="$PKG/node_modules/yaml"
yaml_manifest() {
  [ -d "$yaml_dir" ] || return 1
  [ -L "$yaml_dir" ] && return 1
  local links
  links=$(find "$yaml_dir" -type l -print -quit 2>/dev/null)
  [ $? -eq 0 ] || return 1
  [ -z "$links" ] || return 1
  ( cd "$yaml_dir" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum ) || return 1
}

diagnose_payload() {
  local rc static_rc node_rc tap_rc k value state verdict
  local acc_syntax_run_sh_rc acc_syntax_payload_sh_rc yaml_before_count=0 yaml_snapshot=unreadable
  source "$CORE/tap.sh" || return 70
  br_envelope_enter "$BR_UNIT" "$BR_RUN"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  [ -d "$PKG" ] && [ -x "$NODE" ] || return 70
  command -v bwrap >/dev/null 2>&1 || return 70

  # Future in-envelope syntax substeps, NOT checks performed by this migration.
  if ! exec 7>"$RUN/syntax-run.log"; then br_write_failure syntax-run.log; return 73; fi
  br_evidence_gate || { exec 7>&-; return 73; }
  /bin/bash -n "$SLICE/run.sh" >&7 2>&1; acc_syntax_run_sh_rc=$?
  exec 7>&-
  br_record "$RUN/syntax-run.txt" 'acc_syntax_run_sh_rc=%s\n' "$acc_syntax_run_sh_rc" || :
  br_evidence_gate || return 73
  if ! exec 7>"$RUN/syntax-payload.log"; then br_write_failure syntax-payload.log; return 73; fi
  br_evidence_gate || { exec 7>&-; return 73; }
  /bin/bash -n "$SLICE/payload.sh" >&7 2>&1; acc_syntax_payload_sh_rc=$?
  exec 7>&-
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ] || return 71

  # Original static JavaScript contract preserved in full.
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

const binPath = manifest.bin?.['dsh-compat-diagnose'];
say(`bin_diagnose=${binPath === './src/diagnose-cli.js' ? 'pass' : 'fail'}`);
if (binPath !== './src/diagnose-cli.js') fail.push('bin.diagnose');

const exportEntry = manifest.exports?.['./diagnose'];
say(`export_diagnose_types=${exportEntry?.types === './src/diagnose.d.ts' ? 'pass' : 'fail'}`);
say(`export_diagnose_default=${exportEntry?.default === './src/diagnose.js' ? 'pass' : 'fail'}`);
if (exportEntry?.types !== './src/diagnose.d.ts' || exportEntry?.default !== './src/diagnose.js') {
  fail.push('exports.diagnose');
}

const cliExport = manifest.exports?.['./diagnose-cli'];
say(`export_diagnose_cli=${cliExport === './src/diagnose-cli.js' ? 'pass' : 'fail'}`);
if (cliExport !== './src/diagnose-cli.js') fail.push('exports.diagnose-cli');

// The assembler is deliberately package-internal: neither an own export key nor a
// target of any other export slot may point at it.
const exportTargets = Object.entries(manifest.exports ?? {}).flatMap(([, value]) => {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).filter((v) => typeof v === 'string');
  return [];
});
const internalExported =
  Object.hasOwn(manifest.exports ?? {}, './diagnose-internal') ||
  exportTargets.some((target) => target === './src/diagnose-internal.js' || target.endsWith('/diagnose-internal.js'));
say(`export_internal_absent=${internalExported ? 'fail' : 'pass'}`);
if (internalExported) fail.push('exports.diagnose-internal');

for (const rel of [
  'src/diagnose-internal.js',
  'src/diagnose.js',
  'src/diagnose-cli.js',
  'src/diagnose.d.ts',
  'tests/diagnose.test.js',
]) {
  say(`file_present ${rel}=${existsSync(join(pkgDir, rel)) ? 'yes' : 'no'}`);
  if (!existsSync(join(pkgDir, rel))) fail.push(rel);
}

const declared = manifest.scripts?.test?.match(/tests\/\*\.test\.(js|mjs)/g) ?? [];
const present = readdirSync(join(pkgDir, 'tests'))
  .filter((name) => /\.test\.(js|mjs)$/.test(name))
  .map((name) => `tests/${name}`)
  .sort();
say(`test_files_present=${present.length}`);
say(`test_files=${present.join(',')}`);
say(`test_glob_declared=${declared.length ? 'pass' : 'fail'}`);
if (!declared.length) fail.push('test-glob');
const selectedInGlob = present.includes('tests/diagnose.test.js');
say(`test_file_in_glob=${selectedInGlob ? 'pass' : 'fail'}`);
if (!selectedInGlob) fail.push('test-file-in-glob');

// Dependency precondition. This batch never installs; it refuses instead.
const yamlManifest = join(pkgDir, 'node_modules', 'yaml', 'package.json');
if (!existsSync(yamlManifest)) {
  say('dependency_resolution=absent');
  say('dependency_note=not installed; this batch does not install');
  process.exit(3);
}
let installed;
try {
  installed = JSON.parse(readFileSync(yamlManifest, 'utf8')).version;
} catch {
  say('dependency_resolution=unreadable');
  process.exit(3);
}
say(`dependency_resolution=${installed === expectedYaml ? 'exact' : 'mismatch'}`);
say(`dependency_installed_version=${installed}`);
if (installed !== expectedYaml) process.exit(3);

say(`static_contract=${fail.length === 0 ? 'pass' : 'fail'}`);
say(`static_contract_failures=${fail.join(',') || 'none'}`);
process.exit(fail.length === 0 ? 0 : 1);
CONTRACT
  then
    br_write_failure static-contract-write
    return 73
  fi
  if ! exec 7>"$RUN/static-contract.log"; then br_write_failure static-contract.log; return 73; fi
  br_evidence_gate || { exec 7>&-; return 73; }
  env -i PATH=/usr/bin:/bin HOME=/tmp \
    NODE_OPTIONS="$BR_NODE_OPTIONS" \
    EXPECT_PKG_DIR="$PKG" \
    EXPECT_TEST_SCRIPT="$EXPECT_TEST_SCRIPT" \
    EXPECT_YAML_VERSION="$EXPECT_YAML_VERSION" \
    "$NODE" "$RUN/static-contract.mjs" >&7 2>&1
  static_rc=$?
  exec 7>&-
  br_record "$RUN/static-contract.rc" 'static_contract_rc=%s\n' "$static_rc" || :
  cat "$RUN/static-contract.log" || br_write_failure static-log-relay
  if ! printf 'static_contract_rc=%s\n' "$static_rc" >> "$RUN/static-contract.log"; then
    br_write_failure static-contract-rc-line
  fi
  if [ "$static_rc" -eq 3 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=blocked\nacc_block_reason=yaml_dependency_not_installed\n' || :
    return 71
  fi
  if [ "$static_rc" -ne 0 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=fail\n' || :
    return 71
  fi
  br_record "$RUN/static-verdict.txt" 'acc_static_contract=pass\n' || :
  br_evidence_gate || return 73

  # Regular files at two instants only: no install integrity/provenance claim,
  # no dependency closure and no protection against reverted intervening changes.
  if yaml_manifest > "$RUN/yaml-manifest-before.txt" 2>/dev/null && [ -s "$RUN/yaml-manifest-before.txt" ]; then
    yaml_before_count=$(awk 'END { print NR }' "$RUN/yaml-manifest-before.txt") || { br_write_failure yaml-count; return 73; }
  else
    br_write_failure yaml-manifest-before.txt
    return 73
  fi
  br_record "$RUN/workload.txt" 'node=%s\nworkdir=%s\ntest_files=%s\n' \
    "$NODE" "$PKG" 'tests/diagnose.test.js' || :
  br_evidence_gate || return 73
  if ! exec 7>"$RUN/node-tap.log"; then br_write_failure node-tap.log; return 73; fi
  if ! exec 8>"$RUN/node-stderr.log"; then
    br_write_failure node-stderr.log
    exec 7>&-
    return 73
  fi
  br_evidence_gate || { exec 7>&- 8>&-; return 73; }
  # Preserve original read-only/no-network sandbox, serial TAP args and heap192.
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
       NODE_OPTIONS="$BR_NODE_OPTIONS" \
       "$NODE" --test --test-concurrency=1 --test-reporter=tap tests/diagnose.test.js \
    >&7 2>&8
  node_rc=$?
  exec 7>&- 8>&-
  br_record "$RUN/node.rc" 'node_rc=%s\n' "$node_rc" || :
  cat "$RUN/node-tap.log" || br_write_failure tap-relay

  if yaml_manifest > "$RUN/yaml-manifest-after.txt" 2>/dev/null && [ -s "$RUN/yaml-manifest-after.txt" ]; then
    if ! exec 7>"$RUN/yaml-manifest-diff.txt"; then br_write_failure yaml-manifest-diff.txt; return 73; fi
    diff -q "$RUN/yaml-manifest-before.txt" "$RUN/yaml-manifest-after.txt" >&7 2>&1; rc=$?
    exec 7>&-
    case "$rc" in
      0) yaml_snapshot=identical ;;
      1) yaml_snapshot=changed ;;
      *) br_write_failure yaml-manifest-diff.txt ;;
    esac
  else
    br_write_failure yaml-manifest-after.txt
  fi
  br_record "$RUN/yaml-manifest.txt" 'yaml_dir=%s\nyaml_manifest_files_before=%s\nyaml_manifest_snapshot_state=%s\n' \
    "$yaml_dir" "$yaml_before_count" "$yaml_snapshot" || :
  br_evidence_gate || return 73
  br_tap_check "$RUN/node-tap.log" "$node_rc"; tap_rc=$?
  br_record "$RUN/tap-fields.txt" '%s' '' || :
  br_record "$RUN/tap-summary.txt" '%s' '' || :
  for k in tests pass fail cancelled skipped todo; do
    state=ok
    value=$(br_tap_value "$RUN/node-tap.log" "$k") || { state=invalid; value='<invalid>'; }
    if ! printf 'tap_field_%s=%s\n' "$k" "$state" >> "$RUN/tap-fields.txt"; then br_write_failure tap-fields.txt; fi
    if ! printf 'tap_%s=%s\n' "$k" "$value" >> "$RUN/tap-summary.txt"; then br_write_failure tap-summary.txt; fi
  done
  verdict=pass
  [ "$tap_rc" -eq 0 ] || verdict=tap_or_node_failed
  if [ "$yaml_snapshot" != identical ]; then verdict="yaml_snapshot_$yaml_snapshot"; tap_rc=72; fi
  br_record "$RUN/tap-verdict.txt" 'tests_exit=%s\ntap_check_rc=%s\nacc_smoke_verdict=%s\nacc_yaml_snapshot=%s\n' \
    "$node_rc" "$tap_rc" "$verdict" "$yaml_snapshot" || :
  return "$tap_rc"
}

diagnose_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
