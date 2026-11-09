#!/bin/bash
# In-envelope payload for the packaging acceptance batch (S5).
#
# SOURCE-ONLY migration to the canonical bounded runner (ABI bounded-runner/1,
# core commit c8123de). Awaiting Lead bounded verification. These bytes have not
# been executed, syntax-qualified, sourced or launched.
#
# Runs INSIDE the transient unit. The unit's identity, limits, ownership receipt
# and memory gate are enforced by the core BEFORE this body starts
# (`br_envelope_enter`): cgroup membership, InvocationID, memory.max,
# memory.swap.max, pids.max, cpu.max, Type=exec and RuntimeMaxUSec are read back
# by the core and this payload no longer restates them. What remains here is the
# workload: pack, install into a throwaway consumer, probe it, and prove a missing
# dependency fails loudly.
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
# npm is ALWAYS `--offline` with an explicit `--cache` under a HOME inside the run
# directory, so nothing can be fetched and no user npmrc/cache is consulted.
#
# Logging: this payload NEVER writes unit.log. The host is the single writer; the
# payload only relays its logs to stdout. Every record lives under $RUN.
#
# Exit codes: 0 green; 70 envelope/precondition refusal; 71 static contract failed;
# 72 a step failed; 73 an evidence write failed. Every exit after argument
# validation goes through `br_payload_finish`, so the host always sees a receipt.

set +e
set -uo pipefail

ROOT=/root/dsh-ecosystem-spec
REPO=$ROOT/projects/dsh-compat-platform
SLICE=$REPO/scripts/package-install
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
NPM=/www/server/nodejs/v24.21.0/bin/npm

source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70

[ "$#" -eq 2 ] || { printf 'usage: payload.sh UNIT RUN_DIR\n' >&2; exit 70; }
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1
BR_RUN=$2
RUN=$BR_RUN

refuse() { printf 'payload: %s\n' "$2" >&2; return "$1"; }
say() { printf '%s\n' "$*"; }
evidence_stop() { # marker; the counter belongs to this shell
  say "payload: $BR_WRITE_FAILURES evidence write failure(s) at $1; stopping (73) before proceeding"
  return 73
}

package_install_payload() {
  say "payload: unit=$BR_UNIT run=$RUN"

  # ------------------------------------------------------------ 0. envelope
  # Identity, limits, receipt and the memory gate are the core's, and they are
  # established BEFORE any subprocess; a non-zero return means the payload must not
  # run a single workload subprocess.
  br_envelope_enter "$BR_UNIT" "$BR_RUN" || return $?

  # ------------------------------------------------------------ 1. preconditions
  [ -x "$NODE" ] || refuse 70 "node binary missing: $NODE"
  [ -x "$NPM" ] || refuse 70 "npm binary missing: $NPM"
  for d in analyzer host runtime repair; do
    [ -d "$REPO/packages/$d" ] || refuse 70 "package directory missing: $d"
  done

  # ------------------------------------------------------------ 2. syntax
  br_evidence_gate || evidence_stop before-syntax
  bash -n "$SLICE/run.sh"; local acc_syntax_run_sh_rc=$?
  bash -n "$SLICE/payload.sh"; local acc_syntax_payload_sh_rc=$?
  "$NODE" --check "$SLICE/consumer-check.mjs" > "$RUN/syntax-consumer.txt" 2>&1
  local acc_syntax_consumer_rc=$?
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\nacc_syntax_consumer_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" "$acc_syntax_consumer_rc" || :
  [ "$acc_syntax_run_sh_rc" -eq 0 ] || { refuse 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"; return 71; }
  [ "$acc_syntax_payload_sh_rc" -eq 0 ] || { refuse 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"; return 71; }
  [ "$acc_syntax_consumer_rc" -eq 0 ] || { refuse 71 "consumer-check.mjs does not parse (rc=$acc_syntax_consumer_rc)"; return 71; }

  # ------------------------------------------------------------ 3. static contract
  cat > "$RUN/static-contract.mjs" <<'CONTRACT' || { br_write_failure static-contract-write; return 73; }
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

  br_evidence_gate || evidence_stop before-static-node
  env -i PATH=/usr/bin:/bin HOME=/tmp \
    NODE_OPTIONS=--max-old-space-size=192 \
    EXPECT_REPO="$REPO" \
    "$NODE" "$RUN/static-contract.mjs" > "$RUN/static-contract.log" 2>&1
  local static_rc=$?
  cat "$RUN/static-contract.log" 2>/dev/null || br_write_failure static-log-relay
  printf 'static_contract_rc=%s\n' "$static_rc" >> "$RUN/static-contract.log" 2>/dev/null \
    || br_write_failure static-contract-rc-line
  if [ "$static_rc" -ne 0 ]; then
    br_record "$RUN/static-verdict.txt" 'acc_static_contract=fail\n' || :
    refuse 71 "static contract failed (rc=$static_rc)"
    return 71
  fi
  br_record "$RUN/static-verdict.txt" 'acc_static_contract=pass\n' || :

  br_evidence_gate || evidence_stop before-pack

  # ------------------------------------------------------------ 4. pack
  # `npm pack` reads the package directory and writes one tarball. It never contacts a
  # registry: --offline is passed and a missing tarball is a failure, not a download.
  local ART=$RUN/artifacts
  local NPMHOME=$RUN/npmhome
  mkdir -p "$ART" "$NPMHOME" "$NPMHOME/cache" || { refuse 73 "cannot create pack directories"; return 73; }
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

  local pack_bad='' label rc
  for label in analyzer host runtime repair yaml; do
    rc=$(cat "$RUN/pack-$label.rc" 2>/dev/null || printf '?')
    [ "$rc" = 0 ] || pack_bad="$pack_bad $label(rc=$rc)"
  done
  ls -1 "$ART"/*.tgz > "$RUN/tarballs.txt" 2>/dev/null || true
  local count
  count=$(wc -l < "$RUN/tarballs.txt" 2>/dev/null || printf 0)
  [ "$count" -eq 5 ] || pack_bad="$pack_bad tarballs=$count"
  br_record "$RUN/pack-verdict.txt" 'pack_failures=%s\ntarballs=%s\n' "${pack_bad:-none}" "$count" || :
  [ -z "$pack_bad" ] || { refuse 72 "packing failed:$pack_bad"; return 72; }

  # Tarball identities: name, size, sha256, and the file count npm reported.
  {
    for t in "$ART"/*.tgz; do
      printf '%s  %s  %sB\n' "$(sha256sum "$t" | awk '{print $1}')" "$(basename "$t")" "$(stat -c %s "$t")"
    done
  } > "$RUN/tarball-hashes.txt" || br_write_failure tarball-hashes.txt
  # npm writes its notice block to stderr, not stdout: read both, and let an empty
  # file mean "npm did not report a count" rather than an evidence write failure.
  {
    for f in "$RUN"/pack-*.out "$RUN"/pack-*.err; do
      [ -f "$f" ] || continue
      grep -h 'total files' "$f" 2>/dev/null || true
    done
  } > "$RUN/tarball-file-counts.txt" || br_write_failure tarball-file-counts.txt

  # ------------------------------------------------------------ 5. consumer install
  local CONSUMER=$RUN/consumer
  mkdir -p "$CONSUMER" || { refuse 73 "cannot create consumer directory"; return 73; }
  printf '{"name":"package-install-consumer","private":true,"type":"module"}\n' > "$CONSUMER/package.json" \
    || { refuse 73 "cannot write consumer manifest"; return 73; }
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --bind "$CONSUMER" "$CONSUMER" --bind "$NPMHOME" "$NPMHOME" \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$CONSUMER" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin:/www/server/nodejs/v24.21.0/bin \
       HOME="$NPMHOME" TMPDIR=/tmp \
       "$NPM" install --offline --cache "$NPMHOME/cache" --no-audit --no-fund "$ART"/*.tgz \
    > "$RUN/install.out" 2> "$RUN/install.err"
  local install_rc=$?
  br_record "$RUN/install-verdict.txt" 'install_rc=%s\n' "$install_rc" || :
  [ "$install_rc" -eq 0 ] || { refuse 72 "consumer install failed (rc=$install_rc)"; return 72; }
  node -e "const m=require('$CONSUMER/node_modules/dsh-compat-platform/package.json');console.log(m.name+'@'+m.version)" \
    > "$RUN/install-facts.txt" 2>&1 || br_write_failure install-facts

  # ------------------------------------------------------------ 6. consumer probe
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --bind "$CONSUMER" "$CONSUMER" \
    --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$CONSUMER" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin \
       HOME=/tmp TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=192 \
       CONSUMER_DIR="$CONSUMER" EXPECT_FILE="$SLICE/expect.json" \
       "$NODE" "$SLICE/consumer-check.mjs" \
    > "$RUN/consumer-check.txt" 2> "$RUN/consumer-check.err"
  local consumer_rc=$?
  br_record "$RUN/consumer-verdict.txt" 'consumer_rc=%s\n' "$consumer_rc" || :
  grep -c '^  ok  ' "$RUN/consumer-check.txt" > "$RUN/consumer-ok-count.txt" 2>/dev/null || printf '0\n' > "$RUN/consumer-ok-count.txt"
  [ "$consumer_rc" -eq 0 ] || { refuse 72 "consumer probe failed (rc=$consumer_rc)"; return 72; }

  # ------------------------------------------------------------ 7. missing dependency
  # The plan's gate: a deliberate missing peer must be recorded as a failure, not a skip.
  # A copy of the working tree has the one dependency removed; importing a module that
  # needs it must fail loudly rather than resolve to something else.
  local MISSING=$RUN/consumer-missing
  rm -rf "$MISSING"
  cp -a "$CONSUMER" "$MISSING" || { refuse 72 "cannot copy the consumer tree"; return 72; }
  rm -rf "$MISSING/node_modules/yaml" || { refuse 72 "cannot remove the dependency from the copy"; return 72; }
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
  local missing_rc=$?
  br_record "$RUN/missing-dep-verdict.txt" 'missing_dep_rc=%s\n' "$missing_rc" || :
  [ "$missing_rc" -eq 0 ] || { refuse 72 "a missing dependency did not fail loudly (rc=$missing_rc)"; return 72; }

  br_evidence_gate || return 73
  say 'payload: verdict=pass'
  return 0
}

package_install_payload
rc=$?
# The core records peaks and the payload receipt, and lets an evidence failure win.
br_payload_finish "$rc"
exit "$?"
