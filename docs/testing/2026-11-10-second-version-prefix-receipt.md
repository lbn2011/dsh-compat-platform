# Second version: a receipt for a curated prefix (2026-11-10)

## 0. What this adds, and what it does not

The previous record (`2026-11-10-second-version-baseline.md`) stated plainly that
`0.2.2-alpha.2` gets **no receipt**: its 91 dependencies do not install inside the
120 s envelope, so only its manifest and its interface were recorded.

This increment closes that gap as far as the envelope allows. Instead of the whole tree
it assembles **exactly the ten modules the receipt names**, each at the version the
release itself declares, placed where a real installation would put them, and then asks
`runtime-receipt` what it can and cannot resolve there.

Non-claims:

1. This is a **curated prefix, not the release's tree** — no transitive dependency is
   installed, so the set of bytes present is not what `npm install` would produce.
2. The receipt's own limitations apply unchanged: it names the resolved bytes only, does
   not prove the process used them, is not a dependency closure, and is not a
   loadability or certification result.
3. `unresolved=1` means "the release does not declare this module", not "the module is
   broken". Nothing was executed from the prefix.
4. A green `acceptance_exit=0` means the steps ran; it says nothing about whether their
   *content* was the intended measurement. Six of the eight rounds below were green and
   still wrong — that is why each round's artefacts were inspected.

## 1. What changed

| File | Change |
| --- | --- |
| `scripts/second-version-baseline/payload.sh` | new step **6b**: read the declared version of each receipt module from the packument, `npm pack` it, extract it, place it by its *published* name, then run `runtime-receipt` over the prefix and summarise the result. Header now says steps 4 **and 6b** contact the registry. |
| `scripts/second-version-baseline/run.sh` | `scripts/runtime-receipt/receipt.mjs` added to the hashed selected inputs (11 → 12), because this payload now executes it. |

## 2. The eight rounds, and the five defects they exposed

| # | Run | Exit | What it measured | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `20261110T125316Z-second-version-baseline-1386267-22082` | 0 | 1 tarball packed, `rows=2`, `unresolved=8` | wrong: deps read from the array instead of `versions[v]` |
| 2 | `…125530Z-…-1386722-15758` | 0 | 6 packed, `unresolved=8` | wrong: modules placed beside the installation, refused as `ENTRY_OUTSIDE_INSTALLATION` |
| 3 | `…125721Z-…-1387221-1410` | 73 | `prefix pack failed for cordis-plugin-loader` | wrong: a registry-side absence was treated as a broken step |
| 4 | `…125816Z-…-1387528-2321` | 0 | 7 packed, `unresolved=3` | wrong: trees landed under the *declared* (unscoped) name |
| 5 | `…125857Z-…-1388038-25482` | 0 | identical to round 4 | a patch did not apply; the bytes were unchanged |
| 6 | `…125944Z-…-1388476-5590` | 0 | 8 packed, `unresolved=8` | wrong: placing the installation last cleared the modules nested inside it |
| 7 | `…130023Z-…-1389035-29059` | 0 | 8 packed, **9 rows, `unresolved=1`** | correct |
| 8 | `…130107Z-…-1389612-29576` | 0 | same as round 7 | reproducible |

Defects fixed, in order: (a) `npm view --json` returns a one-element array, so
`doc.dependencies` was empty and every module was silently "skipped"; (b) records were
written with `>` inside a loop, so each write erased the previous one; (c) `npm` reads
stdin and swallowed the loop's input; (d) the receipt refuses any entry that resolves
outside the installation directory, so the modules had to be nested under it; (e) the
registry publishes some plugins only under the scope, so placement must use the name in
the tarball's own `package.json`; (f) the installation must be placed **first**, or its
destination reset removes the modules nested inside it.

## 3. Round 8 and round 7 agree byte for byte

`prefix-receipt.json`, `prefix-summary.txt`, `prefix-packed.txt`, `interface.json`,
`release-manifest.json` and `selected-before.txt` compare equal between the two rounds.
Round 7 peaks: `memory_peak=48402432`, `pids_peak=14`. Round 8: `47906816`, `14`.
Both `acceptance_exit=0`, `terminal_ok=yes`, `hash_rc=0`, `write_failures=0`.

## 4. Measured result

```
rows=9            (7 modules + the two files the receipt names by path)
unresolved=1      @deepseek-ai/cordis-plugin-group
```

| Module | Version in the prefix | Bytes |
| --- | --- | --- |
| `@deepseek-ai/cordis` | 4.0.6-alpha.2 | 64 121 |
| `@deepseek-ai/cordis-plugin-loader` | 1.0.7-alpha.2 | 28 635 |
| `@deepseek-ai/cordis-plugin-include` | 1.0.11-alpha.2 | 23 265 |
| `@deepseek-ai/dsh-app-boot` | 0.2.2-alpha.2 | 202 809 |
| `@deepseek-ai/dsh-cmdline` | 0.2.2-alpha.2 | 6 973 |
| `@deepseek-ai/dsh-home-paths` | 0.2.2-alpha.2 | 8 228 |
| `@deepseek-ai/dsh-official-bundles` | 0.2.2-alpha.2 | 11 801 |
| `lib/bin.js` (no module) | 0.2.2-alpha.2 | 11 772 |
| `lib/profile-boot-e2mS45fC.js` (no module) | 0.2.2-alpha.2 | 13 890 |

The one unresolved module is the interesting line. The **installed** `0.2.2-rc.1`
resolves `cordis-plugin-group` 1.1.0 (165 B); `0.2.2-alpha.2` does not declare it at all.
So the two versions do not ship the same module set, and the receipt says so instead of
inventing a row.

`installation_manifest_sha256=fcfbff65bc9a7beae1d5bd56af6eb166b61dcd22bd20234653d2b8d56d09aa63`
for the alpha.2 package itself — a different artifact from the installed rc.1's
`3e14837ceb3bbc0ba419ed08e9b5ba164338369b1268b93c3c25d89f7b1c9953`.

## 5. What this still does not establish

* Nothing was loaded or activated from the prefix; no fixture ran against alpha.2.
* No behavioural comparison between `0.2.2-alpha.2` and `0.2.2-rc.1`.
* No link between the declared commit `ce7073d5…` and these tarballs — that pin stays
  **declared**, not measured.
* The prefix's bytes are not a closure: `dsh-app-boot` alone declares six non-`dsh`
  dependencies that are absent here.
* The registry was contacted (steps 4 and 6b); a release that disappears from the
  registry makes this batch unrunnable, not wrong.

## 6. Deviations

1. Six green rounds and one `73` were spent on the payload's own defects, all preserved
   above rather than overwritten.
2. Round 5 ran the same bytes as round 4 because a patch failed to apply; it is listed as
   its own round and gives no new information.
3. Two rounds (7, 8) are the only ones whose content is the intended measurement.
4. `npm pack` resolves ranges (`~4.0.6-alpha.1` → `4.0.6-alpha.2`), so the prefix holds
   the newest matching patch of each declared range, not necessarily the version the
   install would have resolved. This is why the receipt, not the manifest, is the record.
5. No file outside the run directory and the shared npm cache was written; the cache path
   is passed on every `npm` call (`--cache`), as in the migrated installers.

## 7. Hashes at the time of the green rounds

```
payload.sh   a2a7c5370a3a1053929905db1859b2bb7825a523b6f34b16d43f9809343e774b
run.sh       4e8a91c54fe0a004fc8a6a19a7f26bf6dc251b9a23a88014bcdfae6967f38398
receipt.mjs  789e77ccfcfc33aa9153cf8d63d59907cf954f75faef0212c473b019f1981df2
```

## 8. Reproducing

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-baseline/run.sh
```

Absolute path is required (a relative invocation refuses `77` before creating a run
directory). Needs registry access.
