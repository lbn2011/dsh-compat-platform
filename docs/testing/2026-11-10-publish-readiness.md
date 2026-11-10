# Publish readiness: what is missing between "installable" and "publishable"

Status: **executed, two bounded green rounds (2026-11-10)**

Scope: user decision item 3 **C**. Turn the packaging batch's "the tarball installs" into
"here is exactly what would have to change before this could be published" — measured from the
tarballs themselves, without publishing anything and without editing a manifest.

## 1. What was added

`scripts/package-install/publish_audit.py` (read by `tarfile`, no dependencies) plus **step 4b** in
that batch's payload, running after the five tarballs are packed and before the consumer install:

1. For each package directory, find the one tarball whose name starts with `<manifest name>-<manifest version>`.
   Zero or several matches is `TARBALL_NOT_FOUND` and counts as a violation — the audit refuses to
   guess which archive it is looking at.
2. Open that tarball and list its regular files.
3. **Allowlist**: only `package/package.json`, `package/README.md`, and `package/src/**` may appear.
   Anything else is `TARBALL_FILE_OUTSIDE_ALLOWLIST` with the first ten offenders, and any violation
   fails the step with **exit 74**. Also `TARBALL_MISSING_README` and `TARBALL_MISSING_SOURCES` if
   the archive is empty where it should not be.
4. **Publish blockers** (recorded, never resolved): missing `name/version/description/license/engines/exports`,
   `"private": true`, a placeholder version (`0.0.0`, `0.0.0-prepared`, `0.0.0-draft.1`), and
   `license` present but empty/`UNLICENSED`.
5. Write `publish-readiness.json` (closed shape, `certification: false`, four limitations) and
   `publish-readiness.txt`, plus `publish-audit.rc`.

`publish_audit.py` was added to the launcher's selected inputs, so the audit's own code is hashed
before and after the round.

## 2. Bounded rounds

| Round | Run dir | acceptance_exit | audit | memory_peak | pids_peak |
| --- | --- | --- | --- | --- | --- |
| 1 | `20261110T122930Z-package-install-1381283-11283` | 0 | 0 violations | 77 033 472 B | 15 |
| 2 | `20261110T122957Z-package-install-1381679-30648` | 0 | 0 violations | 56 303 616 B | 15 |

Both rounds: `terminal_ok=yes`, `hash_rc=0`, same selected-input set, and `publish-readiness.json`
byte-identical between the two rounds.

## 3. What the audit measured

| package | tarball files | bytes | allowlist violations | blockers |
| --- | --- | --- | --- | --- |
| `dsh-compat-platform` (analyzer) | 34 | 168 826 | 0 | license missing, `private: true`, version `0.0.0` |
| `dsh-compat-diagnostics-ui` (host) | 5 | 10 984 | 0 | license missing, `private: true`, version `0.0.0-draft.1` |
| `dsh-compat-trusted-extraction` (runtime) | 7 | 11 035 | 0 | license missing, `private: true`, version `0.0.0-draft.1` |
| `dsh-compat-repair` | 7 | 13 587 | 0 | license missing, `private: true`, version `0.0.0-draft.1` |

So the `files` allowlist does what it claims in the shipped bytes — no test file, no fixture, no
`node_modules` snippet escapes into a tarball — and the distance to a publishable release is three
decisions, identical for all four packages: **choose a license**, **clear `private`**, **replace the
placeholder version**. Nothing in the code differs; the tarball shapes are already clean.

Note that the audit sees a *thin* analyzer tarball (34 files) although the source tree is larger:
that is the `files: ["src/", "README.md"]` allowlist working, not a missing file.

## 4. What this does not establish

- It does not establish that these packages should be published. Choosing a license and a version
  scheme is a decision nobody has taken yet; the audit only lists the decisions.
- It is not a security review of the tarball contents: "only these paths appear" says nothing about
  whether the code inside them is safe.
- It does not re-check that the tarball installs; that is the batch's steps 5–7, which ran green in
  the same rounds.
- `certification` stays `false`; nothing was published, no registry was contacted (`npm pack
  --offline`).

## 5. Deviations

1. The audit lives inside the existing packaging batch rather than in its own triple: adding a new
   runner prefix would have required a `policy.sh` change, and a policy change means re-qualifying
   the core and re-syncing the vendored copy in the spec repo — cost without new evidence.
2. `PYTHON=/usr/bin/python3` was added to the payload (the audit reads tarballs with `tarfile`);
   `python3 -I` is used so no `PYTHONPATH` or user site can influence the parse.
3. The first draft of the audit treated a tarball-name mismatch as a blocker; it is a violation
   instead, because a tarball that cannot be identified is not evidence about the package named in
   the manifest.
4. `scripts/package-install/README.md` was edited after the two rounds (new step, new artefact,
   exit 74 now also meaning an allowlist violation). It is not a hashed input.

## 6. Run-time hashes

```
908faeeb39fc998da152b826ff6a5a0924557c0df83beac400d7ca8981e979eb  scripts/package-install/payload.sh
e9726506154fb3624d8201a2094a98e82dfc23f7d8d43e46da1e95c9c64938d7  scripts/package-install/run.sh
d7bd1dda00a67820ea3d35c380533480800bc170fc7b5e65124215f3599e78d3  scripts/package-install/publish_audit.py
```

The two rounds used these bytes: each round's `control-before.txt` equals its `control-after.txt`
and the two rounds' `selected-before.txt` files carry the same set; the launcher reports drift as
`78` and reported none.

## 7. Reproduce

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/package-install/run.sh
```

Then read `publish-readiness.json` and `publish-readiness.txt` in the run directory.
