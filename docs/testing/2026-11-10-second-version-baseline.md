# Third row: what the published `0.2.2-alpha.2` actually is

Status: **executed, two bounded green rounds (2026-11-10)**

Scope: dev-plan item 3 **B** — put an *older published* release into the matrix instead of only
naming its commit in prose. The first slice (`2026-11-10-second-baseline.md`) made the installed
`0.2.2-rc.1` measurable; this one asks the same questions of `0.2.2-alpha.2`, the version the
project has been quoting as the official baseline.

## 1. What one round does

`scripts/second-version-baseline/` (new triple on the shared runner, prefix
`second-version-baseline`):

1. Envelope receipt — the core's, unchanged: 384 MiB, swap 0, 32 tasks, 50 % CPU, 120 s, one
   `MemAvailable >= 819200` KiB gate.
2. `bash -n` ×2 and `node --check` on `probe-release.mjs`.
3. Static contract: the runtime package is still `private`, still has zero dependencies, and
   `scripts/runtime-receipt/receipt.mjs` still declares a `receiptVersion`.
4. **One registry read** for the release manifest (`npm view @deepseek-ai/dsh@0.2.2-alpha.2 --json`).
   Note: that command answers with an **array** even for a single version — the first draft assumed an
   object and the round failed with "the release names no dsh-app-boot dependency".
5. `npm pack @deepseek-ai/dsh-app-boot@<resolved version>` (one tarball, 29 files) and extract it with
   `python3 -I` + `tarfile`, refusing any member that escapes the destination.
6. `probe-release.mjs` reads the extracted `lib/index.js` **as text** and collects its export names.

Both network steps run without `bwrap` (they need the network) and with `env -i`, an explicit
`HOME`/`TMPDIR`/`--cache` inside the run directory. This is the only batch in the repository that
contacts a registry at all.

## 2. Why there is no receipt for this release

Installing `@deepseek-ai/dsh@0.2.2-alpha.2` pulls **91 direct dependencies**; with their own trees that
is a multi-hundred-package install. It was attempted once and the unit was **killed at the 120 s
envelope** (`code=killed, status=15/TERM`, runtime `2min 71ms`, `Memory peak: 161.9M`). Rather than
raise the envelope for one batch, this slice answers the two questions that fit and says which
question it cannot answer:

- **answered**: the release's own manifest (name, version, dependency count, the app-boot version it
  depends on) and the export surface of that app-boot build;
- **not answered**: its full runtime receipt — that needs an installed tree, and the installed tree
  does not fit the budget. `receipt_scope=release-manifest-and-interface-package-only` is written into
  `baseline.txt` for exactly this reason.

## 3. Bounded rounds

| Round | Run dir | acceptance_exit | interface | memory_peak | pids_peak |
| --- | --- | --- | --- | --- | --- |
| 1 | `20261110T124030Z-second-version-baseline-1384361-341` | 0 | usable | 44 490 752 B | 13 |
| 2 | `20261110T124042Z-second-version-baseline-1384573-29601` | 0 | usable | 45 469 696 B | 13 |

Both rounds: `terminal_ok=yes`, `hash_rc=0`, same selected-input set, and `interface.json`
**byte-identical**.

## 4. What was measured

```
release            @deepseek-ai/dsh 0.2.2-alpha.2
direct dependencies 91
dsh-app-boot      0.2.2-alpha.2
built exports      57 names
required present    boot: true
                    auditStartupEntries: true
```

So the interface this repository's fixture observation depends on **is present in the published
official-line release**, not only in the installed rc.1: `boot` and `auditStartupEntries` both appear
in `lib/index.js`'s export list, in a build whose own manifest says `0.2.2-alpha.2`.

Method caveat, deliberately not blurred: the names were read from the **export statements in the
built file**, not by importing it. Importing needs `@deepseek-ai/cordis`, which a bare package tarball
does not carry (`ERR_MODULE_NOT_FOUND` was the first attempt). "The name is exported" is therefore
established; "the export is a callable function at runtime" is not — for that, the installed rc.1
observation in the sibling record is the evidence, and it is a different build.

## 5. What this does not establish

- It does not establish that the published `0.2.2-alpha.2` tarball was built from commit
  `ce7073d51254c26cd63b22a60835b8f948deb447`. Nothing here measures that link; the commit remains a
  *declared* pin and the published version a *measured* artifact.
- It does not establish behavioural equivalence between alpha.2 and rc.1. No fixture was observed on
  alpha.2; the observation evidence is rc.1's.
- It does not establish that a consumer could install that release here — that is the step that ran
  out of budget, and "we could not do it in 120 s" is not "it does not work".
- `certification` stays `false`.

## 6. Deviations

1. New runner prefix `second-version-baseline` required a `policy.sh` change (prefix + unit family);
   the core manifest was refreshed to policy digest
   `c42d382e55ba88bbb8d745f04a81cc1e54ba455077d93b55510dbc6e17f45e04`. The vendored copy in the spec
   repo is now behind and was re-synced separately.
2. Five failed invocations preceded the two green rounds, all preserved in their run directories:
   missing `br_envelope_enter` arguments (`$1: unbound variable`), a bare version instead of
   `@deepseek-ai/dsh@<version>` (registry 404), the whole-tree install killed at 120 s, a heredoc that
   lost its closing quote, and the array-vs-object manifest assumption. One stale name
   (`fetch-and-observe.mjs`) survived a rename and failed a `node --check`.
3. `probe-release.mjs` replaced an earlier `fetch-and-observe.mjs` that tried to install and observe;
   the rename is why the plan's original shape is not what shipped.
4. The record was written after the two green rounds; `scripts/second-version-baseline/README.md` is
   written from these measured numbers.

## 7. Reproduce

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-baseline/run.sh
```

Then read `release-manifest.json`, `interface.json` and `baseline.txt` in the run directory. This
batch needs network access for steps 4–5 and will fail (exit 72) without it.
