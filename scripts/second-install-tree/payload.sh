#!/bin/bash
# In-envelope payload for the second-install-tree batch.
#
# One question: with the published 0.2.2-alpha.2 placed as an installation directory and
# the pinned dependency closure placed under it as node_modules, does a runtime receipt
# resolve all ten modules it names?
#
# "Does not resolve" is a measured answer, not a broken step — but here a nonzero
# unresolved count means the reconstruction is incomplete, so it fails the round rather
# than being recorded as a result: the whole point of this cell is the resolved count.
#
# Network: step 4 packs one tarball from the registry. That is the only network step.
#
# Exit codes: 0 green, 70 envelope/argument, 71 static contract, 72 a step failed,
# 73 evidence write failed.

set +e
set -uo pipefail
SLICE=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-install-tree
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
NPM=/www/server/nodejs/v24.21.0/bin/npm
VERSION=0.2.2-alpha.2
CLOSURE=/data/dsh-ecosystem-test-artifacts/closures/alpha2-0.2.2-alpha.2
# The closure is an out-of-git artefact: its bytes are pinned here so a swapped closure
# cannot quietly change what this round measured.
CLOSURE_DIGEST=127632a801bf26e631160cedbc99c213acba48d2932aa48298b3d7d76ca58fc9
EXPECT_ROWS=10

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

second_install_tree_payload() {
  # ------------------------------------------------------------ 0. envelope
  br_envelope_enter "$BR_UNIT" "$BR_RUN" || return $?
  br_evidence_gate || { evidence_stop before-syntax; return 73; }

  # ------------------------------------------------------------ 1. syntax
  bash -n "$SLICE/run.sh" && bash -n "$SLICE/payload.sh" \
    || { refuse 70 "payload: shell syntax check failed"; return 70; }
  "$NODE" --check "$REPO/scripts/runtime-receipt/receipt.mjs" > "$RUN/syntax-check.txt" 2>&1 \
    || { refuse 71 "payload: receipt.mjs does not parse"; return 71; }

  # ------------------------------------------------------------ 2. static contract
  # Two facts, both about the inputs rather than about the result: the receipt still
  # names the two unexported files this cell hashes, and the closure on this machine is
  # the closure the record pins.
  CLOSURE="$CLOSURE" EXPECT_DIGEST="$CLOSURE_DIGEST" VERSION="$VERSION" \
  RECEIPT_SRC="$REPO/scripts/runtime-receipt/receipt.mjs" \
  "$NODE" --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { createHash } from "node:crypto";
    const failures = [];
    const receipt = readFileSync(process.env.RECEIPT_SRC, "utf8");
    for (const name of ["lib/bin.js", "lib/profile-boot-e2mS45fC.js"]) {
      if (!receipt.includes(name)) failures.push("receipt:missing-file:" + name);
    }
    let closureText = null;
    try { closureText = readFileSync(process.env.CLOSURE + "/closure.json", "utf8"); }
    catch { failures.push("closure:unreadable"); }
    if (closureText !== null) {
      const digest = createHash("sha256").update(closureText).digest("hex");
      if (digest !== process.env.EXPECT_DIGEST) failures.push("closure:digest-mismatch");
      let doc = null;
      try { doc = JSON.parse(closureText); } catch { failures.push("closure:not-json"); }
      if (doc) {
        if (doc.release !== process.env.VERSION) failures.push("closure:wrong-release");
        if (!Array.isArray(doc.rows) || doc.rows.length === 0) failures.push("closure:no-rows");
      }
    }
    process.stdout.write(`static_contract_failures=${failures.join(",") || "none"}\n`);
    process.exit(failures.length === 0 ? 0 : 1);
  ' > "$RUN/static-contract.txt" 2>&1
  local static_rc=$?
  br_record "$RUN/static-contract.rc" 'static_contract_rc=%s\n' "$static_rc" || :
  cat "$RUN/static-contract.txt" || br_write_failure static-contract
  [ "$static_rc" -eq 0 ] || { refuse 71 "payload: static contract failed"; return 71; }

  br_evidence_gate || { evidence_stop before-fetch; return 73; }

  # ------------------------------------------------------------ 4. the release tarball
  mkdir -p "$RUN/tarball" "$RUN/npm-cache" \
    || { refuse 73 "payload: cannot create tarball directories"; return 73; }
  env -i PATH=/usr/bin:/bin HOME="$RUN" TMPDIR="$RUN" \
    "$NPM" pack "@deepseek-ai/dsh@$VERSION" \
      --pack-destination "$RUN/tarball" --cache "$RUN/npm-cache" \
      > "$RUN/pack.out" 2> "$RUN/pack.err" < /dev/null
  local pack_rc=$?
  br_record "$RUN/pack.rc" 'pack_rc=%s\n' "$pack_rc" || :
  [ "$pack_rc" -eq 0 ] || { refuse 72 "payload: cannot pack $VERSION (rc=$pack_rc)"; return 72; }
  local tgz
  tgz=$(find "$RUN/tarball" -maxdepth 1 -name '*.tgz' | head -n 1)
  [ -n "$tgz" ] || { refuse 72 "payload: the pack step wrote no tarball"; return 72; }
  sha256sum "$tgz" > "$RUN/tarball-sha256.txt" 2>/dev/null || br_write_failure tarball-sha256

  # ------------------------------------------------------------ 5. the tree
  # Reconstruction, not installation: the release's own files, plus the pinned closure
  # as node_modules. `cp -a` rather than a hardlink tree because the closure lives on a
  # different device; the copy is removed after the receipt so a run does not leave
  # 147 MB of third-party bytes behind.
  INSTALL="$RUN/installation"
  rm -rf "$INSTALL" || { refuse 73 "payload: cannot clear $INSTALL"; return 73; }
  mkdir -p "$INSTALL" || { refuse 73 "payload: cannot create $INSTALL"; return 73; }
  tar -xzf "$tgz" -C "$INSTALL" --strip-components=1 \
    || { refuse 72 "payload: cannot extract the release tarball"; return 72; }
  cp -a "$CLOSURE/node_modules" "$INSTALL/node_modules" 2> "$RUN/copy.err" \
    || { refuse 72 "payload: cannot place the closure (see copy.err)"; return 72; }
  "$NODE" -e '
    const m = require(process.argv[1]);
    process.stdout.write(`installation_name=${m.name}\ninstallation_version=${m.version}\n`);
  ' "$INSTALL/package.json" > "$RUN/tree.txt" 2>&1 \
    || { refuse 72 "payload: the tree carries no readable manifest"; return 72; }
  cat "$RUN/tree.txt" || br_write_failure tree
  grep -qx "installation_version=$VERSION" "$RUN/tree.txt" \
    || { refuse 72 "payload: the extracted manifest is not $VERSION"; return 72; }

  # ------------------------------------------------------------ 6. the receipt
  "$NODE" "$REPO/scripts/runtime-receipt/receipt.mjs" --installation "$INSTALL" \
    > "$RUN/receipt.json" 2> "$RUN/receipt.err"
  local receipt_rc=$?
  br_record "$RUN/receipt.rc" 'receipt_rc=%s\n' "$receipt_rc" || :
  # 0 means every named module resolved; 2 is INCOMPLETE_RECEIPT. This cell exists to
  # measure the resolved count, so an incomplete receipt is a failed round, not a result.
  [ "$receipt_rc" -eq 0 ] || { refuse 72 "payload: receipt did not resolve every module (rc=$receipt_rc)"; return 72; }

  RECEIPT="$RUN/receipt.json" EXPECT_ROWS="$EXPECT_ROWS" VERSION="$VERSION" \
  "$NODE" --input-type=module -e '
    import { readFileSync } from "node:fs";
    const doc = JSON.parse(readFileSync(process.env.RECEIPT, "utf8"));
    const rows = Array.isArray(doc.rows) ? doc.rows : [];
    const unresolved = Array.isArray(doc.unresolved) ? doc.unresolved : [];
    const problems = [];
    if ((doc?.installation?.version ?? "") !== process.env.VERSION) problems.push("version");
    if (rows.length !== Number(process.env.EXPECT_ROWS)) problems.push("row-count");
    if (unresolved.length !== 0) problems.push("unresolved");
    for (const row of rows) {
      if (typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)) problems.push("row-digest");
      if (!(Number.isInteger(row.bytes) && row.bytes > 0)) problems.push("row-bytes");
    }
    const lines = [
      `rows=${rows.length}`,
      `unresolved=${unresolved.length}`,
      `installation_version=${doc?.installation?.version ?? ""}`,
      `installation_manifest_sha256=${doc?.installation?.manifestSha256 ?? ""}`,
      `module_versions=${rows.map((r) => `${r.module || "(file)"}@${r.version ?? "-"}`).join(" ")}`,
      `tree_scope=reconstructed-from-the-release-tarball-plus-the-pinned-closure`,
    ];
    if (problems.length > 0) lines.push(`receipt_problems=${problems.join(",")}`);
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(problems.length === 0 ? 0 : 1);
  ' > "$RUN/summary.txt" 2> "$RUN/summary.err"
  local summary_rc=$?
  cat "$RUN/summary.txt" 2>/dev/null || br_write_failure summary
  sha256sum "$RUN/receipt.json" > "$RUN/receipt-sha256.txt" 2>/dev/null || br_write_failure receipt-sha256
  [ "$summary_rc" -eq 0 ] || { refuse 72 "payload: the receipt does not satisfy this cell"; return 72; }

  # ------------------------------------------------------------ 7. do not keep the tree
  local kept=no
  rm -rf "$INSTALL" && kept=no || kept=yes
  br_record "$RUN/tree-retained.txt" 'tree_retained=%s\n' "$kept" || :

  # ------------------------------------------------------------ 8. verdict
  br_payload_finish 0
}

second_install_tree_payload
rc=$?
exit "$rc"
