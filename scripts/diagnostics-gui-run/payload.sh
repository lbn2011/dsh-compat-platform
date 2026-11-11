#!/bin/bash
# In-envelope payload for the read-only diagnostics GUI (host route) batch.
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1, core
# commit c8123de). Awaiting Lead bounded verification. These bytes have not been
# executed, syntax-qualified or sourced.
#
# What the canonical envelope obviates: this file used to prove its own cgroup
# membership receipt, knob readback, one-shot memory gate, resident-peak readback,
# evidence-write counter and terminal-state vocabulary. All of that is the core's
# now. What remains is the workload:
#   A. one real envelope produced by the `dsh-compat-diagnose` CLI,
#   B. the host carrier booted with the new read-only GUI plugin, then probed,
#   C. a second carrier whose configured envelope is missing, probed for the
#      refusal path,
#   D. the GUI package's own test file.
# Each step's bytes stay in the run directory. The host alone owns unit.log.
#
# WHAT IT CAN ESTABLISH: that on these bytes, under these limits, this carrier
# served this page and this envelope at this URL with these statuses, that a
# foreign Host and a wrong method were refused, and that the package's own tests
# pass. Every response is captured with its sha256, so the answer is checkable
# rather than asserted.
#
# WHAT IT CANNOT ESTABLISH: that a browser rendered anything (no browser binary
# exists on this machine and none is installed here), that any plugin loads or
# activates, that any host observed the evidence documents, or that named sources
# correlate. `certification` stays false throughout.
#
# TWO DELIBERATE DEVIATIONS from the CLI-case discipline, both about the sandbox,
# both preserved verbatim from the pre-migration payload:
#   1. The carrier and probe steps do NOT pass `--unshare-net`. A fresh network
#      namespace has its loopback interface DOWN, so a loopback listener would be
#      unreachable and the probe would measure the sandbox rather than the page.
#   2. The carrier step binds ONLY the run's own carrier directory writable on top
#      of `--ro-bind / /`, because the child must write its readiness file and the
#      probe must write its report. Everything else stays read-only.
#
# Payload exit codes: 0 green; 70 envelope/argument/launch-context refusal;
# 71 static contract or dependency precondition failed (no workload started);
# 72 an HTTP assertion or the CLI envelope step did not match; 73 an evidence
# write failed; 74 the GUI test file did not report a clean TAP run.

set +e
set -uo pipefail
ROOT=/root/dsh-ecosystem-spec
REPO=$ROOT/projects/dsh-compat-platform
PKG=$REPO/packages/analyzer
HOSTPKG=$REPO/packages/host
SLICE=$REPO/scripts/diagnostics-gui-run
SPEC=$ROOT/projects/dsh-compat-spec
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
MODULES_ROOT=/www/server/nodejs/v24.21.0/lib/node_modules
CLI=$PKG/src/diagnose-cli.js
BOOT=$SLICE/boot.mjs
PROBE=$SLICE/probe.mjs
WORKDIR=$REPO
EXPECT_YAML_VERSION='2.9.1'
# Both files in the package's own glob: the page route suite and the browser
# half's contribution suite. A batch that ran only one of them would report a
# pass for bytes it never executed.
EXPECT_SELECTED_TESTS=(
  tests/client.test.js
  tests/gui.test.js
)
EXPECT_ENVELOPE_EXIT=1          # profile+static+runtime+admission, admission attention
EXPECT_FORBIDDEN_PORT=3080      # production GUI port: never this batch's port
EXPECT_MIN_TESTS=15
# Real sibling-checkout inputs the envelope step depends on. Absent → refuse (71).
SPEC_INPUTS=(
  "$SPEC/src/index.js"
  "$SPEC/src/admission-evidence.js"
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

# Top-level scalar read of a JSON document, by design: the ready file and the
# probe report are small flat objects, and anything else is a failure to report,
# not a value to guess.
json_field() { # file key
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    let value;
    try { value = JSON.parse(fs.readFileSync(file, "utf8"))[key]; } catch { process.stdout.write(""); process.exit(1); }
    if (value === undefined || value === null) { process.stdout.write(""); process.exit(1); }
    process.stdout.write(String(value));
  ' "$1" "$2"
}

# Conservative TAP normalisation, preserved from the pre-migration payload: the
# reporter that `node --test` picks is not this batch's choice, so BOTH summary
# shapes are read — the TAP summary line (`# tests 15`) and the spec reporter's
# info line (`ℹ tests 15`). The info form is rewritten to the TAP form so the
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

# The yaml snapshot is taken over the YAML directory itself and over symlinks: a
# symlinked tree makes the digest set meaningless, so it is refused rather than
# hashed.
snapshot_yaml() { # destination yaml_dir
  local out=$1
  local yaml_dir=$2
  ( cd "$yaml_dir" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum ) > "$out"
}

diagnostics_gui_payload() {
  source "$CORE/tap.sh" || return 70
  # Envelope first: nothing below may run outside the accounted cgroup.
  br_envelope_enter "$BR_UNIT" "$BR_RUN"
  local rc=$?
  [ "$rc" -eq 0 ] || return "$rc"

  [ -d "$PKG" ] || { say "payload: analyzer package missing: $PKG"; return 70; }
  [ -d "$HOSTPKG" ] || { say "payload: host package missing: $HOSTPKG"; return 70; }
  [ -f "$CLI" ] || { say "payload: diagnose CLI missing: $CLI"; return 70; }
  [ -f "$BOOT" ] || { say "payload: boot script missing: $BOOT"; return 70; }
  [ -f "$PROBE" ] || { say "payload: probe script missing: $PROBE"; return 70; }
  [ -d "$WORKDIR" ] || { say "payload: work directory missing: $WORKDIR"; return 70; }
  [ -x "$NODE" ] || { say "payload: node binary missing: $NODE"; return 70; }
  [ -d "$MODULES_ROOT" ] || { say "payload: modules root missing: $MODULES_ROOT"; return 70; }
  command -v bwrap >/dev/null 2>&1 || return 70
  command -v sha256sum >/dev/null 2>&1 || return 70

  # --- 3. syntax ---------------------------------------------------------
  # Both scripts are always parsed, so one failure never hides the other; the six
  # JavaScript files are checked with node. Parse-only: nothing is executed here.
  br_evidence_gate || return 73
  bash -n "$SLICE/run.sh"
  local acc_syntax_run_sh_rc=$?
  bash -n "$SLICE/payload.sh"
  local acc_syntax_payload_sh_rc=$?
  local syntax_files=(
    "$HOSTPKG/src/index.js"
    "$HOSTPKG/src/envelope.js"
    "$HOSTPKG/src/page.js"
    "$HOSTPKG/${EXPECT_SELECTED_TESTS[0]}"
    "$HOSTPKG/${EXPECT_SELECTED_TESTS[1]}"
    "$BOOT"
    "$PROBE"
  )
  local node_check_fail=''
  local f
  for f in "${syntax_files[@]}"; do
    "$NODE" --check "$f" 2>"$RUN/node-check-$(basename "$f").err" \
      || node_check_fail="$node_check_fail $f"
  done
  br_record "$RUN/syntax.txt" \
    'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\nacc_node_check_failures=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" "${node_check_fail:-none}" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] || { say "payload: run.sh does not parse (rc=$acc_syntax_run_sh_rc)"; return 71; }
  [ "$acc_syntax_payload_sh_rc" -eq 0 ] || { say "payload: payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"; return 71; }
  [ -z "$node_check_fail" ] || { say "payload: node --check failed for:$node_check_fail"; return 71; }

  # --- 4. static contract of the GUI package -----------------------------
  br_evidence_gate || return 73
  if ! cat > "$RUN/static-contract.mjs" <<'CONTRACT'
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const pkgDir = process.argv[2];
const failures = [];
const facts = [];
function check(id, ok, detail) {
  facts.push({ id, ok: ok === true, detail: detail ?? null });
  if (ok !== true) failures.push(`${id}${detail === undefined ? '' : `: ${detail}`}`);
}

const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
check('name', manifest.name === 'dsh-compat-diagnostics-ui', manifest.name);
check('private-absent', manifest.private === undefined, String(manifest.private));
check('type-module', manifest.type === 'module', manifest.type);
// The page must ship without a build step and without borrowing a build chain.
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  check(`no-${field}`, manifest[field] === undefined, JSON.stringify(manifest[field] ?? null));
}
check('test-script', typeof manifest.scripts?.test === 'string' && manifest.scripts.test.includes('node --test'),
  manifest.scripts?.test ?? null);

for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
  const rel = typeof target === 'string' ? target : target?.default;
  check(`export-${subpath}-file`, typeof rel === 'string' && existsSync(join(pkgDir, rel)), rel);
}
for (const required of ['.', './page', './envelope', './package.json']) {
  check(`export-${required}-declared`, Object.hasOwn(manifest.exports ?? {}, required), required);
}

const index = await import(pathToFileURL(join(pkgDir, 'src/index.js')).href);
check('export-apply', typeof index.apply === 'function', typeof index.apply);
check('export-name', typeof index.name === 'string' && index.name.length > 0, index.name);
check('inject-webserver', Array.isArray(index.inject) && index.inject.length === 1 && index.inject[0] === 'webServer',
  JSON.stringify(index.inject));
check('default-page-path', index.DEFAULT_PAGE_PATH === '/compat-diagnostics', index.DEFAULT_PAGE_PATH);
check('default-envelope-path', index.DEFAULT_ENVELOPE_PATH === '/compat-diagnostics/envelope',
  index.DEFAULT_ENVELOPE_PATH);

const envelope = await import(pathToFileURL(join(pkgDir, 'src/envelope.js')).href);
check('byte-ceiling', envelope.ENVELOPE_BYTE_CEILING === 1048576, String(envelope.ENVELOPE_BYTE_CEILING));
const reasons = Object.values(envelope.ENVELOPE_REASONS ?? {});
check('reason-vocabulary', reasons.length === 5 && reasons.every((r) => typeof r === 'string' && /^ENVELOPE_[A-Z_]+$/.test(r)),
  JSON.stringify(reasons));

const page = await import(pathToFileURL(join(pkgDir, 'src/page.js')).href);
const html = page.renderPage();
check('page-content-type', page.PAGE_CONTENT_TYPE === 'text/html; charset=utf-8', page.PAGE_CONTENT_TYPE);
// A screenshot must never show this page without its two literals.
check('page-html-literal-certification', html.includes('certification: false'), null);
check('page-html-literal-correlation', html.includes('correlation: not-established'), null);
check('page-html-envelope-url', html.includes('/compat-diagnostics/envelope'), null);
check('page-html-no-absolute-origin', !html.includes('http://') && !html.includes('https://'), null);
check('page-html-no-process-api', !/child_process|spawn\(|execFile/.test(html), null);

// The test file the batch runs must be the one the package's own glob selects.
const discovered = readdirSync(join(pkgDir, 'tests')).filter((name) => name.endsWith('.test.js')).sort();
check('test-discovery', JSON.stringify(discovered) === JSON.stringify(['client.test.js', 'gui.test.js']), JSON.stringify(discovered));

console.log(JSON.stringify({ verdict: failures.length === 0 ? 'pass' : 'fail', failures, facts }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
CONTRACT
  then
    br_write_failure static-contract-write
    return 73
  fi
  br_evidence_gate || return 73
  "$NODE" "$RUN/static-contract.mjs" "$HOSTPKG" > "$RUN/static-contract.json" 2> "$RUN/static-contract.err"
  local contract_rc=$?
  br_record "$RUN/static-contract.rc" 'static_contract_rc=%s\n' "$contract_rc" || :
  br_evidence_gate || return 73
  [ "$contract_rc" -eq 0 ] || { say "payload: static contract failed (rc=$contract_rc): see static-contract.json"; return 71; }

  # --- 5. dependency precondition ----------------------------------------
  br_evidence_gate || return 73
  if ! cat > "$RUN/deps.mjs" <<'DEPS'
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const [analyzerDir, modulesRoot] = process.argv.slice(2);
const require = createRequire(join(modulesRoot, 'deps-resolver.cjs'));
const facts = [];
const failures = [];

const yamlManifest = JSON.parse(readFileSync(join(analyzerDir, 'node_modules/yaml/package.json'), 'utf8'));
facts.push({ id: 'yaml-version', value: yamlManifest.version });
if (yamlManifest.version !== '2.9.1') failures.push(`yaml is ${yamlManifest.version}, expected 2.9.1`);

// The resolved entry may sit at any depth, so the manifest is found by walking up
// from it rather than by assuming a directory layout.
function manifestFor(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no package.json above ${entry}`);
}

for (const specifier of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-host-webserver']) {
  try {
    const entry = require.resolve(specifier);
    const manifest = manifestFor(entry);
    facts.push({ id: specifier, entry, version: manifest.version });
  } catch (error) {
    failures.push(`${specifier} does not resolve: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(JSON.stringify({ verdict: failures.length === 0 ? 'pass' : 'fail', failures, facts }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
DEPS
  then
    br_write_failure deps-write
    return 73
  fi
  br_evidence_gate || return 73
  "$NODE" "$RUN/deps.mjs" "$PKG" "$MODULES_ROOT" > "$RUN/deps.json" 2> "$RUN/deps.err"
  local deps_rc=$?
  br_record "$RUN/deps.rc" 'deps_rc=%s\n' "$deps_rc" || :
  br_evidence_gate || return 73
  [ "$deps_rc" -eq 0 ] || { say "payload: dependency precondition failed (rc=$deps_rc): see deps.json"; return 71; }

  # --- 6. sibling checkout precondition ----------------------------------
  local missing=''
  for f in "${SPEC_INPUTS[@]}"; do
    [ -f "$f" ] || missing="$missing $f"
  done
  br_record "$RUN/sibling-precondition.txt" 'spec_missing=%s\n' "${missing:-none}" || :
  br_evidence_gate || return 73
  [ -z "$missing" ] || { say "payload: sibling dsh-compat-spec input missing:$missing"; return 71; }

  # --- 7. YAML dependency observed, not modified -------------------------
  local yaml_dir=$PKG/node_modules/yaml
  if [ -L "$yaml_dir" ] || [ ! -d "$yaml_dir" ] \
     || [ -n "$(find "$yaml_dir" -type l -print -quit 2>/dev/null)" ]; then
    br_write_failure yaml-manifest-before.txt
    say 'payload: cannot snapshot the yaml dependency regular-file list; refusing to start the workload'
    return 73
  fi
  if ! snapshot_yaml "$RUN/yaml-manifest-before.txt" "$yaml_dir" \
     || [ ! -s "$RUN/yaml-manifest-before.txt" ]; then
    br_write_failure yaml-manifest-before.txt
    say 'payload: cannot snapshot the yaml dependency regular-file list; refusing to start the workload'
    return 73
  fi
  local yaml_before_count
  yaml_before_count=$(awk 'END { print NR }' "$RUN/yaml-manifest-before.txt") || yaml_before_count=0

  # --- 8. step A: produce ONE envelope -----------------------------------
  say 'payload: step A — producing the envelope with the CLI'
  br_evidence_gate || return 73
  br_record "$RUN/workload.txt" \
    'node=%s\ncli=%s\nworkdir=%s\nmodules_root=%s\nforbidden_port=%s\n' \
    "$NODE" "$CLI" "$WORKDIR" "$MODULES_ROOT" "$EXPECT_FORBIDDEN_PORT" || :
  br_evidence_gate || return 73

  local env_dir=$RUN/envelope-step
  if ! mkdir -p "$env_dir"; then
    br_write_failure envelope-step-dir
    return 73
  fi
  # The CLI writes the envelope to stdout: those bytes ARE the envelope, and the
  # byte-for-byte route check hashes exactly this file.
  local ENVELOPE_FILE=$env_dir/stdout.json
  local env_argv=(
    --profile examples/diagnose/profile.yml
    --static packages/analyzer/fixtures/clean.json
    --declaration-validator ../dsh-compat-spec/src/index.js
    --runtime examples/diagnose/runtime-evidence.json
    --admission examples/diagnose/admission-evidence.json
    --admission-validator ../dsh-compat-spec/src/admission-evidence.js
  )
  if ! { printf 'argv:'; printf ' %q' "$NODE" "$CLI" "${env_argv[@]}"; printf '\n'; } > "$env_dir/case.txt"; then
    br_write_failure envelope-case-meta
    return 73
  fi
  br_evidence_gate || return 73

  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$WORKDIR" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
       NODE_OPTIONS=--max-old-space-size=192 \
       "$NODE" "$CLI" "${env_argv[@]}" \
    > "$env_dir/stdout.json" 2> "$env_dir/stderr.txt"
  local envelope_rc=$?
  br_record "$env_dir/exit.txt" '%s\n' "$envelope_rc" || :
  if ! printf 'actual_exit=%s\nexpected_exit=%s\n' "$envelope_rc" "$EXPECT_ENVELOPE_EXIT" >> "$env_dir/case.txt"; then
    br_write_failure envelope-case-meta
    return 73
  fi
  local envelope_first
  envelope_first=$(head -c 1 "$env_dir/stdout.json" 2>/dev/null)
  say "payload: envelope step exit=$envelope_rc expected=$EXPECT_ENVELOPE_EXIT"

  local envelope_verdict=fail
  if [ "$envelope_rc" -eq "$EXPECT_ENVELOPE_EXIT" ] && [ "$envelope_first" = '{' ]; then
    envelope_verdict=pass
  fi
  br_record "$env_dir/summary.txt" \
    'envelope_verdict=%s\nenvelope_exit=%s\nexpected_exit=%s\nenvelope_bytes=%s\n' \
    "$envelope_verdict" "$envelope_rc" "$EXPECT_ENVELOPE_EXIT" \
    "$(stat -c %s "$ENVELOPE_FILE" 2>/dev/null || printf 'unavailable')" || :

  # --- 9. steps B and C: carrier boot and probes -------------------------
  # Start the composition, wait for its readiness file, then probe it. Every
  # captured byte stays in the run directory.
  local CARRIER_PID=''
  start_carrier() { # dir envelope-path
    local dir=$1
    local envelope=$2
    if ! mkdir -p "$dir"; then
      br_write_failure "carrier-dir-$(basename "$dir")"
      return 1
    fi
    if ! printf 'envelope=%s\nhost=127.0.0.1\nport=0\nmodules_root=%s\n' \
        "$envelope" "$MODULES_ROOT" > "$dir/carrier.txt"; then
      br_write_failure "carrier-meta-$(basename "$dir")"
    fi
    bwrap --ro-bind / / --bind "$dir" "$dir" --dev /dev --proc /proc --tmpfs /tmp \
      --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
      --chdir "$WORKDIR" \
      -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
         NODE_OPTIONS=--max-old-space-size=192 \
         "$NODE" "$BOOT" --modules-root "$MODULES_ROOT" --envelope "$envelope" \
         --ready-file "$dir/ready.json" \
      > "$dir/server-stdout.txt" 2> "$dir/server-stderr.txt" &
    CARRIER_PID=$!
  }

  wait_carrier_ready() { # dir
    local dir=$1
    local i=0
    while [ "$i" -lt 200 ]; do
      [ -s "$dir/ready.json" ] && return 0
      kill -0 "$CARRIER_PID" 2>/dev/null || return 1
      sleep 0.1
      i=$((i + 1))
    done
    return 1
  }

  stop_carrier() { # dir
    local dir=$1
    local carrier_rc=not-run
    local i=0
    kill -TERM "$CARRIER_PID" 2>/dev/null
    while [ "$i" -lt 100 ]; do
      kill -0 "$CARRIER_PID" 2>/dev/null || break
      sleep 0.1
      i=$((i + 1))
    done
    if kill -0 "$CARRIER_PID" 2>/dev/null; then
      if ! printf 'carrier_survived_sigterm=yes\n' >> "$dir/carrier.txt"; then
        br_write_failure carrier-kill-note
      fi
      kill -KILL "$CARRIER_PID" 2>/dev/null
    fi
    wait "$CARRIER_PID" 2>/dev/null
    carrier_rc=$?
    if ! printf 'carrier_exit=%s\ncarrier_pid=%s\n' "$carrier_rc" "$CARRIER_PID" >> "$dir/carrier.txt"; then
      br_write_failure "carrier-exit-$(basename "$dir")"
    fi
    return 0
  }

  local gui_verdict=fail
  local refusal_verdict=fail
  local origin=''
  local origin_port=''

  if [ "$envelope_verdict" != pass ]; then
    say 'payload: the envelope step did not produce a usable envelope; skipping the carrier probes'
  else
    br_evidence_gate || return 73

    # ---- step B: happy path
    say 'payload: step B — booting the carrier over the produced envelope'
    local gui_dir=$RUN/gui-ok
    start_carrier "$gui_dir" "$ENVELOPE_FILE"
    if wait_carrier_ready "$gui_dir"; then
      origin=$(json_field "$gui_dir/ready.json" origin)
      origin_port=$(json_field "$gui_dir/ready.json" port)
      if ! printf 'origin=%s\norigin_port=%s\n' "${origin:-<none>}" "${origin_port:-<none>}" >> "$gui_dir/carrier.txt"; then
        br_write_failure carrier-origin
      fi
      bwrap --ro-bind / / --bind "$gui_dir" "$gui_dir" --dev /dev --proc /proc --tmpfs /tmp \
        --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
        --chdir "$WORKDIR" \
        -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
           "$NODE" "$PROBE" --origin "$origin" --envelope-file "$ENVELOPE_FILE" \
           --out "$gui_dir/probe.json" \
        > "$gui_dir/probe-stdout.txt" 2> "$gui_dir/probe-stderr.txt"
      local probe_rc=$?
      br_record "$gui_dir/probe.rc" 'probe_rc=%s\n' "$probe_rc" || :
      if [ "$probe_rc" -eq 0 ] && [ "$(json_field "$gui_dir/probe.json" verdict 2>/dev/null)" = pass ]; then
        # The production GUI port must never be the port this batch used.
        if [ -n "$origin_port" ] && [ "$origin_port" != "$EXPECT_FORBIDDEN_PORT" ]; then
          gui_verdict=pass
        fi
      fi
    else
      if ! printf 'ready=missing\n' >> "$gui_dir/carrier.txt"; then
        br_write_failure carrier-ready-missing
      fi
      say 'payload: the carrier never wrote its readiness file'
    fi
    stop_carrier "$gui_dir"
    say "payload: carrier(ok) verdict=$gui_verdict origin=${origin:-<none>}"

    # ---- step C: refusal path
    say 'payload: step C — booting a carrier whose envelope is missing'
    local ref_dir=$RUN/gui-refusal
    if ! mkdir -p "$ref_dir"; then
      br_write_failure refusal-dir
    fi
    start_carrier "$ref_dir" "$ref_dir/absent-envelope.json"
    if wait_carrier_ready "$ref_dir"; then
      local ref_origin
      ref_origin=$(json_field "$ref_dir/ready.json" origin)
      if ! printf 'origin=%s\n' "${ref_origin:-<none>}" >> "$ref_dir/carrier.txt"; then
        br_write_failure refusal-origin
      fi
      bwrap --ro-bind / / --bind "$ref_dir" "$ref_dir" --dev /dev --proc /proc --tmpfs /tmp \
        --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
        --chdir "$WORKDIR" \
        -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
           "$NODE" "$PROBE" --origin "$ref_origin" --expect-refusal \
           --out "$ref_dir/probe.json" \
        > "$ref_dir/probe-stdout.txt" 2> "$ref_dir/probe-stderr.txt"
      local ref_probe_rc=$?
      br_record "$ref_dir/probe.rc" 'probe_rc=%s\n' "$ref_probe_rc" || :
      if [ "$ref_probe_rc" -eq 0 ] && [ "$(json_field "$ref_dir/probe.json" verdict 2>/dev/null)" = pass ]; then
        refusal_verdict=pass
      fi
    else
      if ! printf 'ready=missing\n' >> "$ref_dir/carrier.txt"; then
        br_write_failure refusal-ready-missing
      fi
      say 'payload: the refusal carrier never wrote its readiness file'
    fi
    stop_carrier "$ref_dir"
    say "payload: carrier(refusal) verdict=$refusal_verdict"
  fi

  # --- 10. selected test file -------------------------------------------
  local test_verdict=not_run
  br_evidence_gate || return 73
  local test_dir=$RUN/test-file
  if mkdir -p "$test_dir"; then
    br_evidence_gate || return 73
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
      --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
      --chdir "$HOSTPKG" \
      -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
         NODE_OPTIONS=--max-old-space-size=192 \
         "$NODE" --test --test-concurrency=1 "${EXPECT_SELECTED_TESTS[@]}" \
      > "$test_dir/stdout.tap" 2> "$test_dir/stderr.txt"
    local test_rc=$?
    br_record "$test_dir/exit.txt" '%s\n' "$test_rc" || :
    if ! normalize_tap "$test_dir/stdout.tap" "$test_dir/stdout.tap.normalized"; then
      br_write_failure test-file-tap-normalize
      return 73
    fi
    local tap_rc=0
    br_tap_check "$test_dir/stdout.tap.normalized" "$test_rc"
    tap_rc=$?
    local tap_tests='' tap_pass='' tap_fail=''
    tap_tests=$(br_tap_value "$test_dir/stdout.tap.normalized" tests) || tap_tests=''
    tap_pass=$(br_tap_value "$test_dir/stdout.tap.normalized" pass) || tap_pass=''
    tap_fail=$(br_tap_value "$test_dir/stdout.tap.normalized" fail) || tap_fail=''
    br_record "$test_dir/tap-verdict.txt" 'tap_rc=%s\n' "$tap_rc" || :
    # Same six-field artifact as every other migrated runner, so a reviewer can
    # compare runs without knowing which payload produced them. br_tap_check has
    # already refused a missing/duplicate field, so read-back here cannot invent one.
    if ! : > "$test_dir/tap-fields.txt"; then
      br_write_failure test-file-tap-fields
    else
      for _k in tests pass fail cancelled skipped todo; do
        if _v=$(br_tap_value "$test_dir/stdout.tap.normalized" "$_k"); then
          printf '%s=%s\n' "$_k" "$_v" >> "$test_dir/tap-fields.txt" ||
            br_write_failure test-file-tap-fields
        else
          br_write_failure "test-file-tap-fields:$_k"
        fi
      done
    fi
    br_record "$test_dir/summary.txt" \
      'test_file=%s\ncwd=%s\nexit=%s\ntap_tests=%s\ntap_pass=%s\ntap_fail=%s\n' \
      "${EXPECT_SELECTED_TESTS[*]}" "$HOSTPKG" "$test_rc" \
      "${tap_tests:-unparsed}" "${tap_pass:-unparsed}" "${tap_fail:-unparsed}" || :
    test_verdict=fail
    if [ "$tap_rc" -eq 0 ] && br_uint "$tap_tests" && [ "$tap_tests" -ge "$EXPECT_MIN_TESTS" ]; then
      test_verdict=pass
    fi
    br_record "$test_dir/verdict.txt" 'test_verdict=%s\n' "$test_verdict" || :
    say "payload: test file exit=$test_rc tap=${tap_tests:-?}/${tap_pass:-?}/${tap_fail:-?}"
  else
    br_write_failure test-dir
    return 73
  fi
  br_evidence_gate || return 73

  # --- 11. yaml snapshot, second point ----------------------------------
  local yaml_snapshot=unreadable
  if snapshot_yaml "$RUN/yaml-manifest-after.txt" "$yaml_dir" \
     && [ -s "$RUN/yaml-manifest-after.txt" ]; then
    if diff -q "$RUN/yaml-manifest-before.txt" "$RUN/yaml-manifest-after.txt" \
        > "$RUN/yaml-manifest-diff.txt" 2>&1; then
      yaml_snapshot=identical
    else
      yaml_snapshot=changed
    fi
  else
    br_write_failure yaml-manifest-after.txt
    if ! : > "$RUN/yaml-manifest-diff.txt"; then
      br_write_failure yaml-manifest-diff.txt
    fi
  fi
  br_record "$RUN/yaml-manifest.txt" \
    'yaml_dir=%s\nyaml_manifest_files_before=%s\nyaml_manifest_snapshot_state=%s\n' \
    "$yaml_dir" "$yaml_before_count" "$yaml_snapshot" || :
  br_evidence_gate || return 73

  # --- 12. verdict -------------------------------------------------------
  # Order is contractual: envelope step, then carrier, then refusal, then the
  # test file, then the snapshot.
  local verdict=pass
  if [ "$envelope_verdict" != pass ]; then
    verdict="envelope_step_${envelope_verdict}"
  elif [ "$gui_verdict" != pass ]; then
    verdict="carrier_${gui_verdict}"
  elif [ "$refusal_verdict" != pass ]; then
    verdict="refusal_${refusal_verdict}"
  elif [ "$test_verdict" != pass ]; then
    verdict="test_file_${test_verdict}"
  elif [ "$yaml_snapshot" != identical ]; then
    verdict="yaml_snapshot_${yaml_snapshot}"
  fi
  br_record "$RUN/case-verdict.txt" \
    'acc_smoke_verdict=%s\nacc_envelope_verdict=%s\nacc_carrier_verdict=%s\nacc_refusal_verdict=%s\nacc_test_file_verdict=%s\nacc_yaml_snapshot=%s\nacc_origin=%s\n' \
    "$verdict" "$envelope_verdict" "$gui_verdict" "$refusal_verdict" \
    "$test_verdict" "$yaml_snapshot" "${origin:-<none>}" || :
  br_evidence_gate || return 73
  say "payload: verdict=$verdict envelope=$envelope_verdict carrier=$gui_verdict refusal=$refusal_verdict test=$test_verdict"
  case $verdict in
    pass) return 0 ;;
    # A red test file keeps its own exit code (74), as before the migration.
    test_file_*) return 74 ;;
    *) return 72 ;;
  esac
}

diagnostics_gui_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
