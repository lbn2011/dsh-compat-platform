# The default layout, used under an independent prefix

Status: **executed, two bounded green rounds (2026-11-10)**

Scope: user decision item 2 **A + C**. A: the installer keeps refusing to replace an existing
target — nothing here makes it destructive. C: it is now demonstrated that the *layout* a consumer
actually sees (`<prefix>/node_modules/<package>` beside its dependencies) works, not merely that an
archive extracts.

## 0. What this establishes, and what it does not

- It establishes that the installer, pointed at an independent prefix, installs `yaml@2.9.1`
  byte-identically to the pinned tarball, matches its own 233-file manifest, and leaves the
  checkout's real `node_modules/yaml` **unchanged** (digest before == after, enforced by exit 72).
- It establishes that a copy of this package placed in that prefix resolves `yaml` from **that
  prefix** (recorded resolved path) and summarises the shipped example, reporting
  `profile-dump-summary/0.3-draft.1`.
- It does **not** publish anything: all four packages remain `private: true`.
- It does **not** audit the `files` allowlist (item 3 C), and does not claim the tarball is
  complete for any consumer this machine has not been.
- It does **not** touch, read or replace the checkout's real dependency; that tree is measured, not
  modified.

## 1. What changed

Only the installer slice, in `projects/dsh-compat-platform/scripts/profile-dump-install/payload.sh`:

1. Two pinned constants — `EXAMPLE_REL=/examples/diagnose/profile.yml` and
   `EXPECT_SUMMARY_SCHEMA=profile-dump-summary/0.3-draft.1` — so the step cannot pass by
   summarising some other document or by reporting a different shape.
2. After the version check, a **default-layout** step: create `$RUN/layout/node_modules`, copy the
   package's `package.json` and `src` into `$RUN/layout/node_modules/dsh-compat-platform`, symlink
   `$RUN/layout/node_modules/yaml` onto the freshly installed tree, and record the layout.
3. A resolution check inside the same sandbox: `createRequire(<copied src>/profile-dump.js)`
   resolves `yaml` and prints the resolved path; the run **fails 72** unless that path lies inside
   the independent prefix (`$LAYOUT/*` or `$NM/*`, since Node reports the symlink target).
4. A use check: the copied CLI summarises the shipped example with a 192 MiB heap, exit must be 0,
   and the reported `profileDumpSummary` must equal `EXPECT_SUMMARY_SCHEMA`.

Defects found while doing it (both mine, both caught by running it rather than by reading it):

- The first version asked the copied CLI for `"$LAYOUT_PKG/../..$EXAMPLE_REL"`, which is a path
  inside the scratch run directory where no example exists. Fixed to `"$REPO$EXAMPLE_REL"`.
- The first version rejected the resolved path because Node reports the symlink **target**
  (`$NM/yaml/dist/index.js`) rather than the symlink. That is honest behaviour; the check now
  accepts the prefix or the tree it points at, and nothing else.

## 2. Bounded rounds

Both rounds ran the slice's launcher under the shared bounded runner with
`PROFILE_DUMP_INSTALL_NODE_MODULES` naming a fresh scratch prefix.

| Round | Run dir | launch_rc | schema | memory_peak | pids_peak |
| --- | --- | --- | --- | --- | --- |
| 1 | `20261110T121940Z-profile-dump-install-1377544-14010` | 0 | `profile-dump-summary/0.3-draft.1` | 20 672 512 B | 10 |
| 2 | `20261110T122002Z-profile-dump-install-1378233-29971` | 0 | `profile-dump-summary/0.3-draft.1` | 22 888 448 B | 10 |

Both: `phase=completed`, `terminal_ok=yes`, `hash_rc=0`, `write_failures=0`, selected manifests
byte-identical between the two rounds. Install evidence identical in both rounds: `sha512_match=yes`,
`tgz_sha256=4ef6c54cf559b8a207b7b518378230805a1c84af239b14960e8c67c7d59de5d3`, `tgz_bytes=112114`,
`version_actual=2.9.1`, `manifest_files=233`, `manifest_verify_rc=0`.

Resolved-path record (round 2): `resolved=/data/dsh-ecosystem-test-artifacts/scratch/profile-dump-install-20261110T122002Z/node_modules/yaml/dist/index.js`.

Real-tree guard, both rounds: `real_target_digest_before` == `real_target_digest_after` ==
`07d715338d66b0908f07f510f88733244d5c3993bdc3833ec66a8edc0406e594`, `real_target_state=unchanged`.
The launcher exits 72 on disagreement, so this is enforced rather than observed.

Two earlier invocations are preserved as failures and were fixed in the payload, never by
weakening the check: `20261110T121900Z-profile-dump-install-1376859-18699` (exit 72 — the prefix
check rejected the symlink target) and, before that, the same launcher refusing the real target.

## 3. Deviations

1. **The payload changed between rounds 1 and 2? No** — rounds 1 and 2 both used
   `payload.sh` `7d3ecfa8b739973be2f2c2adbe52c411f56a195c5f7ddb8f637d849e5df83ace`. The earlier
   failing invocation used the pre-fix bytes.
2. The **default** target (the checkout's own `packages/analyzer/node_modules/yaml`) still refuses
   by design (A). That path is not green on this machine and is not claimed to be; the scratch
   prefix is the measurement.
3. The scratch prefix is created under `/data/dsh-ecosystem-test-artifacts/scratch/`, never under
   `/tmp`, so the evidence survives the run and the "never under /tmp" rule from the previous
   record holds.
4. `packages/analyzer/package.json` is a selected input of this batch and is unchanged
   (`c9f1fa6a58ef135e71758244126d3e064f3112d4bcb795378d18f2b761a0b766`), so the 0.3 summary change
   reaches this batch only through the copied `src`.

## 4. Run-time hashes

```
7d3ecfa8b739973be2f2c2adbe52c411f56a195c5f7ddb8f637d849e5df83ace  scripts/profile-dump-install/payload.sh
4a19e70ea68f91a00b1818cec81170422017c7b27e019945953cba201e76bc08  scripts/profile-dump-install/run.sh
c9f1fa6a58ef135e71758244126d3e064f3112d4bcb795378d18f2b761a0b766  packages/analyzer/package.json
```

`scripts/profile-dump-install/README.md` was edited after the rounds; its hash is not pinned here.

## 5. Reproduce

```bash
S=/data/dsh-ecosystem-test-artifacts/scratch/profile-dump-install-$(date -u +%Y%m%dT%H%M%SZ)/node_modules
PROFILE_DUMP_INSTALL_NODE_MODULES=$S \
  bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install/run.sh
```

Exit codes: `0` pass, `70` envelope/argument refusal or existing target, `72` drift or a failed
layout check, `73` evidence write failure, `77` relative invocation.
