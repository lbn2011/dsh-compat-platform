#!/bin/bash
# In-envelope payload for the platform correspondence acceptance batch.
#
# STATUS: PREPARED, NEVER EXECUTED. Nothing in this file has been run.
#
# Runs INSIDE the transient unit. It verifies its own envelope, refuses to start
# the workload if anything is off, and only then runs the two demos and one test
# file.
#
# Logging: this payload NEVER writes unit.log. The launcher is the single writer
# of unit.log and redirects this process's stdout/stderr there; the payload only
# relays its logs to stdout. Every record this payload keeps lives under $RUN.
#
# What it can establish: the static contract of the new command; that the two
# shipped demos behave as documented (exit 1 with one finding on the shipped
# examples, exit 2 with CORRESPONDENCE_STALE once a binding is flipped); and that
# `tests/correspondence.test.js` passes on these bytes under these limits.
#
# What it cannot establish: that any profile would load, that any declaration is
# accepted by a host, that a capability is provided, or that the caller's
# assertion is true. The correspondence is an assertion the tool verifies; it
# never certifies correspondence with any real profile.
#
# Exit codes: 0 green; 70 envelope refusal; 71 static contract or syntax
# precondition failed; 72 test verdict not green; 73 an evidence write failed.

set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
PKG=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
CORR=$REPO/examples/correspondence/correspondence.json
PROFILE_EX=$REPO/examples/correspondence/profile.yml
DECL_EX=$REPO/examples/correspondence/declaration.json
NODE=/www/server/nodejs/v24.21.0/bin/node

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200
EXPECT_TEST_SCRIPT='node --test --test-concurrency=1 "tests/*.test.js" "tests/*.test.mjs"'

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
for f in "$CORR" "$PROFILE_EX" "$DECL_EX"; do
  [ -f "$f" ] || die 70 "example input missing: $f"
done

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
bash -n "$REPO/scripts/correspondence-batch/run.sh"
acc_syntax_run_sh_rc=$?
bash -n "$REPO/scripts/correspondence-batch/payload.sh"
acc_syntax_payload_sh_rc=$?
# `node --check` on the three source files and the test file. Node treats a
# `.d.ts` as a TypeScript source here and only erases types, so this checks that
# the declaration file is syntactically well-formed; it is not a type check.
acc_node_check_corr_rc=skipped
acc_node_check_dts_rc=skipped
acc_node_check_cli_rc=skipped
acc_node_check_test_rc=skipped
if [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ]; then
  "$NODE" --check "$PKG/src/correspondence.js" 2>"$RUN/node-check-correspondence.err"
  acc_node_check_corr_rc=$?
  "$NODE" --check "$PKG/src/correspondence.d.ts" 2>"$RUN/node-check-correspondence-dts.err"
  acc_node_check_dts_rc=$?
  "$NODE" --check "$PKG/src/correspondence-cli.js" 2>"$RUN/node-check-correspondence-cli.err"
  acc_node_check_cli_rc=$?
  "$NODE" --check "$PKG/tests/correspondence.test.js" 2>"$RUN/node-check-correspondence-test.err"
  acc_node_check_test_rc=$?
fi
printf 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\nacc_node_check_correspondence_rc=%s\nacc_node_check_dts_rc=%s\nacc_node_check_cli_rc=%s\nacc_node_check_test_rc=%s\n' \
  "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" \
  "$acc_node_check_corr_rc" "$acc_node_check_dts_rc" "$acc_node_check_cli_rc" "$acc_node_check_test_rc" \
  > "$RUN/syntax.txt" || addwf syntax.txt
[ "$acc_syntax_run_sh_rc" -eq 0 ] || die 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"
[ "$acc_syntax_payload_sh_rc" -eq 0 ] || die 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"
[ "$acc_node_check_corr_rc" -eq 0 ] || die 71 "src/correspondence.js does not parse (rc=$acc_node_check_corr_rc)"
[ "$acc_node_check_dts_rc" -eq 0 ] || die 71 "src/correspondence.d.ts does not parse (rc=$acc_node_check_dts_rc)"
[ "$acc_node_check_cli_rc" -eq 0 ] || die 71 "src/correspondence-cli.js does not parse (rc=$acc_node_check_cli_rc)"
[ "$acc_node_check_test_rc" -eq 0 ] || die 71 "tests/correspondence.test.js does not parse (rc=$acc_node_check_test_rc)"

# ---------------------------------------------------------------- 5. static contract
cat > "$RUN/static-contract.mjs" <<'CONTRACT' || { addwf static-contract-write; die 73 "cannot write static-contract.mjs"; }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = process.env.EXPECT_PKG_DIR;
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

const isPrivate = manifest.private === true;
say(`package_private=${isPrivate ? 'pass' : 'fail'}`);
if (!isPrivate) fail.push('private');

const isModule = manifest.type === 'module';
say(`package_type_module=${isModule ? 'pass' : 'fail'}`);
if (!isModule) fail.push('type-module');

// This package is NOT dependency-free: it parses YAML, and one pinned parser is
// the whole justification for that. Assert the exact shape rather than "none",
// so a second dependency or a floating range is what fails.
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
for (const [rel, path] of [
  ['src/correspondence.js', srcPath],
  ['src/correspondence.d.ts', dtsPath],
  ['src/correspondence-cli.js', cliPath],
  ['tests/correspondence.test.js', testPath],
]) {
  say(`file_present ${rel}=${existsSync(path) ? 'yes' : 'no'}`);
  if (!existsSync(path)) fail.push(rel);
}

const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};
const src = read(srcPath);
const cli = read(cliPath);

// The two version literals the design names, each bound to its own exported name.
const versionRe = /CORRESPONDENCE_VERSION\s*=\s*['"]profile-correspondence\/0\.1-draft\.1['"]/;
const summaryRe = /CORRESPONDENCE_SUMMARY\s*=\s*['"]correspondence-summary\/0\.1-draft\.1['"]/;
const versionOk = typeof src === 'string' && versionRe.test(src);
const summaryOk = typeof src === 'string' && summaryRe.test(src);
say(`version_literal_exact=${versionOk ? 'pass' : 'fail'}`);
say(`summary_literal_exact=${summaryOk ? 'pass' : 'fail'}`);
if (!versionOk) fail.push('CORRESPONDENCE_VERSION');
if (!summaryOk) fail.push('CORRESPONDENCE_SUMMARY');

// The output shape states, as a literal, that no identity text is disclosed.
const identityOk = typeof src === 'string' && /identityDisclosed\s*:\s*false/.test(src);
say(`identity_disclosed_false=${identityOk ? 'pass' : 'fail'}`);
if (!identityOk) fail.push('identityDisclosed');

// Stronger and simpler than scanning for template writes: the pure module never
// touches stdout at all, so no string can leave it by that route.
const noStdout = typeof src === 'string' && !src.includes('process.stdout');
say(`module_never_writes_stdout=${noStdout ? 'pass' : 'fail'}`);
if (!noStdout) fail.push('process.stdout');

// The CLI names its own bin, so a packaging change that drops it is visible here.
const binNameOk = typeof cli === 'string' && cli.includes('dsh-compat-correspondence');
say(`cli_declares_bin_name=${binNameOk ? 'pass' : 'fail'}`);
if (!binNameOk) fail.push('bin-name');

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
  "$NODE" "$RUN/static-contract.mjs" > "$RUN/static-contract.log" 2>&1
static_rc=$?
# Relay to stdout only: the launcher is the sole writer of unit.log and redirects
# this payload's stdout there. The payload must NOT append to unit.log itself.
cat "$RUN/static-contract.log" 2>/dev/null || addwf static-log-relay
printf 'static_contract_rc=%s\n' "$static_rc" >> "$RUN/static-contract.log" 2>/dev/null \
  || addwf static-contract-rc-line

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

# ---------------------------------------------------------------- 5c. output checker
cat > "$RUN/check-output.mjs" <<'CHECKER' || { addwf checker-write; die 73 "cannot write check-output.mjs"; }
// Reads one CLI stdout document and asserts the facts the design fixes for that
// mode. Output goes to stderr on failure only; exit 0 means the mode's facts held.
import { readFileSync } from 'node:fs';

const [mode, path] = process.argv.slice(2);
let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch (error) {
  process.stderr.write(`unreadable: ${error.message}\n`);
  process.exit(1);
}
if (raw.trim() === '') {
  process.stderr.write('empty document\n');
  process.exit(1);
}
let doc;
try {
  doc = JSON.parse(raw);
} catch (error) {
  process.stderr.write(`not json: ${error.message}\n`);
  process.exit(1);
}
if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
  process.stderr.write('document is not a JSON object\n');
  process.exit(1);
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
  if (counts.findings !== undefined && counts.findings !== 1) {
    problems.push(`counts.findings=${JSON.stringify(counts.findings)}`);
  }
  if (!Array.isArray(doc.findings) || doc.findings.length === 0) {
    problems.push('findings is not a non-empty array');
  }
  if (!flat.includes('CORRESPONDENCE_PLUGIN_NOT_DECLARED')) {
    problems.push('no CORRESPONDENCE_PLUGIN_NOT_DECLARED finding');
  }
  if (flat.includes('example.plugin-gamma') || flat.includes('example-a')) {
    problems.push('identity text leaked into the output');
  }
  if (doc.identityDisclosed !== false) {
    problems.push(`identityDisclosed=${JSON.stringify(doc.identityDisclosed)}`);
  }
} else if (mode === 'stale') {
  const refusedMarked =
    doc.refused === true ||
    doc.status === 'refused' ||
    doc.code === 'CORRESPONDENCE_STALE' ||
    doc.refusal === 'CORRESPONDENCE_STALE' ||
    (Array.isArray(doc.findings) &&
      doc.findings.some((f) => JSON.stringify(f).includes('CORRESPONDENCE_STALE')));
  note(`stale_refused_marked=${refusedMarked ? 'yes' : 'no'}`);
  if (!refusedMarked) problems.push('document does not mark a refusal');
  if (!flat.includes('CORRESPONDENCE_STALE')) problems.push('no CORRESPONDENCE_STALE code');
  if (flat.includes('example.plugin-gamma')) problems.push('identity text leaked into the output');
} else {
  problems.push(`unknown mode: ${mode}`);
}

if (problems.length > 0) {
  process.stderr.write(`check failed: ${problems.join('; ')}\n`);
  process.exit(1);
}
note('check=pass');
process.exit(0);
CHECKER

# Gate BEFORE the demos: the checker must not be judged on top of an already
# broken evidence set.
if [ "$write_fail" -ne 0 ]; then evidence_stop before-demos; fi

# ---------------------------------------------------------------- 5e. shipped demo
# The three shipped example files are what the design's §7 landing names. Run the
# shipped command on them, inside the same sandbox. The third pair asserts a
# plugin that is deliberately not declared, so the design fixes this at exit 1
# with exactly one finding.
#
# This is a smoke check of one fixture, not a survey: it says nothing about any
# real profile or any real declaration.
say 'payload: running the shipped example'
demo_out="$RUN/example.stdout.json"
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$PKG" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     "$NODE" src/correspondence-cli.js "$CORR" --profile "$PROFILE_EX" --declaration "$DECL_EX" \
  > "$demo_out" 2> "$RUN/example.stderr.txt"
demo_rc=$?
printf 'example_rc=%s\n' "$demo_rc" > "$RUN/example.rc" || addwf example.rc
demo_verdict=fail
if [ "$demo_rc" -eq 1 ] && [ -s "$demo_out" ]; then
  if "$NODE" "$RUN/check-output.mjs" demo "$demo_out" > "$RUN/example-check.log" 2> "$RUN/example-check.err.txt"; then
    demo_verdict=pass
  fi
fi
cat "$RUN/example-check.log" 2>/dev/null || :
printf 'example_verdict=%s\n' "$demo_verdict" > "$RUN/example-verdict.txt" || addwf example-verdict.txt

# ---------------------------------------------------------------- 5f. stale bindings
# The binding check is what stops a correspondence from being replayed against
# different bytes. Flip ONE hex character of profileSha256 — nothing else — and the
# command must refuse with CORRESPONDENCE_STALE at exit 2, not report a mismatch.
cat > "$RUN/make-stale.mjs" <<'STALE' || { addwf stale-writer; die 73 "cannot write make-stale.mjs"; }
// Copies the correspondence and flips exactly one hex digit of one binding, so the
// only difference between the two runs is a single character of one sha256.
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(input, 'utf8'));
const digest = doc?.bindings?.profileSha256;
if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
  process.stderr.write('profileSha256 is not 64 lowercase hex characters\n');
  process.exit(1);
}
const first = digest[0];
const flipped = first === '0' ? '1' : '0';
doc.bindings.profileSha256 = `${flipped}${digest.slice(1)}`;
writeFileSync(output, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
process.stdout.write(`flipped=${first}->${flipped}\n`);
STALE

stale_doc="$RUN/stale-correspondence.json"
stale_verdict=fail
if "$NODE" "$RUN/make-stale.mjs" "$CORR" "$stale_doc" > "$RUN/stale-flip.log" 2>&1; then
  stale_out="$RUN/stale.stdout.json"
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$PKG" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
       NODE_OPTIONS=--max-old-space-size=192 \
       "$NODE" src/correspondence-cli.js "$stale_doc" --profile "$PROFILE_EX" --declaration "$DECL_EX" \
    > "$stale_out" 2> "$RUN/stale.stderr.txt"
  stale_rc=$?
  printf 'stale_rc=%s\n' "$stale_rc" > "$RUN/stale.rc" || addwf stale.rc
  if [ "$stale_rc" -eq 2 ] && [ -s "$stale_out" ]; then
    if "$NODE" "$RUN/check-output.mjs" stale "$stale_out" > "$RUN/stale-check.log" 2> "$RUN/stale-check.err.txt"; then
      stale_verdict=pass
    fi
  fi
  cat "$RUN/stale-check.log" 2>/dev/null || :
else
  printf 'stale_flip=fail\n' > "$RUN/stale.rc" 2>/dev/null || addwf stale.rc
fi
printf 'stale_verdict=%s\n' "$stale_verdict" > "$RUN/stale-verdict.txt" || addwf stale-verdict.txt

# ---------------------------------------------------------------- 6. the workload
say 'payload: starting the workload'
{
  printf 'node=%s\n' "$NODE"
  printf 'workdir=%s\n' "$PKG"
  printf 'test_files=%s\n' 'tests/correspondence.test.js'
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
# scratch it needs for its fixtures (mkdtemp); `--die-with-parent` ties the sandbox
# to this process so nothing survives the unit.
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$PKG" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     "$NODE" --test --test-concurrency=1 --test-reporter=tap tests/correspondence.test.js \
  > "$RUN/node-tap.log" 2> "$RUN/node-stderr.log"
node_rc=$?
printf 'node_rc=%s\n' "$node_rc" > "$RUN/node.rc" || addwf node.rc
# Relay to stdout only; the launcher owns unit.log.
cat "$RUN/node-tap.log" 2>/dev/null || addwf tap-relay

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

# The test count is deliberately not pinned: a suite that grows must still pass,
# and a suite that shrinks to nothing must not.
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
  elif [ "$fail" != 0 ]; then
    verdict=tap_fail_nonzero
  elif [ "$pass" != "$tests" ]; then
    verdict=tap_pass_ne_tests
  elif [ "$cancelled" != 0 ]; then
    verdict=tap_cancelled_nonzero
  elif [ "$skipped" != 0 ]; then
    verdict=tap_skipped_nonzero
  elif [ "$todo" != 0 ]; then
    verdict=tap_todo_nonzero
  elif [ "$node_rc" -ne 0 ]; then
    verdict=node_rc_nonzero
  elif [ "$demo_verdict" != pass ]; then
    verdict="example_${demo_verdict}"
  elif [ "$stale_verdict" != pass ]; then
    verdict="stale_${stale_verdict}"
  fi
fi
printf 'acc_smoke_verdict=%s\nacc_example=%s\nacc_stale=%s\n' "$verdict" "$demo_verdict" "$stale_verdict" \
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
