#!/bin/bash
# In-envelope payload for the diagnose ↔ real dsh-compat-spec wiring batch.
#
# STATUS: DRAFT, NEVER EXECUTED. Nothing in this file has been run.
#
# Minimal adaptation of `scripts/diagnose-batch/payload.sh`: it keeps the same
# envelope self-check, the same single MemAvailable gate, the same two-point yaml
# dependency snapshot, the same evidence-write gates and the same "relay to
# stdout, never write unit.log" discipline. What changes is the workload. Instead
# of running one test file, it drives the `dsh-compat-diagnose` CLI as a **real
# child process** — absolute node binary, explicit working directory — once per
# case, and keeps each case's stdout / stderr / exit code as its own file.
#
# The point of these cases is the wiring between the platform CLI and the REAL
# validators in the sibling `dsh-compat-spec` checkout. The validator specifiers
# below are CWD-relative (`../dsh-compat-spec/...`) on purpose: the CLI resolves a
# `./`/`../` specifier against process.cwd(), so running each case from
# `$WORKDIR` exercises exactly that branch of resolveModuleTarget against real
# files. If the sibling checkout is absent this payload refuses (71) instead of
# letting an unloadable validator masquerade as a usage error.
#
# What it can establish: that on these bytes, under these limits, these six
# invocations exit with these codes and the real validators accept/refuse the
# real fixtures as expected, and that the wiring test file — which imports the
# same two real validators in-process — reports every test passing.
#
# What it cannot establish: that any plugin would load, that a host observed any
# of this, that the synthetic example evidence is a real run, or that named
# sources correlate.
#
# Exit codes: 0 green; 70 envelope refusal; 71 static contract or dependency/
# sibling precondition failed (no case started); 72 a case's exit code did not
# match its expected code; 73 an evidence write failed; 74 the selected test file
# did not report a clean TAP run.

set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
ROOT=/root/dsh-ecosystem-spec
REPO=$ROOT/projects/dsh-compat-platform
PKG=$REPO/packages/analyzer
SPEC=$ROOT/projects/dsh-compat-spec
NODE=/www/server/nodejs/v24.21.0/bin/node

# The CLI to drive and the directory the cases run from. All case paths below are
# relative to $WORKDIR, and $WORKDIR is the CLI's process.cwd() for every case.
CLI=$PKG/src/diagnose-cli.js
WORKDIR=$REPO

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200
EXPECT_TEST_SCRIPT='node --test --test-concurrency=1 "tests/*.test.js" "tests/*.test.mjs"'
EXPECT_YAML_VERSION='2.9.1'
EXPECT_SELECTED_TEST='tests/diagnose-spec-wiring.test.js'

# Real sibling-checkout inputs every case depends on. Absent → refuse (71), never skip.
SPEC_INPUTS=(
  "$SPEC/src/index.js"
  "$SPEC/src/admission-evidence.js"
  "$SPEC/conformance/positive/01-minimal-tool.json"
  "$SPEC/conformance/negative/01-not-an-object.json"
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
[ -f "$CLI" ] || die 70 "diagnose CLI missing: $CLI"
[ -d "$WORKDIR" ] || die 70 "work directory missing: $WORKDIR"
[ -x "$NODE" ] || die 70 "node binary missing: $NODE"

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

# RuntimeMaxUSec via busctl, two steps, whole-reply match only (see diagnose-batch):
# GetUnit yields the object path, then get-property asks for exactly one property.
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

# ---------------------------------------------------------------- 4. syntax of the batch
if [ "$write_fail" -ne 0 ]; then evidence_stop before-syntax; fi
bash -n "$ROOT/projects/dsh-compat-platform/scripts/diagnose-real-wiring/run.sh"
acc_syntax_run_sh_rc=$?
bash -n "$ROOT/projects/dsh-compat-platform/scripts/diagnose-real-wiring/payload.sh"
acc_syntax_payload_sh_rc=$?
printf 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
  "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" > "$RUN/syntax.txt" || addwf syntax.txt
[ "$acc_syntax_run_sh_rc" -eq 0 ] || die 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"
[ "$acc_syntax_payload_sh_rc" -eq 0 ] || die 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"

# ---------------------------------------------------------------- 5. static contract
cat > "$RUN/static-contract.mjs" <<'CONTRACT' || { addwf static-contract-write; die 73 "cannot write static-contract.mjs"; }
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

if [ "$write_fail" -ne 0 ]; then evidence_stop before-static-node; fi
env -i PATH=/usr/bin:/bin HOME=/tmp \
  NODE_OPTIONS=--max-old-space-size=192 \
  EXPECT_PKG_DIR="$PKG" \
  EXPECT_TEST_SCRIPT="$EXPECT_TEST_SCRIPT" \
  EXPECT_YAML_VERSION="$EXPECT_YAML_VERSION" \
  EXPECT_SELECTED_TEST="$EXPECT_SELECTED_TEST" \
  "$NODE" "$RUN/static-contract.mjs" > "$RUN/static-contract.log" 2>&1
static_rc=$?
cat "$RUN/static-contract.log" 2>/dev/null || addwf static-log-relay
printf 'static_contract_rc=%s\n' "$static_rc" >> "$RUN/static-contract.log" 2>/dev/null \
  || addwf static-contract-rc-line

if [ "$static_rc" -eq 3 ]; then
  printf 'acc_static_contract=blocked\nacc_block_reason=yaml_dependency_not_installed\n' \
    > "$RUN/static-verdict.txt" || addwf static-verdict.txt
  say "payload: refusing — yaml@$EXPECT_YAML_VERSION does not resolve from the analyzer package."
  say 'payload: installing is out of scope for this batch and was not attempted.'
  exit 71
fi
if [ "$static_rc" -ne 0 ]; then
  printf 'acc_static_contract=fail\n' > "$RUN/static-verdict.txt" || addwf static-verdict.txt
  die 71 "static contract failed (rc=$static_rc)"
fi
printf 'acc_static_contract=pass\n' > "$RUN/static-verdict.txt" || addwf static-verdict.txt

# ---------------------------------------------------------------- 5c. sibling precondition
# The sibling dsh-compat-spec checkout is the whole subject. Its absence is a
# precondition failure (71), never a skip and never a usage error faked by an
# unloadable validator.
sib_missing=''
for f in "${SPEC_INPUTS[@]}"; do [ -f "$f" ] || sib_missing="$sib_missing $f"; done
printf 'spec_root=%s\nspec_missing=%s\n' "$SPEC" "${sib_missing:-none}" \
  > "$RUN/sibling-precondition.txt" || addwf sibling-precondition.txt
if [ -n "$sib_missing" ]; then
  say "payload: refusing — sibling dsh-compat-spec input missing:${sib_missing}"
  say 'payload: a sibling checkout is required; this batch does not fabricate one.'
  exit 71
fi

# ---------------------------------------------------------------- 5b. evidence gate
if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s) before the workload; refusing to start it"
  exit 73
fi

# yaml dependency snapshot (two instants, must be identical). See diagnose-batch for
# the precise limits of what this equality does and does not prove.
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

# ---------------------------------------------------------------- 6. the workload
say 'payload: starting the workload'
{
  printf 'node=%s\n' "$NODE"
  printf 'cli=%s\n' "$CLI"
  printf 'workdir=%s\n' "$WORKDIR"
  printf 'spec_root=%s\n' "$SPEC"
} > "$RUN/workload.txt" || addwf workload.txt
if [ "$write_fail" -ne 0 ]; then
  say 'payload: evidence write failed before the workload; not starting it'
  exit 73
fi

mkdir -p "$RUN/cases" || { addwf cases-dir; exit 73; }

CASE_FAIL=''
CASE_COUNT=0

# run_case <id> <expected-exit> <cli args...>
# Each case is one real child process: `bwrap` isolates the namespace, `env -i`
# scrubs the environment, the absolute node binary runs the CLI, and `--chdir
# $WORKDIR` makes process.cwd() the directory the CWD-relative validator paths
# are written against. stdout/stderr/exit go to per-case files.
run_case() {
  local id=$1 expect=$2; shift 2
  local dir="$RUN/cases/$id" rc first
  mkdir -p "$dir" || { addwf "case-dir-$id"; return 1; }
  CASE_COUNT=$((CASE_COUNT + 1))
  # Evidence gate before EVERY case: an unrecorded run is not a run.
  if [ "$write_fail" -ne 0 ]; then
    printf 'acc_stop_at=before-case-%s\n' "$id" > "$RUN/evidence-gate.txt" 2>/dev/null || :
    say "payload: evidence write failure before case $id; stopping (73)"
    exit 73
  fi
  printf 'case=%s\nexpected_exit=%s\nworkdir=%s\nargv:' "$id" "$expect" "$WORKDIR" > "$dir/case.txt" \
    || addwf "case-meta-$id"
  printf ' %q' "$NODE" "$CLI" "$@" >> "$dir/case.txt" 2>/dev/null || addwf "case-meta-$id"
  printf '\n' >> "$dir/case.txt" 2>/dev/null || addwf "case-meta-$id"

  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$WORKDIR" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
       NODE_OPTIONS=--max-old-space-size=192 \
       "$NODE" "$CLI" "$@" \
    > "$dir/stdout.json" 2> "$dir/stderr.txt"
  rc=$?
  printf '%s\n' "$rc" > "$dir/exit.txt" || addwf "case-exit-$id"
  printf 'actual_exit=%s\n' "$rc" >> "$dir/case.txt" 2>/dev/null || addwf "case-meta-$id"

  if [ "$rc" -ne "$expect" ]; then
    CASE_FAIL="$CASE_FAIL $id(rc=$rc!=expect=$expect)"
  fi
  # Every case, including the exit-2 cases, must still print a JSON envelope on
  # stdout. A refusal that produced no envelope would be a different failure.
  first=$(head -c 1 "$dir/stdout.json" 2>/dev/null)
  if [ "$first" != '{' ]; then
    CASE_FAIL="$CASE_FAIL $id(no-json-envelope)"
  fi
  say "payload: case $id exit=$rc expected=$expect"
}

# Case argv. Validator specifiers and input paths are CWD-relative to $WORKDIR
# (the repository root) on purpose. `--static` takes the *analyzer input
# envelope* `{declarations, availableCapabilities}` — a bare declaration document
# is a different shape and lands on the static lane's invalid path (case c5).
run_case "c1-profile-only" 0 \
  --profile examples/diagnose/profile.yml

run_case "c2-all-clear" 0 \
  --profile examples/diagnose/profile.yml \
  --static packages/analyzer/fixtures/clean.json \
  --declaration-validator ../dsh-compat-spec/src/index.js \
  --runtime examples/diagnose/runtime-evidence.json

run_case "c3-static-negative" 2 \
  --profile examples/diagnose/profile.yml \
  --static packages/analyzer/fixtures/invalid-declaration.json \
  --declaration-validator ../dsh-compat-spec/src/index.js \
  --runtime examples/diagnose/runtime-evidence.json

run_case "c4-admission-attention" 1 \
  --profile examples/diagnose/profile.yml \
  --static packages/analyzer/fixtures/clean.json \
  --declaration-validator ../dsh-compat-spec/src/index.js \
  --runtime examples/diagnose/runtime-evidence.json \
  --admission examples/diagnose/admission-evidence.json \
  --admission-validator ../dsh-compat-spec/src/admission-evidence.js

run_case "c5-static-bare-declaration" 2 \
  --static ../dsh-compat-spec/conformance/positive/01-minimal-tool.json \
  --declaration-validator ../dsh-compat-spec/src/index.js

run_case "c6-admission-grammar-refusal" 2 \
  --static packages/analyzer/fixtures/clean.json \
  --declaration-validator ../dsh-compat-spec/src/index.js \
  --admission packages/analyzer/fixtures/clean.json \
  --admission-validator ../dsh-compat-spec/src/admission-evidence.js

{
  printf 'case_count=%s\n' "$CASE_COUNT"
  printf 'case_failures=%s\n' "${CASE_FAIL:-none}"
} > "$RUN/cases-summary.txt" || addwf cases-summary.txt

# ---------------------------------------------------------------- 6a2. selected test file
# One bounded `node --test` run of the wiring test file, from the package
# directory. It loads the same two real spec validators in-process and exercises
# the library surface the CLI cases only reach through a command line. A skipped
# or absent run is never read as a pass.
test_verdict=not_run
if [ "$write_fail" -ne 0 ]; then
  printf 'acc_stop_at=before-test-file\n' > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say 'payload: evidence write failure before the test file; stopping (73)'
  exit 73
fi
test_dir="$RUN/test-file"
if mkdir -p "$test_dir"; then
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
       NODE_OPTIONS=--max-old-space-size=192 \
       "$NODE" --test --test-concurrency=1 "$EXPECT_SELECTED_TEST" \
    > "$test_dir/stdout.tap" 2> "$test_dir/stderr.txt"
  test_rc=$?
  printf '%s\n' "$test_rc" > "$test_dir/exit.txt" || addwf test-exit
  # The reporter node --test picks is not ours to choose, so both shapes are read:
  # the TAP summary (`# tests 6`) and the spec summary (`ℹ tests 6`). Both put the
  # count in the third field.
  tap_count() {
    awk -v key="$1" '($1 == "#" || $1 == "ℹ") && $2 == key { value = $3 } END { if (value != "") print value }' \
      "$test_dir/stdout.tap" 2>/dev/null
  }
  tap_tests=$(tap_count tests)
  tap_pass=$(tap_count pass)
  tap_fail=$(tap_count fail)
  {
    printf 'test_file=%s\n' "$EXPECT_SELECTED_TEST"
    printf 'cwd=%s\n' "$PKG"
    printf 'exit=%s\n' "$test_rc"
    printf 'tap_tests=%s\n' "${tap_tests:-unparsed}"
    printf 'tap_pass=%s\n' "${tap_pass:-unparsed}"
    printf 'tap_fail=%s\n' "${tap_fail:-unparsed}"
  } > "$test_dir/summary.txt" || addwf test-summary.txt
  if [ "$test_rc" -eq 0 ] && is_num "$tap_tests" && is_num "$tap_pass" && is_num "$tap_fail" \
     && [ "$tap_fail" -eq 0 ] && [ "$tap_tests" -ge 6 ] && [ "$tap_pass" -eq "$tap_tests" ]; then
    test_verdict=pass
  else
    test_verdict=fail
  fi
  say "payload: test file exit=$test_rc tap=${tap_tests:-?}/${tap_pass:-?}/${tap_fail:-?}"
else
  addwf test-dir
fi

# ---------------------------------------------------------------- 6b. snapshot after
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
if [ -n "$CASE_FAIL" ]; then
  verdict="case_exit_mismatch"
elif [ "$CASE_COUNT" -ne 6 ]; then
  verdict="case_count_${CASE_COUNT}"
elif [ "$test_verdict" != pass ]; then
  verdict="test_file_${test_verdict}"
elif [ "$yaml_snapshot" != identical ]; then
  verdict="yaml_snapshot_${yaml_snapshot}"
fi
printf 'acc_smoke_verdict=%s\nacc_case_failures=%s\nacc_test_file_verdict=%s\nacc_yaml_snapshot=%s\n' \
  "$verdict" "${CASE_FAIL:-none}" "$test_verdict" "$yaml_snapshot" > "$RUN/case-verdict.txt" || addwf case-verdict.txt

# ---------------------------------------------------------------- 8. peaks
{
  printf 'memory_peak=%s\n' "$(read1 "$CGROUP/memory.peak")"
  printf 'pids_peak=%s\n' "$(read1 "$CGROUP/pids.peak")"
} > "$RUN/peaks.txt" || addwf peaks.txt

if [ "$verdict" != pass ]; then
  say "payload: verdict=$verdict cases=$CASE_COUNT failures=${CASE_FAIL:-none}"
  exit 72
fi
if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s)"
  exit 73
fi
say "payload: verdict=pass cases=$CASE_COUNT"
exit 0
