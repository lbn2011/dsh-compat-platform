# profile-dump-install — installer acceptance runner (EXECUTED, MIGRATED)

**STATUS: MIGRATED (ABI `bounded-runner/1`) and the success path is now verified.**
Two bounded rounds on 2026-11-10 installed into a **named scratch target** — the real
`packages/analyzer/node_modules/yaml` was left untouched and proven unchanged by a
digest pair taken around each launch. Both rounds: `acceptance_exit=0`, SHA-512
matched the pinned value, tgz sha256 `4ef6c54c…` (the same bytes as 2026-11-08),
233 files, `manifest_verify_rc=0`, version `2.9.1`, peak 15.8 MiB / 4 pids.
The produced tree is byte-identical to the one already installed
(`07d71533…`, 233 files, `diff -r` clean). Record:
[`../../docs/testing/2026-11-10-profile-dump-install-scratch.md`](../../docs/testing/2026-11-10-profile-dump-install-scratch.md).

That earlier refusal is still the rule: with no override the batch targets the real
dependency directory, and an existing target is **never** replaced (`70`).

Invoke by **absolute** path: the core binds every source frame to an absolute control
list, so a relative entry refuses with 77 before any lock, run directory or unit.

**History (pre-migration, 2026-11-08):** one install round, green —
`acceptance_exit=0`, tgz sha256 `4ef6c54c…`, the SHA-512 matched the pinned value,
233 files extracted, manifest verify rc 0, installed version `2.9.1`; single
memory gate 1651552 KiB ≥ 819200; peak ≈30.9 MiB, pids 5; terminal settled. The
record, including the two acceptance rounds that then consumed this install, is
[`../../docs/testing/2026-11-08-profile-dump.md`](../../docs/testing/2026-11-08-profile-dump.md).
That record describes the pre-migration runners; it is not evidence about these
bytes.

**Installing somewhere else.** Set `PROFILE_DUMP_INSTALL_NODE_MODULES` to an absolute
directory that does not exist; the archive is installed at `<that directory>/yaml`.
The launcher passes it to the payload through the core's declared `--setenv` channel
(a transient service does not inherit the caller's environment), records it in
`setenv.txt` and in `real-target.txt`, and exits `72` if the real dependency tree's
digest changes during the run. The path must not be under `/tmp`: the extraction
sandbox masks `/tmp` with a private `tmpfs`.

**The layout is also used, not only built.** After the manifest check, the payload copies
this package's `package.json` and `src` into `<prefix>/node_modules/dsh-compat-platform`,
symlinks the freshly installed `yaml` beside it, resolves `yaml` from the copy (the
resolved path is recorded and must lie inside the prefix) and runs the copied CLI over
the shipped example, requiring `profile-dump-summary/0.3-draft.1`. That is the layout a
consumer sees; the manifest check alone only shows that an archive extracts. Measured
twice on 2026-11-10 — see `docs/testing/2026-11-10-installer-default-layout.md`.

What this batch owns is the workload and the subject — the download, the pinned
digest, the extraction rules and the manifest re-verification. The resource
envelope, the shared lock, the two-point hash discipline, the ownership receipt,
the terminal readback and the exit-code vocabulary are the **core's**, identical
**on purpose**.

## Invocation

    bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install/run.sh

No arguments; extra arguments are refused (`70`). **The path must be absolute.** The
core binds every active shell source frame to its absolute control list, so a
relative entry path (`scripts/…/run.sh`, `./run.sh`) is refused with `77` **before**
the lock is taken, before a run directory is created and before any unit or
workload is launched. Raw artefacts live outside the repository, under
`${PROFILE_DUMP_INSTALL_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}`.

One invocation is one install attempt, and there are **no retries**: any failure
stops the batch.

## Purpose

Do **one** isolated, verified install of `yaml@2.9.1` into

```
projects/dsh-compat-platform/packages/analyzer/node_modules/yaml
```

so that the separate `profile-dump-batch` acceptance batch (which refuses if the
dependency is absent) has a baseline to run against. This batch does **not** run
any test, does not run any package code, and does not use `npm`.

## Hard boundaries

- Writes only two places: the new `node_modules/yaml` (created exclusively) and this
  run's artifact directory. Everything else is read-only inside the extraction
  sandbox.
- **Refuses if `node_modules/yaml` already exists** — it never deletes or replaces an
  existing target (`70`), and it never removes a partial tree left by an earlier
  failure.
- **Never stops a unit it did not launch.** The core records an ownership receipt
  (`ownership.txt`: unit name plus the unit's own `InvocationID`) at launch time and
  stops a unit only when that receipt matches the unit's *current* invocation; a
  reused, foreign, or restarted unit is left alone. There is no broad
  `systemctl stop`, no `reset-failed`, and no unit-name glob cleanup anywhere in
  this batch or in the core.
- Does not modify production, version-controlled content of the parent repo,
  `vendor/`, or any other package. It does open the **existing** shared lock file
  `experiments/acceptance/runs/.acceptance.lock` (an `flock` on it), so it is not
  claimed to touch no file of the parent repo at all — only to not change its
  version-controlled content.
- No `npm`, no production `npmrc`, no package lifecycle script, no `postinstall`.
- Network is used **only** during the download step. Extraction runs under
  `bwrap --unshare-net`, which **configures** network isolation for that step; it is
  not claimed as proof that no network access occurred.

Note on scope of read-only: only the **extraction** step is the read-only construct.
The run is not read-only overall — the download step writes the tarball into the run
directory and uses the network, and inside the extraction sandbox the writable roots
are the **whole** `node_modules` directory and the run directory (not only `yaml`).

## Files

| file | role |
| --- | --- |
| `run.sh` | host-side launcher: refuses a bad invocation or an already-installed target, names the selected inputs, delegates one unit to the core |
| `payload.sh` | in-unit payload: after the core's envelope receipt, downloads, verifies, extracts and re-verifies |
| `README.md` | this document |

All three are control sources: the core hashes them, its own five modules and its
manifest, and refuses (`77`) if any of them cannot be read or was invoked by a
relative path.

## The envelope (the core's, not restated here)

| knob | value |
| --- | --- |
| unit type | `Type=exec` |
| memory | `MemoryMax=384M` |
| swap | `MemorySwapMax=0` |
| tasks | `TasksMax=32` |
| CPU | `CPUQuota=50%` |
| runtime | `RuntimeMaxSec=120` (read back as `RuntimeMaxUSec=120000000` via `busctl`) |
| node heap | `NODE_OPTIONS=--max-old-space-size=192` |
| memory gate | one `MemAvailable >= 819200 KiB` check, before the workload |
| lock | `flock -n` on `experiments/acceptance/runs/.acceptance.lock` |
| active-unit query | the core's unit-family query; a failed query refuses (`70`) |
| terminal | settled readback (`MainPID=0` plus `Load/Active/Sub` agreement) |
| retries | none — a failure stops the batch |

Every limit is read back from the cgroup and from systemd **inside** the unit by
`br_envelope_enter` and compared to the approved values with strict single-line
reads (an empty, missing, or duplicated value is a mismatch, never a silent pass).
A mismatch refuses (`70`) before anything is downloaded or written.

## Stages

| Stage | What it does | Exit |
| --- | --- | --- |
| 0 | launcher: arguments, core preflights, shared lock, active-unit query, run dir; refuse if the target exists | `70/75/76` |
| 1 | payload: argument/path checks, then the core's envelope receipt (`br_envelope_enter`) | `70` |
| 2 | payload: install preconditions (package canonical, node/python present, `node_modules/yaml` absent, no symlink ancestor) | `70` |
| 3 | payload: **evidence gate 1** — a failed record write stops *before* `bash -n` | `73` |
| 4 | payload: `bash -n` on both scripts, both always checked and both rc's recorded | `71` |
| 5 | payload: **evidence gate 2** — stops before the first filesystem mutation | `73` |
| 6 | payload: `curl -q …` under `env -i` (fixed `PATH/HOME/TMPDIR`, no inherited proxy/credentials), fixed URL, size + time caps, no retry, no user config | `72` |
| 7 | payload: SHA-512 (base64) must equal the pinned value; SHA-256 and size recorded | `72` |
| 8 | payload: write `extract.py`, record its sha256, **evidence gate 3** before creating `node_modules` | `73` |
| 9 | payload: create the `node_modules` parent (never `yaml` itself), re-check that the target is still absent | `70/73` |
| 10 | payload: extract under `bwrap` (ro root, rw only `node_modules` + run dir, `--unshare-net` configured), preceded by **evidence gate 4** | `72/73` |
| 11 | payload: re-verify the written tree via `sha256sum -c` from the installed location | `72` |
| 12 | payload: version check (`2.9.1`) from the installed `package.json`, `install-summary.txt` | `72` |
| 13 | payload: **evidence gate 5** and verdict; the core records peaks and the payload receipt | `73` |
| — | launcher: hash after, terminal verdict | `74/77/78` |

## The download

```
env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
  curl -q --proto '=https' --proto-redir '=https' --tlsv1.2 \
       --max-time 60 --connect-timeout 10 --max-filesize 2097152 \
       --retry 0 --fail --silent --show-error --location --globoff \
       --output <run>/yaml-2.9.1.tgz -- \
       https://registry.npmjs.org/yaml/-/yaml-2.9.1.tgz
```

- `env -i …` starts from a fixed, empty environment: no inherited proxy or
  credential variables reach `curl`.
- `-q` is the first `curl` argument; it disables any user `~/.curlrc`; the pinned URL
  is the only source.
- `--proto`/`--proto-redir` restrict everything (including redirects) to HTTPS.
- `--max-filesize`, `--max-time`, `--connect-timeout` bound the transfer.
- `--retry 0`: a failed transfer stops the batch; it is not retried.
- Integrity is pinned by content, not by host: the SHA-512 below must match
  regardless of where a redirect sends the bytes.

Pinned digest (base64 of the SHA-512 of the tarball):

```
3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==
```

## The extraction (no package code executed)

`extract.py` (Python standard library `tarfile` only) opens the archive and
**pre-validates every member before writing anything**:

- name must be non-empty, not absolute, must contain no empty or `.` component, no
  `..` component, no control/newline characters, and must be `package` or under
  `package/` (the npm tarball root);
- the `package/` prefix is stripped; the remainder must stay inside the destination
  (`os.path.commonpath` check per file and per directory);
- duplicate normalized paths are rejected;
- symlinks and hardlinks are rejected; any non-regular entry (device, fifo,
  char/block) is rejected; only directories and regular files are written;
- the archive is validated one member at a time (**not** via `getmembers()` first),
  counting **all** members including directories: at most `1000` members and at most
  8 MiB of regular-file bytes, both enforced during the streaming iteration so a huge
  member list cannot exhaust memory before the count check;
- the destination directory is created with `os.mkdir` (exclusive) and every file
  with `open(..., "xb")` (exclusive create) — an existing target or file is refused,
  never overwritten;
- a per-file SHA-256 manifest is written as `<hex>  <relative-path>`.

No `package.json` script, `postinstall`, or any file is executed. Version is read by
parsing the installed `package.json` as JSON (parsing, not executing).

The per-file hashes are computed while writing the extracted stream; that alone
proves only what was read from the archive. After extraction the payload therefore
re-verifies the **on-disk** tree with `sha256sum -c` from the installed location and
stops (`72`) if any file does not match its manifest entry.

Sandbox for extraction:

```
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
      --bind <node_modules> <node_modules> --bind <run-dir> <run-dir> \
      --unshare-net --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
      --chdir <run-dir> \
  env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
  /usr/bin/python3 -I extract.py <tgz> <target> <manifest> 1000 8388608
```

The whole tree is read-only except `node_modules` and the run directory; the writable
`node_modules` is the whole directory, not only `yaml`. `--unshare-net`
**configures** network isolation for this step (it is not a claim that no network
access was attempted elsewhere). All Python invocations (here and the SHA-512 /
version readers) use `/usr/bin/python3 -I` (isolated mode: no `PYTHON*`
environment, no user site) to keep them free of injected paths.

## Exit codes

Payload:

- `0` green;
- `70` refusal (envelope/argument/install precondition, including an existing target);
- `71` a script does not parse;
- `72` download, digest, extraction or manifest verification failed;
- `73` an evidence write failed.

Launcher (relaying the core):

- `0` green;
- `70` refusal before or inside the launch — including "the install target already
  exists";
- `71`/`72`/`73` relayed from the payload;
- `74` the unit did not settle (also the core's mapping of a launch timeout);
- `75` lock held;
- `76` run-directory collision;
- `77` a hash manifest or a control source could not be read, matched or written —
  including a **relative** entry path;
- `78` selected-input drift.

## Artefacts (under `$RUN`)

Canonical, written by the core: `selection.txt`, `control-before.txt`,
`selected-before.txt`, `active-units.txt`, `argv.txt`, `requested.txt`, `unit.log`,
`launch.txt`, `systemd-run.rc`, `journal.txt`/`journal.rc`, `terminal-before.txt`,
`terminal-after-stop.txt`, `terminal.txt`, `stop.txt`, `ownership.txt`,
`ownership-systemctl.txt`, `envelope-systemctl.txt`, `envelope-getunit.txt`,
`envelope-runtime.txt`, `envelope-effective.txt`, `memory-gate.txt`,
`control-after.txt`, `selected-after.txt`, `control-diff.txt`,
`selected-diff.txt`, `payload-result.txt`, `payload-evidence.txt`, `peaks.txt`,
`status.txt`.

Written by this payload: `syntax.txt`, `download.txt`, `curl.log`, `integrity.txt`,
`extract.py`, `extractor.txt`, `workload.txt`, `extract.log`, `extract.rc`,
`extract-failure.txt` (only on failure), `yaml-2.9.1.tgz`, `yaml-files.sha256`,
`verify-manifest.log`, `verify-manifest.rc`, `install-summary.txt`.

Changes relative to the pre-migration runner: the envelope, memory-gate and peak
records are now the core's names and shapes (`envelope-effective.txt`,
`memory-gate.txt`, `peaks.txt`); the local `evidence-gate.txt` and per-write counter
files are gone (the counter is `payload-evidence.txt`); the payload no longer writes
its own `journal.txt` or terminal-query files; `envelope-cgroup.txt`,
`envelope-busctl*.txt` and `envelope-verdict.txt` are replaced by the core's
`ownership*`/`envelope-*` set; and `hashes-before.txt`/`-after.txt`/`-diff.txt` are
replaced by the `control-*` and `selected-*` pairs. The digest-verdict field names
inside `syntax.txt` are unchanged (`acc_syntax_run_sh_rc`, `acc_syntax_payload_sh_rc`).

## Selected inputs (hashed before and after)

`packages/analyzer/package.json` only. `node_modules` is deliberately **not** in that
set: this run creates `node_modules/yaml`, so its appearance is not drift, and the
tree is verified by the payload's own manifest instead. `run.sh` and `payload.sh` are
not repeated there either — they are control sources the core hashes. Drift → `78`.

## What a green run would establish — and would not

Would establish: the fetched bytes hash to the pinned SHA-512; a tar archive passing
the path/size/count rules was written into `node_modules/yaml`; the written files
re-verify against the recorded per-file SHA-256 manifest via `sha256sum -c` from the
installed location; the installed `package.json` reports version `2.9.1`.

Would **not** establish:

- That the tarball is the genuine upstream artifact. The digest is only as
  trustworthy as this file; it is not an independent attestation.
- That the installed tree is a complete dependency closure (it is only `yaml` itself;
  the copy hashes are a snapshot of what this payload wrote, **not** a closure and
  **not** an attestation/certification).
- That the analyzer package or its suite now passes — that is `profile-dump-batch`.
- That no change happened-and-was-reverted between snapshots.

## Unresolved risks / caveats

1. **Digest provenance.** The pinned base64 SHA-512 is taken from the task statement.
   Nothing here independently confirms it against a second source; if the constant is
   wrong, the run refuses (`72`) rather than installing.
2. **Runtime budget.** `RuntimeMaxSec=120` with `curl --max-time 60` leaves ~60 s for
   extraction. On a slow network this could approach the cap; a stall is a failure
   (`74`/`72`), not a partial install.
3. **Leftover `node_modules/` on failure.** The parent `node_modules` directory is
   created right before extraction. If `bwrap` fails to launch or extraction fails
   partway, a **partial** `node_modules/yaml` (or an empty `node_modules/`) may
   remain. This batch does **not** delete it and does **not** retry; the fact is
   recorded in `extract-failure.txt`. A later run refuses to proceed while
   `node_modules/yaml` exists, so the partial tree must be inspected and removed by
   hand before any re-run.
4. **Redirect host.** `curl --location` may follow a redirect to a CDN; the pinned
   SHA-512, not the host, is what authenticates the bytes.
5. **`python3`/`tarfile` behaviour** (3.13.5 on host) is trusted for correct
   `..`/link/device rejection; the script additionally re-checks paths with
   `commonpath`, rejects empty/`.` components and control characters, and rejects
   duplicate normalized paths.
6. **Copy hashes are not a closure.** As stated above: the per-file SHA-256 manifest
   and the `sha256sum -c` re-verification show that the written bytes match what the
   payload extracted — they are **not** a dependency closure and **not** an
   attestation/certification of the tarball.

## Changes in this migration (for the reviewer)

- The launcher no longer computes unit names, hashes, terminal state, journal, peaks
  or the verdict: it validates its own invocation and the target-absent
  precondition, names its selected inputs, and hands one launch to `br_host_run`.
- **The launcher's refusals happen before the lock is taken** for bad arguments and
  before the unit exists for an existing target; the reason string is no longer
  written to `status.txt` by hand — the core writes `status.txt` with its own fields
  (`abi`, `unit`, `launch_attempted`, `phase`, `launch_rc`, `terminal_ok`,
  `hash_rc`, `write_failures`, `acceptance_exit`). A pre-launch refusal therefore
  leaves no run directory at all.
- The payload's argument contract is now exactly two arguments (`unit`, `run`), as
  the canonical host launches it, instead of one run directory.
- The payload's own envelope readback (`knob()` loop over `memory.max`,
  `memory.swap.max`, `pids.max`, `cpu.max`, `systemctl show … Type`, `busctl
  GetUnit` → `get-property`), its memory gate, its evidence counter and its peak
  readback are gone, replaced by `br_envelope_enter`, `br_evidence_gate`, `br_peaks`
  and `br_payload_finish`. The target-absent check is **kept in the payload** and is
  now evaluated twice there — once among the preconditions and again right before
  the `node_modules` bind — and the launcher additionally refuses before creating a
  unit at all, so an existing target is caught before and after the launch point.
- Evidence writes go through `br_record`; a failed write is the core's `73` instead
  of a locally incremented counter, and it now outranks a green workload verdict.
- One new precondition: the payload requires the target's canonical path
  (`realpath -m`) to equal its literal path and to have no symlinked ancestor, so
  extraction can never follow a symlink out of `node_modules`.
- Everything the workload does — the URL, the pinned SHA-512, the `curl` argv, the
  `extract.py` rules and limits, the `bwrap` argv, the `sha256sum -c` re-verification
  and the `2.9.1` version assertion — is byte-for-byte the pre-migration behaviour.
