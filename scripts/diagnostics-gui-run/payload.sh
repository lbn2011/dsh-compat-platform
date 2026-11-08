#!/bin/bash
# In-envelope payload for the read-only diagnostics GUI (host route) batch.
#
# STATUS: PREPARED FOR REVIEW. Nothing in this file has been run at the time of
# writing.
#
# Minimal adaptation of `scripts/diagnose-real-wiring/payload.sh`: it keeps the
# same envelope self-check, the same single MemAvailable gate, the same two-point
# yaml dependency snapshot, the same evidence-write gates and the same "relay to
# stdout" discipline. What changes is the workload: instead of six CLI cases it
#   A. produces ONE real envelope with the `dsh-compat-diagnose` CLI,
#   B. boots the host carrier with the new read-only GUI plugin and probes it,
#   C. boots a second carrier whose configured envelope is missing and probes the
#      refusal path,
#   D. runs the GUI package's own test file,
# and records each step's bytes.
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
# TWO DELIBERATE DEVIATIONS from the CLI-case discipline, both about the sandbox:
#   1. The carrier step does NOT pass `--unshare-net`. A fresh network namespace
#      has its loopback interface DOWN, so a loopback listener would be
#      unreachable and the probe would measure the sandbox rather than the page.
#   2. The carrier step binds ONLY the run's own `gui/` directory writable on top
#      of `--ro-bind / /`, because the child must write its readiness file and
#      the probe must write its report. Everything else stays read-only.
#
# Exit codes: 0 green; 70 envelope refusal; 71 static contract or dependency
# precondition failed (no workload started); 72 an HTTP assertion or the CLI
# envelope step did not match its expected result; 73 an evidence write failed;
# 74 the GUI test file did not report a clean TAP run.

set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
ROOT=/root/dsh-ecosystem-spec
REPO=$ROOT/projects/dsh-compat-platform
PKG=$REPO/packages/analyzer
HOSTPKG=$REPO/packages/host
SLICE=$REPO/scripts/diagnostics-gui-run
SPEC=$ROOT/projects/dsh-compat-spec
NODE=/www/server/nodejs/v24.21.0/bin/node
MODULES_ROOT=/www/server/nodejs/v24.21.0/lib/node_modules

CLI=$PKG/src/diagnose-cli.js
BOOT=$SLICE/boot.mjs
PROBE=$SLICE/probe.mjs
WORKDIR=$REPO

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200
EXPECT_YAML_VERSION='2.9.1'
EXPECT_SELECTED_TEST='tests/gui.test.js'
EXPECT_ENVELOPE_EXIT=1          # profile+static+runtime+admission, admission attention
EXPECT_FORBIDDEN_PORT=3080      # production GUI port: never this batch's port

# Real sibling-checkout inputs the envelope step depends on. Absent → refuse (71).
SPEC_INPUTS=(
  "$SPEC/src/index.js"
  "$SPEC/src/admission-evidence.js"
)

write_fail=0
addwf() { write_fail=$((write_fail + 1)); printf 'payload: evidence write failed: %s\n' "$1" >&2; }
die() { printf 'payload: %s\n' "$2" >&2; exit "$1"; }
wr() { cat > "$1" || return 1; [ -s "$1" ] || return 1; }
say() { printf '%s\n' "$*"; }
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }
read1() {
  [ -r "$1" ] || { printf ''; return 1; }
  head -n 1 "$1" 2>/dev/null
}
knob1() {
  local path=$1 n v
  [ -r "$path" ] || { printf '<ambiguous-or-missing:unreadable>'; return; }
  n=$(awk 'END { print NR }' "$path" 2>/dev/null)
  case "$n" in ''|*[!0-9]*) printf '<ambiguous-or-missing:unreadable>'; return ;; esac
  [ "$n" -eq 1 ] || { printf '<ambiguous-or-missing:%s>' "$n"; return; }
  v=$(sed -n '1p' "$path" 2>/dev/null)
  [ -n "$v" ] || { printf '<ambiguous-or-missing:empty>'; return; }
  printf '%s' "$v"
}
json_field() { # file key  (top-level string/number only, by design)
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    let value;
    try { value = JSON.parse(fs.readFileSync(file, "utf8"))[key]; } catch { process.stdout.write(""); process.exit(1); }
    if (value === undefined || value === null) { process.stdout.write(""); process.exit(1); }
    process.stdout.write(String(value));
  ' "$1" "$2"
}

say "payload: unit=$UNIT run=$RUN"

# ---------------------------------------------------------------- 0. arguments
case "$UNIT" in
  *.service) ;;
  *) die 70 "unit name does not end in .service: '${UNIT}'" ;;
esac
[ -n "$RUN" ] || die 70 "run directory argument missing"
[ -d "$RUN" ] || die 70 "run directory does not exist: $RUN"
[ -w "$RUN" ] || die 70 "run directory is not writable: $RUN"
[ -d "$PKG" ] || die 70 "analyzer package missing: $PKG"
[ -d "$HOSTPKG" ] || die 70 "host package missing: $HOSTPKG"
[ -f "$CLI" ] || die 70 "diagnose CLI missing: $CLI"
[ -f "$BOOT" ] || die 70 "boot script missing: $BOOT"
[ -f "$PROBE" ] || die 70 "probe script missing: $PROBE"
[ -d "$WORKDIR" ] || die 70 "work directory missing: $WORKDIR"
[ -x "$NODE" ] || die 70 "node binary missing: $NODE"
[ -d "$MODULES_ROOT" ] || die 70 "modules root missing: $MODULES_ROOT"

# ---------------------------------------------------------------- 1. envelope readback
CGROUP="/sys/fs/cgroup/system.slice/$UNIT"
{
  printf 'unit=%s\n' "$UNIT"
  printf 'cgroup=%s\n' "$CGROUP"
  printf 'cgroup_exists=%s\n' "$([ -d "$CGROUP" ] && echo yes || echo no)"
  printf 'memory.max=%s\n' "$(knob1 "$CGROUP/memory.max")"
  printf 'memory.swap.max=%s\n' "$(knob1 "$CGROUP/memory.swap.max")"
  printf 'pids.max=%s\n' "$(knob1 "$CGROUP/pids.max")"
  printf 'cpu.max=%s\n' "$(knob1 "$CGROUP/cpu.max")"
} > "$RUN/envelope-cgroup.txt" || addwf envelope-cgroup.txt

show_raw=$(timeout 20 systemctl show "$UNIT" -p Type -p CPUQuotaPerSecUSec -p MemoryMax -p TasksMax 2>&1)
show_rc=$?
printf 'systemctl_show_rc=%s\n%s\n' "$show_rc" "$show_raw" > "$RUN/envelope-systemctl.txt" \
  || addwf envelope-systemctl.txt
[ "$show_rc" -eq 0 ] || die 70 "systemctl show failed (rc=$show_rc)"

# RuntimeMaxUSec via busctl, two steps, whole-reply match only.
getunit_raw=$(timeout 20 busctl --system call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
  org.freedesktop.systemd1.Manager GetUnit s "$UNIT" 2>&1)
unit_path_rc=$?
getunit_nonempty_lines=$(printf '%s\n' "$getunit_raw" | grep -c '[^[:space:]]')
getunit_path_lines=$(printf '%s\n' "$getunit_raw" \
  | grep -cE '^o "/org/freedesktop/systemd1/unit/[A-Za-z0-9_/]*"$')
unit_paths_seen=$(printf '%s\n' "$getunit_raw" | sed -n 's/^o "\(.*\)"$/\1/p' | wc -l)
unit_path=
unit_path_ok=no
if [ "$unit_path_rc" -eq 0 ] \
   && [ "$getunit_nonempty_lines" -eq 1 ] \
   && [ "$getunit_path_lines" -eq 1 ] \
   && [ "$unit_paths_seen" -eq 1 ]; then
  unit_path=$(printf '%s\n' "$getunit_raw" | sed -n 's/^o "\(.*\)"$/\1/p')
  unit_path_ok=yes
fi
printf 'unit_path=%s\nunit_path_rc=%s\nunit_path_ok=%s\ngetunit_nonempty_lines=%s\n' \
  "${unit_path:-<none>}" "$unit_path_rc" "$unit_path_ok" "$getunit_nonempty_lines" \
  > "$RUN/envelope-busctl-path.txt" || addwf envelope-busctl-path.txt

bus_raw=''
bus_rc=1
if [ "$unit_path_ok" = yes ]; then
  bus_raw=$(timeout 20 busctl --system get-property org.freedesktop.systemd1 "$unit_path" \
    org.freedesktop.systemd1.Service RuntimeMaxUSec 2>&1)
  bus_rc=$?
fi
printf 'busctl_rc=%s\nbusctl_bus_raw<<%s\n' "$bus_rc" "$bus_raw" > "$RUN/envelope-busctl.txt" \
  || addwf envelope-busctl.txt

acc_runtime_usec=
acc_runtime_usec_source=unavailable
if [ "$bus_rc" -eq 0 ]; then
  case "$bus_raw" in
    't '*)
      val=${bus_raw#t }
      case "$val" in
        ''|*[!0-9]*) : ;;
        *) acc_runtime_usec=$val; acc_runtime_usec_source=busctl ;;
      esac
      ;;
  esac
fi

memory_max=$(knob1 "$CGROUP/memory.max")
swap_max=$(knob1 "$CGROUP/memory.swap.max")
pids_max=$(knob1 "$CGROUP/pids.max")
cpu_max=$(knob1 "$CGROUP/cpu.max")
unit_type=$(printf '%s\n' "$show_raw" | sed -n 's/^Type=//p')
unit_type_replies=$(printf '%s\n' "$show_raw" | sed -n 's/^Type=//p' | wc -l)
[ "$unit_type_replies" -eq 1 ] || unit_type="<ambiguous-or-missing:$unit_type_replies>"

{
  printf 'memory_max=%s\n' "$memory_max"
  printf 'swap_max=%s\n' "$swap_max"
  printf 'pids_max=%s\n' "$pids_max"
  printf 'cpu_max=%s\n' "$cpu_max"
  printf 'unit_type=%s\n' "$unit_type"
  printf 'acc_runtime_usec=%s\n' "$acc_runtime_usec"
  printf 'acc_runtime_usec_source=%s\n' "$acc_runtime_usec_source"
} > "$RUN/envelope-effective.txt" || addwf envelope-effective.txt

# ---------------------------------------------------------------- 2. envelope must match
mismatch=''
[ "$memory_max" = "$EXPECT_MEM_BYTES" ] || mismatch="$mismatch memory.max=$memory_max"
[ "$swap_max" = "$EXPECT_SWAP_BYTES" ] || mismatch="$mismatch memory.swap.max=$swap_max"
[ "$pids_max" = "$EXPECT_PIDS" ] || mismatch="$mismatch pids.max=$pids_max"
[ "$cpu_max" = "$EXPECT_CPU_MAX" ] || mismatch="$mismatch cpu.max=$cpu_max"
[ "$unit_type" = exec ] || mismatch="$mismatch Type=$unit_type"
[ "$acc_runtime_usec" = "$EXPECT_RUNTIME_USEC" ] || mismatch="$mismatch RuntimeMaxUSec=${acc_runtime_usec:-<unreadable>}"
printf 'envelope_mismatch=%s\n' "${mismatch:-none}" > "$RUN/envelope-verdict.txt" || addwf envelope-verdict.txt
[ -z "$mismatch" ] || die 70 "envelope does not match the approved limits:$mismatch"

# ---------------------------------------------------------------- 3. memory gate, once
meminfo_rc=0
mem_available=$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo 2>/dev/null) || meminfo_rc=$?
is_num "$mem_available" || meminfo_rc=1
printf 'mem_available_kib=%s\nthreshold_kib=%s\nmeminfo_rc=%s\n' \
  "$mem_available" "$EXPECT_MEMAVAILABLE_KIB" "$meminfo_rc" > "$RUN/memory-gate.txt" \
  || addwf memory-gate.txt
[ "$meminfo_rc" -eq 0 ] || die 70 "MemAvailable could not be read"
[ "$mem_available" -ge "$EXPECT_MEMAVAILABLE_KIB" ] || die 70 "MemAvailable ${mem_available} KiB is below ${EXPECT_MEMAVAILABLE_KIB} KiB"

evidence_stop() {
  printf 'acc_evidence_write_failures=%s\nacc_stop_at=%s\nacc_workload_started=no\n' \
    "$write_fail" "$1" > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say "payload: $write_fail evidence write failure(s) at $1; stopping (73) before proceeding"
  exit 73
}

# ---------------------------------------------------------------- 4. syntax
if [ "$write_fail" -ne 0 ]; then evidence_stop before-syntax; fi
bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
syntax_files=(
  "$HOSTPKG/src/index.js"
  "$HOSTPKG/src/envelope.js"
  "$HOSTPKG/src/page.js"
  "$HOSTPKG/$EXPECT_SELECTED_TEST"
  "$BOOT"
  "$PROBE"
)
node_check_fail=''
for f in "${syntax_files[@]}"; do
  "$NODE" --check "$f" 2>"$RUN/node-check-$(basename "$f").err" || node_check_fail="$node_check_fail $f"
done
printf 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\nacc_node_check_failures=%s\n' \
  "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" "${node_check_fail:-none}" > "$RUN/syntax.txt" \
  || addwf syntax.txt
[ "$acc_syntax_run_sh_rc" -eq 0 ] || die 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"
[ "$acc_syntax_payload_sh_rc" -eq 0 ] || die 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"
[ -z "$node_check_fail" ] || die 71 "node --check failed for:$node_check_fail"

# ---------------------------------------------------------------- 5. static contract
cat > "$RUN/static-contract.mjs" <<'CONTRACT' || { addwf static-contract-write; die 73 "cannot write static-contract.mjs"; }
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
check('private', manifest.private === true, String(manifest.private));
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
check('test-discovery', JSON.stringify(discovered) === JSON.stringify(['gui.test.js']), JSON.stringify(discovered));

console.log(JSON.stringify({ verdict: failures.length === 0 ? 'pass' : 'fail', failures, facts }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
CONTRACT

if [ "$write_fail" -ne 0 ]; then evidence_stop before-static-contract; fi
"$NODE" "$RUN/static-contract.mjs" "$HOSTPKG" > "$RUN/static-contract.json" 2> "$RUN/static-contract.err"
contract_rc=$?
printf 'static_contract_rc=%s\n' "$contract_rc" > "$RUN/static-contract.rc" || addwf static-contract.rc
[ "$contract_rc" -eq 0 ] || die 71 "static contract failed (rc=$contract_rc): see static-contract.json"

# ---------------------------------------------------------------- 5c. dependency precondition
cat > "$RUN/deps.mjs" <<'DEPS' || { addwf deps-write; die 73 "cannot write deps.mjs"; }
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
"$NODE" "$RUN/deps.mjs" "$PKG" "$MODULES_ROOT" > "$RUN/deps.json" 2> "$RUN/deps.err"
deps_rc=$?
printf 'deps_rc=%s\n' "$deps_rc" > "$RUN/deps.rc" || addwf deps.rc
[ "$deps_rc" -eq 0 ] || die 71 "dependency precondition failed (rc=$deps_rc): see deps.json"

missing=''
for f in "${SPEC_INPUTS[@]}"; do [ -f "$f" ] || missing="$missing $f"; done
[ -z "$missing" ] || die 71 "sibling dsh-compat-spec input missing:${missing}"

# ---------------------------------------------------------------- 5b. evidence gate
if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s) before the workload; refusing to start it"
  exit 73
fi

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
yaml_before_count=0
if yaml_manifest > "$RUN/yaml-manifest-before.txt" 2>/dev/null && [ -s "$RUN/yaml-manifest-before.txt" ]; then
  yaml_before_count=$(awk 'END { print NR }' "$RUN/yaml-manifest-before.txt")
else
  addwf yaml-manifest-before.txt
  say 'payload: cannot snapshot the yaml dependency regular-file list; refusing to start the workload'
  exit 73
fi

# ---------------------------------------------------------------- 6a. produce ONE envelope
say 'payload: step A — producing the envelope with the CLI'
{
  printf 'node=%s\n' "$NODE"
  printf 'cli=%s\n' "$CLI"
  printf 'workdir=%s\n' "$WORKDIR"
  printf 'modules_root=%s\n' "$MODULES_ROOT"
  printf 'forbidden_port=%s\n' "$EXPECT_FORBIDDEN_PORT"
} > "$RUN/workload.txt" || addwf workload.txt
if [ "$write_fail" -ne 0 ]; then
  say 'payload: evidence write failed before the workload; not starting it'
  exit 73
fi

env_dir="$RUN/envelope-step"
mkdir -p "$env_dir" || { addwf envelope-step-dir; exit 73; }
# The CLI writes the envelope to stdout: those bytes ARE the envelope, and the
# byte-for-byte route check hashes exactly this file.
ENVELOPE_FILE="$env_dir/stdout.json"
env_argv=(
  --profile examples/diagnose/profile.yml
  --static packages/analyzer/fixtures/clean.json
  --declaration-validator ../dsh-compat-spec/src/index.js
  --runtime examples/diagnose/runtime-evidence.json
  --admission examples/diagnose/admission-evidence.json
  --admission-validator ../dsh-compat-spec/src/admission-evidence.js
)
printf 'argv:' > "$env_dir/case.txt" || addwf envelope-case-meta
printf ' %q' "$NODE" "$CLI" "${env_argv[@]}" >> "$env_dir/case.txt" 2>/dev/null || addwf envelope-case-meta
printf '\n' >> "$env_dir/case.txt" 2>/dev/null || addwf envelope-case-meta

bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$WORKDIR" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     "$NODE" "$CLI" "${env_argv[@]}" \
  > "$env_dir/stdout.json" 2> "$env_dir/stderr.txt"
envelope_rc=$?
printf '%s\n' "$envelope_rc" > "$env_dir/exit.txt" || addwf envelope-exit
printf 'actual_exit=%s\nexpected_exit=%s\n' "$envelope_rc" "$EXPECT_ENVELOPE_EXIT" >> "$env_dir/case.txt" \
  2>/dev/null || addwf envelope-case-meta
envelope_first=$(head -c 1 "$env_dir/stdout.json" 2>/dev/null)
say "payload: envelope step exit=$envelope_rc expected=$EXPECT_ENVELOPE_EXIT"

envelope_verdict=fail
if [ "$envelope_rc" -eq "$EXPECT_ENVELOPE_EXIT" ] && [ "$envelope_first" = '{' ]; then
  envelope_verdict=pass
fi
printf 'envelope_verdict=%s\nenvelope_exit=%s\nexpected_exit=%s\nenvelope_bytes=%s\n' \
  "$envelope_verdict" "$envelope_rc" "$EXPECT_ENVELOPE_EXIT" \
  "$(stat -c %s "$ENVELOPE_FILE" 2>/dev/null || printf 'unavailable')" > "$env_dir/summary.txt" \
  || addwf envelope-summary

# ---------------------------------------------------------------- 6b/6c. carrier probes
# Start the composition, wait for its readiness file, then probe it. Every
# captured byte stays in the run directory.
start_carrier() { # <dir> <envelope-path>
  local dir=$1 envelope=$2
  mkdir -p "$dir" || { addwf "carrier-dir-$(basename "$dir")"; return 1; }
  printf 'envelope=%s\nhost=127.0.0.1\nport=0\nmodules_root=%s\n' "$envelope" "$MODULES_ROOT" > "$dir/carrier.txt" \
    || addwf "carrier-meta-$(basename "$dir")"
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

wait_carrier_ready() { # <dir>
  local dir=$1 i=0
  while [ "$i" -lt 200 ]; do
    [ -s "$dir/ready.json" ] && return 0
    kill -0 "$CARRIER_PID" 2>/dev/null || return 1
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

stop_carrier() { # <dir>
  local dir=$1 rc=not-run i=0
  kill -TERM "$CARRIER_PID" 2>/dev/null
  while [ "$i" -lt 100 ]; do
    kill -0 "$CARRIER_PID" 2>/dev/null || break
    sleep 0.1
    i=$((i + 1))
  done
  if kill -0 "$CARRIER_PID" 2>/dev/null; then
    printf 'carrier_survived_sigterm=yes\n' >> "$dir/carrier.txt" 2>/dev/null || addwf "carrier-kill-note"
    kill -KILL "$CARRIER_PID" 2>/dev/null
  fi
  wait "$CARRIER_PID" 2>/dev/null
  rc=$?
  printf 'carrier_exit=%s\ncarrier_pid=%s\n' "$rc" "$CARRIER_PID" >> "$dir/carrier.txt" 2>/dev/null \
    || addwf "carrier-exit-$(basename "$dir")"
}

gui_verdict=fail
refusal_verdict=fail
origin=''
origin_port=''

if [ "$envelope_verdict" != pass ]; then
  say 'payload: the envelope step did not produce a usable envelope; skipping the carrier probes'
else
  if [ "$write_fail" -ne 0 ]; then
    printf 'acc_stop_at=before-carrier\n' > "$RUN/evidence-gate.txt" 2>/dev/null || :
    say 'payload: evidence write failure before the carrier; stopping (73)'
    exit 73
  fi

  # ---- 6b. happy path
  say 'payload: step B — booting the carrier over the produced envelope'
  gui_dir="$RUN/gui-ok"
  start_carrier "$gui_dir" "$ENVELOPE_FILE"
  if wait_carrier_ready "$gui_dir"; then
    origin=$(json_field "$gui_dir/ready.json" origin)
    origin_port=$(json_field "$gui_dir/ready.json" port)
    printf 'origin=%s\norigin_port=%s\n' "${origin:-<none>}" "${origin_port:-<none>}" >> "$gui_dir/carrier.txt" 2>/dev/null \
      || addwf carrier-origin
    bwrap --ro-bind / / --bind "$gui_dir" "$gui_dir" --dev /dev --proc /proc --tmpfs /tmp \
      --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
      --chdir "$WORKDIR" \
      -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
         "$NODE" "$PROBE" --origin "$origin" --envelope-file "$ENVELOPE_FILE" \
         --out "$gui_dir/probe.json" \
      > "$gui_dir/probe-stdout.txt" 2> "$gui_dir/probe-stderr.txt"
    probe_rc=$?
    printf 'probe_rc=%s\n' "$probe_rc" > "$gui_dir/probe.rc" || addwf probe-rc
    if [ "$probe_rc" -eq 0 ] && [ "$(json_field "$gui_dir/probe.json" verdict 2>/dev/null)" = pass ]; then
      # The production GUI port must never be the port this batch used.
      if [ -n "$origin_port" ] && [ "$origin_port" != "$EXPECT_FORBIDDEN_PORT" ]; then
        gui_verdict=pass
      fi
    fi
  else
    printf 'ready=missing\n' >> "$gui_dir/carrier.txt" 2>/dev/null || addwf carrier-ready-missing
    say 'payload: the carrier never wrote its readiness file'
  fi
  stop_carrier "$gui_dir"
  say "payload: carrier(ok) verdict=$gui_verdict origin=${origin:-<none>}"

  # ---- 6c. refusal path
  say 'payload: step C — booting a carrier whose envelope is missing'
  ref_dir="$RUN/gui-refusal"
  mkdir -p "$ref_dir" || { addwf refusal-dir; }
  start_carrier "$ref_dir" "$ref_dir/absent-envelope.json"
  if wait_carrier_ready "$ref_dir"; then
    ref_origin=$(json_field "$ref_dir/ready.json" origin)
    printf 'origin=%s\n' "${ref_origin:-<none>}" >> "$ref_dir/carrier.txt" 2>/dev/null || addwf refusal-origin
    bwrap --ro-bind / / --bind "$ref_dir" "$ref_dir" --dev /dev --proc /proc --tmpfs /tmp \
      --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
      --chdir "$WORKDIR" \
      -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
         "$NODE" "$PROBE" --origin "$ref_origin" --expect-refusal \
         --out "$ref_dir/probe.json" \
      > "$ref_dir/probe-stdout.txt" 2> "$ref_dir/probe-stderr.txt"
    ref_probe_rc=$?
    printf 'probe_rc=%s\n' "$ref_probe_rc" > "$ref_dir/probe.rc" || addwf refusal-probe-rc
    if [ "$ref_probe_rc" -eq 0 ] && [ "$(json_field "$ref_dir/probe.json" verdict 2>/dev/null)" = pass ]; then
      refusal_verdict=pass
    fi
  else
    printf 'ready=missing\n' >> "$ref_dir/carrier.txt" 2>/dev/null || addwf refusal-ready-missing
    say 'payload: the refusal carrier never wrote its readiness file'
  fi
  stop_carrier "$ref_dir"
  say "payload: carrier(refusal) verdict=$refusal_verdict"
fi

# ---------------------------------------------------------------- 6d. selected test file
test_verdict=not_run
if [ "$write_fail" -ne 0 ]; then
  printf 'acc_stop_at=before-test-file\n' > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say 'payload: evidence write failure before the test file; stopping (73)'
  exit 73
fi
test_dir="$RUN/test-file"
if mkdir -p "$test_dir"; then
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$HOSTPKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
       NODE_OPTIONS=--max-old-space-size=192 \
       "$NODE" --test --test-concurrency=1 "$EXPECT_SELECTED_TEST" \
    > "$test_dir/stdout.tap" 2> "$test_dir/stderr.txt"
  test_rc=$?
  printf '%s\n' "$test_rc" > "$test_dir/exit.txt" || addwf test-exit
  # The reporter node --test picks is not ours to choose, so both shapes are read:
  # the TAP summary (`# tests 15`) and the spec summary (`ℹ tests 15`).
  tap_count() {
    awk -v key="$1" '($1 == "#" || $1 == "ℹ") && $2 == key { value = $3 } END { if (value != "") print value }' \
      "$test_dir/stdout.tap" 2>/dev/null
  }
  tap_tests=$(tap_count tests)
  tap_pass=$(tap_count pass)
  tap_fail=$(tap_count fail)
  {
    printf 'test_file=%s\n' "$EXPECT_SELECTED_TEST"
    printf 'cwd=%s\n' "$HOSTPKG"
    printf 'exit=%s\n' "$test_rc"
    printf 'tap_tests=%s\n' "${tap_tests:-unparsed}"
    printf 'tap_pass=%s\n' "${tap_pass:-unparsed}"
    printf 'tap_fail=%s\n' "${tap_fail:-unparsed}"
  } > "$test_dir/summary.txt" || addwf test-summary.txt
  if [ "$test_rc" -eq 0 ] && is_num "$tap_tests" && is_num "$tap_pass" && is_num "$tap_fail" \
     && [ "$tap_fail" -eq 0 ] && [ "$tap_tests" -ge 15 ] && [ "$tap_pass" -eq "$tap_tests" ]; then
    test_verdict=pass
  else
    test_verdict=fail
  fi
  say "payload: test file exit=$test_rc tap=${tap_tests:-?}/${tap_pass:-?}/${tap_fail:-?}"
else
  addwf test-dir
fi

# ---------------------------------------------------------------- 6e. snapshot after
yaml_snapshot=unreadable
if yaml_manifest > "$RUN/yaml-manifest-after.txt" 2>/dev/null && [ -s "$RUN/yaml-manifest-after.txt" ]; then
  if diff -q "$RUN/yaml-manifest-before.txt" "$RUN/yaml-manifest-after.txt" > "$RUN/yaml-manifest-diff.txt" 2>&1; then
    yaml_snapshot=identical
  else
    yaml_snapshot=changed
  fi
else
  addwf yaml-manifest-after.txt
fi
{
  printf 'yaml_dir=%s\n' "$yaml_dir"
  printf 'yaml_manifest_files_before=%s\n' "$yaml_before_count"
  printf 'yaml_manifest_snapshot_state=%s\n' "$yaml_snapshot"
} > "$RUN/yaml-manifest.txt" || addwf yaml-manifest.txt

# ---------------------------------------------------------------- 7. verdict
verdict=pass
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
printf 'acc_smoke_verdict=%s\nacc_envelope_verdict=%s\nacc_carrier_verdict=%s\nacc_refusal_verdict=%s\nacc_test_file_verdict=%s\nacc_yaml_snapshot=%s\nacc_origin=%s\n' \
  "$verdict" "$envelope_verdict" "$gui_verdict" "$refusal_verdict" "$test_verdict" "$yaml_snapshot" \
  "${origin:-<none>}" > "$RUN/case-verdict.txt" || addwf case-verdict.txt

# ---------------------------------------------------------------- 8. peaks
{
  printf 'memory_peak=%s\n' "$(read1 "$CGROUP/memory.peak")"
  printf 'pids_peak=%s\n' "$(read1 "$CGROUP/pids.peak")"
} > "$RUN/peaks.txt" || addwf peaks.txt

case "$verdict" in
  pass) ;;
  test_file_*)
    # A red test file is its own exit code (74), never folded into 72.
    say "payload: verdict=$verdict envelope=$envelope_verdict carrier=$gui_verdict refusal=$refusal_verdict"
    exit 74
    ;;
  *)
    say "payload: verdict=$verdict envelope=$envelope_verdict carrier=$gui_verdict refusal=$refusal_verdict test=$test_verdict"
    exit 72
    ;;
esac
if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s)"
  exit 73
fi
say "payload: verdict=pass origin=$origin"
exit 0
