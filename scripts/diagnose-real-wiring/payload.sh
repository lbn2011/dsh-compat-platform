#!/bin/bash
# In-envelope payload for the `diagnose` ↔ real `dsh-compat-spec` wiring batch.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1, core
# commit c8123de). Awaiting Lead bounded verification. These bytes have not been
# executed, syntax-qualified or sourced.
#
# What the canonical envelope obviates: this file used to prove its own cgroup
# membership receipt, knob readback, one-shot memory gate, resident-peak readback,
# evidence-write counter and terminal-state vocabulary. All of that is the core's
# now. What remains here is the batch: syntax of the two scripts, the static
# contract, the sibling precondition, the YAML two-point snapshot, six CLI cases
# as real child processes, and the selected test file.
#
# The host alone owns unit.log; this file only relays its own step logs into the
# run directory.
#
# Payload exit codes: 0 green; 70 envelope/argument/launch-context refusal;
# 71 static contract, sibling or dependency precondition failed (no case was
# started); 72 a case, the TAP summary or the test file did not match; 73 an
# evidence write failed.

set +e
set -uo pipefail
ROOT=/root/dsh-ecosystem-spec
REPO=$ROOT/projects/dsh-compat-platform
PKG=$REPO/packages/analyzer
SPEC=$ROOT/projects/dsh-compat-spec
SLICE=$REPO/scripts/diagnose-real-wiring
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
CLI=$PKG/src/diagnose-cli.js
WORKDIR=$REPO
EXPECT_TEST_SCRIPT='node --test --test-concurrency=1 "tests/*.test.js" "tests/*.test.mjs"'
EXPECT_YAML_VERSION='2.9.1'
EXPECT_SELECTED_TEST='tests/diagnose-spec-wiring.test.js'
EXPECT_CASE_COUNT=6
EXPECT_MIN_TESTS=6
# The sibling checkout is a PRECONDITION, never an installation: these four files
# must already exist, and their absence is a refusal (71), never a skip.
SPEC_INPUTS=(
  "$SPEC/src/index.js"
  "$SPEC/src/admission-evidence.js"
  "$SPEC/conformance/positive/01-minimal-tool.json"
  "$SPEC/conformance/negative/01-not-an-object.json"
)
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70
# The canonical host launches the payload with exactly two arguments.
[ "$#" -eq 2 ] || exit 70
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1
BR_RUN=$2
RUN=$BR_RUN
say() { printf '%s\n' "$*"; }

# Conservative TAP normalisation, preserved from the pre-migration batch: the
# reporter that `node --test` picks is not this batch's choice, so BOTH summary
# shapes are read — the TAP summary line (`# tests 6`) and the spec reporter's
# info line (`ℹ tests 6`). The info form is rewritten to the TAP form so the
# canonical single-summary checker applies to exactly one summary per key either
# way. Nothing else in the stream is touched.
normalize_tap() { # source destination
  LC_ALL=C awk '
    {
      line = $0
      if (line ~ /^# /) { print line; next }
      body = line
      sub(/^[^ \t]+[ \t]+/, "", body)
      if (body ~ /^(tests|pass|fail|cancelled|skipped|todo) [0-9]+$/) {
        print "# " body
        next
      }
      print line
    }
  ' "$1" > "$2"
}

# Two-point YAML snapshot. The manifest is taken over the YAML directory itself
# and over symlinks: a symlinked tree makes the digest set meaningless, so it is
# refused rather than hashed.
snapshot_yaml() { # destination yaml_dir
  local out=$1
  local yaml_dir=$2
  ( cd "$yaml_dir" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum ) > "$out"
}

# --- one CLI case, as a real child process ---------------------------------
#
# The sandbox is deliberately tight: its own pid/ipc/uts namespace, no network,
# the whole filesystem read-only, and the repository as the working directory.
# Each case is its own bwrap launch, so no case can observe another's writes.
CASE_COUNT=0
CASE_FAIL=''
run_case() { # id expected_exit argv...
  local id=$1
  local expect=$2
  shift 2
  local dir=$RUN/cases/$id
  if ! mkdir -p "$dir"; then
    br_write_failure "cases/$id"
    return 73
  fi
  CASE_COUNT=$((CASE_COUNT + 1))
  br_evidence_gate || return 73
  if ! br_record "$dir/case.txt" 'case=%s\nexpected_exit=%s\nworkdir=%s\nargv:' \
      "$id" "$expect" "$WORKDIR"; then
    return 73
  fi
  if ! { local a; for a in "$NODE" "$CLI" "$@"; do printf ' %q' "$a"; done; printf '\n'; } >> "$dir/case.txt"; then
    br_write_failure "cases/$id/case.txt"
    return 73
  fi
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$WORKDIR" -- \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
      NODE_OPTIONS=--max-old-space-size=192 \
      "$NODE" "$CLI" "$@" > "$dir/stdout.json" 2> "$dir/stderr.txt"
  local rc=$?
  br_record "$dir/exit.txt" '%s\n' "$rc" || :
  if ! printf 'actual_exit=%s\n' "$rc" >> "$dir/case.txt"; then
    br_write_failure "cases/$id/case.txt"
    return 73
  fi
  if [ "$rc" -ne "$expect" ]; then
    CASE_FAIL="$CASE_FAIL $id(rc=$rc!=expect=$expect)"
  fi
  # A diagnosis that does not put a JSON object on stdout is not a diagnosis.
  if [ "$(head -c 1 "$dir/stdout.json" 2>/dev/null)" != '{' ]; then
    CASE_FAIL="$CASE_FAIL $id(no-json-envelope)"
  fi
  return 0
}

diagnose_real_wiring_payload() {
  source "$CORE/tap.sh" || return 70
  # Envelope first: nothing below may run outside the accounted cgroup.
  br_envelope_enter "$BR_UNIT" "$BR_RUN"
  local rc=$?
  [ "$rc" -eq 0 ] || return "$rc"

  [ -d "$PKG" ] && [ -f "$CLI" ] && [ -d "$WORKDIR" ] || return 70
  [ -x "$NODE" ] || return 70
  command -v bwrap >/dev/null 2>&1 || return 70
  command -v sha256sum >/dev/null 2>&1 || return 70

  # --- 1. syntax of the two batch scripts --------------------------------
  # Both are always checked, so one failure never hides the other. This is a
  # parse-only check of the files; the workload below is what actually runs.
  br_evidence_gate || return 73
  bash -n "$SLICE/run.sh"
  local acc_syntax_run_sh_rc=$?
  br_evidence_gate || return 73
  bash -n "$SLICE/payload.sh"
  local acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  br_evidence_gate || return 73
  if [ "$acc_syntax_run_sh_rc" -ne 0 ] || [ "$acc_syntax_payload_sh_rc" -ne 0 ]; then
    return 71
  fi

  # --- 2. static contract of the CLI package -----------------------------
  # The package must already declare the wiring this batch exercises; nothing is
  # installed or repaired here. A missing YAML dependency is reported as a
  # blocked contract (exit 3 from the contract) rather than a red workload.
  br_evidence_gate || return 73
  if ! cat > "$RUN/static-contract.mjs" <<'CONTRACT'
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = process.env.EXPECT_PKG_DIR;
const expectedTest = process.env.EXPECT_TEST_SCRIPT;
const expectedYaml = process.env.EXPECT_YAML_VERSION;
const selectedTest = process.env.EXPECT_SELECTED_TEST;
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

const cliExport = manifest.exports?.['./diagnose-cli'];
say(`export_diagnose_cli=${cliExport === './src/diagnose-cli.js' ? 'pass' : 'fail'}`);
if (cliExport !== './src/diagnose-cli.js') fail.push('exports.diagnose-cli');

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
  selectedTest,
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
const selectedInGlob = present.includes(selectedTest);
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
  br_evidence_gate || return 73
  if ! exec 7>"$RUN/static-contract.log"; then
    br_write_failure static-contract.log
    return 73
  fi
  env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS=--max-old-space-size=192 \
    EXPECT_PKG_DIR="$PKG" \
    EXPECT_TEST_SCRIPT="$EXPECT_TEST_SCRIPT" \
    EXPECT_YAML_VERSION="$EXPECT_YAML_VERSION" \
    EXPECT_SELECTED_TEST="$EXPECT_SELECTED_TEST" \
    "$NODE" "$RUN/static-contract.mjs" >&7 2>&1
  local static_rc=$?
  exec 7>&-
  # The contract's own output is relayed to stdout, and the exit code is appended
  # to its log exactly as before the migration.
  if ! cat "$RUN/static-contract.log"; then
    br_write_failure static-log-relay
  fi
  if ! printf 'static_contract_rc=%s\n' "$static_rc" >> "$RUN/static-contract.log"; then
    br_write_failure static-contract-rc-line
  fi
  if [ "$static_rc" -eq 3 ]; then
    br_record "$RUN/static-verdict.txt" \
      'acc_static_contract=blocked\nacc_block_reason=yaml_dependency_not_installed\n' || :
    return 71
  fi
  if [ "$static_rc" -ne 0 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=fail\n' || :
    return 71
  fi
  br_record "$RUN/static-verdict.txt" 'acc_static_contract=pass\n' || :

  # --- 3. sibling checkout precondition ----------------------------------
  local spec_missing=''
  local f
  for f in "${SPEC_INPUTS[@]}"; do
    br_path "$f" && [ -f "$f" ] || spec_missing="$spec_missing ${f#"$SPEC"/}"
  done
  br_record "$RUN/sibling-precondition.txt" 'spec_root=%s\nspec_missing=%s\n' \
    "$SPEC" "$spec_missing" || :
  br_evidence_gate || return 73
  if [ -n "$spec_missing" ]; then
    return 71
  fi

  # --- 4. YAML dependency snapshot, observed and not modified ------------
  # A tree that cannot be snapshotted is an unrecordable run, not a red
  # workload: it stops as an evidence-write failure (73) before any case runs.
  local yaml_dir=$PKG/node_modules/yaml
  if ! snapshot_yaml "$RUN/yaml-manifest-before.txt" "$yaml_dir"; then
    br_write_failure yaml-manifest-before.txt
    return 73
  fi

  # --- 5. the workload: six CLI cases ------------------------------------
  br_evidence_gate || return 73
  br_record "$RUN/workload.txt" 'node=%s\ncli=%s\nworkdir=%s\nspec_root=%s\n' \
    "$NODE" "$CLI" "$WORKDIR" "$SPEC" || :
  if ! mkdir -p "$RUN/cases"; then
    br_write_failure cases
    return 73
  fi

  # c1: profile only — the report is assembled from the profile alone.
  run_case c1-profile-only 0 \
    --profile examples/diagnose/profile.yml || return $?
  # c2: profile + a clean static declaration + runtime evidence — all clear.
  run_case c2-all-clear 0 \
    --profile examples/diagnose/profile.yml \
    --static packages/analyzer/fixtures/clean.json \
    --declaration-validator ../dsh-compat-spec/src/index.js \
    --runtime examples/diagnose/runtime-evidence.json || return $?
  # c3: a declaration that is not a valid tool — refused by the validator.
  run_case c3-static-negative 2 \
    --profile examples/diagnose/profile.yml \
    --static packages/analyzer/fixtures/invalid-declaration.json \
    --declaration-validator ../dsh-compat-spec/src/index.js \
    --runtime examples/diagnose/runtime-evidence.json || return $?
  # c4: admission evidence needs attention — exit 1, not a refusal.
  run_case c4-admission-attention 1 \
    --profile examples/diagnose/profile.yml \
    --static packages/analyzer/fixtures/clean.json \
    --declaration-validator ../dsh-compat-spec/src/index.js \
    --runtime examples/diagnose/runtime-evidence.json \
    --admission examples/diagnose/admission-evidence.json \
    --admission-validator ../dsh-compat-spec/src/admission-evidence.js || return $?
  # c5: a bare minimal tool as a declaration — insufficient, refused.
  run_case c5-static-bare-declaration 2 \
    --static ../dsh-compat-spec/conformance/positive/01-minimal-tool.json \
    --declaration-validator ../dsh-compat-spec/src/index.js || return $?
  # c6: clean declarations fed in as admission evidence — grammar refusal.
  run_case c6-admission-grammar-refusal 2 \
    --static packages/analyzer/fixtures/clean.json \
    --declaration-validator ../dsh-compat-spec/src/index.js \
    --admission packages/analyzer/fixtures/clean.json \
    --admission-validator ../dsh-compat-spec/src/admission-evidence.js || return $?

  local case_failures=${CASE_FAIL:-none}
  br_record "$RUN/cases-summary.txt" 'case_count=%s\ncase_failures=%s\n' \
    "$CASE_COUNT" "$case_failures" || :
  br_evidence_gate || return 73

  # --- 6. the selected test file -----------------------------------------
  # The suite is run exactly as the package's test script runs it: no reporter
  # flag, so the summary format is whatever node chooses — hence normalisation.
  local test_dir=$RUN/test-file
  if ! mkdir -p "$test_dir"; then
    br_write_failure test-file
    return 73
  fi
  br_evidence_gate || return 73
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$PKG" -- \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
      NODE_OPTIONS=--max-old-space-size=192 \
      "$NODE" --test --test-concurrency=1 "$EXPECT_SELECTED_TEST" \
      > "$test_dir/stdout.tap" 2> "$test_dir/stderr.txt"
  local test_rc=$?
  br_record "$test_dir/exit.txt" '%s\n' "$test_rc" || :
  if ! normalize_tap "$test_dir/stdout.tap" "$test_dir/stdout.tap.normalized"; then
    br_write_failure test-file-tap-normalize
    return 73
  fi
  br_evidence_gate || return 73
  if ! br_record "$test_dir/summary.txt" \
      'test_file=%s\ncwd=%s\nexit=%s\n' "$EXPECT_SELECTED_TEST" "$PKG" "$test_rc"; then
    return 73
  fi

  local tap_rc=0
  br_tap_check "$test_dir/stdout.tap.normalized" "$test_rc"
  tap_rc=$?
  local k value state
  if ! : > "$test_dir/tap-fields.txt"; then
    br_write_failure test-file-tap-fields
    return 73
  fi
  for k in tests pass fail cancelled skipped todo; do
    if value=$(br_tap_value "$test_dir/stdout.tap.normalized" "$k"); then
      state=ok
    else
      state=invalid
      value='<invalid>'
    fi
    if ! printf '%s=%s\n' "$k" "$value" >> "$test_dir/tap-fields.txt"; then
      br_write_failure test-file-tap-fields
      return 73
    fi
    if ! printf '%s=%s\n' "$k" "$value" >> "$test_dir/summary.txt"; then
      br_write_failure test-file-summary
      return 73
    fi
    if [ "$state" = invalid ]; then
      br_record "$test_dir/tap-invalid.txt" '%s\n' "$k" || :
    fi
  done
  br_record "$test_dir/tap-verdict.txt" 'tap_rc=%s\n' "$tap_rc" || :

  local test_verdict=pass
  local tests=0
  if [ "$tap_rc" -ne 0 ]; then
    test_verdict=fail
  else
    tests=$(br_tap_value "$test_dir/stdout.tap.normalized" tests) || tests=0
    # The batch is only green if the selected file really carries the suite's
    # assertions: a file that reports three passing tests must not pass.
    if ! br_uint "$tests" || [ "$tests" -lt "$EXPECT_MIN_TESTS" ]; then
      test_verdict=insufficient_tests
    fi
  fi
  br_record "$test_dir/verdict.txt" 'test_verdict=%s\ntests=%s\n' \
    "$test_verdict" "$tests" || :
  br_evidence_gate || return 73

  # --- 7. YAML snapshot, second point ------------------------------------
  if ! snapshot_yaml "$RUN/yaml-manifest-after.txt" "$yaml_dir"; then
    br_write_failure yaml-manifest-after.txt
    return 73
  fi
  local yaml_snapshot=identical
  if ! diff -q "$RUN/yaml-manifest-before.txt" "$RUN/yaml-manifest-after.txt" \
      > "$RUN/yaml-manifest-diff.txt" 2>&1; then
    yaml_snapshot=changed
  fi
  local yaml_files
  yaml_files=$(wc -l < "$RUN/yaml-manifest-before.txt" 2>/dev/null) || yaml_files=0
  br_record "$RUN/yaml-manifest.txt" \
    'yaml_dir=%s\nyaml_manifest_files_before=%s\nyaml_manifest_snapshot_state=%s\n' \
    "$yaml_dir" "$yaml_files" "$yaml_snapshot" || :
  br_evidence_gate || return 73

  # --- 8. verdict --------------------------------------------------------
  # Order is contractual: a case mismatch outranks a count problem, which
  # outranks the test file, which outranks the snapshot.
  local verdict=pass
  if [ -n "$CASE_FAIL" ]; then
    verdict=case_exit_mismatch
  elif [ "$CASE_COUNT" -ne "$EXPECT_CASE_COUNT" ]; then
    verdict=case_count_$CASE_COUNT
  elif [ "$test_verdict" != pass ]; then
    verdict=test_file_$test_verdict
  elif [ "$yaml_snapshot" != identical ]; then
    verdict=yaml_snapshot_$yaml_snapshot
  fi
  br_record "$RUN/case-verdict.txt" \
    'acc_smoke_verdict=%s\nacc_case_failures=%s\nacc_test_file_verdict=%s\nacc_yaml_snapshot=%s\n' \
    "$verdict" "$case_failures" "$test_verdict" "$yaml_snapshot" || :
  br_evidence_gate || return 73
  say "case_count=$CASE_COUNT case_failures=${case_failures:-none}"
  say "test_file_verdict=$test_verdict yaml_snapshot=$yaml_snapshot"
  say "acc_smoke_verdict=$verdict"
  if [ "$verdict" = pass ]; then
    return 0
  fi
  # The selected test file keeps its own exit code (74): a clean case list with an
  # unclean test run is a different failure from a case mismatch, and the launcher
  # relays whichever number applies.
  case $verdict in
    test_file_*) return 74 ;;
    *) return 72 ;;
  esac
}

diagnose_real_wiring_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
