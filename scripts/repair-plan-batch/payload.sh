#!/bin/bash
# In-envelope payload for the dsh-compat-repair acceptance batch.
#
# STATUS: PREPARED. Nothing in this file has been run on these bytes.
#
# Runs INSIDE the transient unit. It verifies its own envelope, refuses to start
# the workload if anything is off, and only then runs the repository's suite.
#
# Logging: this payload NEVER writes unit.log. The launcher is the single writer
# of unit.log and redirects this process's stdout/stderr there; the payload only
# relays its logs to stdout. Every record this payload keeps lives under $RUN.
#
# What it can establish: that the repair package is a closed-schema validator plus
# a preview that writes nothing, that the plan vocabulary is one element wide, that
# a stale precondition is refused, and that its own suite passes on these bytes.
#
# What it cannot establish: that any repair is safe, approved or applicable. There
# is no apply path in this delivery, and this batch never writes a document.
#
# Exit codes: 0 green; 70 envelope refusal; 71 static contract failed; 72 test
# verdict not green; 73 an evidence write failed.

set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/repair
SLICE=$REPO/scripts/repair-plan-batch
NODE=/www/server/nodejs/v24.21.0/bin/node

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200
EXPECT_EXPORTS="|./src/repair-plan.js|./src/repair-preview.js|./src/repair-approval.js|./src/repair-apply.js|./src/fixture-applier.js|"
EXPECT_PLAN_VERSION='repair-plan/0.1-draft.1'

write_fail=0
addwf() { write_fail=$((write_fail + 1)); printf 'payload: evidence write failed: %s\n' "$1" >&2; }
die() { printf 'payload: %s\n' "$2" >&2; exit "$1"; }
wr() { cat > "$1" || return 1; [ -s "$1" ] || return 1; }
say() { printf '%s\n' "$*"; }
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }

# Strict single-value readback for anything COMPARED against a limit. A file must
# yield EXACTLY one non-empty line; `head -n 1` would silently accept the first of
# several differing lines, and an empty read is reported as unreadable instead of
# being allowed to compare equal to an expected value.
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
[ -d "$PKG" ] || die 70 "repair package missing: $PKG"
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

# RuntimeMaxUSec is read through busctl in two steps: `GetUnit` yields the object
# path, then `get-property` asks for exactly one property of that object.
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
# An unreadable or ambiguous value is itself a mismatch: a failed query must never
# widen the set of envelopes this batch accepts.
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

evidence_stop() { # marker
  printf 'acc_evidence_write_failures=%s\nacc_stop_at=%s\nacc_workload_started=no\n' \
    "$write_fail" "$1" > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say "payload: $write_fail evidence write failure(s) at $1; stopping (73) before proceeding"
  exit 73
}

# ---------------------------------------------------------------- 4. syntax of the batch
if [ "$write_fail" -ne 0 ]; then evidence_stop before-syntax; fi
bash -n "$SLICE/run.sh"
acc_syntax_run_sh_rc=$?
bash -n "$SLICE/payload.sh"
acc_syntax_payload_sh_rc=$?
printf 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
  "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" > "$RUN/syntax.txt" || addwf syntax.txt
[ "$acc_syntax_run_sh_rc" -eq 0 ] || die 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"
[ "$acc_syntax_payload_sh_rc" -eq 0 ] || die 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"

# ---------------------------------------------------------------- 5. static contract
cat > "$RUN/static-contract.mjs" <<'CONTRACT' || { addwf static-contract-write; die 73 "cannot write static-contract.mjs"; }
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = process.env.EXPECT_PKG_DIR;
const expectExports = process.env.EXPECT_EXPORTS;
const expectPlanVersion = process.env.EXPECT_PLAN_VERSION;
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
say(`name_exact=${manifest.name === 'dsh-compat-repair' ? 'pass' : 'fail'}`);
say(`private=${manifest.private === true ? 'pass' : 'fail'}`);
say(`type_module=${manifest.type === 'module' ? 'pass' : 'fail'}`);
if (manifest.name !== 'dsh-compat-repair') fail.push('name');
if (manifest.private !== true) fail.push('private');
if (manifest.type !== 'module') fail.push('type');

for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const names = Object.keys(manifest[field] ?? {});
  say(`no_${field}=${names.length === 0 ? 'pass' : 'fail'}`);
  if (names.length !== 0) fail.push(field);
}

const seen = [];
for (const [key, value] of Object.entries(manifest.exports ?? {})) {
  if (typeof value !== 'string') { say(`export_not_string ${key}=fail`); fail.push(`export:${key}`); continue; }
  const target = value.replace(/^\.\//, '');
  const ok = existsSync(join(pkgDir, target));
  say(`export_target ${key}=${ok ? 'yes' : 'no'}`);
  if (!ok) fail.push(`target:${target}`);
  seen.push(target);
}
const wanted = expectExports.split('|').filter(Boolean).map((p) => p.replace(/^\.\//, ''));
for (const need of wanted) {
  const present = seen.includes(need);
  say(`export_declared ${need}=${present ? 'pass' : 'fail'}`);
  if (!present) fail.push(`declared:${need}`);
}

const plan = await import(join(pkgDir, 'src/repair-plan.js'));
const preview = await import(join(pkgDir, 'src/repair-preview.js'));

say(`plan_version_exact=${plan.PLAN_VERSION === expectPlanVersion ? 'pass' : 'fail'}`);
if (plan.PLAN_VERSION !== expectPlanVersion) fail.push('plan-version');
say(`operation_vocabulary_width=${plan.OPERATION_KINDS.length}`);
if (plan.OPERATION_KINDS.length !== 1) fail.push('vocabulary-width');
say(`flag_fields=${plan.FLAG_FIELDS.join(',')}`);
if (plan.FLAG_FIELDS.join(',') !== 'disabled') fail.push('flag-fields');
say(`confined_apply_limitation=${plan.PLAN_LIMITATIONS.includes('APPLY_PATH_IS_CONFINED_TO_A_FIXTURE_DIRECTORY') ? 'pass' : 'fail'}`);
if (!plan.PLAN_LIMITATIONS.includes('APPLY_PATH_IS_CONFINED_TO_A_FIXTURE_DIRECTORY')) fail.push('confined-apply-limitation');
say(`stale_no_apply_claim=${plan.PLAN_LIMITATIONS.includes('NO_APPLY_PATH_EXISTS_IN_THIS_DELIVERY') ? 'fail' : 'pass'}`);
if (plan.PLAN_LIMITATIONS.includes('NO_APPLY_PATH_EXISTS_IN_THIS_DELIVERY')) fail.push('stale-no-apply-claim');

// The pure modules must export no writer at all; the single writer is the applier.
const approval = await import(join(pkgDir, 'src/repair-approval.js'));
const apply = await import(join(pkgDir, 'src/repair-apply.js'));
const applier = await import(join(pkgDir, 'src/fixture-applier.js'));
const forbidden = /^(apply|write|save|commit|install|exec|run)/i;
for (const [moduleName, module] of Object.entries({ plan, preview, approval, apply })) {
  for (const [name, value] of Object.entries(module)) {
    if (typeof value !== 'function') continue;
    if (forbidden.test(name)) { say(`writer_export ${moduleName}.${name}=fail`); fail.push(`writer:${moduleName}.${name}`); }
  }
}
const writers = Object.keys(applier)
  .filter((name) => typeof applier[name] === 'function' && /^(apply|write|restore|save|commit)/i.test(name))
  .sort();
say(`applier_writers=${writers.join(',') || 'none'}`);
if (writers.join(',') !== 'applyApproved,restoreFixture') fail.push('applier-writers');
say(`applier_byte_ceiling=${applier.MAX_FIXTURE_BYTES}`);
if (applier.MAX_FIXTURE_BYTES !== 1048576) fail.push('applier-ceiling');

say(`static_contract=${fail.length === 0 ? 'pass' : 'fail'}`);
say(`static_contract_failures=${fail.join(',') || 'none'}`);
process.exit(fail.length === 0 ? 0 : 1);
CONTRACT

if [ "$write_fail" -ne 0 ]; then evidence_stop before-static-node; fi
env -i PATH=/usr/bin:/bin HOME=/tmp \
  NODE_OPTIONS=--max-old-space-size=192 \
  EXPECT_PKG_DIR="$PKG" \
  EXPECT_EXPORTS="$EXPECT_EXPORTS" \
  EXPECT_PLAN_VERSION="$EXPECT_PLAN_VERSION" \
  "$NODE" "$RUN/static-contract.mjs" > "$RUN/static-contract.log" 2>&1
static_rc=$?
cat "$RUN/static-contract.log" 2>/dev/null || addwf static-log-relay
printf 'static_contract_rc=%s\n' "$static_rc" >> "$RUN/static-contract.log" 2>/dev/null \
  || addwf static-contract-rc-line
if [ "$static_rc" -ne 0 ]; then
  printf 'acc_static_contract=fail\n' > "$RUN/static-verdict.txt" || addwf static-verdict.txt
  die 71 "static contract failed (rc=$static_rc)"
fi
printf 'acc_static_contract=pass\n' > "$RUN/static-verdict.txt" || addwf static-verdict.txt

# ---------------------------------------------------------------- 5b. evidence gate
if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s) before the workload; refusing to start it"
  exit 73
fi

# ---------------------------------------------------------------- 5c. example preview
# The shipped example must render a ready preview and must not change the fixture.
# The digest before and after the preview run are compared: a preview that wrote
# would show up as a changed document, and this batch would fail rather than pass.
if [ "$write_fail" -ne 0 ]; then evidence_stop before-example; fi
EX_FIXTURE=$REPO/examples/repair/profile.yml
EX_PLAN=$REPO/examples/repair/plan.json
example_before=$(sha256sum "$EX_FIXTURE" 2>/dev/null | awk '{print $1}')
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$REPO" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     "$NODE" examples/repair/preview.mjs \
  > "$RUN/example-preview.txt" 2> "$RUN/example-preview.err"
example_rc=$?
example_after=$(sha256sum "$EX_FIXTURE" 2>/dev/null | awk '{print $1}')
example_verdict=pass
[ "$example_rc" -eq 0 ] || example_verdict="rc_$example_rc"
grep -q '^preview: ready$' "$RUN/example-preview.txt" || example_verdict=fail_preview
grep -q '^nothing was written; no apply path exists$' "$RUN/example-preview.txt" || example_verdict=fail_no_write_line
[ -n "$example_before" ] && [ "$example_before" = "$example_after" ] || example_verdict=fixture_changed
printf 'example_rc=%s\nexample_verdict=%s\nfixture_before=%s\nfixture_after=%s\n' \
  "$example_rc" "$example_verdict" "${example_before:-<unreadable>}" "${example_after:-<unreadable>}" \
  > "$RUN/example-verdict.txt" || addwf example-verdict.txt
[ "$example_verdict" = pass ] || die 72 "example preview did not behave ($example_verdict)"

# ---------------------------------------------------------------- 5d. four paths
# The approval and apply paths are exercised on a **copy** of the example fixture inside
# the sandbox's private /tmp. Four outcomes must be distinguishable, the two refusals must
# leave the copy untouched, and the example fixture in the checkout must not change.
if [ "$write_fail" -ne 0 ]; then evidence_stop before-four-paths; fi
fp_fixture=$REPO/examples/repair/profile.yml
fp_before=$(sha256sum "$fp_fixture" 2>/dev/null | awk '{print $1}')
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$REPO" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     "$NODE" examples/repair/four-paths.mjs \
  > "$RUN/four-paths.txt" 2> "$RUN/four-paths.err"
fp_rc=$?
fp_after=$(sha256sum "$fp_fixture" 2>/dev/null | awk '{print $1}')
four_verdict=pass
[ "$fp_rc" -eq 0 ] || four_verdict="rc_$fp_rc"
grep -q '^four-paths: pass ' "$RUN/four-paths.txt" || four_verdict=fail_not_pass
grep -q '"status": "refused"' "$RUN/four-paths.txt" || four_verdict=fail_no_refusal
grep -q '"status": "partial"' "$RUN/four-paths.txt" || four_verdict=fail_no_partial
grep -q '"status": "restored"' "$RUN/four-paths.txt" || four_verdict=fail_no_recovery
grep -q '"untouched": true' "$RUN/four-paths.txt" || four_verdict=fail_touched
[ -n "$fp_before" ] && [ "$fp_before" = "$fp_after" ] || four_verdict=fixture_changed
printf 'four_paths_rc=%s\nfour_paths_verdict=%s\nfixture_before=%s\nfixture_after=%s\n' \
  "$fp_rc" "$four_verdict" "${fp_before:-<unreadable>}" "${fp_after:-<unreadable>}" \
  > "$RUN/four-paths-verdict.txt" || addwf four-paths-verdict.txt
[ "$four_verdict" = pass ] || die 72 "four-path demonstration did not behave ($four_verdict)"

# ---------------------------------------------------------------- 6. the workload
say 'payload: starting the workload'
{
  printf 'node=%s\n' "$NODE"
  printf 'workdir=%s\n' "$PKG"
  printf 'test_glob=%s\n' 'tests/*.test.js'
} > "$RUN/workload.txt" || addwf workload.txt
if [ "$write_fail" -ne 0 ]; then
  say 'payload: evidence write failed before the workload; not starting it'
  exit 73
fi

# `--ro-bind / /` keeps the checkout visible and mounted read-only; `--tmpfs /tmp`
# is the writable private scratch the suite may need; `--die-with-parent` ties the
# sandbox to this process so nothing survives the unit.
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$PKG" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     "$NODE" --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.js' \
  > "$RUN/node-tap.log" 2> "$RUN/node-stderr.log"
node_rc=$?
printf 'node_rc=%s\n' "$node_rc" > "$RUN/node.rc" || addwf node.rc
cat "$RUN/node-tap.log" 2>/dev/null || addwf tap-relay

# ---------------------------------------------------------------- 6b. peaks
# Read from this unit's own cgroup while it still exists. These are measurements of
# the whole unit (payload + sandboxed suite), not of the suite alone.
{
  printf 'memory_peak_bytes=%s\n' "$(knob1 "$CGROUP/memory.peak")"
  printf 'pids_peak=%s\n' "$(knob1 "$CGROUP/pids.peak")"
} >> "$RUN/envelope-cgroup.txt" || addwf envelope-cgroup.txt
{
  printf 'memory_peak_bytes=%s\n' "$(knob1 "$CGROUP/memory.peak")"
  printf 'pids_peak=%s\n' "$(knob1 "$CGROUP/pids.peak")"
} > "$RUN/peaks.txt" || addwf peaks.txt

# ---------------------------------------------------------------- 7. TAP fields
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
    verdict=tap_tests_unreadable
  elif ! is_num "$pass" || ! is_num "$fail"; then
    verdict=tap_pass_or_fail_unreadable
  elif [ "$fail" -ne 0 ]; then
    verdict="tap_fail:${fail}"
  elif [ "$pass" -ne "$tests" ]; then
    verdict="tap_pass_short:${pass}/${tests}"
  fi
fi
[ "$node_rc" -eq 0 ] || verdict="node_rc:${node_rc}"
if [ "$verdict" = pass ] && [ "$example_verdict" != pass ]; then verdict="example_${example_verdict}"; fi
if [ "$verdict" = pass ] && [ "$four_verdict" != pass ]; then verdict="four_paths_${four_verdict}"; fi
printf 'tests_exit=%s\nverdict=%s\n' "$node_rc" "$verdict" > "$RUN/tap-verdict.txt" || addwf tap-verdict.txt

if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s); the verdict cannot be recorded"
  exit 73
fi
if [ "$verdict" != pass ]; then
  say "payload: verdict=$verdict"
  exit 72
fi
say 'payload: verdict=pass'
exit 0
