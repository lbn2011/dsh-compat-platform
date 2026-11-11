# second-install-tree

The second cell of the version matrix: take the **published** `@deepseek-ai/dsh@0.2.2-alpha.2`
and ask whether a runtime receipt over a *tree* — not only over a manifest — resolves every
module the receipt names.

Runs: 2026-11-11, two bounded rounds, both green, receipt bytes identical.

## What one round does

| Step | Action | Refusal |
|---|---|---|
| 0 | Read the cgroup knobs and refuse if they are not the reviewed envelope | `70` |
| 1 | `bash -n` this runner and payload, `node --check` the receipt | `70` / `71` |
| 2 | Static contract: the receipt still names `lib/bin.js` and `lib/profile-boot-e2mS45fC.js`; the closure on this machine hashes to the pinned digest and declares release `0.2.2-alpha.2` | `71` |
| 4 | `npm pack @deepseek-ai/dsh@0.2.2-alpha.2` — **the only network step** | `72` |
| 5 | Reconstruct the installation directory: the release's own files, plus the pinned closure as `node_modules` | `72` |
| 6 | Run `scripts/runtime-receipt/receipt.mjs --installation …` and require `rows = 10`, `unresolved = 0`, every row digesting 64 hex characters over a positive byte count | `72` |
| 7 | Delete the reconstructed tree (147 MB of third-party bytes) and record `tree_retained=no` | — |

## Why the tree is reconstructed, not installed

`npm install @deepseek-ai/dsh@0.2.2-alpha.2` was measured at **97 s** inside the 120 s
envelope on 2026-11-10 and the unit was killed before it finished (91 direct dependencies
expand well past 120 s once transitive resolution and lifecycle scripts run). So this slice
does not install. It takes two artefacts whose bytes are pinned:

- the release tarball, fetched by step 4 (sha256 recorded in `tarball-sha256.txt`);
- the closure at `/data/dsh-ecosystem-test-artifacts/closures/alpha2-0.2.2-alpha.2`,
  digest-pinned in the payload as
  `127632a801bf26e631160cedbc99c213acba48d2932aa48298b3d7d76ca58fc9`.

That closure was itself assembled by a script outside any envelope, disclosed in
`docs/testing/2026-11-10-second-version-observe.md`. **A reconstructed tree is not an
`npm install`**: no lockfile resolution, no peer resolution, no lifecycle scripts.

## Measured result (2026-11-11)

```
rows=10  unresolved=0  installation_version=0.2.2-alpha.2
installation_manifest_sha256=fcfbff65bc9a7beae1d5bd56af6eb166b61dcd22bd20234653d2b8d56d09aa63
cordis 4.0.6-alpha.2 · loader 1.0.7-alpha.2 · include 1.0.11-alpha.2 · group 1.1.0
dsh-app-boot 0.2.2-alpha.2 · dsh-cmdline 0.2.2-alpha.2 · dsh-home-paths 0.2.2-alpha.2
dsh-official-bundles 0.2.2-alpha.2 · lib/bin.js · lib/profile-boot-e2mS45fC.js
```

Compare the curated-prefix cell of the same release: `rows=9`, `unresolved=1`
(`cordis-plugin-group`, which `0.2.2-alpha.2` does not declare although its `dsh-app-boot`
imports it and the installed rc.1 ships 1.1.0). Placing the closure rather than a
hand-picked prefix is what closes that cell.

## What one round does not establish

- That `npm install` of this release works, or that it produces this tree.
- That the tree loads. Nothing in this slice imports a module; the receipt hashes bytes and
  resolves entry paths. Whether the runtime then runs them is the `second-version-observe`
  slice, and even that only observes four synthetic entries.
- That the four `dsh-*` packages and `cordis` are the versions a real install would pick —
  they are the versions this closure contains.
- Anything about any other release.

## Exit codes

Launcher (from the shared core): `0` green, `70` refusal, `71` static contract failed,
`72` a step failed, `73` an evidence write failed, `74` the unit did not settle, `75` lock
held, `76` run-directory collision, `77` control/selected frame unreadable, `78` drift.

Payload: `0` green, `70` envelope/argument, `71` static contract, `72` a step failed,
`73` evidence write failed.

## Artefacts

`summary.txt`, `receipt.json`, `receipt-sha256.txt`, `receipt.rc`, `tarball-sha256.txt`,
`tree.txt`, `tree-retained.txt`, `static-contract.txt`, `pack.out` / `pack.err`,
`selected-before.txt` / `selected-after.txt` / `selected-diff.txt`,
`control-before.txt` / `control-after.txt` / `control-diff.txt`, `peaks.txt`,
`memory-gate.txt`, `terminal.txt`. The run directory keeps no copy of the tree.

The record is `docs/testing/2026-11-11-second-install-tree.md`.

## Deviations worth knowing

- The memory peak is dominated by the 147 MB copy (`memory_peak` 238 956 544 B in round 1,
  197 218 304 B in round 2): `cp -a` pulls file pages into the cgroup. A hardlink tree was
  tried first and refused by the kernel (`Invalid cross-device link`) because the closure
  lives on `/data` and the run directory was on `/tmp` during exploration.
- The cache and `HOME`/`TMPDIR` for `npm` are run-local; nothing is written to the global
  npm cache.
