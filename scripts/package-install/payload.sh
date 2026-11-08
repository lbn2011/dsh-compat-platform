#!/bin/bash
# In-envelope payload for the packaging acceptance batch (S5).
#
# STATUS: PREPARED. Nothing in this file has been run on these bytes.
#
# Runs INSIDE the transient unit. It verifies its own envelope, refuses to start the
# workload if anything is off, and only then packs and installs.
#
# What it can establish: that each package's tarball contains what its `files` list and
# export map promise, that the four tarballs plus the one dependency install into a
# directory with no sibling checkout, and that every documented subpath imports from
# there by package specifier.
#
# What it cannot establish: that anything is publishable, that the versions are right for
# a registry, or that a consumer's own runtime matches this one. `private: true` stays in
# every manifest; nothing is published.
#
# Exit codes: 0 green; 70 envelope refusal; 71 static contract failed; 72 a step failed;
# 73 an evidence write failed.

set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
SLICE=$REPO/scripts/package-install
NODE=/www/server/nodejs/v24.21.0/bin/node
NPM=/www/server/nodejs/v24.21.0/bin/npm

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200

write_fail=0
addwf() { write_fail=$((write_fail + 1)); printf 'payload: evidence write failed: %s\n' "$1" >&2; }
die() { printf 'payload: %s\n' "$2" >&2; exit "$1"; }
wr() { cat > "$1" || return 1; [ -s "$1" ] || return 1; }
say() { printf '%s\n' "$*"; }
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }

# Strict single-value readback for anything COMPARED against a limit.
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
[ -x "$NODE" ] || die 70 "node binary missing: $NODE"
[ -x "$NPM" ] || die 70 "npm binary missing: $NPM"
for d in analyzer host runtime repair; do
  [ -d "$REPO/packages/$d" ] || die 70 "package directory missing: $d"
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

evidence_stop() { # marker
  printf 'acc_evidence_write_failures=%s\nacc_stop_at=%s\nacc_workload_started=no\n' \
    "$write_fail" "$1" > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say "payload: $write_fail evidence write failure(s) at $1; stopping (73) before proceeding"
  exit 73
}

# ---------------------------------------------------------------- 4. syntax
if [ "$write_fail" -ne 0 ]; then evidence_stop before-syntax; fi
bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
"$NODE" --check "$SLICE/consumer-check.mjs" > "$RUN/syntax-consumer.txt" 2>&1
acc_syntax_consumer_rc=$?
printf 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\nacc_syntax_consumer_rc=%s\n' \
  "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" "$acc_syntax_consumer_rc" > "$RUN/syntax.txt" || addwf syntax.txt
[ "$acc_syntax_run_sh_rc" -eq 0 ] || die 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"
[ "$acc_syntax_payload_sh_rc" -eq 0 ] || die 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"
[ "$acc_syntax_consumer_rc" -eq 0 ] || die 71 "consumer-check.mjs does not parse (rc=$acc_syntax_consumer_rc)"

# ---------------------------------------------------------------- 5. static contract
cat > "$RUN/static-contract.mjs" <<'CONTRACT' || { addwf static-contract-write; die 73 "cannot write static-contract.mjs"; }
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.env.EXPECT_REPO;
const fail = [];
const say = (line) => process.stdout.write(`${line}\n`);

const expected = {
  analyzer: { name: 'dsh-compat-platform', version: '0.0.0' },
  host: { name: 'dsh-compat-diagnostics-ui', version: '0.0.0-draft.1' },
  runtime: { name: 'dsh-compat-trusted-extraction', version: '0.0.0-draft.1' },
  repair: { name: 'dsh-compat-repair', version: '0.0.0-draft.1' },
};

for (const [dir, want] of Object.entries(expected)) {
  const base = join(repo, 'packages', dir);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
  } catch {
    say(`manifest_${dir}=fail`);
    fail.push(`manifest:${dir}`);
    continue;
  }
  say(`name_${dir}=${manifest.name === want.name ? 'pass' : 'fail'}`);
  if (manifest.name !== want.name) fail.push(`name:${dir}`);
  say(`version_${dir}=${manifest.version === want.version ? 'pass' : 'fail'}`);
  if (manifest.version !== want.version) fail.push(`version:${dir}`);
  say(`private_${dir}=${manifest.private === true ? 'pass' : 'fail'}`);
  if (manifest.private !== true) fail.push(`private:${dir}`);
  say(`type_${dir}=${manifest.type === 'module' ? 'pass' : 'fail'}`);
  if (manifest.type !== 'module') fail.push(`type:${dir}`);
  const deps = Object.keys(manifest.dependencies ?? {});
  if (dir === 'analyzer') {
    const ok = deps.length === 1 && deps[0] === 'yaml' && manifest.dependencies.yaml === '2.9.1';
    say(`deps_${dir}=${ok ? 'pass' : 'fail'}:${deps.join(',')}`);
    if (!ok) fail.push(`deps:${dir}`);
  } else {
    const ok = deps.length === 0;
    say(`deps_${dir}=${ok ? 'pass' : 'fail'}:${deps.join(',')}`);
    if (!ok) fail.push(`deps:${dir}`);
  }
  // An export target is either a bare path or a conditional object ({types, default}).
  // Both forms must name files that exist; a conditional object is checked key by key,
  // so an unknown condition cannot smuggle in a missing path.
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    const pairs = [];
    if (typeof target === 'string') {
      pairs.push(['', target]);
    } else if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
      for (const [condition, path] of Object.entries(target)) pairs.push([`#${condition}`, path]);
    } else {
      say(`export_not_path_or_object ${dir}${key}=fail`);
      fail.push(`export-type:${dir}${key}`);
      continue;
    }
    if (pairs.length === 0) {
      say(`export_empty_object ${dir}${key}=fail`);
      fail.push(`export-empty:${dir}${key}`);
      continue;
    }
    for (const [suffix, path] of pairs) {
      const ok = typeof path === 'string'
        && path.length > 0
        && existsSync(join(base, path.replace(/^\.\//, '')));
      say(`export_target ${dir}${key}${suffix}=${ok ? 'yes' : 'no'}`);
      if (!ok) fail.push(`target:${dir}${key}${suffix}`);
    }
  }
  const files = manifest.files;
  if (!Array.isArray(files) || files.length === 0) {
    say(`files_${dir}=missing`);
    fail.push(`files:${dir}`);
  } else {
    say(`files_${dir}=${files.join(',')}`);
  }
}

say(`static_contract=${fail.length === 0 ? 'pass' : 'fail'}`);
say(`static_contract_failures=${fail.join(',') || 'none'}`);
process.exit(fail.length === 0 ? 0 : 1);
CONTRACT

if [ "$write_fail" -ne 0 ]; then evidence_stop before-static-node; fi
env -i PATH=/usr/bin:/bin HOME=/tmp \
  NODE_OPTIONS=--max-old-space-size=192 \
  EXPECT_REPO="$REPO" \
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

if [ "$write_fail" -ne 0 ]; then evidence_stop before-pack; fi

# ---------------------------------------------------------------- 6. pack
# `npm pack` reads the package directory and writes one tarball. It never contacts a
# registry: --offline is passed and a missing tarball is a failure, not a download.
ART=$RUN/artifacts
NPMHOME=$RUN/npmhome
mkdir -p "$ART" "$NPMHOME" "$NPMHOME/cache" || die 73 "cannot create pack directories"
pack_one() { # dir label
  local dir=$1 label=$2
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --bind "$ART" "$ART" --bind "$NPMHOME" "$NPMHOME" \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$REPO/packages/$dir" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin:/www/server/nodejs/v24.21.0/bin \
       HOME="$NPMHOME" TMPDIR=/tmp \
       "$NPM" pack --offline --cache "$NPMHOME/cache" --pack-destination "$ART" \
    > "$RUN/pack-$label.out" 2> "$RUN/pack-$label.err"
  printf '%s\n' "$?" > "$RUN/pack-$label.rc"
  return 0
}
pack_one analyzer analyzer
pack_one host host
pack_one runtime runtime
pack_one repair repair
# The one dependency, packed from the copy the analyzer already resolved.
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --bind "$ART" "$ART" --bind "$NPMHOME" "$NPMHOME" \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$REPO/packages/analyzer/node_modules/yaml" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin:/www/server/nodejs/v24.21.0/bin \
     HOME="$NPMHOME" TMPDIR=/tmp \
     "$NPM" pack --offline --cache "$NPMHOME/cache" --pack-destination "$ART" \
  > "$RUN/pack-yaml.out" 2> "$RUN/pack-yaml.err"
printf '%s\n' "$?" > "$RUN/pack-yaml.rc"

pack_bad=''
for label in analyzer host runtime repair yaml; do
  rc=$(cat "$RUN/pack-$label.rc" 2>/dev/null || printf '?')
  [ "$rc" = 0 ] || pack_bad="$pack_bad $label(rc=$rc)"
done
ls -1 "$ART"/*.tgz > "$RUN/tarballs.txt" 2>/dev/null || true
count=$(wc -l < "$RUN/tarballs.txt" 2>/dev/null || printf 0)
[ "$count" -eq 5 ] || pack_bad="$pack_bad tarballs=$count"
printf 'pack_failures=%s\ntarballs=%s\n' "${pack_bad:-none}" "$count" > "$RUN/pack-verdict.txt" || addwf pack-verdict.txt
[ -z "$pack_bad" ] || die 72 "packing failed:$pack_bad"

# Tarball identities: name, size, sha256, and the file count npm reported.
{
  for t in "$ART"/*.tgz; do
    printf '%s  %s  %sB\n' "$(sha256sum "$t" | awk '{print $1}')" "$(basename "$t")" "$(stat -c %s "$t")"
  done
} > "$RUN/tarball-hashes.txt" || addwf tarball-hashes.txt
# npm writes its notice block to stderr, not stdout: read both, and let an empty
# file mean "npm did not report a count" rather than an evidence write failure.
{
  for f in "$RUN"/pack-*.out "$RUN"/pack-*.err; do
    [ -f "$f" ] || continue
    grep -h 'total files' "$f" 2>/dev/null || true
  done
} > "$RUN/tarball-file-counts.txt" || addwf tarball-file-counts.txt

# ---------------------------------------------------------------- 7. consumer install
CONSUMER=$RUN/consumer
mkdir -p "$CONSUMER" || die 73 "cannot create consumer directory"
printf '{"name":"package-install-consumer","private":true,"type":"module"}\n' > "$CONSUMER/package.json" \
  || die 73 "cannot write consumer manifest"
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --bind "$CONSUMER" "$CONSUMER" --bind "$NPMHOME" "$NPMHOME" \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$CONSUMER" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin:/www/server/nodejs/v24.21.0/bin \
     HOME="$NPMHOME" TMPDIR=/tmp \
     "$NPM" install --offline --cache "$NPMHOME/cache" --no-audit --no-fund "$ART"/*.tgz \
  > "$RUN/install.out" 2> "$RUN/install.err"
install_rc=$?
printf 'install_rc=%s\n' "$install_rc" > "$RUN/install-verdict.txt" || addwf install-verdict.txt
[ "$install_rc" -eq 0 ] || die 72 "consumer install failed (rc=$install_rc)"
node -e "const m=require('$CONSUMER/node_modules/dsh-compat-platform/package.json');console.log(m.name+'@'+m.version)" \
  > "$RUN/install-facts.txt" 2>&1 || addwf install-facts

# ---------------------------------------------------------------- 8. consumer probe
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --bind "$CONSUMER" "$CONSUMER" \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$CONSUMER" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin \
     HOME=/tmp TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=192 \
     CONSUMER_DIR="$CONSUMER" EXPECT_FILE="$SLICE/expect.json" \
     "$NODE" "$SLICE/consumer-check.mjs" \
  > "$RUN/consumer-check.txt" 2> "$RUN/consumer-check.err"
consumer_rc=$?
printf 'consumer_rc=%s\n' "$consumer_rc" > "$RUN/consumer-verdict.txt" || addwf consumer-verdict.txt
grep -c '^  ok  ' "$RUN/consumer-check.txt" > "$RUN/consumer-ok-count.txt" 2>/dev/null || printf '0\n' > "$RUN/consumer-ok-count.txt"
[ "$consumer_rc" -eq 0 ] || die 72 "consumer probe failed (rc=$consumer_rc)"

# ---------------------------------------------------------------- 8b. missing dependency
# The plan's gate: a deliberate missing peer must be recorded as a failure, not a skip.
# A copy of the working tree has the one dependency removed; importing a module that
# needs it must fail loudly rather than resolve to something else.
MISSING=$RUN/consumer-missing
rm -rf "$MISSING"
cp -a "$CONSUMER" "$MISSING" || die 72 "cannot copy the consumer tree"
rm -rf "$MISSING/node_modules/yaml" || die 72 "cannot remove the dependency from the copy"
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --bind "$MISSING" "$MISSING" \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$MISSING" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     "$NODE" --input-type=module -e "
       import('dsh-compat-platform/profile-dump').then(
         () => { console.log('missing_dep=resolved_unexpectedly'); process.exit(1) },
         (e) => {
           console.log('missing_dep=' + e.code);
           process.exit(e.code === 'ERR_MODULE_NOT_FOUND' ? 0 : 2);
         });
     " \
  > "$RUN/missing-dep.txt" 2> "$RUN/missing-dep.err"
missing_rc=$?
printf 'missing_dep_rc=%s\n' "$missing_rc" > "$RUN/missing-dep-verdict.txt" \
  || addwf missing-dep-verdict.txt
[ "$missing_rc" -eq 0 ] || die 72 "a missing dependency did not fail loudly (rc=$missing_rc)"

# ---------------------------------------------------------------- 9. peaks
{
  printf 'memory_peak_bytes=%s\n' "$(knob1 "$CGROUP/memory.peak")"
  printf 'pids_peak=%s\n' "$(knob1 "$CGROUP/pids.peak")"
} > "$RUN/peaks.txt" || addwf peaks.txt

if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s); the verdict cannot be recorded"
  exit 73
fi
say 'payload: verdict=pass'
exit 0
