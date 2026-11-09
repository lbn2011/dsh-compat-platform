# Config-engine literal reproduction — bounded record (2026-11-10)

**Status: executed. Three separately authorized bounded stages, each terminal-green. 14 of 22
closed cases reproduced a literal-handling divergence. No patch, no conformance claim.**

The three runs, in order, exactly as they happened:

| # | Stage | Run directory | Verdict | Exit |
| --- | --- | --- | --- | --- |
| 1 | `resolve` | `/data/dsh-ecosystem-test-artifacts/runs/20261109T182952Z-config-engine-install-1128328-1695` | `acceptance_exit=0`, `terminal_ok=yes` | `0` |
| 2 | `acquire` | `/data/dsh-ecosystem-test-artifacts/runs/20261109T184644Z-config-engine-install-1145262-32328` | `acceptance_exit=0`, `terminal_ok=yes` | `0` |
| 3 | `repro` | `/data/dsh-ecosystem-test-artifacts/runs/config-engine-repro-20261109t184751z-1146538-24152.service` | `status=reproduced`, `terminal_ok=yes` | `2` |

Exit `2` on the third run means **reproduced**, not failure (see §6.4). Raw artifacts live outside
the repository under `/data/dsh-ecosystem-test-artifacts/runs/`; this record carries the figures and
quotes the decisive lines, and is not a substitute for those files.

## 0. Scope

This record documents that one lock-resolution stage, one scripts-suppressed acquisition stage and
one bounded reproduction stage ran under explicit envelopes, and it reports exactly what their
artifacts say — including the two rows the brief asked to have checked and one counting discrepancy
in the brief's own summary of them (§6.3).

It does **not** claim any of the following, and none of them was attempted:

- that any patch was applied. `status.txt` of the reproduction run records `patch_performed=no`;
- that any engine conforms to JSON Schema 2020-12. `payload-verdict.txt` records
  `conformance_claim=no`; no conformance suite, no dialect coverage sweep, and no counterexample
  beyond the 22 fixed cases exists;
- that any judgement is made about the *standard's* semantics here. The expectations in §6.2 come
  from the prepared case table, not from an independent reading of the specification performed for
  this record;
- that a production profile, deployment or promoted dependency tree exists. The acquisition base is
  a disposable artifact directory (the repro run's `selection.txt` records
  `dependency_closure=no`);
- that a dependency closure or installed-tree closure is proven. `npm ls --all --json` is inventory
  evidence, not closure proof, and no lock-to-installed-file hash manifest was produced;
- that the `per_file_limit_bytes=1048576` (1 MiB) limit is an aggregate quota. The schedule records
  `aggregate_disk_quota=no`; the limit is a per-file `ulimit -f 1024` (1024 blocks ≈ 1 MiB) and the
  per-case report cap is 1024 bytes;
- that any third-party patch is authorized. A patch to `@hyperjump/json-schema` requires a separate
  review, and none was reviewed here.

## 1. Authorization chain and inputs

The two online stages were **authorized separately by the Lead via user questions**, not as one
blanket permission: `resolve` first, then — only after the lock review record existed — `acquire`.
The stages are separately gated in the scripts themselves: the resolver's output is never
auto-fed into acquisition, and acquisition requires the reviewed lock's absolute path plus its
literal SHA-256 as a caller attestation (`argv.txt` of run 2 ends with the path
`…/20261109T182952Z-config-engine-install-1128328-1695/work/package-lock.json` and the digest
`cc3a4c99bec6bb5a4453cf4deb6f999d34a8eba9e0014eed79fd2ed1c6822745`).

The lock review record lives at
`/data/dsh-ecosystem-test-artifacts/reviews/2026-11-10-config-engine-lock-review.md`. It is the
gate that made run 2 admissible, and it is external to the repository by design.

Fixed inputs, hashed before and after each run (`hashes-before.txt` / `hashes-after.txt`,
`hashes-diff.txt` empty, `hash_rc=0`):

- `scripts/config-engine-install/{run.sh,payload.sh,acquire.sh,inspect.mjs,README.md}`
- `packages/config-check/package.json` (`0fbd37800565e0c6bcf7e7c9f6900e7cc89c070367e0579d0a65084cf35b00c6`)
- `/www/server/nodejs/v24.21.0/bin/node` and `…/lib/node_modules/npm/bin/npm-cli.js`
- for run 2, additionally the reviewed lock (`cc3a4c99…2745`)
- for run 3, `scripts/config-engine-repro/{run.sh,payload.sh,cases.mjs}` plus the acquire-stage
  `package.json`/`package-lock.json` and the `systemd-run`/`systemctl`/`busctl`/`journalctl`/`flock`/
  `timeout`/`bwrap`/`sha256sum`/`diff`/`realpath`/`date`/`gawk`/`stat`/`mkdir`/`env` binaries

This is a selected control set, not an OS or toolchain closure.

Toolchain for every stage: node `v24.21.0`, npm `12.2.1` (`work/node-version.txt`,
`work/npm-version.txt`).

## 2. Stage 1 — `resolve`

Unit `config-engine-install-20261109T182952Z-1128328-10413.service`, one transient `Type=exec`
unit; npm invoked as `install --package-lock-only --ignore-scripts --no-audit --no-fund`.

| Field | Measured |
| --- | --- |
| `systemd_run_rc` / `payload_rc` | `0` / `0` |
| `terminal_ok` / `terminal_confirmation` | `yes` / `settled` (`not-found`/`inactive`/`dead`, `MainPID=0`, `stop_attempted=no`) |
| `hashes` / `hash_rc` | `identical` / `0` |
| `selected_inputs` | `8` |
| `write_failures` | `0` |
| `acceptance_exit` | `0` |
| `MemAvailable` gate | `1631912` KiB against `819200` KiB |
| peaks | `77762560` B, `16` pids |
| envelope | `memory.max=402653184`, `memory.swap.max=0`, `pids.max=32`, `cpu.max=50000 100000`, `Type=exec`, `RuntimeMaxUSec=120000000` (busctl `t 120000000`), `envelope_mismatch=none` |
| unit runtime / CPU | `8.135 s` / `1.714 s` |

`work/npm-operation.log` contains only `up to date in 4s`; `payload-verdict.txt` records
`stage=resolve`, `acquisition=complete`, `checker_executed=no`. The produced lock is
`work/package-lock.json`, 5467 bytes, SHA-256
`cc3a4c99bec6bb5a4453cf4deb6f999d34a8eba9e0014eed79fd2ed1c6822745`.

## 3. The lock review — what the bytes establish, and what they do not

The review record at `/data/dsh-ecosystem-test-artifacts/reviews/2026-11-10-config-engine-lock-review.md`
approved exactly those bytes ("Any change to the file, path or digest voids this approval and
requires a new resolve plus review"). I re-verified its mechanical claims against
`work/package-lock.json` rather than trusting the prose:

| Claim | Re-checked result |
| --- | --- |
| `lockfileVersion` | `3` |
| entry count | `12` `packages` entries |
| third-party entries | `11` |
| `integrity` | every value starts `sha512-` and base64-decodes to exactly **64 bytes** |
| `resolved` | every URL is `https://registry.npmjs.org/…`; no other host |
| `hasInstallScript` | absent on all 12 entries |
| `dev` / `optional` / `peer` | no entry carries any of these flags |
| `license` | `MIT` on all 11 third-party entries |

**Counting note (checked, not assumed).** The review's heading says "12 packages" while its table
enumerates 11 rows. The lock does contain 12 `packages` entries: one is the root project entry
`""` (`@dsh-compat/config-check@0.0.0-prepared`), the other 11 are installable packages. Both figures
are therefore correct under their own convention — 12 entries, 11 packages — and the acquisition
result of "11 packages added" (§4) matches the 11.

Root dependencies are exact-pinned in the manifest: `@hyperjump/browser@1.6.0` and
`@hyperjump/json-schema@1.18.0`; `uuid@14.0.3` enters transitively through
`@hyperjump/json-schema`'s `^14.0.0` range.

The review states its own limits, and they matter for §5: lock metadata cannot prove the
*transitive* lifecycle declarations of packages that were never unpacked — that requires the
scripts-suppressed acquisition followed by data-only inspection. The review also notes that
integrity binds bytes to a registry record, not to safety, provenance or licence compliance beyond
the declared `license` field, and that lifecycle checks covered only the two direct-dependency
registry metadata records.

Those two records were compared against real data, not against absent fields: both
`work/npm-metadata-json-schema.json` and `work/npm-metadata-browser.json` carry an actual `scripts`
block (`lint`, `test`, `clean`, `type-check`) and carry no `preinstall`/`install`/`postinstall`/
`prepare`/`prepack` key — so the review's negative result is a check on present fields. Both records
also carry `allowScripts: {"unrs-resolver@1.12.2": true}`. That name appears **only** inside the two
packuments and npm's cache logs; `unrs-resolver` is not in `package-lock.json` and is not installed,
so it is a registry-metadata artifact of the upstream project's own dependency tree and not a
component of this acquisition. Recorded for completeness, not as a finding.

## 4. Stage 2 — `acquire`

Unit `config-engine-install-20261109T184644Z-1145262-32374.service`; `npm ci --ignore-scripts
--no-audit --no-fund` from a fresh disposable directory that does not reuse the resolver cache.

| Field | Measured |
| --- | --- |
| `systemd_run_rc` / `payload_rc` | `0` / `0` |
| `terminal_ok` / `confirmation` | `yes` / `settled` |
| `hashes` / `hash_rc` | `identical` / `0` |
| `selected_inputs` | `9` (the 8 stage-1 inputs plus the reviewed lock) |
| `write_failures` | `0` |
| `acceptance_exit` | `0` |
| `MemAvailable` gate | `1686320` KiB against `819200` KiB |
| peaks | `74551296` B, `16` pids |
| envelope | identical limits to §2, read back independently (`envelope-verdict.txt` = `envelope_mismatch=none`) |
| unit runtime / CPU | `6.659 s` / `2.178 s` |

Post-conditions, read from the artifacts rather than assumed:

- **The lock is bit-identical to the reviewed lock.** `sha256sum work/package-lock.json` =
  `cc3a4c99bec6bb5a4453cf4deb6f999d34a8eba9e0014eed79fd2ed1c6822745`, the same digest recorded in
  `workload.txt` as `reviewed_sha256` and in `output-hashes.txt`.
- `work/package.json` is unchanged (`0fbd3780…b00c6`), matching the reviewed manifest.
- `node_modules` is present; `work/npm-operation.log` contains only `added 11 packages in 2s`
  (`npm-installed-tree.json` records the same 11 with `overridden: false`).

## 5. Post-acquisition data inspection — `uuid@14.0.3`

This is the one finding that changes how the lock review should be read, so it is stated exactly.

Reading the acquired manifest as data — no import, no script execution — shows
`node_modules/uuid/package.json` (uuid `14.0.3`) declaring:

```json
"prepack": "npm run build -- --no-pack",
"prepare": "if [ -d .git ]; then npx lefthook install; fi",
"prepublishOnly": "npm run build"
```

Scanning all 11 installed manifests for the lifecycle hook set
(`preinstall`, `install`, `postinstall`, `prepare`, `prepack`, `prepublish`, `prepublishOnly`)
gives a single hit: `uuid@14.0.3`. No installed package declares `preinstall`, `install` or
`postinstall` at all.

What this does and does not mean, precisely:

- These are **pack/publish-phase** hooks, not registry-tarball install hooks: `prepare` runs on a
  local install and for git dependencies, `prepack`/`prepublishOnly` on pack and publish. They are
  not evidence that anything ran here. What the artifacts can show is bounded: the acquisition log
  is the single line `added 11 packages in 2s`, `ignore-scripts=true` was in force, the installed
  `uuid` directory contains only the tarball's own `dist`, `dist-node`, `LICENSE.md`,
  `package.json` and `README.md` — no `node_modules`, no hook artifacts — and its `prepare` guard
  could only have fired with a `.git` present, which it is not. File mtimes are all the extraction
  instant, so they cannot distinguish execution either way; this bullet is an absence-of-trace
  argument, not a positive proof of non-execution.
- They were **suppressed either way** by `ignore-scripts=true`, which the effective npm config
  records explicitly (`work/npm-effective-config.json`), alongside `registry=https://registry.npmjs.org/`,
  `audit=false`, `fund=false`, `progress=false`, `fetch-retries=0`, and empty user/global npmrc files.
- They were **discoverable only after acquisition**: the lock carries no `hasInstallScript` flag for
  `uuid`, and `uuid` is transitive, so it sat outside the two direct-dependency metadata records the
  review compared. The review's own text anticipates this gap.

The lesson, stated as a reusable rule rather than a one-off:

> **Absence of lifecycle flags in a lock file does not prove absence of lifecycle scripts.** A lock
> can only carry what the resolver saw; transitive manifests exist only after the tarballs are
> unpacked. Only a scripts-suppressed acquisition followed by data-only manifest inspection closes
> that gap — and the result is a *declaration* inventory, not proof about what any script would do.

## 6. Stage 3 — `repro`

Unit `config-engine-repro-20261109t184751z-1146538-24152.service`, launched via
`/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C` so no ambient environment leaks in.

### 6.1 Envelope, as measured

| Field | Measured |
| --- | --- |
| cgroup | `memory.max=402653184` (384 MiB), `memory.swap.max=0`, `pids.max=32`, `cpu.max=50000 100000` (50%), `Type=exec` |
| runtime | `RuntimeMaxUSec=120000000` (120 s), confirmed by busctl `t 120000000` |
| memory gate | `1526380` KiB available against `819200` KiB minimum |
| per case | fresh process, fresh `bwrap` sandbox, `NODE_OPTIONS=--max-old-space-size=192`, `timeout 3 s`, kill grace 1 s |
| isolation | `bwrap --unshare-user --unshare-pid --unshare-ipc --unshare-uts --unshare-net --die-with-parent --new-session --cap-drop ALL`, `/` remounted read-only, dependency base and `cases.mjs` read-only binds, only the case output directory writable |
| schedule | `cases=22`, `serial=yes`, `per_file_limit_bytes=1048576`, `aggregate_disk_quota=no` |
| run verdict | `status=reproduced`, `exit=2`, `terminal_ok=yes`, `hash_rc=0`, `evidence_failure=0`, `completed_cases=22`, `reproduced_cases=14` |
| hashes | 22 selected files, before/after identical, `hashes-diff.txt` empty |
| unit runtime / CPU / peak | `6.718 s` / `3.388 s` / `32.9 M` |

Each case is exactly one `cases.mjs` invocation in its own process — no in-process runner, no
shared registry, no concurrency. `network=unshared` in the schedule is enforced by
`--unshare-net`, and the probe additionally removes the browser's `http`, `https` and `file`
scheme plugins before and after dialect initialization. Every case writes one `report.json`
(≤1024 bytes, `wx`, mode `0600`, no overwrite) and one `*.process-exit.txt`.

### 6.2 All 22 cases, as the artifacts report them

`expected`/`actual`/`status` are quoted from each `report.json`; `exit` from each
`*.process-exit.txt`. "Reproduced" means **`actual` diverges from `expected`** — not that a test
failed to run.

| Case | expected | actual | exit | status |
| --- | --- | --- | --- | --- |
| `const-anchor-equal` | `valid:true` | `valid:false` | 2 | `reproduced` |
| `const-anchor-different` | `valid:false` | `valid:true` | 2 | `reproduced` |
| `const-id-equal` | `valid:true` | `valid:false` | 2 | `reproduced` |
| `const-id-different` | `valid:false` | `valid:true` | 2 | `reproduced` |
| `const-schema-known-equal` | `valid:true` | `valid:true` | 0 | `not-reproduced` |
| `const-schema-known-different` | `valid:false` | `valid:false` | 0 | `not-reproduced` |
| `const-schema-unknown-equal` | `valid:true` | `error:REGISTER_ERROR` | 2 | `reproduced` |
| `const-schema-unknown-different` | `valid:false` | `error:REGISTER_ERROR` | 2 | `reproduced` |
| `enum-anchor-equal` | `valid:true` | `valid:false` | 2 | `reproduced` |
| `enum-anchor-different` | `valid:false` | `valid:true` | 2 | `reproduced` |
| `enum-id-equal` | `valid:true` | `valid:false` | 2 | `reproduced` |
| `enum-id-different` | `valid:false` | `valid:true` | 2 | `reproduced` |
| `enum-schema-known-equal` | `valid:true` | `valid:true` | 0 | `not-reproduced` |
| `enum-schema-known-different` | `valid:false` | `valid:false` | 0 | `not-reproduced` |
| `enum-schema-unknown-equal` | `valid:true` | `error:REGISTER_ERROR` | 2 | `reproduced` |
| `enum-schema-unknown-different` | `valid:false` | `error:REGISTER_ERROR` | 2 | `reproduced` |
| `scalar-equal` | `valid:true` | `valid:true` | 0 | `not-reproduced` |
| `scalar-different` | `valid:false` | `valid:false` | 0 | `not-reproduced` |
| `default-schema-unknown` | `valid:true` | `error:REGISTER_ERROR` | 2 | `reproduced` |
| `examples-schema-unknown` | `valid:true` | `error:REGISTER_ERROR` | 2 | `reproduced` |
| `dynamic-uri-integer` | `valid:true` | `valid:true` | 0 | `not-reproduced` |
| `dynamic-uri-string` | `valid:false` | `valid:false` | 0 | `not-reproduced` |

**Totals: 22 completed, 14 reproduced, 8 not reproduced.** The 14 split into two distinct
mechanisms that must not be flattened into one number:

- **8 boolean verdict inversions** — the `const`/`enum` `anchor` and `id` families: `equal` cases
  return `false`, `different` cases return `true`;
- **6 registration errors** — `const`/`enum` `schema-unknown`, plus `default-schema-unknown` and
  `examples-schema-unknown`: `actual` is `{"error":"REGISTER_ERROR"}`, i.e. registration throws
  where a boolean was expected.

The 8 not-reproduced cases are the `schema-known` contrasts (4), the scalar controls (2) and the
`dynamic-uri` controls (2).

### 6.3 The two cases the brief flagged for verification

The brief was unsure whether `default-schema-unknown` and `examples-schema-unknown` were reproduced
and asked for exactly what the file says. `case-index.tsv` lists both as **reproduced with process
exit `2`**, and their `report.json` files give the reason:

```text
{"case":"default-schema-unknown","expected":{"valid":true},"actual":{"error":"REGISTER_ERROR"},"status":"reproduced"}
{"case":"examples-schema-unknown","expected":{"valid":true},"actual":{"error":"REGISTER_ERROR"},"status":"reproduced"}
```

So the reproduced set is **14, not 12**. The brief's reproduced list enumerated twelve IDs — the six
`const`/`enum` `anchor`, `id` and `schema-unknown` pairs — under the label "all 14", while
separately doubting these two rows. Those two rows are the shortfall: twelve listed plus
`default-schema-unknown` plus `examples-schema-unknown` is exactly the fourteen the artifacts
report, and nothing else in the brief's "not reproduced" list turns out to be reproduced.

Both cases are reproduced **through an error**, not through an inverted verdict; that difference is
visible in `actual` and is preserved above.

### 6.4 Why exit `2` is not a failure

`scripts/config-engine-repro/run.sh:4` states the code table: `0` not-reproduced; **`2` reproduced
(NOT test failure)**; `70` setup/control failure; `73` evidence; `74` unsettled; `75` lock held;
`77` hash failure; `78` input drift. `payload.sh` increments its `reproduced` counter only for
non-control divergences, sets `outcome=reproduced` when that counter is greater than zero, and
exits `2`; a diverging control instead sets `phase=control-failure` and exits `70`.

`journalctl` and `unit.stderr` render this as
`Main process exited, code=exited, status=2/INVALIDARGUMENT` and `Failed with result 'exit-code'`.
That string is systemd's name for exit code 2, **not** a diagnosis of invalid arguments; the
payload had already written `phase=complete`, `completed_cases=22`, `reproduced_cases=14` and
`conformance_claim=no` before exiting. `status.txt` corroborates: `terminal_ok=yes`,
`hash_rc=0`, `evidence_failure=0`.

### 6.5 Controls — why 14 reproductions are not a uniformly broken harness

`scalar-equal`, `scalar-different`, `dynamic-uri-integer` and `dynamic-uri-string` are marked
`control` in `cases.mjs`. The payload cross-checks each control and aborts the whole batch
(`phase=control-failure`, exit `70`) if a control diverges. None diverged: all four returned the
expected boolean, `not-reproduced`, exit `0`.

That is the load-bearing negative evidence in this record. The same harness, under the same
envelope, returned `valid:true` and `valid:false` correctly for four cases, so the 14 reproductions
are a property of the cases and the engine, not of a harness that fails everything. The four
`schema-known` contrast rows corroborate this independently — they are ordinary (non-control) cases
that came back agreeing with expectation, which a uniformly failing harness could not produce.

Two boundaries hold on that evidence. The controls prove the harness *can* return `true` and
`false`; they do not prove it returns the correct answer for the defective cases, only that
"reproduced" is a real mismatch. And a control passing means the probe's plumbing works, not that
its expectation for any particular family is right — the expectations come from the prepared case
table, the standard was not re-derived here (§0).

## 7. Reading the result

What the artifacts support:

1. A specific, narrow, repeatable divergence is observable under a 384 MiB / 50 % CPU / 120 s
   envelope with no network: identifier-shaped members inside `const`/`enum` literals change the
   verdict in both directions, and an unknown `$schema` inside a literal — including inside
   `default` and `examples` — raises `REGISTER_ERROR` where the case table expects a boolean.
2. The divergence is not universal: literals that carry the *known* dialect (`*-schema-known-*`),
   plain scalars, and `$dynamicRef` resolution all behave as expected.
3. The suppression configuration held: no network namespace, no scripts, reproducible hashes.

What the artifacts do not support: any statement about conformance, about other dialects, about
non-object literals beyond the scalar controls, or about the upstream project's intent. The record
is a reproduction, and "reproduced" here means only "the case's actual result differed from the
engineered expectation" — a mismatch count, not a sample of the standard.

## 8. Non-claims, consolidated

- no patch applied (`patch_performed=no`); no third-party patch reviewed or authorized;
- no engine conformance, and no judgement about the standard's semantics;
- no production profile; the acquisition base is a disposable artifact directory;
- no installed-tree or dependency-closure proof (`dependency_closure=no`; `npm ls` is inventory);
- the per-file 1 MiB limit is not an aggregate quota (`aggregate_disk_quota=no`);
- no retries: each stage ran once, and any failure would have ended that attempt;
- the lock review is a human record; a digest alone does not establish that review happened, and
  separate `resolve`/`acquire` authorization does not extend to any further stage.

## 9. Evidence index

| Artifact | Carries |
| --- | --- |
| `…/20261109T182952Z-…-1695/{status.txt,argv.txt,workload.txt,selection.txt}` | stage 1 verdict, exact command, `stage=resolve`, `selected_inputs=8` |
| `…/{envelope-effective.txt,envelope-cgroup.txt,envelope-busctl.txt,memory-gate.txt,peaks.txt}` | measured limits and the memory gate |
| `…/work/package-lock.json` | the reviewed lock, `cc3a4c99…2745` |
| `…/work/npm-effective-config.json`, `work/npm-operation.log` | `ignore-scripts=true` and the 4 s operation line |
| `/data/dsh-ecosystem-test-artifacts/reviews/2026-11-10-config-engine-lock-review.md` | the approval gate for stage 2 |
| `…/20261109T184644Z-…-32328/{status.txt,workload.txt,output-hashes.txt}` | stage 2 verdict, `reviewed_sha256`, post-run digests |
| `…/20261109T184644Z-…-32328/work/{npm-installed-tree.json,npm-operation.log}` | 11 packages added, tree inventory |
| `…/20261109T184644Z-…-32328/work/node_modules/uuid/package.json` | the `prepack`/`prepare`/`prepublishOnly` declarations |
| `…/config-engine-repro-…-24152.service/case-index.tsv` | all 22 case rows: exit code and status |
| `…/config-engine-repro-…-24152.service/<case>/report.json` | `expected`, `actual`, `status` per case |
| `…/config-engine-repro-…-24152.service/{status.txt,payload-verdict.txt,schedule.txt,selection.txt}` | run verdict, counts, envelope schedule, dependency base |
| `…/config-engine-repro-…-24152.service/<case>.argv.txt` | the exact `bwrap` sandbox and probe argv per case |
