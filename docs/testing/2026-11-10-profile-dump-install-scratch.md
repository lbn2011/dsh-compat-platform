# profile-dump-install — the success path after the migration, against a named scratch target

**Status: executed, two bounded rounds, both green. The installed tree reproduced by
these rounds is byte-identical to the one already on disk, and that existing tree was
proved unchanged by a digest taken before and after each run.**

Date: 2026-11-10. Repository: `projects/dsh-compat-platform`.
Runner: `scripts/profile-dump-install/{run.sh,payload.sh}` on the shared core
(`bounded-runner/1`).

## 0. Scope and non-claims

This record answers exactly one question that the 2026-11-10 migration record left
open: **does the migrated installer's success path still work?** The earlier attempt
could only reach the by-design refusal, because
`packages/analyzer/node_modules/yaml` already exists and the batch never replaces an
existing target.

It does **not** establish:

- that the tarball is the genuine upstream artifact — the pinned SHA-512 is only as
  trustworthy as the constant in `payload.sh`;
- that the installed tree is a dependency closure (it is `yaml` alone, and the
  per-file manifest is a snapshot of what this payload wrote);
- that the analyzer package or its suite passes — that is `profile-dump-batch`;
- that the analyzer now resolves `yaml` differently — the real tree was not touched,
  so no consumer's resolution changed;
- anything about certification, loadability or activation.

## 1. What changed

| file | change |
| --- | --- |
| `scripts/bounded-runner/host.sh` | new declared `BR_SETENV` channel: an array of `--setenv=NAME=value` strings, validated against `^--setenv=[A-Za-z_][A-Za-z0-9_]*=?` and recorded to `setenv.txt`, then inserted before `--` in the `systemd-run` argv. Empty by default; when unset, the argv is byte-identical to before. |
| `scripts/bounded-runner/core.manifest` | `host.sh` digest updated. |
| `scripts/profile-dump-install/payload.sh` | `NM="${PROFILE_DUMP_INSTALL_NODE_MODULES:-$PKG/node_modules}"`, `TARGET="$NM/yaml"`. Default behaviour unchanged; the "never replace an existing target" refusal now applies to whatever path is named. |
| `scripts/profile-dump-install/run.sh` | computes `NM_BASE`/`NM_TARGET` from the same variable, preflights **that** path instead of the hard-coded one, declares `BR_SETENV=(--setenv=PROFILE_DUMP_INSTALL_NODE_MODULES=$NM_BASE)`, and takes a digest of the real dependency tree before and after the launch. |

### Why the core needed a change

The payload runs as a transient systemd service. A transient service does not inherit
the invoking shell's environment, so exporting the variable in `run.sh` would never
reach the payload. The alternative — passing it on the payload's command line — is
impossible because the core fixes the payload's argv to `unit run`. The declared
`--setenv` channel is the smallest explicit route: one name/value, validated, echoed
into the run's own evidence, never a general environment passthrough.

## 2. Why a scratch target rather than removing the real one

The real target exists and is in use by `packages/analyzer`. Deleting it to exercise
the installer would damage a working dependency to make a test proceed, and a failed
extraction would leave a partial tree where a real one used to be. Pointing the
installer at a named path under `/data/dsh-ecosystem-test-artifacts/scratch/` exercises
the same code (same URL, same pinned digest, same extractor, same manifest
re-verification, same version assertion) while leaving the installed tree alone — and
the digest pair around the launch proves the latter rather than asserting it.

The scratch path is deliberately **not** under `/tmp`: the extraction sandbox mounts a
private `tmpfs` at `/tmp`, which would hide a target living there.

## 3. The two rounds

| round | run directory | exit | tests | install target |
| --- | --- | --- | --- | --- |
| 1 | `/data/dsh-ecosystem-test-artifacts/runs/20261109T194725Z-profile-dump-install-1206601-29769` | 0 | n/a (installer, no suite) | `…/scratch/profile-dump-install-20261109T194700Z/node_modules/yaml` |
| 2 | `/data/dsh-ecosystem-test-artifacts/runs/20261109T194749Z-profile-dump-install-1207571-10185` | 0 | n/a | `…/scratch/profile-dump-install-20261109T194800Z/node_modules/yaml` |

Both rounds, from `status.txt` and the core's records:

- `abi=bounded-runner/1`, `launch_attempted=yes`, `phase=completed`;
- `launch_rc=0`, `terminal_ok=yes`, `hash_rc=0`, `write_failures=0`, `acceptance_exit=0`;
- `control-before.txt` and `selected-before.txt` **byte-identical between rounds**;
  `control-diff.txt` and `selected-diff.txt` empty in both;
- `memory_peak=15810560` B, `pids_peak=4`, `MemAvailableKiB=1450824` against the
  819200 KiB gate;
- ownership receipt recorded (`unit=profile-dump-install-20261109t194725z-1206601-12795.service`,
  `invocation_id=2f654a72624244f4988d1aeb4d64e168` in round 1), no automatic stop.

The two rounds used different scratch paths only because an existing target is (by
design) refused; nothing else differs.

## 4. What the install actually did

From `integrity.txt` and `install-summary.txt`, identical in both rounds:

```
sha512_b64_expected=3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==
sha512_b64_actual=3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==
sha512_match=yes
tgz_sha256=4ef6c54cf559b8a207b7b518378230805a1c84af239b14960e8c67c7d59de5d3
tgz_bytes=112114
version_expected=2.9.1
version_actual=2.9.1
manifest_files=233
manifest_verify_rc=0
```

`extract.log`: `extract: files=233 dirs=0 total_bytes=686297`.

The tarball digest is the same value the pre-migration run on 2026-11-08 recorded
(`4ef6c54c…`, 112114 B), so the bytes fetched today are the bytes fetched then.

### The installed tree is the tree that is already on disk

A digest over sorted `(path, sha256)` pairs was computed for three directories with the
same function the launcher uses:

| directory | digest | files |
| --- | --- | --- |
| round 1 scratch install | `07d715338d66b0908f07f510f88733244d5c3993bdc3833ec66a8edc0406e594` | 233 |
| round 2 scratch install | `07d715338d66b0908f07f510f88733244d5c3993bdc3833ec66a8edc0406e594` | 233 |
| `packages/analyzer/node_modules/yaml` (untouched) | `07d715338d66b0908f07f510f88733244d5c3993bdc3833ec66a8edc0406e594` | 233 |

`diff -r` between the round-1 tree and the real tree reports no differences.

### The real tree was not modified

`real-target.txt`, written by the launcher around the launch, both rounds:

```
real_target=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer/node_modules/yaml
real_target_digest_before=07d715338d66b0908f07f510f88733244d5c3993bdc3833ec66a8edc0406e594
real_target_digest_after=07d715338d66b0908f07f510f88733244d5c3993bdc3833ec66a8edc0406e594
real_target_state=unchanged
```

The launcher exits `72` if that pair ever disagrees, so the guarantee is enforced, not
merely observed.

## 5. What a green run establishes

- The fetched bytes hash to the pinned SHA-512 and to the same SHA-256 as the
  2026-11-08 install.
- An archive passing the path/size/count rules was written into the **named** target.
- The written tree re-verified against its per-file SHA-256 manifest via
  `sha256sum -c` from the installed location (`manifest_verify_rc=0`).
- The installed `package.json` reports `2.9.1`.
- The produced tree is byte-identical to the one currently installed, and that
  installed tree was not modified by the run.

## 6. Deviations and open points

1. **The core changed for this slice.** `host.sh` gained the `BR_SETENV` channel and
   `core.manifest` was refreshed. The mock qualification was re-run afterwards and
   reported `failures=0` for both negative-test suites (18 host-path checks); that
   suite does **not** exercise the `--setenv` branch, which is exercised only by these
   two installer runs. The `--setenv` path therefore has two real executions, not a
   mock test.
2. **`core.manifest` is a control source**, so the platform core's own record
   (`docs/testing/2026-11-10-bounded-runner-core.md`) now describes historical bytes
   for `host.sh`.
3. **The scratch trees remain on disk** under
   `/data/dsh-ecosystem-test-artifacts/scratch/`. They are artifacts, not repository
   content, and not evidence of anything beyond what §4 states.
4. **Round 1 and round 2 differ in one input only**: the scratch path, which is passed
   in. Control and selected hashes are identical.
5. **`profile-dump-install` still has no default-mode green run** on this machine. The
   default path (install into the real location) remains verified only by the
   2026-11-08 record, for those bytes. This record does not retroactively validate it.
6. The scratch run leaves the `node_modules` parent created inside the scratch path;
   nothing cleans it, by the same "never delete" rule the batch applies to a real
   target.

## 7. Hashes at run time

Control sources (`control-before.txt`, identical in both rounds):

```
a8166c3120ca5a08e40f2babb264951ee749c17fcaca45b0372611b96fb319a5  scripts/bounded-runner/core.manifest
4a19e70ea68f91a00b1818cec81170422017c7b27e019945953cba201e76bc08  scripts/profile-dump-install/run.sh
a8a69a9eb545e3cff5aee493022df36d14ee0d2eed29b8de4d86d059237057a8  scripts/profile-dump-install/payload.sh
b99d70e898bcaa5ece54b7c08759176d081e26b7fab1eff5fe47a411454ac872  scripts/bounded-runner/common.sh
67ab0cd1240058a3e96852007ac753b479edf06a7ad7ec5c466fc1d47d02d4ab  scripts/bounded-runner/policy.sh
08a12b13f1ce535b8bb86b7f22ba63f99daa0c4b3b67e089e62d7c524f086b84  scripts/bounded-runner/host.sh
3c6cff413df965f0015cd7175acadebe1422341e8bab7915af8e88daed7832dd  scripts/bounded-runner/envelope.sh
bae622fb3814c2327be76b94796e1a18745077c824a7c348aaa50aaf519dc1a0  scripts/bounded-runner/tap.sh
```

Selected input (one):

```
c9f1fa6a58ef135e71758244126d3e064f3112d4bcb795378d18f2b761a0b766  packages/analyzer/package.json
```

`README.md` was edited after the rounds and is not in either set; this §7 is the
run-time state.

## 8. Reproduce

```
SCRATCH=/data/dsh-ecosystem-test-artifacts/scratch/profile-dump-install-$(date -u +%Y%m%dT%H%M%SZ)/node_modules
mkdir -p "$(dirname "$SCRATCH")"
PROFILE_DUMP_INSTALL_NODE_MODULES="$SCRATCH" \
  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install/run.sh
```

The path must be absolute and must not exist; `/tmp` is unusable because the
extraction sandbox masks it with a private `tmpfs`.

Exit codes are the documented ones: `0` green, `70` refusal (including "target already
exists"), `71` parse, `72` download/verify/extraction failure or real-target drift,
`73` evidence write, `74` unit did not settle, `75` lock held, `76` run-directory
collision, `77` control/manifest read failure (including a relative entry path), `78`
selected-input drift.
