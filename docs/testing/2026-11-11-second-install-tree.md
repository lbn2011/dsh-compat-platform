# Second install tree — a receipt over a reconstructed `0.2.2-alpha.2` tree

Status: **executed, two bounded rounds, both green** (2026-11-11). The receipt bytes are
identical across both rounds and identical to one exploratory build made before the slice
existed.

## 0. Scope and non-claims

This record answers one question: with the published `@deepseek-ai/dsh@0.2.2-alpha.2`
placed as an installation directory and a pinned dependency closure placed under it as
`node_modules`, does `scripts/runtime-receipt/receipt.mjs` resolve every module it names?

It does **not** claim any of the following.

- That the tree was produced by `npm install`. It was reconstructed from the release's own
  tarball plus the closure; there is no lockfile resolution, no peer resolution and no
  lifecycle script in this path.
- That the closure is the closure `npm` would pick. It is the closure an out-of-envelope
  assembler picked on 2026-11-10, pinned by digest.
- That the tree **loads**. Nothing here imports a module. Resolving an entry path and
  hashing its bytes is not loading it.
- That this tree behaves like the installed `0.2.2-rc.1`. The behavioural comparison is the
  separate `second-version-observe` slice, and that only observes four synthetic entries.
- That `cordis-plugin-group@1.1.0` belongs to this release. `0.2.2-alpha.2` does not
  declare it, while its `dsh-app-boot` imports it; the installed rc.1 ships 1.1.0. The
  closure contains it, so the tree contains it.
- Anything about any other release.

`installation_manifest_sha256` is the digest of `<installation>/package.json`, i.e. of the
release's own manifest. It is worth recording only because it pins *which* manifest was
under the tree; it says nothing about whether the tree is complete.

## 1. What changed

| File | Change |
|---|---|
| `scripts/second-install-tree/run.sh` | new; host-side launcher, prefix `second-install-tree` |
| `scripts/second-install-tree/payload.sh` | new; reconstructs the tree, runs the receipt, deletes the tree |
| `scripts/second-install-tree/README.md` | new; written after the rounds (deviation 3) |
| `scripts/bounded-runner/policy.sh` | `second-install-tree` added to the accepted prefixes and to the unit families |
| `scripts/bounded-runner/core.manifest` | `policy.sh` re-hashed |

No package source changed. The receipt, the analyzer and the runtime package are untouched.

## 2. The rounds

| # | Run directory | Result | `memory_peak` | `pids_peak` | `rows` / `unresolved` |
|---|---|---|---|---|---|
| 1 | `20261111T103236Z-second-install-tree-1509105-20600` | `acceptance_exit=0` | 238 956 544 B | 13 | 10 / 0 |
| 2 | `20261111T103251Z-second-install-tree-1509316-5812` | `acceptance_exit=0` | 197 218 304 B | 13 | 10 / 0 |

Both rounds: `static_contract_failures=none`, `terminal_ok=yes`, `confirmation=settled`,
`tree_retained=no`, `MemAvailableKiB` above the 819 200 gate (1 153 288 / see run files).

### Bytes that are identical across rounds

- `summary.txt`
- `receipt.json` (`sha256 2ceeca32617953c09288d63bed1eb6549aef149973fca9c8d655cd915f38942d`)
- the packed release tarball (`sha256 3c8fd2338d0e89b1a72484abc22fc9f7452088a5ad8e122566065ef5a803ea7a`)
- `selected-before.txt` and `control-before.txt`

`peaks.txt` differs between rounds (238 956 544 vs 197 218 304 B). That is page cache
from the 147 MB copy, not a different workload; the two `receipt.json` files are byte
identical, which is what the measurement rests on.

## 3. What was measured

```
rows=10  unresolved=0
installation_version=0.2.2-alpha.2
installation_manifest_sha256=fcfbff65bc9a7beae1d5bd56af6eb166b61dcd22bd20234653d2b8d56d09aa63
cordis                       4.0.6-alpha.2
cordis-plugin-loader         1.0.7-alpha.2
cordis-plugin-include        1.0.11-alpha.2
cordis-plugin-group          1.1.0
dsh-app-boot                 0.2.2-alpha.2
dsh-cmdline                  0.2.2-alpha.2
dsh-home-paths               0.2.2-alpha.2
dsh-official-bundles         0.2.2-alpha.2
lib/bin.js                   0.2.2-alpha.2
lib/profile-boot-e2mS45fC.js 0.2.2-alpha.2
```

Against the curated-prefix cell of the same release (`rows=9`, `unresolved=1`), the only
difference is `cordis-plugin-group`: a hand-picked prefix of the ten modules does not
contain it, because the release does not declare it; the closure does, because
`dsh-app-boot` imports it.

## 4. Non-claims restated as the four things a reader might infer

| A reader might infer | Why that is not established here |
|---|---|
| "alpha.2 installs" | the tree was assembled from two pinned artefacts; `npm install` of this release was measured at 97 s and killed at the envelope |
| "alpha.2 loads" | no module was imported; a resolved path and a matching hash are not an execution |
| "alpha.2 is compatible with rc.1" | a resolved module list is not a behavioural comparison; the observe slice covers four synthetic entries and nothing else |
| "the closure is complete" | completeness is what the closure's own `packages: 339` count claims, and that number came from a script outside any envelope |

## 5. Deviations

1. **One exploratory build outside any envelope**, before the slice existed: the same
   reconstruction in `/tmp`, receipt digest `2ceeca32…`. It produced no evidence; it is
   named here because the identical digest is a useful cross-check, not because it ran
   under the envelope.
2. **A hardlink tree was attempted first and refused by the kernel** (`Invalid cross-device
   link`): the closure is on `/data` and the exploratory run directory was on `/tmp`. The
   slice uses `cp -a`, which is why the memory peak is several times the workload's need.
3. **The README was written after the two rounds.** It is not a selected input, so no
   hash in this record refers to it; its post-run hash is recorded in §6 for completeness.
4. **The registry is contacted once per round** (`npm pack` of one tarball). The closure
   itself is not fetched; it is read from a pinned, out-of-git artefact whose digest the
   payload verifies before doing anything else.
5. **The run directory deliberately keeps no copy of the tree**: 147 MB of third-party
   bytes are removed after the receipt is written, and `tree-retained.txt` records which
   happened. The tree is reproducible from the two pinned artefacts.

## 6. Bytes at run time

| File | sha256 |
|---|---|
| `scripts/second-install-tree/run.sh` | `852193a4bdae7bf5a789c2a96c197b2103a9b13bdb8a5a7c38205d189d28e93a` |
| `scripts/second-install-tree/payload.sh` | `7da8ea450319f092e427d135209bd2e9af0a46997a63d94a5c32ee5d6303713e` |
| `scripts/runtime-receipt/receipt.mjs` | `789e77ccfcfc33aa9153cf8d63d59907cf954f75faef0212c473b019f1981df2` |
| `scripts/bounded-runner/policy.sh` | `9fd4fce1ad6551ac28909c9711a23a2bcfa04fbfca44f8667214eb872f0ecf94` |
| `scripts/bounded-runner/core.manifest` | `e3c854fe2be5ef2b39d3fda0c03200b65d5080885c71cb2b38b94a0c4aaa11b1` |
| `scripts/second-install-tree/README.md` *(after the rounds)* | `03deab078181fed5f6c72127e452411a494bc37af12adf43f8deab13391060b3` |

## 7. Reproduce

```
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-install-tree/run.sh
```

Absolute path is required (the shared core refuses a relative entry with `77`). Needs the
registry for step 4, the pinned closure at
`/data/dsh-ecosystem-test-artifacts/closures/alpha2-0.2.2-alpha.2`, and roughly 200 MB of
free space under `/data` for the duration of the round.
