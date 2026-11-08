# Package install verification — `scripts/package-install`

**Status: executed. Ten invocations under the bounded envelope. Two consecutive green
rounds on the final bytes (21 selected inputs, identical `hashes-before.txt`).**

The question: do the four packages, packed as tarballs, install into a directory with no
sibling checkout, and does every documented subpath import there by package specifier?

## 0. Scope and non-claims

What these rounds establish:

- each package's tarball is produced offline and its declared export targets exist on disk;
- the five tarballs (`dsh-compat-platform`, `dsh-compat-diagnostics-ui`,
  `dsh-compat-trusted-extraction`, `dsh-compat-repair`, `yaml`) install into a fresh
  consumer directory whose `package.json` names nothing;
- from that directory, every documented subpath resolves by package specifier to a path
  under that consumer's `node_modules`, and two of them behave as they do in the
  repository (`summarizeProfileDumpText` on a two-line fixture; `decideApply` refusing an
  invalid plan);
- a deliberate missing-dependency case **fails loudly**: a copy of the consumer tree with
  `yaml` removed raises `ERR_MODULE_NOT_FOUND` from
  `import('dsh-compat-platform/profile-dump')`. The plan's gate asks for this to be
  recorded as a failure, not a skip, and it is.

What they do **not** establish:

1. **Nothing is published.** Every manifest keeps `private: true`. A green round says the
   tarball matches its export map, not that a registry would accept it.
2. **The consumer is this machine.** Same Node build as the packing side; a different
   Node, platform or dependency tree could differ.
3. **`files` is not audited.** The static contract checks a `files` list exists; the probe
   checks the subpaths it imports are present. Nothing proves every file a consumer might
   want is inside.
4. **No host, no plugin, no profile.** No DSH process starts, no profile is read.
5. **Not the full suite.** This batch runs one probe; each package's own suite is a
   separate record.
6. **`yaml` is packed from `packages/analyzer/node_modules/yaml`**, so the dependency is
   the pinned `2.9.1` and not what a registry would serve today.

## 1. What the slice added

| path | change |
|---|---|
| `scripts/package-install/run.sh` | new launcher: envelope, 21 hashed inputs, terminal readback, exits 70–78 |
| `scripts/package-install/payload.sh` | new payload: envelope self-check, static contract, pack, install, probe, peaks |
| `scripts/package-install/consumer-check.mjs` | new probe: specifier resolution, versions, two calls |
| `scripts/package-install/expect.json` | new expectations: package versions and documented surfaces |
| `scripts/package-install/README.md` | new: usage, what one run does and does not establish |
| `packages/host/src/envelope.js` | **changed**: the cross-package relative import was replaced by a local contract check |
| `packages/host/README.md` | **changed**: the reading-discipline passage now explains that decoupling |
| `packages/runtime/package.json` | **changed**: added `"files": ["src/", "README.md"]` |
| `packages/repair/package.json` | **changed**: added `"files": ["src/", "README.md"]` |

## 2. The eight invocations

| # | run directory | exit | what happened |
|---|---|---|---|
| 1 | `20261108T201143Z-package-install-876178-25928` | 71 | static contract refused: the export-target loop assumed every `exports` value is a string, but the analyzer's seven subpaths use `{types, default}` objects |
| 2 | `20261108T201259Z-package-install-876514-8986` | 72 | every `npm pack` failed `EROFS`: npm's cache is `/www/server/nodejs/cache`, read-only inside `--ro-bind / /` |
| 3 | `20261108T201348Z-package-install-876848-20933` | 72 | packing and install succeeded; the probe failed one check — `import:dsh-compat-diagnostics-ui` → `ERR_MODULE_NOT_FOUND` |
| 4 | `20261108T201631Z-package-install-877425-19598` | 73 | every substantive check passed; the run died because one evidence file was written by a `grep` that matched nothing |
| 5 | `20261108T201658Z-package-install-877861-9341` | **0** | first green; 19 selected inputs |
| 6 | `20261108T201716Z-package-install-878238-13070` | **0** | green; identical `hashes-before.txt` to #5 |
| 7 | `20261108T201809Z-package-install-878693-21586` | **0** | green; 21 inputs after the changed host modules were added to the selection |
| 8 | `20261108T201827Z-package-install-879094-22131` | **0** | green; identical `hashes-before.txt` to #7 |
| 9 | `20261108T202017Z-package-install-879605-15925` | **0** | green; missing-dependency gate added to the payload |
| 10 | `20261108T202033Z-package-install-880062-14142` | **0** | green; identical `hashes-before.txt` to #9 |

### 2.1 The three real defects, in the order they were found

**(a) Export targets are not always strings (my bug).** The static contract's loop did
`typeof target !== 'string' → fail`. The analyzer declares seven subpaths as
`{ "types": …, "default": … }`. Fixed to accept either form and to check every key of a
conditional object, so an unknown condition cannot smuggle in a missing path.

**(b) npm's cache is read-only inside the sandbox (my bug).** `npm pack` failed with
`EROFS … /www/server/nodejs/cache/_cacache/tmp`. Fixed by passing
`--cache "$NPMHOME/cache"` to every `npm` call and creating that directory under the run
root, which is bound read-write. The earlier exploratory probes never saw this because
they ran without `bwrap`.

**(c) The host package could not be installed standalone (a real defect in shipped
code).** `packages/host/src/envelope.js` imported
`'../../analyzer/src/diagnose.js'`. Inside the checkout that resolves; inside
`node_modules/dsh-compat-diagnostics-ui/src/` it points at `node_modules/analyzer/src/…`,
which does not exist. The tarball was therefore unusable by any consumer.

The two facts that `diagnoseExitCode` call actually added — the `correlation` literal, and
a closed outcome word on each lane block present — are now checked locally in
`checkEnvelopeShape`/`checkContract`. The host suite stayed at 16/16, including the two
tests that pin `field: 'certification'` and `field: 'contract'`.

**This is a change to a byte range that an earlier record covers.** The GUI record
(`docs/testing/2026-11-08-read-only-diagnostics-gui.md`) measured the previous
`envelope.js`; the GUI batch was **not** re-run, because the change preserves every
assertion it pinned. `packages/host/src/envelope.js` is now a selected input of
`scripts/diagnostics-gui-run/run.sh`, so that runner's hash manifest no longer matches its
recorded values — that record's numbers still describe the bytes they were taken on.

### 2.2 The one false failure (my bug)

Round 4 exited 73 after static contract, packing, install and the probe had all passed:
`grep -h 'total files' "$RUN"/pack-*.out` matched nothing because npm writes its notice
block to **stderr**, so the redirection produced an empty file and the evidence gate
counted it as a write failure. Fixed to read both streams and to let an empty file mean
"npm reported no count".

### 2.3 The missing-dependency gate (added after round 8)

The plan's gate names a deliberate missing-peer case. Rounds 1–8 did not exercise it, so
the payload gained a step that copies the working consumer tree, removes
`node_modules/yaml`, and imports `dsh-compat-platform/profile-dump` there. The expected
outcome is a loud `ERR_MODULE_NOT_FOUND` — not a resolved import, and not a skipped check.
Both rounds 9 and 10 recorded `missing_dep=ERR_MODULE_NOT_FOUND`.

This is also why the payload hash differs between round 8 and round 9: the gate did not
exist in the bytes that produced the earlier green rounds.

## 3. Green-round figures

Round 10 (`20261108T202033Z-package-install-880062-14142`):

| field | value |
|---|---|
| `acceptance_exit` | 0 |
| `payload_rc` | 0 |
| `write_failures` | 0 |
| `selected_inputs` | 21 |
| `hashes` | identical (before == after) |
| `acc_static_contract` | pass |
| `pack_failures` | none; `tarballs=5` |
| `install_rc` | 0 |
| `consumer_rc` | 0 |
| probe checks | 24 ok, 0 fail |
| `missing_dep_rc` | 0, `missing_dep=ERR_MODULE_NOT_FOUND` |
| `memory_peak_bytes` | 55083008 |
| `pids_peak` | 15 |
| `mem_available_kib` | 1426220 (threshold 819200) |
| `envelope_mismatch` | none |
| terminal | `load_state=not-found`, `active_state=inactive`, `sub_state=dead`, `main_pid=0`, `confirmation=settled` |

Round 9 (`…202017Z-…-879605-15925`): same verdicts plus the missing-dependency gate,
`memory_peak_bytes=55037952`, `pids_peak=15`, `mem_available_kib=1443488`.

Round 8 (`…201827Z-…-879094-22131`): `memory_peak_bytes=56991744`, `pids_peak=15`,
`mem_available_kib=1453764`.
Round 7 (`…201809Z-…-878693-21586`): `memory_peak_bytes=57524224`, `pids_peak=15`,
`mem_available_kib=1459476`.
Rounds 5 and 6 (19 inputs, before the host modules joined the selection, no
missing-dependency gate): `memory_peak_bytes=57446400` and `58523648`, `pids_peak=15`,
24 probe checks ok.

### 3.1 The five tarballs (identical in rounds 5–8)

```
3779941b003b8452ab8c627b3970e17f2e6a9212752206c2fafd8e5d891848c0  dsh-compat-diagnostics-ui-0.0.0-draft.1.tgz  10984B
9c17a64362b9be40c38cd06450c9a738e52dee42405aedca3a6dc71913290833  dsh-compat-platform-0.0.0.tgz  152807B
bf2086dad71fab6795f8e69a1431e82763d70bd459ad5ea9078b329d52275719  dsh-compat-repair-0.0.0-draft.1.tgz  13587B
b220d0766b43b84a45d4c5984317fe2cf41df7b33a09e563521f4f8f7f42bbe0  dsh-compat-trusted-extraction-0.0.0-draft.1.tgz  10730B
5648e80d3e8969770b61c1e3a48b701dea49cf6b690b039221bfd3df91a2a0c1  yaml-2.9.1.tgz  112446B
```

npm reported `total files: 31 / 5 / 7 / 7 / 233` (analyzer, host, runtime, repair, yaml).

### 3.2 What the probe checked (24 ok)

Installed versions for all four packages; `yaml@2.9.1` resolvable; three
`dsh-compat-platform` subpaths resolve inside `node_modules` with complete surfaces; the
host package resolves and **imports**; `dsh-compat-trusted-extraction/isolation-policy`
resolves with a complete surface; `dsh-compat-repair/repair-apply` and
`/fixture-applier` resolve with complete surfaces; `summarizeProfileDumpText` returns
`profile-dump-summary/0.2-draft.1` with one entry; `decideApply` on an invalid plan
returns `refused` with `APPLY_PLAN_INVALID` among the issue codes.

## 4. Deviations

1. **Three exploratory runs outside any envelope** before round 1 (npm pack/install
   probes in a scratch directory) — they produced no evidence and are not counted.
2. **Scripts were written mode `600`** and made `755` before the first run. File modes are
   not part of the sha256 manifest.
3. **Rounds 5–6 used a 19-input selection that omitted `packages/host/src/envelope.js`** —
   the very file this slice changed. Rounds 7–8 added `envelope.js` and `page.js`
   (21 inputs) so the hashed selection covers the change. Rounds 5–6 remain green but cover
   the older selection; nothing is retracted.
4. **Two manifests gained `files`** (`runtime`, `repair`) *before* round 1, so all rounds
   hash the same manifests. `git diff` shows only the added field.
5. **The host package was changed** (§2.1c) after earlier records measured it. The GUI
   batch was not re-run; its record keeps its own numbers.
6. **`payload.sh` changed after round 8** to add the missing-dependency gate, so rounds
   9–10 hash a different payload than rounds 5–8. No earlier verdict is retracted; the
   gate is new work, not a fix to a failure.
7. **The `run.sh` and `payload.sh` bytes differ between round 1 and round 10** (contract
   fix, cache flag, probe-import decoupling, selection growth, file-count fix), so there is
   no single script hash for "the batch"; each round's `hashes-before.txt` is the authority
   for what ran.
8. **`README.md` for this slice was written before round 1** and not edited afterwards, so
   its hash is stable across rounds.

## 5. Selected inputs of the final rounds (21, rounds 9–10)

```
efd1cb838d9f98e86500a6e6aedfa79a9623e56f9f23b5aeaed75a4a44af482d  scripts/package-install/run.sh
d5f6f7d46f4f81e2d5c2ad54258e7609e212c2ea081de1ddfbffc67fa166b5fe  scripts/package-install/payload.sh
554327f730fde74be5b8dfd781aaa02097f05b9b01b0f5f927b2e6dae5d80a96  scripts/package-install/consumer-check.mjs
6b0979fec98fc41eeaf8425400f7f27871ee9d7be6b6899e2c1b76e45f490d78  scripts/package-install/expect.json
eb4233dd8f23d05fab8e0415f9ace9b24f73a91ca89d170693e2d069241c3f46  packages/analyzer/package.json
01882b673e6c96a7abb9e2bdd238619ea77b065306d3ecbc43200939a691950d  packages/analyzer/README.md
e74c975e76ec7285aaef25ba854c70de00a6fd4543175e106ffe7980d2478b7a  packages/host/package.json
31510ba6aa95425ad04af065b8b37915aa17db5064f264d845fdb00d78a625cb  packages/host/README.md
2067e90e1cf827124273b4e26d46a01b84acd26f8b362cbd49ebabf3446c5d62  packages/runtime/package.json
c7affafd87712d835f7b78be66da7c977229a47195464f58039aa5d849f7df28  packages/runtime/README.md
2f350c84c973199f888f4c674678220a5a18f1ecbfb2f4530db0abe16e33826d  packages/repair/package.json
d6feeb438ee64e99403dca9ed1cb1fc9df45fea934998c8a6dbf7226c5fef9a9  packages/repair/README.md
5fea56f50c346b886f8d62cdc8aa46e67304eb1e6e946cf14d6eb2185b296eb1  packages/analyzer/src/profile-dump.js
0466b2ac8a3347248639abaa1c6acf87b8cf669fddb8acfabb8d8ed2127e3764  packages/analyzer/src/dependency-shape.js
a8dd242813067aefb1bdd0bf8196e684d0b35b1a01ac3326095500246bce449f  packages/analyzer/src/diagnose.js
b46610d4eddfb4b77e485e74f10a403d7c2b210a8c24791c0aa90a5ad30c212e  packages/host/src/index.js
d655157e0ab063926c72b8bade9408d89da5b6cc3fba46401bfd1545351ddfa5  packages/host/src/envelope.js
121deb7e6d3bf36d6c29f02b4a743342dfd9de39b5e39051a8a5ed0c0ac7e342  packages/host/src/page.js
0166bd0256330a6ce0cf387f44c59e7e3c8866baf9694df86e211d1f4faa7364  packages/runtime/src/isolation-policy.js
bc8e22f407326790b04402eef2feacd6b03d5ee0243e5aa1218a56f25a14966f  packages/repair/src/repair-apply.js
1c6441703d8204a23ded0d37ddf57c3b69d821dc392f20852d1f605bb9b8861c  packages/analyzer/node_modules/yaml/package.json
```

Paths are relative to `projects/dsh-compat-platform`; the manifests hash their absolute
paths in the run directory.

## 6. Reproduce

```
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/package-install/run.sh
```

Run directory under `/data/dsh-ecosystem-test-artifacts/runs` (override with
`PACKAGE_INSTALL_RUNS_ROOT`). Launcher exit codes: 0 green; 70 preflight refusal; 71 unit
or limits; 72 a failed step; 73 evidence write; 74 input changed; 75 unit still loaded;
76 terminal state not settled; 77 no verdict; 78 no run directory. Payload exit codes: 0
pass; 70 envelope; 71 static contract; 72 pack/install/probe; 73 evidence write.
