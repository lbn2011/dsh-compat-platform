#!/bin/bash
# In-envelope payload for the isolated yaml@2.9.1 install.
#
# STATUS: PREPARED, NEVER EXECUTED. Nothing in this file has been run.
#
# Runs INSIDE the transient unit. It verifies its own envelope, refuses to touch
# the filesystem if anything is off, and only then performs one bounded install:
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
# Logging: this payload NEVER writes unit.log. The launcher is the single writer
# of unit.log and redirects this process's stdout/stderr there; the payload only
# relays its logs to stdout. Every record this payload keeps lives under $RUN.
#
# Exit codes: 0 green; 70 envelope/precondition refusal (incl. target exists);
# 71 a batch script does not parse; 72 download/verify/extract verification
# failed; 73 an evidence write failed.

set -uo pipefail

UNIT=${1:-}
RUN=${2:-}
PKG=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer
NM="$PKG/node_modules"
TARGET="$NM/yaml"
NODE=/www/server/nodejs/v24.21.0/bin/node

EXPECT_MEM_BYTES=402653184      # 384 MiB
EXPECT_SWAP_BYTES=0
EXPECT_PIDS=32
EXPECT_CPU_MAX='50000 100000'   # 50% of one CPU
EXPECT_RUNTIME_USEC=120000000
EXPECT_MEMAVAILABLE_KIB=819200

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

write_fail=0
addwf() { write_fail=$((write_fail + 1)); printf 'payload: evidence write failed: %s\n' "$1" >&2; }
die() { printf 'payload: %s\n' "$2" >&2; exit "$1"; }
wr() { cat > "$1" || return 1; [ -s "$1" ] || return 1; }
say() { printf '%s\n' "$*"; }
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }
# Strict single-value readback for anything COMPARED against a limit: exactly one
# non-empty line, else an explicit ambiguous/missing marker (never silently empty).
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
[ -x "$PY_BIN" ] || die 70 "python3 missing: $PY_BIN"
[ "$(realpath -m "$PKG" 2>/dev/null)" = "$PKG" ] || die 70 "package path is not canonical: $PKG"
# Refuse up front if the target is already present: this batch never replaces it.
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  die 70 "install target already exists (refusing to replace): $TARGET"
fi
no_symlink_ancestors "$PKG" || die 70 "a symlink appears in the package path: $PKG"

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

# RuntimeMaxUSec is read through busctl in two steps: GetUnit yields the object
# path, then get-property asks for exactly one property of that object.
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

# RuntimeMaxUSec is accepted only when the whole reply is `t <digits>` with no
# trailing text. The digits are then compared EXACTLY below; anything non-numeric
# leaves the value empty so the exact comparison refuses.
acc_runtime_usec=
acc_runtime_usec_source=unavailable
if [ "$bus_rc" -eq 0 ]; then
  case "$bus_raw" in
    't '*)
      rt_num=${bus_raw#t }
      case "$rt_num" in
        ''|*[!0-9]*) : ;;   # non-numeric or suffixed -> leave empty (refusal)
        *) acc_runtime_usec=$rt_num; acc_runtime_usec_source=busctl ;;
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

# ---------------------------------------------------------------- 4. gate BEFORE syntax
# bash -n must not run on top of an already-broken evidence set.
if [ "$write_fail" -ne 0 ]; then
  printf 'acc_evidence_write_failures=%s\nacc_stop_at=before-syntax\nacc_workload_started=no\n' \
    "$write_fail" > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say "payload: $write_fail evidence write failure(s) before syntax; stopping (73)"
  exit 73
fi

bash -n /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install/run.sh
acc_syntax_run_sh_rc=$?
bash -n /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install/payload.sh
acc_syntax_payload_sh_rc=$?
printf 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
  "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" > "$RUN/syntax.txt" || addwf syntax.txt
[ "$acc_syntax_run_sh_rc" -eq 0 ] || die 71 "run.sh does not parse (rc=$acc_syntax_run_sh_rc)"
[ "$acc_syntax_payload_sh_rc" -eq 0 ] || die 71 "payload.sh does not parse (rc=$acc_syntax_payload_sh_rc)"

# ---------------------------------------------------------------- 5. evidence gate
# Every record written so far must have landed BEFORE any filesystem mutation.
if [ "$write_fail" -ne 0 ]; then
  printf 'acc_evidence_write_failures=%s\nacc_stop_at=pre-workload\nacc_workload_started=no\n' \
    "$write_fail" > "$RUN/evidence-gate.txt" 2>/dev/null || :
  say "payload: $write_fail evidence write failure(s) before the workload; refusing to proceed"
  exit 73
fi

# ---------------------------------------------------------------- 6. download (network ONLY here)
# Fixed, isolated environment: no inherited proxy/credential variables, -q first
# so no user curl config is read, HTTPS-only (including redirects), bounded size
# and time, no retry.
TGZ="$RUN/yaml-2.9.1.tgz"
"${NET_ENV[@]}" "$CURL_BIN" -q --proto '=https' --proto-redir '=https' --tlsv1.2 \
  --max-time "$CURL_MAX_TIME" --connect-timeout "$CURL_CONNECT" \
  --max-filesize "$MAX_TGZ_BYTES" --retry 0 --fail --silent --show-error \
  --location --globoff --output "$TGZ" -- "$URL" > "$RUN/curl.log" 2>&1
curl_rc=$?
tgz_bytes=0
[ -f "$TGZ" ] && tgz_bytes=$(wc -c < "$TGZ" 2>/dev/null || printf '0')
{
  printf 'url=%s\n' "$URL"
  printf 'curl_rc=%s\n' "$curl_rc"
  printf 'tgz_bytes=%s\n' "$tgz_bytes"
  printf 'max_time_s=%s\n' "$CURL_MAX_TIME"
  printf 'connect_timeout_s=%s\n' "$CURL_CONNECT"
  printf 'max_bytes=%s\n' "$MAX_TGZ_BYTES"
  printf 'env=env -i PATH HOME TMPDIR only; curl -q (no user config)\n'
} > "$RUN/download.txt" || addwf download.txt
if [ "$curl_rc" -ne 0 ]; then
  say "payload: download failed (curl rc=$curl_rc); stopping (72), no retry"
  exit 72
fi
case "$tgz_bytes" in ''|*[!0-9]*) die 72 "cannot measure downloaded size" ;; esac
[ "$tgz_bytes" -gt 0 ] || die 72 "downloaded file is empty"
[ "$tgz_bytes" -le "$MAX_TGZ_BYTES" ] || die 72 "downloaded file exceeds ${MAX_TGZ_BYTES} bytes"

# ---------------------------------------------------------------- 7. integrity
sha512_b64=$("$PY_BIN" -I - "$TGZ" <<'PY'
import sys, hashlib, base64
h = hashlib.sha512()
with open(sys.argv[1], 'rb') as f:
    for chunk in iter(lambda: f.read(1 << 20), b''):
        h.update(chunk)
sys.stdout.write(base64.b64encode(h.digest()).decode())
PY
) || die 72 "cannot compute SHA-512"
tgz_sha256=$(sha256_hex "$TGZ") || die 72 "cannot compute SHA-256"
sha512_ok=no
[ "$sha512_b64" = "$EXPECT_SHA512_B64" ] && sha512_ok=yes
{
  printf 'sha512_b64_expected=%s\n' "$EXPECT_SHA512_B64"
  printf 'sha512_b64_actual=%s\n' "$sha512_b64"
  printf 'sha512_match=%s\n' "$sha512_ok"
  printf 'tgz_sha256=%s\n' "$tgz_sha256"
  printf 'tgz_bytes=%s\n' "$tgz_bytes"
} > "$RUN/integrity.txt" || addwf integrity.txt
[ "$sha512_ok" = yes ] || die 72 "SHA-512 mismatch: tarball is not the pinned artifact"

# ---------------------------------------------------------------- 8. extraction plan
EXTRACTOR="$RUN/extract.py"
cat > "$EXTRACTOR" <<'PYEOF' || { addwf extract.py-write; die 73 "cannot write extract.py"; }
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
extractor_sha256=$(sha256_hex "$EXTRACTOR") || die 73 "cannot hash extract.py"
printf 'extractor_sha256=%s\nextractor_path=%s\n' "$extractor_sha256" "$EXTRACTOR" \
  > "$RUN/extractor.txt" || addwf extractor.txt

# ---------------------------------------------------------------- 9. evidence gate (again)
if [ "$write_fail" -ne 0 ]; then
  say "payload: evidence write failed before extraction; not creating node_modules"
  exit 73
fi

# Create the node_modules parent (NOT the yaml target) now, right before the
# sandbox. The yaml target itself is created exclusively by extract.py.
if [ -e "$NM" ] || [ -L "$NM" ]; then
  { [ -d "$NM" ] && [ ! -L "$NM" ]; } || die 70 "node_modules is not a plain directory: $NM"
else
  mkdir -p "$NM" || die 73 "cannot create $NM"
fi
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  die 70 "install target appeared, refusing: $TARGET"
fi

# ---------------------------------------------------------------- 10. extract
# The sandbox makes the whole tree read-only EXCEPT node_modules and this run
# directory (which are bound writable; the node_modules bind is the whole dir, not
# only yaml). --unshare-net CONFIGURES network isolation for this step; it is not
# claimed as proof that no network access occurred.
say 'payload: starting extraction'
{
  printf 'target=%s\n' "$TARGET"
  printf 'tgz=%s\n' "$TGZ"
  printf 'max_members=%s\n' "$MAX_MEMBERS"
  printf 'max_total_bytes=%s\n' "$MAX_TOTAL_BYTES"
  printf 'sandbox=ro-bind / / ; rw bind node_modules + run dir ; unshare-net configured\n'
} > "$RUN/workload.txt" || addwf workload.txt
if [ "$write_fail" -ne 0 ]; then
  say 'payload: evidence write failed before extraction; not starting it'
  exit 73
fi

bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --bind "$NM" "$NM" --bind "$RUN" "$RUN" \
  --unshare-net --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
  --chdir "$RUN" \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     "$PY_BIN" -I "$EXTRACTOR" "$TGZ" "$TARGET" "$RUN/yaml-files.sha256" "$MAX_MEMBERS" "$MAX_TOTAL_BYTES" \
  > "$RUN/extract.log" 2>&1
extract_rc=$?
printf 'extract_rc=%s\n' "$extract_rc" > "$RUN/extract.rc" || addwf extract.rc
cat "$RUN/extract.log" 2>/dev/null || addwf extract-log-relay
if [ "$extract_rc" -ne 0 ]; then
  # A failed extraction may leave a PARTIAL node_modules/yaml behind. This batch
  # does NOT remove it and does NOT retry; the fact is recorded here.
  printf 'extract_rc=%s\npartial_tree_may_exist=%s\nnote=partial node_modules/yaml (if present) is NOT deleted; this batch does not retry\n' \
    "$extract_rc" "$([ -e "$TARGET" ] && echo yes || echo maybe)" > "$RUN/extract-failure.txt" 2>/dev/null || :
  say "payload: extraction failed (rc=$extract_rc); stopping (72); partial tree, if any, not removed"
  exit 72
fi

# ---------------------------------------------------------------- 11. verify what we wrote
mf="$RUN/yaml-files.sha256"
[ -s "$mf" ] || die 72 "per-file manifest is empty or missing: $mf"
manifest_files=$(awk 'END { print NR }' "$mf")
case "$manifest_files" in ''|*[!0-9]*) die 72 "cannot count manifest lines" ;; esac
[ "$manifest_files" -gt 0 ] || die 72 "manifest lists zero files"
# grep -c prints the count and exits 1 when the count is 0: capture then normalise.
wellformed=$(grep -Ec '^[0-9a-f]{64}  [^/]' "$mf" 2>/dev/null)
case "$wellformed" in ''|*[!0-9]*) wellformed=0 ;; esac
[ "$wellformed" = "$manifest_files" ] || die 72 "manifest has malformed lines ($wellformed/$manifest_files)"

[ -f "$TARGET/package.json" ] || die 72 "extracted tree has no package.json"

# The hashes in the manifest were computed while reading the SOURCE stream. To
# prove the bytes actually on disk match, re-verify with `sha256sum -c` FROM the
# installed location. A mismatch stops the batch (72); nothing is retried.
manifest_verify_rc=1
if ( cd "$TARGET" 2>/dev/null && sha256sum -c "$mf" > "$RUN/verify-manifest.log" 2>&1 ); then
  manifest_verify_rc=0
else
  manifest_verify_rc=$?
fi
printf 'manifest_verify_rc=%s\n' "$manifest_verify_rc" > "$RUN/verify-manifest.rc" \
  || addwf verify-manifest.rc
[ "$manifest_verify_rc" -eq 0 ] || die 72 "installed tree does not match its own manifest (sha256sum -c rc=$manifest_verify_rc)"

version=$("$PY_BIN" -I - "$TARGET/package.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        print(json.load(f).get('version', ''))
except Exception:
    print('')
PY
) || version=''
{
  printf 'version_expected=%s\n' "$EXPECT_VERSION"
  printf 'version_actual=%s\n' "$version"
  printf 'manifest_files=%s\n' "$manifest_files"
  printf 'manifest=%s\n' "$mf"
  printf 'manifest_verify_rc=%s\n' "$manifest_verify_rc"
  printf 'tgz_sha256=%s\n' "$tgz_sha256"
  printf 'tgz_bytes=%s\n' "$tgz_bytes"
  printf 'sha512_match=%s\n' "$sha512_ok"
  printf 'install_target=%s\n' "$TARGET"
} > "$RUN/install-summary.txt" || addwf install-summary.txt
[ "$version" = "$EXPECT_VERSION" ] || die 72 "installed version '$version' != expected '$EXPECT_VERSION'"

# ---------------------------------------------------------------- 12. peaks
{
  printf 'memory_peak=%s\n' "$(knob1 "$CGROUP/memory.peak")"
  printf 'pids_peak=%s\n' "$(knob1 "$CGROUP/pids.peak")"
} > "$RUN/peaks.txt" || addwf peaks.txt

if [ "$write_fail" -ne 0 ]; then
  say "payload: $write_fail evidence write failure(s)"
  exit 73
fi
say "payload: verdict=installed version=$version files=$manifest_files sha512=$sha512_ok manifest_verify=$manifest_verify_rc"
exit 0
