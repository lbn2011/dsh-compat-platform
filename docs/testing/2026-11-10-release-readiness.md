# Release readiness: MIT, real versions, and a standard-aware audit (2026-11-10)

## 0. What this slice decides and what it does not

The publish audit had been reporting the same three blockers on every package: no `license`
field, `"private": true`, and a placeholder version. Two of those were **states the project
chose**, not defects — the roadmap's P5 is titled "compatibility matrix and **private** release
candidate" and states that "npm scope, license, remote, release and publication remain user
decisions". An audit that judges a private candidate by public-publication rules cannot answer
the question anyone actually has, which is "how far is this from being ready".

Decided by the user on 2026-11-10:

* **License: MIT** for all four repositories and all five packages.
* **Version: `0.1.0-draft.1`** for all five packages.
* **Standard A**: make the packages ready, keep `"private": true`, and teach the audit to
  measure against the *private* standard while still being able to measure the public one.

Non-claims:

1. Nothing was published; no registry was contacted in this slice.
2. `"private": true` remains set on all five packages — that is the decision, not an oversight.
3. MIT was chosen by the user; this record documents the choice, it does not argue for it.
4. The audit reads tarballs and manifests. It is not a licence-compliance review of the
   dependency tree, and it never installs anything.
5. `config-check` is audited but **not** installed by the consumer step (see §5).

## 1. Licence

`LICENSE` (MIT, `Copyright (c) 2026 lbn2011`) added to all four repositories, byte-identical
(`b1922703e917c62a97a7457b293f6edc9daa3769dc40cdf1a97d7d25f078c87b`).

The copyright line names `lbn2011` because that is the author on every commit in all four
repositories (`git log --format='%an <%ae>'` → `lbn2011 <lbn20011@outlook.com>`, with one
`lead <lead@local>` commit in the spec repo).

No upstream code was copied into these repositories, so no third-party licence obligation is
inherited: the only reference to `@deepseek-ai/cordis` in the five packages is a JSDoc type
annotation at `packages/host/src/index.js:204`, and no source file carries a `Copyright` header.
The declared dependencies are `yaml@2.9.1` (MIT) and, for `config-check`,
`@hyperjump/browser@1.6.0` / `@hyperjump/json-schema@1.18.0` (MIT per the reviewed lock).

## 2. Manifests

Every package gained `license: "MIT"` and a `repository` object, and its version moved to
`0.1.0-draft.1`. Only those keys changed; `private`, `engines`, `exports`, `files` and the
dependency sets are untouched.

| package | before | after |
| --- | --- | --- |
| `dsh-compat-platform` | `0.0.0` | `0.1.0-draft.1` |
| `@dsh-compat/config-check` | `0.0.0-prepared` | `0.1.0-draft.1` |
| `dsh-compat-diagnostics-ui` | `0.0.0-draft.1` | `0.1.0-draft.1` |
| `dsh-compat-trusted-extraction` | `0.0.0-draft.1` | `0.1.0-draft.1` |
| `dsh-compat-repair` | `0.0.0-draft.1` | `0.1.0-draft.1` |

The three non-platform repositories (`dsh-compat-spec`, `dsh-plugin-kit`,
`dsh-agent-test-driver`) received the same licence, version and repository fields.

## 3. The audit now names the standard it measures

`scripts/package-install/publish_audit.py` gained `--standard private|public` (default
`private`) and moved to `publish-audit/0.1-draft.2`:

* **private** — `"private": true` is the intended state; it is **not** a blocker. Everything
  else (missing `name`/`version`/`description`/`license`/`engines`/`exports`, a placeholder
  version, an empty or `UNLICENSED` license) still blocks.
* **public** — `"private": true` is a blocker, because it would silently prevent a publish.

The chosen standard is written into the document (`standard`) and into every package row, and
two limitations were added: `STANDARD_IS_CHOSEN_BY_THE_CALLER_NOT_INFERRED` and
`AUDITS_TARBALLS_AND_MANIFESTS_ONLY_NEVER_INSTALLS`.

Measured, same tarballs, both standards:

| standard | packages | allowlist violations | blockers |
| --- | --- | --- | --- |
| `private` | 5 | 0 | **0** on all five |
| `public` | 5 | 0 | 1 on all five — `PRIVATE_FLAG_SET` |

So the remaining distance to a public release is now exactly one decision, and it is the
user's: clearing `private`.

## 4. Coverage: the audit had a hole

`EXPECTED` listed four packages; `@dsh-compat/config-check` was missing — the one package with
third-party peers, and therefore the one most worth auditing. It is now the fifth entry, and
`packages/client/` remains a placeholder with no manifest at all (correctly out of scope).

`LICENSE` was added to the tarball allowlist (`package/LICENSE`): npm always ships the licence
file when one exists, so treating it as a stray file would have produced a false violation.

## 5. Why config-check is audited but not installed

Its two peers (`@hyperjump/*`) are not installed anywhere in this repository — the only copy on
this machine lives inside an old run directory
(`/data/dsh-ecosystem-test-artifacts/runs/202609…/work/node_modules`). The offline consumer
install therefore cannot include it, so it is packed into its own directory
(`tarballs-own/`) and audited from there. What that still establishes: the tarball ships only
what its `files` list implies, and its manifest carries the fields a release needs. What it
does **not** establish: that it installs or resolves.

## 6. Rounds

| # | Run | Exit | Notes |
| --- | --- | --- | --- |
| 1 | `20261110T134430Z-package-install-1400901-6535` | 70 | `TARBALL_NOT_FOUND` for config-check: npm writes a scoped name as `dsh-compat-config-check-…`, not `@dsh-compat/config-check-…` |
| 2 | `20261110T135013Z-package-install-1401642-30369` | 0 | green, 5 packages audited, 0 violations, 0 blockers |
| 3 | `20261110T135140Z-package-install-1402171-14653` | 0 | green again; `publish-readiness.json`, `tarball-hashes.txt` and the 23-input selection byte-identical to round 2 |

Round 3: `memory_peak=70135808` B, `pids_peak=15`, `terminal_ok=yes`, `hash_rc=0`,
`write_failures=0`, 24 consumer checks ok, `missing_dep_rc=0`.

`consumer-check.txt` differs between rounds 2 and 3 only in the absolute run directory that
appears in each line — the checks themselves are identical.

Tarballs (round 3):

```
acc370f12689a9f5a55e7fb6bd10bd973477f5e8031f7ef88addf83d5e31f811  dsh-compat-diagnostics-ui-0.1.0-draft.1.tgz  11043B
9d1ec9fe12844f21ecc10aea35f345d9e2439e5faa1a61bfba0433d4b21244b7  dsh-compat-platform-0.1.0-draft.1.tgz       168880B
1023d6baa4ad3823c8baa51abcffdcba42c216fe6f1eeab061009fc740062b95  dsh-compat-repair-0.1.0-draft.1.tgz          13647B
87fd1c1b8a60dfa1b5274c29cbe969b7de98ff632b11e0ca5b71ca14ef7ab64f  dsh-compat-trusted-extraction-0.1.0-draft.1.tgz 11098B
5648e80d3e8969770b61c1e3a48b701dea49cf6b690b039221bfd3df91a2a0c1  yaml-2.9.1.tgz                              112446B
5457550eea2b0c9ad8b4edde27a31ffe284aeccf  (shasum) dsh-compat-config-check-0.1.0-draft.1.tgz  12012B
```

## 7. Deviations

1. Round 1 failed on a real defect in my own audit (`TARBALL_NOT_FOUND` for a scoped name), not
   on a package problem; it is kept at its own exit code rather than deleted.
2. Two spec assertions had encoded "no licence chosen yet" as a fact
   (`assert.equal(packageJson.license, undefined)` and a test named "no install, lockfile or
   license artifacts are committed yet"). They now assert the decided state, including that
   `LICENSE` is the MIT text and not an empty placeholder. The decision is what changed.
3. The `public`-standard measurement in §3 was produced by running the audit by hand against
   round 2's tarballs, outside the envelope; it reads files that already exist and installs
   nothing. It is evidence for the standard split, not a bounded round.
4. Local `node --test` runs (analyzer 448/448, host 16/16, runtime 32/32, repair 42/42, spec
   105/105) preceded the rounds; they are sanity checks outside any envelope. The spec suite was
   then re-run **inside** its own envelope after the version bump, because its package-identity
   test asserted the old version:
   `20261110T135634Z-spec-test-batch-1403086-12330` — `acceptance_exit=0`, `# tests 105 /
   # pass 105 / # fail 0`, `memory_peak=39161856` B, `pids_peak=16`, `terminal_ok=yes`,
   `hash_rc=0`, `write_failures=0`. An earlier invocation returned `77` because it was started
   by a relative path; the core refuses a relative entry rather than guessing, which is the
   behaviour it is supposed to have.
5. `scripts/package-install/run.sh` grew from 21 to 23 selected inputs (config-check manifest
   and README, plus `LICENSE`).

## 8. Hashes at the time of the green rounds

```
consumer-check.mjs   e14c618541d6dcf0e329890d3e198d165e922c77d80d8b18e5535de55c065a52
publish_audit.py     6213e7c0ff396bd5a787704d6fbe8059193b4bb64243668ca2c7bdcf57631040
expect.json          5352c9b3f31f216a38b219003dd6fa0592c5ca44dae6b774c18b8e6edd9db7d3
LICENSE              b1922703e917c62a97a7457b293f6edc9daa3769dc40cdf1a97d7d25f078c87b
```

## 9. Reproducing

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/package-install/run.sh
```

Offline: the four audited-and-installed packages plus `yaml` are packed from the working tree.
The audit then reports `standard=private … blockers=0`. To see the public-standard distance,
run `publish_audit.py` by hand with `--standard public` against the run's tarball directories.
