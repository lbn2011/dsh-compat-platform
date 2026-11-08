#!/bin/bash
# In-envelope payload for the platform diagnose acceptance batch.
#
# STATUS: PREPARED, NEVER EXECUTED. Nothing in this file has been run.
#
# Runs INSIDE the transient unit. It verifies its own envelope, refuses to start
# the workload if anything is off, and only then runs one test file.
#
# Logging: this payload NEVER writes unit.log. The launcher is the single writer
# of unit.log and redirects this process's stdout/stderr there; the payload only
# relays its logs to stdout. Every record this payload keeps lives under $RUN.
#
# What it can establish: the static contract of the new command, and that
# `tests/diagnose.test.js` passes on these bytes under these limits.
#
# What it cannot establish: that the diagnose envelope behaves identically in a
# real host, that any plugin would load, that a profile dump is complete, or that
# named sources correlate. The suite asserts on this package's own CLI/API, not
# on DSH.
#
# Exit codes: 0 green; 70 envelope refusal; 71 static contract or dependency
# precondition failed; 72 test verdict not green; 73 an evidence write failed.

set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
PKG=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer
NODE=/www/server/nodejs/v24.21.0/bin/node

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200
EXPECT_TEST_SCRIPT='node --test --test-concurrency=1 "tests/*.test.js" "tests/*.test.mjs"'
EXPECT_YAML_VERSION='2.9.1'

write_fail=0
addwf() { write_fail=$((write_fail + 1)); printf 'payload: evidence write failed: %s\n' "$1" >&2; }
die() { printf 'payload: %s\n' "$2" >&2; exit "$1"; }
wr() { cat > "$1" || return 1; [ -s "$1" ] || return 1; }
say() { printf '%s\n' "$*"; }
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }
read1() { # path -> first line for non-verdict display only (never compared)
  [ -r "$1" ] || { printf ''; return 1; }
  head -n 1 "$1" 2>/dev/null
}
# Strict single-value readback for anything that is COMPARED against a limit. A
# file must yield EXACTLY one non-empty line; `head -n 1` would silently accept
# the first of several differing lines, and an empty read is reported as
# unreadable instead of being allowed to compare equal to an expected value.
knob1() { # path -> value if exactly one non-empty line, else <ambiguous-or-missing:...>
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

# RuntimeMaxUSec is read through busctl, in two steps. Static review of an earlier draft found
# `busctl show` with a property list is not a get-property call at all, so it could not have
# returned the property. `GetUnit` yields the object path, then `get-property` asks for exactly
# one property of that object.
#
# Step 1 — GetUnit. The rc must be 0 (captured from busctl itself, not from a trailing filter)
# and the whole reply must be a single legal object path. Anything else leaves unit_path_ok=no,
# which forces the RuntimeMaxUSec value to read as unavailable below instead of being guessed.
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

# Step 2 — get-property, only against a validated object path. A reply is accepted only when the
# WHOLE output is exactly one `t <number>` line: extra lines or trailing garbage disqualify it,
# so a stray diagnostic cannot be silently counted as a match the way a line-counting parse would.
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
  # Outer match takes any `t `-prefixed reply; the inner negative class then rejects it unless
  # the remainder is non-empty AND all digits. A shell glob `[0-9]*` would NOT be a pure-digit
  # test (it is one digit followed by anything), so the digit check is done by exclusion here.
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
# Result: the value is set only when the entire reply is `t ` followed exclusively by digits, so a
# second line, an error string or trailing text leaves it empty — and empty is a refusal, never a
# reason to skip the comparison.

memory_max=$(knob1 "$CGROUP/memory.max")
swap_max=$(knob1 "$CGROUP/memory.swap.max")
pids_max=$(knob1 "$CGROUP/pids.max")
cpu_max=$(knob1 "$CGROUP/cpu.max")
# One occurrence only. `head -n 1` would quietly accept a reply that said two different things.
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
# Not "compare if we happened to read something": an unreadable or ambiguous value is itself a
# mismatch. A query that failed must never widen the set of envelopes this batch accepts.
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

# A stop that records the write failure best-effort before exiting 73, so the
# failure itself is evidenced rather than merely announced on stderr.
evidence_stop() { # marker
  printf 'acc_evidence_write_failures=%s\nacc_stop_at=%s\nacc_workload_started=no\n' \
    "$write_fail" "$1" > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say "payload: $write_fail evidence write failure(s) at $1; stopping (73) before proceeding"
  exit 73
}

# ---------------------------------------------------------------- 4. syntax of the batch
# Gate BEFORE the syntax checks: bash -n must not run on top of an already-broken
# evidence set. A failure here is itself recorded best-effort, then 73.
if [ "$write_fail" -ne 0 ]; then evidence_stop before-syntax; fi
bash -n /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnose-batch/run.sh
acc_syntax_run_sh_rc=$?
bash -n /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnose-batch/payload.sh
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

# Gate BEFORE the node step: the static contract must not be judged on top of an
# already-broken evidence set. Recorded best-effort, then 73.
if [ "$write_fail" -ne 0 ]; then evidence_stop before-static-node; fi
env -i PATH=/usr/bin:/bin HOME=/tmp \
  NODE_OPTIONS=--max-old-space-size=192 \
  EXPECT_PKG_DIR="$PKG" \
  EXPECT_TEST_SCRIPT="$EXPECT_TEST_SCRIPT" \
  EXPECT_YAML_VERSION="$EXPECT_YAML_VERSION" \
  "$NODE" "$RUN/static-contract.mjs" > "$RUN/static-contract.log" 2>&1
static_rc=$?
# Relay to stdout only: the launcher is the sole writer of unit.log and redirects
# this payload's stdout there. The payload must NOT append to unit.log itself.
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

# ---------------------------------------------------------------- 5b. evidence gate
# Every record written so far must have landed BEFORE the workload starts. An
# unrecorded envelope is not something a later verdict may paper over, so a write
# failure here stops the batch (73) with the workload unstarted.
if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s) before the workload; refusing to start it"
  exit 73
fi

# Snapshot baseline for the yaml dependency. `yaml` is used by the workload but is
# deliberately NOT part of the runner's named selected-input hash (that set is a
# selection, not a closure). This is nothing more than a snapshot of the regular
# files under node_modules/yaml taken at two instants — before and after the test —
# and the two manifests must match byte for byte. That equality says the file list
# and contents were identical at those two moments; it does NOT prove the package
# was installed intact, does not prove its provenance, and cannot rule out a change
# that happened and was reverted between the two snapshots. Install-source/tarball
# verification is a separate concern, not claimed here.
yaml_dir="$PKG/node_modules/yaml"
yaml_manifest() {
  [ -d "$yaml_dir" ] || return 1
  # Refuse a symlinked directory or any symlink inside it: `find -type f` does not
  # follow symlinks, so a symlinked file (or a symlinked tree) would drop out of the
  # snapshot and leave an imported file unhashed. Refusing beats a silently short
  # manifest that looks complete.
  [ -L "$yaml_dir" ] && return 1
  # Capture the find result and check its rc: `[ -z "$(find …)" ]` would read a find error as
  # "no symlinks found" and wrongly pass. pipefail (set at the top) additionally propagates a
  # failure in the manifest pipeline below to this function's exit.
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
  printf 'workdir=%s\n' "$PKG"
  printf 'test_files=%s\n' 'tests/diagnose.test.js'
} > "$RUN/workload.txt" || addwf workload.txt

# The record describing the workload is itself evidence: if it did not land, do
# not run the workload on an unrecorded footing.
if [ "$write_fail" -ne 0 ]; then
  say 'payload: evidence write failed before the workload; not starting it'
  exit 73
fi

# `--ro-bind / /` keeps the whole checkout and the installed dependency visible;
# `--dev /dev --proc /proc` and the private pid/ipc/uts/net namespaces give the
# suite an isolated, unmounted namespace; `--tmpfs /tmp` is the writable private
# scratch it needs for its fixtures (mkdtemp) and its temporary validator modules;
# `--die-with-parent` ties the sandbox to this process so nothing survives the unit.
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$PKG" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     "$NODE" --test --test-concurrency=1 --test-reporter=tap tests/diagnose.test.js \
  > "$RUN/node-tap.log" 2> "$RUN/node-stderr.log"
node_rc=$?
printf 'node_rc=%s\n' "$node_rc" > "$RUN/node.rc" || addwf node.rc
# Relay to stdout only; the launcher owns unit.log.
cat "$RUN/node-tap.log" 2>/dev/null || addwf tap-relay

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

# ---------------------------------------------------------------- 7. TAP fields
# Each summary key must appear EXACTLY once. Absence is unknown, a duplicate is
# ambiguous, and neither may be read as a number — so we count occurrences first
# and only a single well-formed `# key <digits>` line yields a value.
TAPFILE="$RUN/node-tap.log"
tap_count() { awk -v k="$2" '$0 ~ ("^# " k " [0-9]+$") { n++ } END { print n + 0 }' "$1"; }
tap_value() { awk -v k="$2" '$0 ~ ("^# " k " [0-9]+$") { v = $3 } END { print v }' "$1"; }
tap_state() { # file key -> ok|missing|duplicate
  local n; n=$(tap_count "$1" "$2")
  if [ "$n" -eq 1 ]; then printf 'ok'; elif [ "$n" -eq 0 ]; then printf 'missing'; else printf 'duplicate'; fi
}

for k in tests pass fail cancelled skipped todo; do
  printf 'tap_field_%s=%s\n' "$k" "$(tap_state "$TAPFILE" "$k")"
done > "$RUN/tap-fields.txt" || addwf tap-fields.txt

tests=$(tap_value "$TAPFILE" tests)
pass=$(tap_value "$TAPFILE" pass)
fail=$(tap_value "$TAPFILE" fail)
cancelled=$(tap_value "$TAPFILE" cancelled)
skipped=$(tap_value "$TAPFILE" skipped)
todo=$(tap_value "$TAPFILE" todo)

{
  printf 'tap_tests=%s\n' "${tests:-<missing>}"
  printf 'tap_pass=%s\n' "${pass:-<missing>}"
  printf 'tap_fail=%s\n' "${fail:-<missing>}"
  printf 'tap_cancelled=%s\n' "${cancelled:-<missing>}"
  printf 'tap_skipped=%s\n' "${skipped:-<missing>}"
  printf 'tap_todo=%s\n' "${todo:-<missing>}"
  printf 'tap_bytes=%s\n' "$(wc -c < "$TAPFILE" 2>/dev/null || printf '?')"
  printf 'tap_lines=%s\n' "$(wc -l < "$TAPFILE" 2>/dev/null || printf '?')"
  printf 'stderr_bytes=%s\n' "$(wc -c < "$RUN/node-stderr.log" 2>/dev/null || printf '?')"
} > "$RUN/tap-summary.txt" || addwf tap-summary.txt

verdict=pass
for k in tests pass fail cancelled skipped todo; do
  case "$(tap_state "$TAPFILE" "$k")" in
    ok) : ;;
    missing) verdict="tap_field_missing:$k" ;;
    duplicate) verdict="tap_field_duplicate:$k" ;;
  esac
  [ "$verdict" = pass ] || break
done
if [ "$verdict" = pass ]; then
  if ! is_num "$tests" || [ "$tests" -le 0 ]; then
    verdict=tap_no_tests
  elif [ "$pass" != "$tests" ]; then        # tests = pass, and pass = tests > 0
    verdict=tap_pass_ne_tests
  elif [ "$fail" != 0 ]; then
    verdict=tap_fail_nonzero
  elif [ "$cancelled" != 0 ]; then
    verdict=tap_cancelled_nonzero
  elif [ "$skipped" != 0 ]; then
    verdict=tap_skipped_nonzero
  elif [ "$todo" != 0 ]; then
    verdict=tap_todo_nonzero
  elif [ "$node_rc" -ne 0 ]; then
    verdict=node_rc_nonzero
  elif [ "$yaml_snapshot" != identical ]; then
    verdict="yaml_snapshot_${yaml_snapshot}"
  fi
fi
printf 'acc_smoke_verdict=%s\nacc_yaml_snapshot=%s\n' "$verdict" "$yaml_snapshot" \
  > "$RUN/tap-verdict.txt" || addwf tap-verdict.txt

# ---------------------------------------------------------------- 8. peaks
{
  printf 'memory_peak=%s\n' "$(read1 "$CGROUP/memory.peak")"
  printf 'pids_peak=%s\n' "$(read1 "$CGROUP/pids.peak")"
} > "$RUN/peaks.txt" || addwf peaks.txt

if [ "$verdict" != pass ]; then
  say "payload: verdict=$verdict node_rc=$node_rc"
  exit 72
fi
if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s)"
  exit 73
fi
say "payload: verdict=pass tests=$tests pass=$pass fail=$fail"
exit 0
