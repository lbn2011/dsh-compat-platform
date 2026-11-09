#!/bin/bash
# Source-only migration; awaiting Lead bounded verification. Host alone owns unit.log.
# Payload contract: exactly two arguments (unit, run). Envelope first, work after.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/config-check
SLICE=$REPO/scripts/config-check-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
NODE_PREFIX=/www/server/nodejs/v24.21.0
# The one acquired engine tree named by the install run (README.md documents it).
DEFAULT_ENGINE_ROOT=/data/dsh-ecosystem-test-artifacts/runs/20261109T184644Z-config-engine-install-1145262-32328/work/node_modules
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
# One CLI case. Only the engine tree, the package and this run directory are
# bound, all read-only, and the network is unshared. The caller's environment is
# replaced, so the engine root is stated explicitly inside the sandbox.
run_cli_case() { # case-name schema instance
  local name=$1 schema=$2 instance=$3 rc
  br_evidence_gate || return 73
  capture "$RUN/case-$name.stdout.json" "$RUN/case-$name.stderr.txt" \
    bwrap --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib \
    --symlink usr/lib64 /lib64 \
    --ro-bind "$NODE_PREFIX" "$NODE_PREFIX" --ro-bind "$ENGINE" "$ENGINE" \
    --ro-bind "$PKG" "$PKG" --ro-bind "$RUN" "$RUN" \
    --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
    NODE_OPTIONS="$BR_NODE_OPTIONS" CONFIG_CHECK_ENGINE_ROOT="$ENGINE" \
    "$NODE" "$PKG/src/config-check-cli.js" "$schema" "$instance"; rc=$?
  br_record "$RUN/case-$name.rc" 'case_rc=%s\n' "$rc" || return 73
  return "$rc"
}
check_case() { # mode case-name; 0 only when the summary matches the contract
  local mode=$1 name=$2 rc
  br_evidence_gate || return 73
  capture "$RUN/check-$name.log" "$RUN/check-$name.err" \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" "$RUN/check-case.mjs" "$mode" "$RUN/case-$name.stdout.json"; rc=$?
  br_record "$RUN/check-$name.rc" 'check_rc=%s\n' "$rc" || return 73
  cat "$RUN/check-$name.log" || br_write_failure "check-$name-relay"
  return "$rc"
}
config_check_payload() {
  local rc syntax_rc node_check_rc tap_rc tap_tests verdict engine_source
  local acc_syntax_run_sh_rc acc_syntax_payload_sh_rc node_check_bad
  local acc_node_check_cc acc_node_check_hj acc_node_check_cli acc_node_check_cc_test acc_node_check_hj_test
  local valid_check_rc invalid_check_rc notchecked_check_rc case_state=pass leak_state=clean
  local leak_config leak_credential f hit
  source "$CORE/tap.sh" || return 70
  # Envelope first: no workload and no syntax subprocess before it.
  br_envelope_enter "$BR_UNIT" "$BR_RUN"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  [ -d "$PKG" ] && [ -x "$NODE" ] || return 70
  command -v bwrap >/dev/null 2>&1 || return 70
  for f in "$PKG/src/config-check-cli.js" "$PKG/src/config-check.js" "$PKG/examples/valid.json" \
    "$PKG/examples/invalid.json" "$PKG/examples/contract.json"; do
    [ -f "$f" ] || return 70
  done
  # Engine root: the caller's environment first, else the recorded acquired tree.
  engine_source=env
  ENGINE=${CONFIG_CHECK_ENGINE_ROOT:-}
  if [ -z "$ENGINE" ]; then ENGINE=$DEFAULT_ENGINE_ROOT; engine_source=recorded-default; fi
  br_record "$RUN/engine-root.txt" 'engine_root=%s\nsource=%s\n' "$ENGINE" "$engine_source" || :
  br_evidence_gate || return 73
  br_path "$ENGINE" && [ -d "$ENGINE" ] || return 70
  [ -f "$ENGINE/@hyperjump/json-schema/draft-2020-12/index.js" ] || return 70
  capture "$RUN/syntax-run.log" "$RUN/syntax-run.err" /bin/bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
  br_record "$RUN/syntax-run.txt" 'acc_syntax_run_sh_rc=%s\n' "$acc_syntax_run_sh_rc" || :
  br_evidence_gate || return 73
  capture "$RUN/syntax-payload.log" "$RUN/syntax-payload.err" /bin/bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax-payload.txt" 'acc_syntax_payload_sh_rc=%s\n' "$acc_syntax_payload_sh_rc" || :
  node_check_bad=0
  acc_node_check_cc=skipped acc_node_check_hj=skipped acc_node_check_cli=skipped
  acc_node_check_cc_test=skipped acc_node_check_hj_test=skipped
  br_evidence_gate || return 73
  if [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ]; then
    capture "$RUN/node-check-config-check.log" "$RUN/node-check-config-check.err" \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
      "$NODE" --check "$PKG/src/config-check.js"; acc_node_check_cc=$?
    br_evidence_gate || return 73
    capture "$RUN/node-check-hyperjump-engine.log" "$RUN/node-check-hyperjump-engine.err" \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
      "$NODE" --check "$PKG/src/hyperjump-engine.js"; acc_node_check_hj=$?
    br_evidence_gate || return 73
    capture "$RUN/node-check-config-check-cli.log" "$RUN/node-check-config-check-cli.err" \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
      "$NODE" --check "$PKG/src/config-check-cli.js"; acc_node_check_cli=$?
    br_evidence_gate || return 73
    capture "$RUN/node-check-config-check-test.log" "$RUN/node-check-config-check-test.err" \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
      "$NODE" --check "$PKG/tests/config-check.test.js"; acc_node_check_cc_test=$?
    br_evidence_gate || return 73
    capture "$RUN/node-check-hyperjump-engine-test.log" "$RUN/node-check-hyperjump-engine-test.err" \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
      "$NODE" --check "$PKG/tests/hyperjump-engine.test.js"; acc_node_check_hj_test=$?
  fi
  for rc in "$acc_node_check_cc" "$acc_node_check_hj" "$acc_node_check_cli" \
    "$acc_node_check_cc_test" "$acc_node_check_hj_test"; do
    [ "$rc" = 0 ] || node_check_bad=1
  done
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\nacc_node_check_config_check_rc=%s\nacc_node_check_hyperjump_engine_rc=%s\nacc_node_check_cli_rc=%s\nacc_node_check_config_check_test_rc=%s\nacc_node_check_hyperjump_engine_test_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" "$acc_node_check_cc" "$acc_node_check_hj" \
    "$acc_node_check_cli" "$acc_node_check_cc_test" "$acc_node_check_hj_test" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ] || return 71
  [ "$node_check_bad" -eq 0 ] || return 71
  # ---- step a: unit suite, serial TAP, whole filesystem read-only ----
  if ! mkdir -m 700 -p -- "$RUN/unit"; then br_write_failure unit; return 73; fi
  br_record "$RUN/workload.txt" 'node=%s\nworkdir=%s\nunit_glob=%s\n' \
    "$NODE" "$PKG" 'tests/*.test.js' || :
  br_evidence_gate || return 73
  capture "$RUN/unit/tap.log" "$RUN/unit/tap.err" \
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp NODE_OPTIONS="$BR_NODE_OPTIONS" \
    "$NODE" --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.js'; rc=$?
  br_record "$RUN/unit/tap.rc" 'node_rc=%s\n' "$rc" || :
  cat "$RUN/unit/tap.log" || br_write_failure tap-relay
  br_evidence_gate || return 73
  # Normalisation is the core's strict singleton reader: duplicate, malformed or
  # missing fields are rejected there, before any field value is read back.
  br_tap_check "$RUN/unit/tap.log" "$rc"; tap_rc=$?
  br_record "$RUN/unit/tap-check.txt" 'tap_check_rc=%s\nnode_rc=%s\nminimum_tests=46\n' "$tap_rc" "$rc" || :
  for f in tests pass fail cancelled skipped todo; do
    hit=$(br_tap_value "$RUN/unit/tap.log" "$f") || hit='<invalid>'
    printf 'tap_field_%s=%s\n' "$f" "$hit" >> "$RUN/unit/tap-fields.txt" || br_write_failure unit/tap-fields.txt
  done
  tap_tests=$(br_tap_value "$RUN/unit/tap.log" tests) || tap_tests=0
  br_evidence_gate || return 73
  # The checker is written before any case runs, so no case depends on a control
  # file that does not exist yet.
  if ! cat > "$RUN/check-case.mjs" <<'CHECKER'
import { readFileSync } from 'node:fs';
const [mode, path] = process.argv.slice(2);
const say = (line) => process.stdout.write(`${line}\n`);
let doc;
try { doc = JSON.parse(readFileSync(path, 'utf8')); }
catch { process.stderr.write('case stdout is not readable JSON\n'); process.exit(1); }
const problems = [];
if (mode === 'valid') {
  say(`schema_status=${doc.schemaStatus}`);
  say(`valid=${doc.valid}`);
  if (doc.schemaStatus !== 'checked') problems.push(`schemaStatus=${doc.schemaStatus}`);
  if (doc.valid !== true) problems.push(`valid=${doc.valid}`);
} else if (mode === 'invalid') {
  const paths = Array.isArray(doc.findings) ? doc.findings.map((item) => item && item.path) : [];
  for (const value of paths) say(`finding_path=${value}`);
  say(`finding_count=${paths.length}`);
  const want = ['config.endpoint', 'config.mode', 'config.retries'];
  const got = [...new Set(paths)].sort();
  if (doc.schemaStatus !== 'checked' || doc.valid !== false) problems.push('not a checked invalid verdict');
  if (paths.length !== 3) problems.push(`findings=${paths.length}`);
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`paths=${JSON.stringify(got)}`);
} else if (mode === 'notchecked') {
  say(`schema_status=${doc.schemaStatus}`);
  say(`not_checked_reason=${doc.notCheckedReason}`);
  if (doc.schemaStatus !== 'not-checked') problems.push(`schemaStatus=${doc.schemaStatus}`);
  if (doc.notCheckedReason !== 'NOT_CHECKED_SCHEMA_LITERAL_HAS_IDENTIFIER') {
    problems.push(`notCheckedReason=${doc.notCheckedReason}`);
  }
} else { problems.push(`unknown mode: ${mode}`); }
if (problems.length > 0) { process.stderr.write(`case check failed: ${problems.join('; ')}\n`); process.exit(1); }
say('case_check=pass');
process.exit(0);
CHECKER
  then br_write_failure check-case.mjs; return 73; fi
  br_evidence_gate || return 73
  # ---- step b: three CLI cases against the acquired engine ----
  run_cli_case valid "$PKG/examples/contract.json" "$PKG/examples/valid.json"; rc=$?
  if [ "$rc" -ne 0 ]; then br_record "$RUN/case-valid.verdict" 'case=valid\nverdict=fail\n' || :; return 73; fi
  br_evidence_gate || return 73
  check_case valid valid; valid_check_rc=$?
  [ "$valid_check_rc" -eq 0 ] || return 73
  br_evidence_gate || return 73
  run_cli_case invalid "$PKG/examples/contract.json" "$PKG/examples/invalid.json"; rc=$?
  if [ "$rc" -ne 1 ]; then br_record "$RUN/case-invalid.verdict" 'case=invalid\nverdict=fail\n' || :; return 73; fi
  br_evidence_gate || return 73
  check_case invalid invalid; invalid_check_rc=$?
  [ "$invalid_check_rc" -eq 0 ] || return 73
  br_evidence_gate || return 73
  # Third case, generated here: a schema whose `const` literal carries an
  # identifier key, which the acquired engine would misread as a reference.
  if ! cat > "$RUN/case-notchecked.schema.json" <<'SCHEMA'
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "token": { "const": { "$anchor": "x" } } }
}
SCHEMA
  then br_write_failure case-notchecked.schema.json; return 73; fi
  if ! cat > "$RUN/case-notchecked.instance.json" <<'INSTANCE'
{ "token": "sk-live-SECRET" }
INSTANCE
  then br_write_failure case-notchecked.instance.json; return 73; fi
  br_evidence_gate || return 73
  run_cli_case notchecked "$RUN/case-notchecked.schema.json" "$RUN/case-notchecked.instance.json"; rc=$?
  if [ "$rc" -ne 2 ]; then br_record "$RUN/case-notchecked.verdict" 'case=notchecked\nverdict=fail\n' || :; return 73; fi
  br_evidence_gate || return 73
  check_case notchecked notchecked; notchecked_check_rc=$?
  [ "$notchecked_check_rc" -eq 0 ] || return 73
  br_record "$RUN/case-verdict.txt" 'acc_cases=%s\nvalid_check_rc=%s\ninvalid_check_rc=%s\nnotchecked_check_rc=%s\n' \
    "$case_state" "$valid_check_rc" "$invalid_check_rc" "$notchecked_check_rc" || :
  br_evidence_gate || return 73
  # ---- step c: leak assertion over every case's stdout ----
  leak_config=absent leak_credential=absent
  for f in "$RUN/case-valid.stdout.json" "$RUN/case-invalid.stdout.json" "$RUN/case-notchecked.stdout.json"; do
    [ -f "$f" ] || { leak_state=missing; continue; }
    if grep -F -q -- 'not a uri' "$f"; then leak_config=present; fi
    if grep -F -q -- 'sk-live-SECRET' "$f"; then leak_credential=present; fi
  done
  if [ "$leak_config" = present ] || [ "$leak_credential" = present ]; then leak_state=fail; fi
  br_record "$RUN/leak.txt" 'acc_config_value_in_report=%s\nacc_credential_in_report=%s\nleak_state=%s\n' \
    "$leak_config" "$leak_credential" "$leak_state" || :
  br_evidence_gate || return 73
  verdict=pass
  [ "$tap_rc" -eq 0 ] || verdict=tap_fail
  [ "$tap_tests" -ge 46 ] || verdict=tap_count
  [ "$case_state" = pass ] || verdict="case_$case_state"
  [ "$leak_state" = clean ] || verdict="leak_$leak_state"
  br_record "$RUN/verdict.txt" 'acc_unit_tap=%s\nacc_cases=%s\nacc_leak=%s\nverdict=%s\ntap_check_rc=%s\ntap_tests=%s\nminimum_tests=46\n' \
    "$tap_rc" "$case_state" "$leak_state" "$verdict" "$tap_rc" "$tap_tests" || :
  br_evidence_gate || return 73
  [ "$leak_state" = clean ] || return 73
  [ "$verdict" = pass ] || return 72
  return 0
}
config_check_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
