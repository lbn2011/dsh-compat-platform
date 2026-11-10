# Publishable: `private` cleared, both standards at zero (2026-11-10)

## 0. What this slice does and does not do

The previous slice ended with exactly one blocker on every package: `PRIVATE_FLAG_SET`. The
user then approved clearing it (m08720 「我同意」), which is the decision the roadmap reserved
for itself. This slice removes that flag, flips every check that had encoded it as a required
state, and re-measures.

What it does **not** do: publish anything, add registry credentials, or move the version out of
`draft`. "Zero blockers" means the shipped bytes pass the audit's own rules; it is not a claim
that a published package would work for anyone else, and it is not a compatibility statement.

## 1. The change

| File | Change |
| --- | --- |
| `packages/{analyzer,config-check,host,repair,runtime}/package.json` | `"private": true` removed; nothing else touched |
| `dsh-compat-spec` `package.json` | same removal |
| `scripts/package-install/publish_audit.py` | `--standard` default `private` → `public`; docstring records the decision and why the `private` standard is kept |
| `scripts/package-install/payload.sh` | passes `--standard public`; `private_<dir>=pass` became `private_absent_<dir>=pass`, asserting the **absence** |
| `scripts/trusted-extraction-batch/payload.sh` | `pkg.private !== true` became `pkg.private !== undefined`, so a stray `true` now fails the static contract |
| `dsh-compat-spec` `src/test/package.test.js` | the identity test asserted `private === true`; it now asserts `undefined`, and its name says why |

The direction of the two assertions is the point. Before, a manifest that dropped `private` would
fail the check; now, a manifest that keeps it fails. The check follows the decision instead of
pinning the state it replaced.

## 2. Bounded rounds

All rounds were started by absolute path (the shared core refuses a relative entry with `77`
rather than guessing).

| # | Unit | Exit | Notes |
| --- | --- | --- | --- |
| A | `20261110T141451Z-package-install-1405965-28690` | 0 | `standard=public packages=5 allowlist_violations=0`, `blockers=0` on all five; 24 consumer checks; `memory_peak=73252864` B, `pids_peak=15` |
| B | `20261110T141528Z-package-install-1406441-31585` | 0 | same; `memory_peak=57696256` B, `pids_peak=15` |
| C | `20261110T141557Z-trusted-extraction-batch-1406871-7298` | 0 | `verdict=pass`, `gate=none`, `32/32`, `memory_peak=40148992` B, `pids_peak=21` |
| D | `20261110T141745Z-trusted-extraction-batch-1407411-15331` | 0 | same; `memory_peak=35954688` B, `pids_peak=21` |
| E | `20261110T141829Z-spec-test-batch-1407831-25201` | 0 | `105/105`, `memory_peak=37408768` B, `pids_peak=16` |

Rounds A and B are byte-identical in `publish-readiness.json`, `tarball-hashes.txt`,
`selected-before.txt` and `control-before.txt`. Rounds C and D are byte-identical in
`baseline.txt`, `isolation.txt` and `failure-paths.json`.

Audit output, round B:

```
publish-audit: standard=public packages=5 allowlist_violations=0
  analyzer: files=34 bytes=168877 private=False violations=0 blockers=0
  config-check: files=7 bytes=12006 private=False violations=0 blockers=0
  host: files=5 bytes=11034 private=False violations=0 blockers=0
  runtime: files=7 bytes=11087 private=False violations=0 blockers=0
  repair: files=7 bytes=13640 private=False violations=0 blockers=0
```

The tarballs are a few bytes smaller than in the previous slice (`168880` → `168877` for the
analyzer) because the `"private": true` line is no longer shipped. That is the only difference in
content that the size change reflects.

## 3. Local suites (sanity, outside any envelope)

analyzer `448/448`, host `16/16`, runtime `32/32`, repair `42/42`, spec `105/105`.

## 4. Deviations

1. The local suite runs above are sanity checks outside any envelope, not evidence.
2. `packages/config-check` is still audited but not consumer-installed (its `@hyperjump/*` peers
   are absent from this machine), so its installability remains unclaimed.
3. `dsh-plugin-kit` and `dsh-agent-test-driver` were **left `private: true`**. They are neither
   audited nor packaged by any runner, so clearing the flag there would create publishability
   that nothing measures. That is deliberate, not an omission.
4. Rounds C and D re-run a batch whose subject (the runtime package) changed only by that one
   removed line; they exist so the static contract's flipped assertion is exercised on real
   bytes rather than only locally.

## 5. What is still between here and a publication

- A publication is still a user action: no credentials, no registry write, no `npm publish` in
  any script.
- The versions stay `0.1.0-draft.1`; promoting them is a separate decision.
- Nothing here establishes that a consumer on another machine, another Node major, or another DSH
  build can install or run these packages.

## 5a. Run-time hashes

`package-install` round B selected these (paths relative to the platform repo):

```
d913e4dd02eb9717bc44d350bf8ac5e28208b94ad3a25575f1596078b6e09550  packages/analyzer/package.json
97df302d12534f524f0530734b584fd9deaed7f7599437dd9eb2a7722cb5190f  packages/config-check/package.json
1fab5459a004288a239e7251b3d09fbbe93798016871209b86161cd106959f1f  packages/host/package.json
2f8ae9883e282045fdcce1a81115c29f0406d0dbd5c6d46df087c06fc8969c4c  packages/repair/package.json
ead5ce3b06c54463ef8201ffa122c110c5c90e0604567ec70459c09a7c7f9a57  packages/runtime/package.json
672770fff279a7c1aaf64f784260d4e762c26b15b43a034f2afcf3207733b67f  scripts/package-install/publish_audit.py
```

`trusted-extraction-batch` round D selected
`3bfc4f66443eb8585536320c9b6b285dc8a04aba502274d615b404fa5bd808e2` for
`scripts/trusted-extraction-batch/payload.sh`.

`spec-test-batch` round E selected `d3ee56b30d844354af550e3b8a9e9f164d3a9e6181c20a32928e6b4a0bd4d8e8`
for `dsh-compat-spec/package.json` and `660f18c129a939a10c0167ec171238d73a860324a55862872e40ab4383f04bb9`
for its `README.md`; that README was edited **after** the round (a row naming the
`0.2.0-draft.1` config-schema revision was added), so its current bytes differ from the measured
hash while the measured file remains what the round actually read.

## 6. Reproduce

```
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/package-install/run.sh
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/trusted-extraction-batch/run.sh
bash /root/dsh-ecosystem-spec/projects/dsh-compat-spec/scripts/spec-test-batch/run.sh
```
