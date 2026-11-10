#!/bin/bash
# In-envelope payload for the second-version baseline batch.
#
# One question: what does the published 0.2.2-alpha.2 say about itself, and does it
# expose `boot`/`auditStartupEntries` at all? Both a "usable" and an "absent" answer are
# results; only a broken step is a failure.
#
# Network: step 4 is the only step that contacts a registry, by design. Everything else
# reads the prefix it produced. There is no retry: a fetch that fails fails the round.
#
# Exit codes: 0 green, 70 envelope/argument, 71 static contract, 72 a step failed,
# 73 evidence write failed.

set +e
set -uo pipefail
SLICE=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-baseline
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
NPM=/www/server/nodejs/v24.21.0/bin/npm
VERSION=0.2.2-alpha.2

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
evidence_stop() {
  say "payload: $BR_WRITE_FAILURES evidence write failure(s) at $1; stopping (73) before proceeding"
  return 73
}

second_version_payload() {
  # ------------------------------------------------------------ 0. envelope
  br_envelope_enter "$BR_UNIT" "$BR_RUN" || return $?
  br_evidence_gate || { evidence_stop before-syntax; return 73; }

  # ------------------------------------------------------------ 1. syntax
  bash -n "$SLICE/run.sh" && bash -n "$SLICE/payload.sh" \
    || { refuse 70 "payload: shell syntax check failed"; return 70; }
  "$NODE" --check "$SLICE/probe-release.mjs" > "$RUN/syntax-check.txt" 2>&1 \
    || { refuse 71 "payload: probe-release.mjs does not parse"; return 71; }

  # ------------------------------------------------------------ 2. static contract
  REPO_DIR="$REPO" "$NODE" --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    const repo = process.env.REPO_DIR;
    const failures = [];
    const pkg = JSON.parse(readFileSync(join(repo, "packages/runtime/package.json"), "utf8"));
    if (pkg.private !== true) failures.push("runtime:not-private");
    if (Object.keys(pkg.dependencies ?? {}).length !== 0) failures.push("runtime:has-dependencies");
    const receipt = readFileSync(join(repo, "scripts/runtime-receipt/receipt.mjs"), "utf8");
    if (!receipt.includes("receiptVersion")) failures.push("receipt:no-version-field");
    process.stdout.write(`static_contract_failures=${failures.join(",") || "none"}\n`);
    process.exit(failures.length === 0 ? 0 : 1);
  ' > "$RUN/static-contract.txt" 2>&1
  local static_rc=$?
  br_record "$RUN/static-contract.rc" 'static_contract_rc=%s\n' "$static_rc" || :
  cat "$RUN/static-contract.txt" || br_write_failure static-contract
  [ "$static_rc" -eq 0 ] || { refuse 71 "payload: static contract failed"; return 71; }

  # ------------------------------------------------------------ 3. evidence gate
  br_evidence_gate || { evidence_stop before-fetch; return 73; }

  # ------------------------------------------------------------ 4. the release manifest
  # Two network steps only, both small: a manifest read and one package tarball.
  # Installing the release's whole tree is NOT attempted here: a 330-package install
  # takes longer than the 120 s envelope (measured — the unit was killed at 120 s in
  # an earlier round), so this slice answers what it can inside the budget and says so.
  env -i PATH=/usr/bin:/bin HOME="$RUN" TMPDIR="$RUN" \
    "$NPM" view "@deepseek-ai/dsh@$VERSION" --json > "$RUN/release-manifest.json" 2> "$RUN/view.err"
  local view_rc=$?
  br_record "$RUN/view.rc" 'view_rc=%s\nversion=%s\n' "$view_rc" "$VERSION" || :
  [ "$view_rc" -eq 0 ] || { refuse 72 "payload: registry manifest read failed (rc=$view_rc)"; return 72; }

  # ------------------------------------------------------------ 5. the interface package
  local appboot_version
  appboot_version=$(WANT="$VERSION" "$NODE" -e '
    const fs = require("fs");
    const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    // `npm view <name>@<version> --json` answers with an array even for one version.
    const doc = Array.isArray(raw) ? (raw.find((e) => e && e.version === process.env.WANT) ?? raw[0] ?? {}) : raw;
    process.stdout.write(String(doc?.dependencies?.["@deepseek-ai/dsh-app-boot"] ?? ""));
  ' "$RUN/release-manifest.json" 2>/dev/null || true)
  br_record "$RUN/appboot-dependency.txt" 'appboot_dependency=%s\n' "${appboot_version:-absent}" || :
  [ -n "$appboot_version" ] || { refuse 72 "payload: the release names no dsh-app-boot dependency"; return 72; }

  mkdir -p "$RUN/appboot-tgz" || { refuse 73 "cannot create appboot directory"; return 73; }
  env -i PATH=/usr/bin:/bin HOME="$RUN" TMPDIR="$RUN" \
    "$NPM" pack "@deepseek-ai/dsh-app-boot@$appboot_version" --pack-destination "$RUN/appboot-tgz" \
    > "$RUN/appboot-pack.out" 2> "$RUN/appboot-pack.err"
  local pack_rc=$?
  br_record "$RUN/appboot-pack.rc" 'pack_rc=%s\n' "$pack_rc" || :
  [ "$pack_rc" -eq 0 ] || { refuse 72 "payload: app-boot pack failed (rc=$pack_rc)"; return 72; }

  mkdir -p "$RUN/appboot" || { refuse 73 "cannot create appboot extract directory"; return 73; }
  python3 -I - "$RUN/appboot-tgz" "$RUN/appboot" <<'PY_EOF'
import os, sys, tarfile
src, dst = sys.argv[1], sys.argv[2]
tgz = [os.path.join(src, n) for n in sorted(os.listdir(src)) if n.endswith('.tgz')]
if len(tgz) != 1:
    sys.exit("expected exactly one tarball")
with tarfile.open(tgz[0], 'r:gz') as tar:
    for member in tar.getmembers():
        name = os.path.normpath(member.name)
        if name.startswith('..') or os.path.isabs(name):
            sys.exit("refusing an escaping member")
        if not (member.isfile() or member.isdir()):
            continue
        target = os.path.join(dst, name)
        os.makedirs(os.path.dirname(target) or dst, exist_ok=True)
        handle = tar.extractfile(member) if member.isfile() else None
        if handle is not None:
            with open(target, 'wb') as out:
                out.write(handle.read())
PY_EOF
  local extract_rc=$?
  br_record "$RUN/appboot-extract.rc" 'extract_rc=%s\n' "$extract_rc" || :
  [ "$extract_rc" -eq 0 ] || { refuse 72 "payload: app-boot extract failed (rc=$extract_rc)"; return 72; }

  # ------------------------------------------------------------ 6. the interface question
  "$NODE" "$SLICE/probe-release.mjs" "$RUN/release-manifest.json" "$RUN/appboot" "$RUN/interface.json" \
    > "$RUN/interface.txt" 2> "$RUN/interface.err"
  local interface_rc=$?
  br_record "$RUN/interface.rc" 'interface_rc=%s\n' "$interface_rc" || :
  cat "$RUN/interface.txt" 2>/dev/null || br_write_failure interface-stdout
  [ "$interface_rc" -eq 0 ] || { refuse 72 "payload: interface probe failed (rc=$interface_rc)"; return 72; }

  br_record "$RUN/baseline.txt" \
    'baseline_id=published-older\nrequested_version=%s\nappboot_dependency=%s\nreceipt_scope=release-manifest-and-interface-package-only\n' \
    "$VERSION" "$appboot_version" || :

  # ------------------------------------------------------------ 7. verdict
  br_payload_finish 0
}

second_version_payload
rc=$?
exit "$rc"
