# Acceptance record — repair plan and preview (S3, the inert half of P4)

**Status: executed, two bounded rounds, both green.** No repair has ever been applied by
this code, and the code to apply one does not exist.

## 0. Scope and non-claims

What this record establishes:

- The `dsh-compat-repair` package validates a closed `repair-plan/0.1-draft.1` schema,
  with a one-element operation vocabulary and a full refusal set.
- Its preview verifies a precondition digest, renders a two-line diff from document text
  it never writes, and compares the resulting text against a declared postcondition digest.
- Its own suite (25 tests) passes on these bytes inside the standard acceptance envelope.
- The shipped example previews as `ready` and leaves the fixture byte-identical.

What it does **not** establish, and must not be read as establishing:

1. No repair was applied — there is no apply path, no writer, and no CLI that touches a file.
2. A validated plan is not an approval. Approval is S4's subject, and it is not built yet.
3. A digest pins bytes, not authority: a plan could describe a change the author was not
   entitled to make.
4. Nothing was loaded, activated, or resolved. `set-entry-flag` on `disabled` says nothing
   about whether a DSH runtime would honour that field.
5. `25/25` is this package's suite only. It is not additive with the analyzer, runtime,
   spec or GUI numbers, and it certifies nothing.
6. The preview's accepted document subset is small by design. Documents outside it are
   refused, not handled.

## 1. What was added

| Path | Kind | Notes |
| --- | --- | --- |
| `packages/repair/package.json` | new | `dsh-compat-repair`, private, type module, zero dependencies. |
| `packages/repair/src/repair-plan.js` | new | Closed schema, one-element vocabulary, canonical digest. |
| `packages/repair/src/repair-preview.js` | new | Text-only preview; no I/O, no writer. |
| `packages/repair/tests/repair.test.js` | new | 25 pure tests. |
| `packages/repair/README.md` | new | Contract, verdicts, non-claims. |
| `examples/repair/profile.yml` | new | Synthetic three-entry profile; never loaded. |
| `examples/repair/plan.json` | new | One plan with real digests against that profile. |
| `examples/repair/preview.mjs` | new | Prints the preview; the only executable in the example. |
| `scripts/repair-plan-batch/{run.sh,payload.sh}` | new | Bounded launcher and payload. |
| `scripts/repair-plan-batch/README.md` | new | Usage, exits, artefacts. |

Nothing in `packages/analyzer`, `packages/runtime`, `packages/host` or `packages/client`
was touched.

## 2. Round 1

Run: `/data/dsh-ecosystem-test-artifacts/runs/20261108T195209Z-repair-plan-batch-872853-25441`

| Field | Value |
| --- | --- |
| `acceptance_exit` | 0 |
| `payload_rc` / `systemd_run_rc` | 0 / 0 |
| `launch` | `completed` |
| TAP | `tests=25 pass=25 fail=0 cancelled=0 skipped=0 todo=0` |
| `stderr_bytes` | 0 |
| `example_verdict` | `pass` (fixture digest `cb17e292…bca` before **and** after) |
| `hashes` | `identical` (10 selected inputs) |
| `memory_peak_bytes` | 34119680 |
| `pids_peak` | 16 |
| terminal | `load_state=not-found`, `active_state=inactive`, `sub_state=dead`, `MainPID=0`, `confirmation=settled` |
| `write_failures` | 0 |

## 3. Round 2

Run: `/data/dsh-ecosystem-test-artifacts/runs/20261108T195225Z-repair-plan-batch-873143-30397`

| Field | Value |
| --- | --- |
| `acceptance_exit` | 0 |
| `payload_rc` / `systemd_run_rc` | 0 / 0 |
| `launch` | `completed` |
| TAP | `tests=25 pass=25 fail=0` |
| `stderr_bytes` | 0 |
| `example_verdict` | `pass` |
| `hashes` | `identical` (10 selected inputs) |
| `memory_peak_bytes` | 35209216 |
| `pids_peak` | 16 |
| terminal | settled, `MainPID=0` |
| `write_failures` | 0 |

The two rounds' `hashes-before.txt` files are byte-identical, so both rounds judged the
same ten inputs; each round's `hashes-before.txt` equals its own `hashes-after.txt`.

## 4. What the 25 tests pin

- The schema accepts the shipped plan and refuses: a non-record, an extra top-level key, a
  missing top-level key, a wrong `planVersion`, an unknown `kind`, `field: "group"`, a
  string `value`, entry index `0`/`-1`/`1.5`/`"1"`/`null`, an uppercase or short digest, an
  empty/over-long/non-string revision, and a postcondition that disagrees with the operation.
- `canonicalJson` ignores key order (so `planDigest` is stable) and throws `TypeError` for
  `NaN`, functions and `undefined`.
- The preview returns `ready` with `{line, removed, added}` for a present field, and inserts
  after the record's last member when the field is absent.
- The preview returns `stale` when the document digest moved, `mismatch` when the edit does
  not produce the declared postcondition digest, and `refused` for an invalid plan, an
  out-of-range entry index, a non-literal field value, and a record outside the subset.
- Non-text and oversize input are refused with their own codes.
- The rendered text contains `preview: ready` and the literal line
  `nothing was written; no apply path exists`.
- No exported function in either module matches `/^(apply|write|save|commit|install|exec|run)/i`.

## 5. Deviations

1. Two local `node --test` runs of `tests/repair.test.js` were made while developing,
   outside any envelope; the first showed two of my own wrong expectations (a deleted
   field produces two issues; the inserted line is line 3, not 4). They produce no
   evidence and are not counted as rounds.
2. `scripts/repair-plan-batch/*.sh` were created mode `755` this time; no `chmod` was needed
   and file modes are not in the hash manifest anyway.
3. The runner is an adaptation of `dsh-compat-spec/scripts/spec-test-batch`, keeping its
   envelope, lock, hash-manifest and terminal-readback idioms. The second round ran
   against byte-identical scripts.
4. `packages/repair/README.md` is a hashed input and was finalized **before** round 1, so
   its manifest value `5d379c86…` is the value both rounds judged.
5. The example preview step runs a `node` process inside a second bubblewrap sandbox that
   grants no network and a private `/tmp`; it reads two repository files and writes nothing,
   which the before/after digest comparison checks rather than assumes.

## 6. File hashes (as selected by the runner)

| File | sha256 |
| --- | --- |
| `scripts/repair-plan-batch/run.sh` | `3b38e7ba3875ab30d9b224938ec35478bf2ee12ef962c32039a92e400cfa6654` |
| `scripts/repair-plan-batch/payload.sh` | `ff23540e049a4ff624d4bfb737c65fc43ce63ed09fde8a36a3d009f609419c96` |
| `packages/repair/package.json` | `bfbea53855ed9743a7a52306fa77fadb795a51a667d7ed36118a71eade2aba0c` |
| `packages/repair/README.md` | `5d379c863895ece4c9f9d3bd0dca0c3df7e83de1641b024ba67c3a23c4721a24` |
| `packages/repair/src/repair-plan.js` | `a3a2f283f064fbd7f5d08a5dfaee5b682505fbd1d322e183b8ba282b3213a16f` |
| `packages/repair/src/repair-preview.js` | `ad99cb3d43eed6171ab1ec213abe5803936dac9c4b2e7352ede3cb93fec7faa8` |
| `packages/repair/tests/repair.test.js` | `1350238e36c152bc9e24f441a7eedd517afed3148e5c38115201b1a695e4b2c9` |
| `examples/repair/profile.yml` | `cb17e29249858665802437256e8faa5f1e11113382681d19e7646152b13d3bca` |
| `examples/repair/plan.json` | `c9d9a97dc716c26031919dd5fb2aeb1fcc32acc5f38540e1eccede916128ec2c` |
| `examples/repair/preview.mjs` | `fddfa4acc90f1d4ee623f11cc13f57857cfdfcb310214a95a4798a0ec5a5a198` |

## 7. Reproduce

```bash
bash projects/dsh-compat-platform/scripts/repair-plan-batch/run.sh
```

Exit codes: `0` green; `70` envelope refusal before or inside the launch; `71` static
contract failed (no test started); `72` test or example verdict not green; `73` an evidence
write failed; `74` the unit did not settle; `75` lock held; `76` run-directory collision;
`77` a hash manifest could not be read or written; `78` selected-input drift.
