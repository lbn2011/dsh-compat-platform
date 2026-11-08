# profile-dump `0.2-draft.1`: the row window and the two guard lists

**Status: executed, four bounded rounds — three green, one red on a test-side assertion.** This record covers the shape change that
turned `profile-dump-summary/0.1-draft.1` into `0.2-draft.1` by adding `rows`, `rowsTruncated`,
`notDerived` and `limitations`, plus the `maxRows` limit. It reports what those two rounds measured
on this machine and nothing else.

It is a **separate record** from
[`2026-11-08-profile-dump.md`](./2026-11-08-profile-dump.md) (the `0.1-draft.1` rounds) and from
[`2026-11-08-profile-dump-retained-export.md`](./2026-11-08-profile-dump-retained-export.md) (the
first replay of the retained captures). Neither earlier record is retracted, edited down or
absorbed here: each other's numbers stand for the bytes they were taken on.

## 0. Scope and non-claims

The change under test is additive and read-only: a summariser that already refused unsafe input now
also emits a **capped display window** of shape facts per top-level row.

Not established by anything below:

- that any plugin loads, activates, resolves dependencies or is admitted;
- that the record set is complete — `limitations` carries `ROW_SET_COMPLETENESS_UNKNOWN`
  because denied bundles contribute no row and skipped bundles arrive as free-form stderr;
- that a row is a declaration, or that `config` contains declarations;
- that the page or the CLI was run on any host version other than Node 24.21.0 here;
- the whole package suite, packaging, or cross-version behaviour.

## 1. What changed

| Change | Where |
| --- | --- |
| `PROFILE_DUMP_SCHEMA` → `profile-dump-summary/0.2-draft.1` | `packages/analyzer/src/profile-dump.js` |
| `PROFILE_DUMP_LIMITS.maxRows = 64` | same |
| `rows` / `rowsTruncated` in the summary; `null` exactly where `counts` is `null` | same |
| `PROFILE_DUMP_NOT_DERIVED` (five names, verbatim from `NOT_DERIVED`) and `PROFILE_DUMP_LIMITATIONS` (eight fixed codes), copied per summary | same |
| Row vocabulary `group`/`disabled` ∈ `absent|true|false|null|other` because `EntryOptions` declares `boolean \| null` (`vendor/loader/src/config/entry.ts:8-24`); `config` ∈ `absent|mapping|not-mapping` | same |
| Types, README §12, design doc §4.5/§4.6/§5 | `profile-dump.d.ts`, `packages/analyzer/README.md`, `docs/requirements-and-design/2026-11-08-profile-dump-design.md` |
| Row-window and guard-list tests | `packages/analyzer/tests/profile-dump.test.js` |
| Shape-tracking verifier moved to `0.2-draft.1` (closed key sets, row vocabulary, exact limit values, exact guard lists) | `scripts/profile-dump-retained-export/retained-export.mjs` |

No dependency was added: `yaml@2.9.1` was already pinned, and the parse options that make tags,
anchors, aliases, merge keys, duplicate keys and multi-document streams refusals were already in
place. The "separately reviewed parser strategy" the structured-profile-input boundary design asks
for therefore needed no new parser — only closed output words.

## 2. Round 1 — the module's own test file, under the envelope

Launcher `scripts/profile-dump-batch/run.sh`; raw artefacts
`/data/dsh-ecosystem-test-artifacts/runs/20261108T163243Z-profile-dump-batch-842647-16961`.

| Field | Value |
| --- | --- |
| `acceptance_exit` | `0` |
| TAP | `tests=78`, `pass=78`, `fail=0`, `cancelled=0`, `skipped=0`, `todo=0` |
| TAP field shapes | all six `ok` (each key appears exactly once) |
| script under test | `tests/profile-dump.test.js` only |
| selected inputs | `9`, `hashes=identical` before/after |
| yaml snapshot | `233` files, `identical` (two-point) |
| memory gate | `mem_available_kib=1133112` ≥ `819200` |
| peaks | `memory_peak=73322496` B, `pids_peak=23` |
| envelope | `envelope_mismatch=none`, `acc_static_contract=pass` |
| terminal | `load_state=not-found`, `active_state=inactive`, `sub_state=dead`, `main_pid=0`, `confirmation=settled` |

Envelope: 384 MiB / swap 0 / `TasksMax=32` / `CPUQuota=50%` / `RuntimeMaxSec=120`, heap
`--max-old-space-size=192`, one `MemAvailable` gate, one run, no retry.

`78` is the count **for these bytes**. It is not `65` plus anything portable: the added cases are
the row-window and guard-list ones, and earlier counts belong to earlier bytes.

## 2b. Rounds 3 and 4 — the shipped example and both failure paths, as processes

Rounds 1 and 2 exercised the in-process API and three historical captures, but no *real repository
fixture* and no *failure path* crossed a process boundary. Three cases were added for that and run
under the same envelope: the shipped `examples/diagnose/profile.yml` read from disk (success), a
document whose second entry has a non-string `id` (`1`, partial failure), and a root mapping (`2`,
refusal). `scripts/profile-dump-batch/run.sh` also gained that example file as a tenth hashed
input, because the tests now read it.

| Field | Round 3 (failed) | Round 4 (green) |
| --- | --- | --- |
| run dir | `…/20261108T163955Z-profile-dump-batch-843804-30176` | `…/20261108T164017Z-profile-dump-batch-844094-19335` |
| `acceptance_exit` | `72` | `0` |
| TAP | `tests=81`, `pass=80`, `fail=1` | `tests=81`, `pass=81`, `fail=0` |
| failure | new case asserted `diagnostics[0].ordinal === 1` | — |
| selected inputs | `10`, `hashes=identical` | `10`, `hashes=identical` |
| memory gate | `mem_available_kib=1192832` | `mem_available_kib=1261900` |
| peaks | `memory_peak=71495680` B, `pids_peak=23` | `memory_peak=64409600` B, `pids_peak=23` |
| terminal | settled, `main_pid=0` | settled, `main_pid=0` |
| yaml snapshot | `identical` (233 files) | `identical` (233 files) |

The round-3 failure was **test-side and only test-side**: the malformed entry is the *second* entry
of the document, so `ordinal` is `2`; the assertion demanded `1`. The implementation was not
changed to fit the assertion — the expectation was corrected and its comment now says it is pinned
to the document, not to the position in `diagnostics`. Round 3 is kept here rather than replaced:
it is what the first attempt measured.

What round 4 established on the shipped fixture, through a real child process
(`--max-old-space-size=192`, 5 s wall clock, 256 KiB buffer, environment reduced to `PATH`/`HOME`/
`TMPDIR`):

- exit `0`, `counts.entries === rows.length === 2`, `rowsTruncated === false`;
- both rows `keyCount: 5`, `config: 'mapping'`, `configKeyCount: 1`, `group: 'other'` (the example
  writes `group: demo`, a string, and `EntryOptions` declares `boolean | null` — the row reports
  what is there), `disabled: 'false'` then `'true'`;
- none of the example's own words appears in the serialized summary: no
  `example.plugin-alpha`, `example.plugin-beta`, `Example Alpha`, `demo`, `greeting`, `hello` or
  `retries`.

And on the two failure paths, as processes: the partial case exits `1` with
`ENTRY_ID_NOT_STRING` at `ordinal: 2` while **both** rows are still described
(`idKind: ['string', 'non-string']`), and the refusal case exits `2` with `inventory: 'none'`,
`counts: null`, `rows: null` and `rowsTruncated: false` — the null-not-empty rule visible at the
process boundary, with both guard lists still present.

## 3. Round 2 — the three retained real captures, 0.2 shape

Launcher `scripts/profile-dump-retained-export/run.sh`; raw artefacts
`/data/dsh-ecosystem-test-artifacts/runs/20261108T163324Z-profile-dump-retained-export-843007-22855`.

Input bytes are the same three historical captures as the earlier replay, unchanged and re-pinned
by digest at run time:

| Sample | Bytes | sha256 | Exit | stderr | Verdict |
| --- | --- | --- | --- | --- | --- |
| `probe` | `333` | `222a50d0…f810cc` | `0` | `0` | `pass` |
| `denied` | `162` | `34ea1fbc…a0f0` | `0` | `0` | `pass` |
| `script-probe` | `568` | `3af2218c…b44b` | `0` | `0` | `pass` |

Runner fields: `verdict=pass`, `samples_verified=3`, `child_runs=3`, `first_failure=none`,
`selected_inputs=11`, `hashes=identical`, `acceptance_exit=0`, `write_failures=0`,
`memory_peak=32686080` B, `pids_peak=17`, `mem_available_kib=1251572` ≥ `819200`,
terminal `main_pid=0` / `confirmation=settled`, `samples_snapshot_state=identical`,
`yaml_manifest_snapshot_state=identical` (233 files).

What the verifier judged on those real bytes (`script-probe`, the two-row sample):

```json
{ "index": 1, "line": 2, "keyCount": 3, "idKind": "string", "nameKind": "string",
  "group": "absent", "disabled": "absent", "config": "mapping",
  "configKeyCount": 2, "unmodelledKeyCount": 0 }
```

with `profileDumpSummary=profile-dump-summary/0.2-draft.1`, `rows.length === counts.entries === 2`,
`rowsTruncated=false`, `notDerived` the five verbatim names and `limitations` the eight fixed codes.
The `probe` and `denied` samples each produced one row with `configKeyCount: 2`; the `!!js` scalars
in `script-probe` stayed counted-and-flagged, never evaluated.

The verifier refuses, at code `65`, a row whose key set is not exactly the closed one, whose
`index` is not its 1-based position, whose vocabulary words are outside the closed sets, whose
`configKeyCount` is present without a mapping config, whose `unmodelledKeyCount` exceeds
`keyCount`, or whose window length and `rowsTruncated` flag disagree in either direction. It also
compares `maxRows: 64` and both guard lists exactly, so a silently different cap or a reworded
limitation is a failure rather than a drift.

## 4. Deviations and housekeeping

1. Both runner scripts were `600` in the working tree and were `chmod 755`-ed before the runs. File
   modes do not enter the sha256 manifest; the change happened before hashing and is visible in the
   before/after lists.
2. The retained-export verifier bytes changed (`06257f01…` for this run instead of `007a6729…` in
   the earlier record) because the shape it pins moved to `0.2-draft.1`. That is maintenance of a
   verifier that tracks the published shape, not a re-judgement of the earlier run; the earlier
   record keeps its own hashes and numbers.
3. No run was hidden to reach green. Round 3 failed on a test-side assertion; it is recorded above
   with its figures, and round 4 changed only that assertion. Rounds 1 and 2 were single runs each.
4. `node --check` was used on edited files while writing them. Parse-only, no envelope, no
   evidence — the numbers above come from the two runs.

## 5. Files as executed

| File | sha256 at run time |
| --- | --- |
| `scripts/profile-dump-batch/run.sh` | `2089f8e44b9f20d2162a406a1aa4dce0395619735f77a61b1cae9818b9788f1c` |
| `scripts/profile-dump-batch/payload.sh` | `defa2ef7f1d7f0d12bf465558ea4a0d737269d5255be0ff14761264fc880f20d` |
| `packages/analyzer/src/profile-dump.js` | `5fea56f50c346b886f8d62cdc8aa46e67304eb1e6e946cf14d6eb2185b296eb1` |
| `packages/analyzer/src/profile-dump.d.ts` | `0f4977238c1d530e9934676509d3ccf3e0d42f65831c331f62010ab7f3d6ca79` |
| `packages/analyzer/src/profile-dump-cli.js` | `928ddcc3ecc580825331ca2e3e6b6fbff52bc028c14f07d146b53df9d3626a56` |
| `packages/analyzer/src/evidence-cli.js` | `75b0c267e5c889420cacb45820d12b0f8067b49c18e8c0e1994b2cc1103128be` |
| `packages/analyzer/tests/profile-dump.test.js` | `374831a231f7268a67552764489c05be225b1dfb48ce58ef796695725226e633` (rounds 1–2); `50c759800b0a1e223ab0d6361f9fae081d10b9738f725983460b2b90aaa306d7` (rounds 3–4) |
| `scripts/profile-dump-batch/run.sh` (rounds 3–4) | `419b2eb26a2941de8ee8d05bdef1360e670a56fc403ff245d4848be113158c21` |
| `examples/diagnose/profile.yml` (rounds 3–4) | `bf4cdb0e5ca124c77c57601ab1dc51cd9ddf614f6791c2155e57e1adb385bf7d` |
| `scripts/profile-dump-retained-export/run.sh` | `ca15a6037027b800692ff351f0247a9c2a23be551920a077af5f3552fa62a038` |
| `scripts/profile-dump-retained-export/payload.sh` | `53c2661d47e72aaaf0a1c2caa3085ba48d6f7c54a93c143048195feb33c14de3` |
| `scripts/profile-dump-retained-export/retained-export.mjs` | `06257f015df4ed8d38ffaed58f4d9d5cb9059e177e5a83b58c5b81100a0220fa` |

`packages/analyzer/README.md` was edited after both runs (verification-status wording only), so it
is deliberately absent from this table: the bytes that ran are the nine above plus the two
launchers.
