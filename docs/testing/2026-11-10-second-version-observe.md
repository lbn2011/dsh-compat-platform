# Second version: the same adapter observes both runtimes (2026-11-10)

## 0. The question this answers

The version matrix had three cells: the installed `0.2.2-rc.1` (measured receipt + fixture
observation), the published `0.2.2-alpha.2` (manifest, interface, curated-prefix receipt), and
"do the two behave the same" — **empty**. This slice fills the third cell with a measurement
rather than an assumption.

The answer, measured twice: **the two runtimes reach the same per-entry verdicts for the same
three fixtures.** `agree=true`, `differences=0`, four entries compared.

Non-claims:

1. This compares **four entries of one synthetic fixture**, not the two releases.
2. Nothing was loaded from a real profile; no production path was read.
3. The alpha.2 side runs from a **hand-assembled closure**, not from an `npm install` tree.
4. `certification` stays `false`; this is not a compatibility guarantee.
5. Agreement on this fixture does not predict agreement on a plugin that uses a service the
   fixture does not exercise.

## 1. What was built

| File | Purpose |
| --- | --- |
| `scripts/second-version-observe/run.sh` | launcher, core prefix `second-version-observe` |
| `scripts/second-version-observe/payload.sh` | closure digest check, two adapter runs in bwrap, comparison |
| `scripts/second-version-observe/compare.mjs` | compares per-entry `state` and, for failed entries, `failurePhase` |
| `scripts/bounded-runner/policy.sh` | prefix and unit family registered |
| `scripts/bounded-runner/core.manifest` | `policy.sh` digest re-pinned to `8a70501a…` |

**No network.** The alpha.2 closure is a pinned artefact
(`/data/dsh-ecosystem-test-artifacts/closures/alpha2-0.2.2-alpha.2`, 339 packages, manifest
sha256 `127632a801bf26e631160cedbc99c213acba48d2932aa48298b3d7d76ca58fc9`), because assembling it
takes **3 m 26 s** — more than three times the 120 s envelope. The payload verifies the
manifest digest and refuses (72) on any mismatch, so the observation cannot silently describe a
different runtime than the record claims.

The adapter is the repository's own, unmodified: `trusted-extraction-adapter.js`
`ebeddaec…`, the same bytes the trusted-extraction batch runs against rc.1.

## 2. How the closure was assembled (outside the envelope, disclosed)

Recursive `npm pack` + extract, seeded with the nine packages the curated prefix needed plus
their `dependencies` transitively, placing each tree under the name in its own
`package.json`. Two facts forced the recursion:

* `@deepseek-ai/cordis` imports `@deepseek-ai/cosmokit`;
* `ajv` imports `fast-deep-equal`.

A hand-enumerated nine-package prefix therefore cannot even be **imported** — it resolves no
further than the first missing peer. 324 packages were placed in 3 m 26 s; the tree carries
339 `package.json` files (the difference is nested `node_modules` inside packages).

This assembly is **not** a verified install: no `npm install`, no lockfile, no integrity
checking. It is a set of tarballs extracted into a tree, recorded by digest so later runs can
prove they used the same bytes. `closure.json` is the record.

## 3. The two rounds

| # | Run | Exit | `agree` | `differences` | `entries` | `memory_peak` | `pids_peak` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `20261110T131707Z-second-version-observe-1396869-29288` | 0 | true | 0 | 4 | 26 681 344 | 14 |
| 2 | `20261110T131725Z-second-version-observe-1397089-21757` | 0 | true | 0 | 4 | 21 422 080 | 14 |

Both: `terminal_ok=yes`, `hash_rc=0`, `write_failures=0`, `observe_rc=0` for both runtimes,
`comparison_rc=0`. `observed-installed.json`, `observed-alpha2.json`, `comparison.json` and
`comparison-summary.txt` are **byte-identical** between the two rounds, and the selected-input
manifest is the same eight files.

## 4. What was measured

Both runtimes, both rounds:

```
status=observed   bootError=null   phases: resolve/import/activate/settle/cleanup all observed
```

| Entry | rc.1 (installed) | alpha.2 (pinned closure) |
| --- | --- | --- |
| `include` | active | active |
| `ok` | active | active |
| `import-throw` | failed / `import` | failed / `import` |
| `activate-throw` | failed / `activation` | failed / `activation` |

The interesting part is not that they agree — it is **what** they agree on. The import-vs-
activation split is produced by re-importing the entry's module (`FAILURE_PHASE_READ_BY_REIMPORT`),
and that behaviour survives the version change: alpha.2's loader also swallows an import
exception into a log line with no fiber, so the same probe separates the two failure modes
identically. That is the observation this repository was built to make, now confirmed on a
second release.

## 5. What this does not establish

* Behaviour on any plugin other than these three fixtures.
* That the closure matches what `npm install` would produce (no lockfile, no integrity check).
* That rc.1 and alpha.2 are interchangeable for a consumer.
* Anything about `0.2.2-alpha.2`'s real dependency resolution, activation order beyond four
  entries, or service availability.
* Timing, log text, module identity, or the bytes each runtime loaded — `comparison.json`
  names these as `notCompared` rather than leaving the omission implicit.

## 6. Deviations

1. The closure was assembled **outside** any envelope, in `/tmp/pkprobe`, because 3 m 26 s
   exceeds the 120 s limit. It was then copied to the artefacts tree and digested; only the
   digested copy is read by the batch.
2. Two exploratory runs preceded the batch: a bare `import()` of alpha.2's `dsh-app-boot`
   (which first failed on missing peers) and one adapter run against the closure outside
   bwrap. Both are what established that the slice was worth building.
3. The first assembly attempt placed packages under their **tarball** names, which Node cannot
   resolve; the placement rule was corrected to use the name in each `package.json`.
4. `@deepseek-ai/cordis-plugin-group@1.1.0` was packed from the registry even though alpha.2
   does not declare it, because alpha.2's `dsh-app-boot` **imports** it. Without it the closure
   cannot boot at all; with it, the observation measures the release plus one module the
   release forgot to declare. That is disclosed here rather than hidden in the closure.
5. `bwrap --ro-bind / /` is used, which is *not* the trusted-extraction isolation policy: this
   batch observes, it does not claim confinement, and `--unshare-net` is set anyway.
6. No `chmod` was needed; both scripts were created `755`.

## 7. Hashes at the time of the green rounds

```
compare.mjs                      ae4219e7d117055ca9cb96b84e0b11fbe3054791d2a73705611073a151bea4f6
payload.sh                       e235863c9609d97ac43a63074fda1f75944acedec70e0bd15f5f2dac3c0ef7bc
trusted-extraction-adapter.js    ebeddaec674821f1ac5e3059c8cd5f9aa622a5a3c441a9daca3193bf8ae726ca
trusted-extraction-receipt.js    0cdf87e7dd9f60824c4af4b212ff3d36e4101605ec624fbf55630dc735896424
examples config.yml              7f63b873961781c1cc1024d27eac2041771206fc09f860cb86cd68d84aefb1b2
plugin-ok.mjs                    cb5529f827d0a1ad87d37096967128368e4f1e943e07590b2f46c1393dc6b920
plugin-import-throw.mjs          1e0fa77c97f05247bd78af37de622b0bfabaa70619a760d3486fdb5eca7f6435
plugin-activate-throw.mjs        8c5786091fc5eff5bfe0ef9d3324777085bccefeca0ce40d761a5c976ca0c1a9
closure manifest                 127632a801bf26e631160cedbc99c213acba48d2932aa48298b3d7d76ca58fc9
```

## 8. Reproducing

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-observe/run.sh
```

Absolute path required. No network. Fails 72 if the closure manifest digest does not match.
