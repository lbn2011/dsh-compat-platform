# profile-dump install envelope (yaml@2.9.1)

**STATUS: EXECUTED (2026-11-08).** A single isolated install of `yaml@2.9.1` was run under this
envelope and succeeded: `acceptance_exit=0`, tgz sha256 `4ef6c54c…`, sha512 matched the registry,
233 files extracted, manifest verify rc 0, version `2.9.1`. Envelope/readback green; single memory
gate 1651552 KiB ≥ 819200; peak ≈30.9 MiB, pids 5; terminal settled. Full record (including the
two acceptance rounds that consumed this install) is in
`docs/testing/2026-11-08-profile-dump.md`.

## Purpose

Do **one** isolated, verified install of `yaml@2.9.1` into

```
projects/dsh-compat-platform/packages/analyzer/node_modules/yaml
```

so that the separate `profile-dump-batch` acceptance batch (which refuses if the
dependency is absent) has a baseline to run against. This envelope does **not**
run any test, does not run any package code, and does not use `npm`.

## Hard boundaries

- Writes only two places: the new `node_modules/yaml` (created exclusively) and
  this run's artifact directory under `/data/dsh-ecosystem-test-artifacts/runs`.
  Everything else is read-only inside the extraction sandbox.
- **Refuses if `node_modules/yaml` already exists** — it never deletes or
  replaces an existing target (`70`).
- Does not modify production, version-controlled content of the parent repo,
  `vendor/`, or any other package. It does open the **existing** shared lock file
  `experiments/acceptance/runs/.acceptance.lock` (an `flock` on it), so it is not
  claimed to touch no file of the parent repo at all — only to not change its
  version-controlled content.
- No `npm`, no production `npmrc`, no package lifecycle script, no `postinstall`.
- Network is used **only** during the download step. Extraction runs under
  `bwrap --unshare-net`, which **configures** network isolation for that step; it
  is not claimed as proof that no network access occurred.

Note on scope of read-only: only the **extraction** step is the read-only
construct. The run is not read-only overall — the download step writes the
tarball into the run directory and uses the network, and inside the extraction
sandbox the writable roots are the **whole** `node_modules` directory and the run
directory (not only `yaml`).

## Envelope (identical to the accepted batches)

| Property | Value |
| --- | --- |
| `Type` | `exec` |
| `MemoryMax` | 384 MiB (`402653184`) |
| `MemorySwapMax` | `0` |
| `TasksMax` | `32` |
| `CPUQuota` | `50%` (`cpu.max = 50000 100000`) |
| `RuntimeMaxSec` | `120` (`RuntimeMaxUSec = 120000000`, read back through `busctl`) |
| Host gate | `MemAvailable` ≥ `819200` KiB, read **once**, before any work |
| Concurrency | `flock -n` on the shared `experiments/acceptance/runs/.acceptance.lock`; a held lock is a refusal (`75`), never a wait |
| Active-unit query | same unit-family `systemctl list-units` query every batch uses; a failed query refuses (`70`) |
| Terminal | `MainPID` must read back as `0` (plus `Load/Active/Sub` agreement) |
| Retries | none — any failure stops |

Every limit is **read back** from the cgroup and from systemd inside the payload
and compared to the approved values with strict single-line reads (an empty,
missing, or duplicated value is a mismatch). A mismatch refuses (`70`) before
anything is downloaded or written.

## Stages

| Stage | What it does | Exit |
| --- | --- | --- |
| 0 | runner: args, shared lock, active-unit query, run dir, pre-hashes; refuse if target exists | `70/75/76/73` |
| 1 | payload: envelope readback (cgroup + `systemctl` + `busctl GetUnit` → `get-property`) | `70` |
| 2 | payload: envelope matched against approved limits | `70` |
| 3 | payload: `MemAvailable` gate, once | `70` |
| 4 | payload: **evidence gate** — any record write failure stops *before* `bash -n` | `73` |
| 5 | payload: `bash -n` on both scripts | `71` |
| 6 | payload: **evidence gate** — any record write failure stops before mutation | `73` |
| 7 | payload: `curl -q …` under `env -i` (fixed `PATH/HOME/TMPDIR`, no inherited proxy/credentials), fixed URL, size + time caps, no retry, no user config | `72` |
| 8 | payload: SHA-512 (base64) must equal the pinned value; SHA-256 recorded | `72` |
| 9 | payload: write `extract.py`, hash it | `73` |
| 10 | payload: second evidence gate before creating `node_modules` | `73` |
| 11 | payload: extract under `bwrap` (ro root, rw only `node_modules` + run dir, `--unshare-net` configured) | `72` |
| 12 | payload: re-verify written tree via `sha256sum -c` from the installed location | `72` |
| 13 | payload: version check (`2.9.1`) from installed `package.json` | `72` |
| — | runner: terminal-state (`MainPID=0`) and post-hash check | `74/77/78` |

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
- `-q` is the first `curl` argument; it disables any user `~/.curlrc`; the pinned
  URL is the only source.
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

- name must be non-empty, not absolute, must contain no empty or `.` component,
  no `..` component, no control/newline characters, and must be `package` or
  under `package/` (the npm tarball root);
- the `package/` prefix is stripped; the remainder must stay inside the
  destination (`os.path.commonpath` check per file and per directory);
- duplicate normalized paths are rejected;
- symlinks and hardlinks are rejected; any non-regular entry (device, fifo,
  char/block) is rejected; only directories and regular files are written;
- the archive is validated one member at a time (**not** via `getmembers()`
  first), counting **all** members including directories: at most `1000` members
  and at most 8 MiB of regular-file bytes, both enforced during the streaming
  iteration so a huge member list cannot exhaust memory before the count check;
- the destination directory is created with `os.mkdir` (exclusive) and every
  file with `open(..., "xb")` (exclusive create) — an existing target or file is
  refused, never overwritten;
- a per-file SHA-256 manifest is written as `<hex>  <relative-path>`.

No `package.json` script, `postinstall`, or any file is executed. Version is read
by parsing the installed `package.json` as JSON (parsing, not executing).

The per-file hashes are computed while writing the extracted stream; that alone
proves only what was read from the archive. After extraction the payload therefore
re-verifies the **on-disk** tree with `sha256sum -c` from the installed location
and stops (`72`) if any file does not match its manifest entry.

Sandbox for extraction:

```
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
      --bind <node_modules> <node_modules> --bind <run-dir> <run-dir> \
      --unshare-net --unshare-pid --unshare-ipc --unshare-uts --die-with-parent \
      --chdir <run-dir> \
  env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
  /usr/bin/python3 -I extract.py <tgz> <target> <manifest> 1000 8388608
```

The whole tree is read-only except `node_modules` and the run directory; the
writable `node_modules` is the whole directory, not only `yaml`. `--unshare-net`
**configures** network isolation for this step (it is not a claim that no network
access was attempted elsewhere). All Python invocations (here and the SHA-512 /
version readers) use `/usr/bin/python3 -I` (isolated mode: no `PYTHON*`
environment, no user site) to keep them free of injected paths.

## Evidence

Raw artifacts: `/data/dsh-ecosystem-test-artifacts/runs/<stamp>-profile-dump-install-…/`.

- Runner writes: `status.txt`, `argv.txt`, `selection.txt`, `hashes-before.txt`,
  `hashes-after.txt`, `hashes-diff.txt`, `active-units.txt`/`.err`, `unit.log`,
  `journal.txt`, `terminal-query.txt`/`-raw.txt`, `systemd-run.rc`, `launch.txt`.
- Payload writes: `envelope-cgroup.txt`, `envelope-systemctl.txt`,
  `envelope-busctl-path.txt`, `envelope-busctl.txt`, `envelope-effective.txt`,
  `envelope-verdict.txt`, `memory-gate.txt`, `evidence-gate.txt`, `syntax.txt`,
  `download.txt`, `curl.log`, `integrity.txt`, `extract.py`, `extractor.txt`,
  `workload.txt`, `extract.log`, `extract.rc`, `extract-failure.txt` (only on
  failure), `yaml-files.sha256`, `verify-manifest.log`, `verify-manifest.rc`,
  `install-summary.txt`, `peaks.txt`.

Selected-input hashes (`run.sh`, `payload.sh`, `package.json`) must be identical
before and after (`hash_rc=0`). `node_modules` is deliberately **not** in that
set: this run creates it, so its appearance is not drift.

## Exit codes

`0` green · `70` refusal (envelope/precondition/target exists) · `71` a script
does not parse · `72` download/verify/extract verification failed · `73` evidence
write failed · `74` unit did not settle · `75` lock held · `76` run-directory
collision · `77` hash manifest unreadable/unwritable · `78` selected-input drift.

## What a green run would establish — and would not

Would establish: the fetched bytes hash to the pinned SHA-512; a tar archive
passing the path/size/count rules was written into `node_modules/yaml`; the
written files re-verify against the recorded per-file SHA-256 manifest via
`sha256sum -c` from the installed location; the installed `package.json` reports
version `2.9.1`.

Would **not** establish:

- That the tarball is the genuine upstream artifact. The digest is only as
  trustworthy as this file; it is not an independent attestation.
- That the installed tree is a complete dependency closure (it is only `yaml`
  itself; the copy hashes are a snapshot of what this payload wrote, **not** a
  closure and **not** an attestation/certification).
- That the analyzer package or its suite now passes — that is `profile-dump-batch`.
- That no change happened-and-was-reverted between snapshots.

## Unresolved risks / caveats

1. **Digest provenance.** The pinned base64 SHA-512 is taken from the task
   statement. Nothing here independently confirms it against a second source; if
   the constant is wrong, the run refuses (`72`) rather than installing.
2. **Runtime budget.** `RuntimeMaxSec=120` with `curl --max-time 60` leaves
   ~60 s for extraction. On a slow network this could approach the cap; a stall is
   a failure (`74`/`72`), not a partial install.
3. **Leftover `node_modules/` on failure.** The parent `node_modules` directory is
   created right before extraction. If `bwrap` fails to launch or extraction fails
   partway, a **partial** `node_modules/yaml` (or an empty `node_modules/`) may
   remain. This batch does **not** delete it and does **not** retry; the fact is
   recorded in `extract-failure.txt`. A later run refuses to proceed while
   `node_modules/yaml` exists, so the partial tree must be inspected and removed
   by hand before any re-run.
4. **Redirect host.** `curl --location` may follow a redirect to a CDN; the
   pinned SHA-512, not the host, is what authenticates the bytes.
5. **`python3`/`tarfile` behaviour** (3.13.5 on host) is trusted for correct
   `..`/link/device rejection; the script additionally re-checks paths with
   `commonpath`, rejects empty/`.` components and control characters, and rejects
   duplicate normalized paths.
6. **Copy hashes are not a closure.** As stated above: the per-file SHA-256
   manifest and the `sha256sum -c` re-verification show that the written bytes
   match what the payload extracted — they are **not** a dependency closure and
   **not** an attestation/certification of the tarball.

## Files

- `run.sh` — host-side launcher (lock, active-unit query, systemd-run, terminal,
  hashes, verdict).
- `payload.sh` — in-unit payload (envelope readback, gates, download, verify,
  extract, version check).
- `README.md` — this document.
