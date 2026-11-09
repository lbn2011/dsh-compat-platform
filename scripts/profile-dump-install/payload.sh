#!/bin/bash
# In-envelope payload for the isolated yaml@2.9.1 install.
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
# workload itself: one bounded install.
#   1. download the fixed tarball over HTTPS (network is used ONLY here),
#   2. verify its pinned SHA-512 (base64),
#   3. extract it with Python's tarfile under a bwrap sandbox that is read-only
#      except node_modules and this run directory, writing ONLY node_modules/yaml,
#      with per-member path validation and size/count caps, WITHOUT running any
#      package code,
#   4. re-verify the written tree against its own SHA-256 manifest with
#      `sha256sum -c` from the installed location.
#
# It never installs via npm, never reads a production npmrc, never runs a package
# script, and never deletes or replaces an existing node_modules/yaml.
#
# What it can establish: the fetched bytes hash to the pinned SHA-512; a validated
# archive was written into node_modules/yaml; the written files match a recorded
# per-file SHA-256 manifest; the package version is exactly 2.9.1.
# What it cannot establish: that the tarball is genuine upstream (the digest is
# only as trustworthy as this file), that the tree is a full dependency closure,
# or any attestation/certification. The copy hashes are a snapshot of what THIS
# payload wrote, NOT a closure or an attestation.
#
# Logging: this payload NEVER writes unit.log. The host is the single writer of
# unit.log and redirects this process's stdout/stderr there; the payload only
# relays its logs to stdout. Every record this payload keeps lives under $RUN.
#
# Exit codes: 0 green; 70 envelope/precondition refusal (incl. target exists);
# 71 a batch script does not parse; 72 download/verify/extract verification
# failed; 73 an evidence write failed. Every exit after argument validation goes
# through `br_payload_finish`, so the host always sees a payload receipt.

set +e
set -uo pipefail

ROOT=/root/dsh-ecosystem-spec
REPO=$ROOT/projects/dsh-compat-platform
SLICE=$REPO/scripts/profile-dump-install
CORE=$REPO/scripts/bounded-runner
PKG=$REPO/packages/analyzer
NM="$PKG/node_modules"
TARGET="$NM/yaml"
NODE=/www/server/nodejs/v24.21.0/bin/node

URL='https://registry.npmjs.org/yaml/-/yaml-2.9.1.tgz'
EXPECT_SHA512_B64='3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw=='
EXPECT_VERSION='2.9.1'

# Fixed, non-inherited environment for the network step: no proxy/credential
# variables from the unit survive, curl reads no user config (-q).
NET_ENV=(/usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp)
CURL_BIN=/usr/bin/curl
PY_BIN=/usr/bin/python3
CURL_MAX_TIME=60
CURL_CONNECT=10
MAX_TGZ_BYTES=2097152           # 2 MiB: the pinned archive is far smaller
MAX_MEMBERS=1000                # total archive members (files + directories)
MAX_TOTAL_BYTES=8388608         # 8 MiB of extracted regular-file bytes

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
sha256_hex() { # file -> hex digest or empty
  local line; line=$(sha256sum "$1" 2>/dev/null) || return 1
  printf '%s' "${line%% *}"
}
no_symlink_ancestors() { # path -> 0 if no component is a symlink
  local p=$1
  while [ -n "$p" ] && [ "$p" != "/" ]; do
    [ -L "$p" ] && return 1
    p=$(dirname "$p")
  done
  return 0
}

profile_dump_install_payload() {
  say "payload: unit=$BR_UNIT run=$RUN"

  # ------------------------------------------------------------ 0. envelope
  # Identity, limits, receipt and the memory gate are the core's; a non-zero
  # return means the payload must not touch the filesystem.
  br_envelope_enter "$BR_UNIT" "$BR_RUN" || return $?

  # ------------------------------------------------------------ 1. preconditions
  [ -d "$PKG" ] || refuse 70 "analyzer package missing: $PKG"
  [ -x "$NODE" ] || refuse 70 "node binary missing: $NODE"
  [ -x "$PY_BIN" ] || refuse 70 "python3 missing: $PY_BIN"
  [ "$(realpath -m "$PKG" 2>/dev/null)" = "$PKG" ] || refuse 70 "package path is not canonical: $PKG"
  # Refuse up front if the target is already present: this batch never replaces it.
  if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
    refuse 70 "install target already exists (refusing to replace): $TARGET"
    return 70
  fi
  no_symlink_ancestors "$PKG" || { refuse 70 "a symlink appears in the package path: $PKG"; return 70; }

  # ------------------------------------------------------------ 2. gate BEFORE syntax
  # bash -n must not run on top of an already-broken evidence set.
  br_evidence_gate || return 73

  bash -n "$SLICE/run.sh"; local acc_syntax_run_sh_rc=$?
  bash -n "$SLICE/payload.sh"; local acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  [ "$acc_syntax_run_sh_rc" -eq 0 ] || { refuse 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"; return 71; }
  [ "$acc_syntax_payload_sh_rc" -eq 0 ] || { refuse 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"; return 71; }

  # ------------------------------------------------------------ 3. gate before the workload
  # Every record written so far must have landed BEFORE any filesystem mutation.
  br_evidence_gate || return 73

  # ------------------------------------------------------------ 4. download (network ONLY here)
  # Fixed, isolated environment: no inherited proxy/credential variables, -q first
  # so no user curl config is read, HTTPS-only (including redirects), bounded size
  # and time, no retry.
  local TGZ="$RUN/yaml-2.9.1.tgz"
  "${NET_ENV[@]}" "$CURL_BIN" -q --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --max-time "$CURL_MAX_TIME" --connect-timeout "$CURL_CONNECT" \
    --max-filesize "$MAX_TGZ_BYTES" --retry 0 --fail --silent --show-error \
    --location --globoff --output "$TGZ" -- "$URL" > "$RUN/curl.log" 2>&1
  local curl_rc=$?
  local tgz_bytes=0
  [ -f "$TGZ" ] && tgz_bytes=$(wc -c < "$TGZ" 2>/dev/null || printf '0')
  br_record "$RUN/download.txt" 'url=%s\ncurl_rc=%s\ntgz_bytes=%s\nmax_time_s=%s\nconnect_timeout_s=%s\nmax_bytes=%s\nenv=env -i PATH HOME TMPDIR only; curl -q (no user config)\n' \
    "$URL" "$curl_rc" "$tgz_bytes" "$CURL_MAX_TIME" "$CURL_CONNECT" "$MAX_TGZ_BYTES" || :
  if [ "$curl_rc" -ne 0 ]; then
    say "payload: download failed (curl rc=$curl_rc); stopping (72), no retry"
    return 72
  fi
  case "$tgz_bytes" in ''|*[!0-9]*) refuse 72 "cannot measure downloaded size"; return 72 ;; esac
  [ "$tgz_bytes" -gt 0 ] || { refuse 72 "downloaded file is empty"; return 72; }
  [ "$tgz_bytes" -le "$MAX_TGZ_BYTES" ] || { refuse 72 "downloaded file exceeds ${MAX_TGZ_BYTES} bytes"; return 72; }

  # ------------------------------------------------------------ 5. integrity
  local sha512_b64 tgz_sha256 sha512_ok
  sha512_b64=$("$PY_BIN" -I - "$TGZ" <<'PY'
import sys, hashlib, base64
h = hashlib.sha512()
with open(sys.argv[1], 'rb') as f:
    for chunk in iter(lambda: f.read(1 << 20), b''):
        h.update(chunk)
sys.stdout.write(base64.b64encode(h.digest()).decode())
PY
  ) || { refuse 72 "cannot compute SHA-512"; return 72; }
  tgz_sha256=$(sha256_hex "$TGZ") || { refuse 72 "cannot compute SHA-256"; return 72; }
  sha512_ok=no
  [ "$sha512_b64" = "$EXPECT_SHA512_B64" ] && sha512_ok=yes
  br_record "$RUN/integrity.txt" 'sha512_b64_expected=%s\nsha512_b64_actual=%s\nsha512_match=%s\ntgz_sha256=%s\ntgz_bytes=%s\n' \
    "$EXPECT_SHA512_B64" "$sha512_b64" "$sha512_ok" "$tgz_sha256" "$tgz_bytes" || :
  [ "$sha512_ok" = yes ] || { refuse 72 "SHA-512 mismatch: tarball is not the pinned artifact"; return 72; }

  # ------------------------------------------------------------ 6. extraction plan
  local EXTRACTOR="$RUN/extract.py"
  cat > "$EXTRACTOR" <<'PYEOF' || { br_write_failure "extract.py-write"; return 73; }
import sys, os, tarfile, hashlib

def die(msg, code):
    sys.stdout.write("extract: " + msg + "\n")
    sys.exit(code)

def has_control(s):
    for ch in s:
        o = ord(ch)
        if o < 0x20 or o == 0x7f:
            return True
    return False

def main():
    if len(sys.argv) != 6:
        die("usage: extract.py TGZ DESTDIR MANIFEST MAX_MEMBERS MAX_TOTAL", 2)
    tgz, destdir, manifest, cap_s, max_total_s = sys.argv[1:6]
    try:
        cap = int(cap_s)
        max_total = int(max_total_s)
    except ValueError:
        die("bad limits", 2)

    destdir = os.path.abspath(destdir)
    if os.path.lexists(destdir):
        die("destination already exists, refusing: " + destdir, 3)
    parent = os.path.dirname(destdir)
    if (not os.path.isdir(parent)) or os.path.islink(parent):
        die("parent missing or a symlink: " + parent, 3)

    try:
        tf = tarfile.open(tgz, "r:*")
    except Exception as e:
        die("open failed: %r" % (e,), 4)

    # Validate the WHOLE archive one member at a time (streaming, so a huge member
    # list cannot exhaust memory before the count check). Nothing is written until
    # every member has passed. The member cap counts files AND directories.
    plan = []
    seen = set()
    nmembers = 0
    nfiles = 0
    total = 0
    try:
        for m in tf:
            nmembers += 1
            if nmembers > cap:
                die("too many archive members (> %d)" % cap, 6)
            name = m.name
            if (not name) or name.startswith("/"):
                die("reject absolute/empty name: %r" % (name,), 5)
            if has_control(name):
                die("reject control character in name: %r" % (name,), 5)
            isdir = m.isdir()
            core = name
            if isdir and core.endswith("/"):
                core = core[:-1]
            parts = core.split("/")
            if any(p == "" for p in parts):
                die("reject empty path component: %r" % (name,), 5)
            if any(p == "." for p in parts):
                die("reject '.' path component: %r" % (name,), 5)
            if any(p == ".." for p in parts):
                die("reject '..' in name: %r" % (name,), 5)
            if m.issym() or m.islnk():
                die("reject symlink/hardlink: %r" % (name,), 5)
            if name != "package" and not name.startswith("package/"):
                die("reject entry outside package/: %r" % (name,), 5)
            rel = core[len("package"):].lstrip("/")
            if isdir:
                if rel in seen:
                    die("duplicate path: %r" % (name,), 5)
                seen.add(rel)
                plan.append((rel, "dir", m))
                continue
            if not m.isfile():
                die("reject non-regular entry (type=%r): %r" % (m.type, name), 5)
            if not rel:
                die("reject empty relative path for file entry", 5)
            if rel in seen:
                die("duplicate path: %r" % (name,), 5)
            seen.add(rel)
            nfiles += 1
            total += m.size
            if total > max_total:
                die("total extracted size too large (> %d bytes)" % max_total, 6)
            plan.append((rel, "file", m))
    except SystemExit:
        raise
    except Exception as e:
        die("member iteration failed: %r" % (e,), 4)

    try:
        os.mkdir(destdir, 0o755)
    except FileExistsError:
        die("destination appeared during run, refusing", 3)

    lines = []
    nout = 0
    for rel, kind, m in plan:
        if kind == "dir":
            if not rel:
                continue
            p = os.path.join(destdir, rel)
            if os.path.commonpath([destdir, os.path.abspath(p)]) != destdir:
                die("reject escaping directory path: %r" % (rel,), 5)
            os.makedirs(p, 0o755, exist_ok=True)
            continue
        p = os.path.join(destdir, rel)
        if os.path.commonpath([destdir, os.path.abspath(p)]) != destdir:
            die("reject escaping file path: %r" % (rel,), 5)
        os.makedirs(os.path.dirname(p), 0o755, exist_ok=True)
        src = tf.extractfile(m)
        if src is None:
            die("no stream for file entry: %r" % (rel,), 5)
        h = hashlib.sha256()
        try:
            with open(p, "xb") as out:
                for chunk in iter(lambda: src.read(65536), b""):
                    h.update(chunk)
                    out.write(chunk)
        except FileExistsError:
            die("file already exists, refusing: %r" % (rel,), 3)
        nout += 1
        lines.append("%s  %s" % (h.hexdigest(), rel))

    tf.close()
    lines.sort(key=lambda s: s.split("  ", 1)[1])
    with open(manifest, "w") as mf:
        if lines:
            mf.write("\n".join(lines) + "\n")
    sys.stdout.write("extract: files=%d dirs=%d total_bytes=%d\n"
                     % (nout, nmembers - nfiles, total))
    return 0

try:
    sys.exit(main())
except SystemExit:
    raise
except Exception as e:
    sys.stdout.write("extract: fatal: %r\n" % (e,))
    sys.exit(9)
PYEOF
  local extractor_sha256
  extractor_sha256=$(sha256_hex "$EXTRACTOR") || { refuse 73 "cannot hash extract.py"; return 73; }
  br_record "$RUN/extractor.txt" 'extractor_sha256=%s\nextractor_path=%s\n' \
    "$extractor_sha256" "$EXTRACTOR" || :

  # ------------------------------------------------------------ 7. evidence gate (again)
  if ! br_evidence_gate; then
    say "payload: evidence write failed before extraction; not creating node_modules"
    return 73
  fi

  # Create the node_modules parent (NOT the yaml target) now, right before the
  # sandbox. The yaml target itself is created exclusively by extract.py.
  if [ -e "$NM" ] || [ -L "$NM" ]; then
    { [ -d "$NM" ] && [ ! -L "$NM" ]; } || { refuse 70 "node_modules is not a plain directory: $NM"; return 70; }
  else
    mkdir -p "$NM" || { refuse 73 "cannot create $NM"; return 73; }
  fi
  if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
    refuse 70 "install target appeared, refusing: $TARGET"
    return 70
  fi

  # ------------------------------------------------------------ 8. extract
  # The sandbox makes the whole tree read-only EXCEPT node_modules and this run
  # directory (which are bound writable; the node_modules bind is the whole dir, not
  # only yaml). --unshare-net CONFIGURES network isolation for this step; it is not
  # claimed as proof that no network access occurred.
  say 'payload: starting extraction'
  br_record "$RUN/workload.txt" 'target=%s\ntgz=%s\nmax_members=%s\nmax_total_bytes=%s\nsandbox=ro-bind / / ; rw bind node_modules + run dir ; unshare-net configured\n' \
    "$TARGET" "$TGZ" "$MAX_MEMBERS" "$MAX_TOTAL_BYTES" || :
  if ! br_evidence_gate; then
    say 'payload: evidence write failed before extraction; not starting it'
    return 73
  fi

  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
    --bind "$NM" "$NM" --bind "$RUN" "$RUN" \
    --unshare-net --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
    --chdir "$RUN" \
    -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
       "$PY_BIN" -I "$EXTRACTOR" "$TGZ" "$TARGET" "$RUN/yaml-files.sha256" "$MAX_MEMBERS" "$MAX_TOTAL_BYTES" \
    > "$RUN/extract.log" 2>&1
  local extract_rc=$?
  br_record "$RUN/extract.rc" 'extract_rc=%s\n' "$extract_rc" || :
  cat "$RUN/extract.log" 2>/dev/null || br_write_failure extract-log-relay
  if [ "$extract_rc" -ne 0 ]; then
    # A failed extraction may leave a PARTIAL node_modules/yaml behind. This batch
    # does NOT remove it and does NOT retry; the fact is recorded here.
    br_record "$RUN/extract-failure.txt" 'extract_rc=%s\npartial_tree_may_exist=%s\nnote=partial node_modules/yaml (if present) is NOT deleted; this batch does not retry\n' \
      "$extract_rc" "$([ -e "$TARGET" ] && echo yes || echo maybe)" || :
    say "payload: extraction failed (rc=$extract_rc); stopping (72); partial tree, if any, not removed"
    return 72
  fi

  # ------------------------------------------------------------ 9. verify what we wrote
  local mf="$RUN/yaml-files.sha256"
  [ -s "$mf" ] || { refuse 72 "per-file manifest is empty or missing: $mf"; return 72; }
  local manifest_files
  manifest_files=$(awk 'END { print NR }' "$mf")
  case "$manifest_files" in ''|*[!0-9]*) refuse 72 "cannot count manifest lines"; return 72 ;; esac
  [ "$manifest_files" -gt 0 ] || { refuse 72 "manifest lists zero files"; return 72; }
  # grep -c prints the count and exits 1 when the count is 0: capture then normalise.
  local wellformed
  wellformed=$(grep -Ec '^[0-9a-f]{64}  [^/]' "$mf" 2>/dev/null)
  case "$wellformed" in ''|*[!0-9]*) wellformed=0 ;; esac
  [ "$wellformed" = "$manifest_files" ] || { refuse 72 "manifest has malformed lines ($wellformed/$manifest_files)"; return 72; }

  [ -f "$TARGET/package.json" ] || { refuse 72 "extracted tree has no package.json"; return 72; }

  # The hashes in the manifest were computed while reading the SOURCE stream. To
  # prove the bytes actually on disk match, re-verify with `sha256sum -c` FROM the
  # installed location. A mismatch stops the batch (72); nothing is retried.
  local manifest_verify_rc=1
  if ( cd "$TARGET" 2>/dev/null && sha256sum -c "$mf" > "$RUN/verify-manifest.log" 2>&1 ); then
    manifest_verify_rc=0
  else
    manifest_verify_rc=$?
  fi
  br_record "$RUN/verify-manifest.rc" 'manifest_verify_rc=%s\n' "$manifest_verify_rc" || :
  [ "$manifest_verify_rc" -eq 0 ] || { refuse 72 "installed tree does not match its own manifest (sha256sum -c rc=$manifest_verify_rc)"; return 72; }

  local version
  version=$("$PY_BIN" -I - "$TARGET/package.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        print(json.load(f).get('version', ''))
except Exception:
    print('')
PY
  ) || version=''
  br_record "$RUN/install-summary.txt" 'version_expected=%s\nversion_actual=%s\nmanifest_files=%s\nmanifest=%s\nmanifest_verify_rc=%s\ntgz_sha256=%s\ntgz_bytes=%s\nsha512_match=%s\ninstall_target=%s\n' \
    "$EXPECT_VERSION" "$version" "$manifest_files" "$mf" "$manifest_verify_rc" \
    "$tgz_sha256" "$tgz_bytes" "$sha512_ok" "$TARGET" || :
  [ "$version" = "$EXPECT_VERSION" ] || { refuse 72 "installed version '$version' != expected '$EXPECT_VERSION'"; return 72; }

  br_evidence_gate || return 73
  say "payload: verdict=installed version=$version files=$manifest_files sha512=$sha512_ok manifest_verify=$manifest_verify_rc"
  return 0
}

profile_dump_install_payload
rc=$?
# The core records peaks and the payload receipt, and lets an evidence failure win.
br_payload_finish "$rc"
exit "$?"
