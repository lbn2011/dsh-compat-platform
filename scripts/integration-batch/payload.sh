#!/bin/bash
# Bounded slice payload: the three repositories' integration suites, in sequence,
# inside one envelope. See README.md beside this file for what the run proves and
# what it cannot.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
ECOSYSTEM=/root/dsh-ecosystem-spec/projects
ECOSYSTEM_ROOT=/root/dsh-ecosystem-spec
KIT=$ECOSYSTEM/dsh-plugin-kit
SPEC=$ECOSYSTEM/dsh-compat-spec
SLICE=$REPO/scripts/integration-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
BR_IN_PATH=/usr/bin:/bin
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

# One TAP suite in its own bwrap sandbox: read-only host tree, private /tmp,
# no network. `$1` label, `$2` working directory, `$3` test glob.
run_tap_suite() {
  local label=$1 dir=$2 glob=$3
  local log="$RUN/$label-tap.log" rc tap_rc k value state
  br_record "$RUN/$label-workload.txt" 'node=%s\nworkdir=%s\ntest_glob=%s\nnode_options=%s\n' \
    "$NODE" "$dir" "$glob" "$BR_NODE_OPTIONS" || :
  br_evidence_gate || return 73
  capture "$log" "$RUN/$label-stderr.log" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$dir" \
    -- /usr/bin/env -i PATH="$BR_IN_PATH" HOME=/tmp TMPDIR=/tmp \
    NODE_OPTIONS="$BR_NODE_OPTIONS" \
    DSH_INTEGRATION_ENVELOPE=1 DSH_ECOSYSTEM_ROOT="$ECOSYSTEM_ROOT" \
    BR_UNIT="$BR_UNIT" BR_MEMORY_BYTES="$BR_MEMORY_BYTES" BR_TASKS="$BR_TASKS" \
    BR_RUNTIME_USEC="$BR_RUNTIME_USEC" \
    "$NODE" --test --test-concurrency=1 --test-reporter=tap $glob
  rc=$?
  br_record "$RUN/$label.rc" 'node_rc=%s\n' "$rc" || :
  br_evidence_gate || return 73
  br_tap_check "$log" "$rc"; tap_rc=$?
  : > "$RUN/$label-tap-summary.txt"
  for k in tests pass fail cancelled skipped todo; do
    state=ok
    value=$(br_tap_value "$log" "$k") || { state=invalid; value='<invalid>'; }
    printf 'tap_field_%s=%s\n' "$k" "$state" >> "$RUN/$label-tap-fields.txt" || br_write_failure "$label-tap-fields.txt"
    printf 'tap_%s=%s\n' "$k" "$value" >> "$RUN/$label-tap-summary.txt" || br_write_failure "$label-tap-summary.txt"
  done
  state=pass; [ "$tap_rc" -eq 0 ] || state=fail
  br_record "$RUN/$label-verdict.txt" 'tests_exit=%s\ntap_check_rc=%s\nverdict=%s\n' \
    "$rc" "$tap_rc" "$state" || :
  return "$tap_rc"
}

integration_payload() {
  local rc static_rc tap_rc
  local acc_syntax_run_sh_rc acc_syntax_payload_sh_rc
  local platform_rc kit_rc verdict=pass
  source "$CORE/tap.sh" || return 70
  br_envelope_enter "$BR_UNIT" "$BR_RUN"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  for dir in "$REPO" "$KIT" "$SPEC"; do [ -d "$dir" ] || return 70; done
  [ -x "$NODE" ] || return 70
  command -v bwrap >/dev/null 2>&1 || return 70

  capture "$RUN/syntax-run.log" "$RUN/syntax-run.err" /bin/bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
  br_evidence_gate || return 73
  capture "$RUN/syntax-payload.log" "$RUN/syntax-payload.err" /bin/bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ] || return 71

  # Static contract: what the run is about to test, stated as data. Repository
  # versions, the presence of every suite, and the envelope's own numbers.
  if ! cat > "$RUN/static-contract.mjs" <<'CONTRACT'
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const platform = process.env.EXPECT_PLATFORM;
const kit = process.env.EXPECT_KIT;
const spec = process.env.EXPECT_SPEC;
const fail = [];
const say = (line) => process.stdout.write(`${line}\n`);
const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

let specManifest;
let kitManifest;
let platformManifest;
try {
  specManifest = readManifest(spec);
  kitManifest = readManifest(kit);
  platformManifest = readManifest(join(platform, 'packages/analyzer'));
} catch (error) {
  say(`manifest_parse=fail ${error.message}`);
  process.exit(1);
}
say('manifest_parse=pass');
say(`spec_version=${specManifest.version}`);
say(`kit_version=${kitManifest.version}`);
say(`platform_version=${platformManifest.version}`);
say(`node_version=${process.version}`);
say(`node_options=${process.env.NODE_OPTIONS ?? 'none'}`);
if (!/--max-old-space-size=192\b/.test(process.env.NODE_OPTIONS ?? '')) fail.push('node-options');

// The suites this slice claims to run must exist, and each one must be a real
// file with tests in it rather than an empty placeholder.
// This unit runs the platform and kit suites. The protocol owner's suite runs in
// its own repository's envelope (spec/scripts/integration-batch); listing it here
// as a suite would double-count it.
const suites = {
  platform: { dir: join(platform, 'tests/integration'), ext: '.test.mjs' },
  kit: { dir: join(kit, 'tests/integration'), ext: '.test.js' },
};
const counts = {};
for (const [label, { dir, ext }] of Object.entries(suites)) {
  const present = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(ext)).sort() : [];
  say(`${label}_suite_files=${present.join(',') || 'none'}`);
  let cases = 0;
  for (const name of present) {
    const text = readFileSync(join(dir, name), 'utf8');
    cases += (text.match(/^test\(/gm) ?? []).length;
  }
  say(`${label}_test_cases=${cases}`);
  counts[label] = cases;
  if (present.length === 0) fail.push(`${label}-suite-missing`);
  if (cases === 0) fail.push(`${label}-suite-empty`);
}
if (counts.platform < 30) fail.push('platform-too-few');
if (counts.kit < 5) fail.push('kit-too-few');

// The spec repository is not a suite here, but its validator is what the kit's
// conflict-check case calls, so its absence would silently weaken that case.
say(`spec_validator_present=${existsSync(join(spec, 'src/index.js')) ? 'yes' : 'no'}`);
if (!existsSync(join(spec, 'src/index.js'))) fail.push('spec-validator-missing');

// The cross-repository imports the suites depend on resolve from here, or the
// suites would skip and the run would look green without testing anything.
for (const target of [join(kit, 'src/index.js'), join(spec, 'src/index.js'),
  join(platform, 'packages/analyzer/src/index.js'),
  join(platform, 'packages/repair/src/repair-approval.js'),
  join(platform, 'packages/lifecycle-bootstrap/src/patch-merge.js')]) {
  say(`import_target ${target.replace(platform, '<platform>')}=${existsSync(target) ? 'yes' : 'no'}`);
  if (!existsSync(target)) fail.push(`missing:${target}`);
}

// The peer packages a scaffolded plugin imports: present means the Layer 1 case
// executes for real; absent means that one case skips, which must be visible.
const dshRoot = process.env.DSH_INSTALL_ROOT;
const toolsPresent = dshRoot !== undefined && existsSync(join(dshRoot, '@deepseek-ai/dsh-tools/package.json'));
say(`dsh_install_root=${dshRoot ?? 'unset'}`);
say(`dsh_tools_present=${toolsPresent ? 'yes' : 'no'}`);
say(`layer1_execution=${toolsPresent ? 'will-run' : 'will-skip'}`);

say(`static_contract=${fail.length === 0 ? 'pass' : 'fail'}`);
say(`static_contract_failures=${fail.join(',') || 'none'}`);
process.exit(fail.length === 0 ? 0 : 1);
CONTRACT
  then br_write_failure static-contract-write; return 73; fi
  capture "$RUN/static-contract.log" "$RUN/static-contract.err" \
    /usr/bin/env -i PATH="$BR_IN_PATH" HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    EXPECT_PLATFORM="$REPO" EXPECT_KIT="$KIT" EXPECT_SPEC="$SPEC" \
    DSH_INSTALL_ROOT="${DSH_INSTALL_ROOT:-/www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules}" \
    "$NODE" "$RUN/static-contract.mjs"; static_rc=$?
  br_record "$RUN/static-contract.rc" 'static_contract_rc=%s\n' "$static_rc" || :
  cat "$RUN/static-contract.log" || br_write_failure static-log-relay
  br_evidence_gate || return 73
  if [ "$static_rc" -ne 0 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=fail\n' || :
    return 71
  fi
  br_record "$RUN/static-verdict.txt" 'acc_static_contract=pass\n' || :

  # The three suites, in order, each in its own sandbox. A failing suite does not
  # stop the next one: the record should show all three verdicts, not the first.
  run_tap_suite platform "$REPO" 'tests/integration/*.test.mjs'; platform_rc=$?
  run_tap_suite kit "$KIT" 'tests/integration/*.test.js'; kit_rc=$?

  [ "$platform_rc" -eq 0 ] || verdict=fail
  [ "$kit_rc" -eq 0 ] || verdict=fail
  br_record "$RUN/integration-verdict.txt" \
    'platform_rc=%s\nkit_rc=%s\nverdict=%s\n' \
    "$platform_rc" "$kit_rc" "$verdict" || :
  br_evidence_gate || return 73
  [ "$verdict" = pass ] || return 72
  return 0
}
integration_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
