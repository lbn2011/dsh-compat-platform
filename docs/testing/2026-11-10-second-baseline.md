# Second baseline: the installed `0.2.2-rc.1`, receipt and observation in one launch

Status: **executed, two bounded green rounds (2026-11-10)**

Scope: user decision item 3 **A** — put the DSH installation actually running on this machine into
the matrix as a second baseline, with its runtime receipt and its fixture observation produced by
the **same** launch so the two artifacts cannot silently describe different runtimes.

## 0. What the matrix is, and what each cell means

| Cell | Baseline 1 (official pin) | Baseline 2 (this machine) |
| --- | --- | --- |
| identity | `@deepseek-ai/dsh` `0.2.2-alpha.2`, commit `ce7073d51254c26cd63b22a60835b8f948deb447` | `@deepseek-ai/dsh` `0.2.2-rc.1`, installation manifest sha256 `3e14837ceb3bbc0ba419ed08e9b5ba164338369b1268b93c3c25d89f7b1c9953` |
| runtime receipt | **declared, not measured** — the pin names a commit, and no installed tree of it exists here | **measured**: 10 module rows resolved, digest `49b52d11f0cf786acfe1b1f3ab95d238c66cd345d962572555557aa2580426f6`, identical across rounds and identical to the 2026-11-09 run |
| cordis resolved | not measured | `@deepseek-ai/cordis` **4.1.0** (`node_modules/@deepseek-ai/cordis/lib/index.js`, 64 121 B) |
| loader | not measured | `@deepseek-ai/cordis-plugin-loader` **1.1.0** (28 635 B) |
| fixture observation | not performed | `status: observed`, `cleanup: confirmed`, five phases observed, entries as recorded in `fixture.json` |
| what it licenses | that a protocol revision was written against that commit | that the checks in this repository ran against the runtime this machine actually uses |

The honest shape of the matrix today: **one measured baseline and one declared baseline.** That is
the whole point of adding the second row — before this, every green round in this repository was
against a runtime whose identity was described only by prose.

## 1. What changed

Only the trusted-extraction slice, so that receipt and observation share one launch:

1. `scripts/trusted-extraction-batch/run.sh`: `scripts/runtime-receipt/receipt.mjs` added to the
   selected inputs (a receipt step whose script was not hashed would be unaccounted control).
2. `scripts/trusted-extraction-batch/payload.sh`: new **step 4b** before the fixture observation —
   run the receipt against `$INSTALLATION`, record `runtime-receipt.rc`, take the sha256 of the
   receipt document itself, read `installation.version` out of it, and write `baseline.txt`
   (`baseline_id=installed-rc`, `installed_version`, `receipt_digest`, the official pin's commit and
   version as **declared** constants, and `receipt_scope=process-and-bytes-of-this-installation-only`).

Nothing about the observation, the isolation gates or the failure paths changed.

## 2. Bounded rounds

Four rounds. Rounds 1–2 ran the first payload bytes; rounds 3–4 ran the final bytes, because the
payload's header comment still said the file had never been executed and correcting that comment
changes the control hash. The difference between the two byte sets is **comments only** (two
header lines and two TAP-comment lines); the executed logic is identical, and rounds 3–4 are what
the record's hash table pins.

| Round | Run dir | acceptance_exit | tests | fixture | memory_peak | pids_peak |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `20261110T122332Z-trusted-extraction-batch-1379210-23054` | 0 | 32/32 | `observed` / `confirmed` | 53 612 544 B | 21 |
| 2 | `20261110T122400Z-trusted-extraction-batch-1379631-2760` | 0 | 32/32 | `observed` / `confirmed` | 37 179 392 B | 21 |
| 3 | `20261110T122705Z-trusted-extraction-batch-1380237-19598` | 0 | 32/32 | `observed` / `confirmed` | 38 690 816 B | 21 |
| 4 | `20261110T122711Z-trusted-extraction-batch-1380663-30686` | 0 | 32/32 | `observed` / `confirmed` | 39 444 480 B | 21 |

All four rounds: `terminal_ok=yes`, `hash_rc=0`, `write_failures=0`, and the **runtime receipt
byte-identical across every round** (`49b52d11…`). The selected-input manifests of rounds 3 and 4
are byte-identical to each other, so the two final-bytes rounds ran the same input set.

Receipt content (round 4): `rows=10`, `unresolved=0`, `installation.package=@deepseek-ai/dsh`,
`installation.version=0.2.2-rc.1`, `installation.manifestSha256=3e14837c…`. First rows:
cordis 4.1.0 (64 121 B), cordis-plugin-loader 1.1.0 (28 635 B), cordis-plugin-include 1.1.0
(23 265 B), cordis-plugin-group 1.1.0 (165 B).

## 3. What this does not establish

- It does not compare behaviour between the two baselines: `0.2.2-alpha.2` was never installed or
  run here, so "the checks pass on both" is **not** a claim this record makes. Only the rc.1 column
  has measurements.
- It does not establish that the receipt's rows were the files the process loaded — the receipt
  says so itself (`DOES_NOT_PROVE_THE_PROCESS_USED_THEM`).
- It does not establish that a fixture observation on rc.1 implies anything about alpha.2, or about
  any other installation, or about a real profile.
- `certification` remains `false`; nothing was loaded outside the fixture directory.

## 4. Deviations

1. Gating: this slice re-uses the existing batch rather than a new triple. The extra step is inside
   the same envelope and the same single launch, which is the point (one launch, two artifacts),
   but it does mean the trusted-extraction record's step numbering gained a step between 4 and 5.
2. `scripts/runtime-receipt/README.md` was not edited, so the receipt step is documented only here
   and in the batch README (item 3 C will revisit packaging and docs).
3. The payload's header comment claimed the file had never been executed; correcting it after the
   first two rounds changed a **control** hash, so rounds 3–4 were run with the final bytes rather
   than presenting hashes for bytes no round used. The change was comment-only, but "comment-only"
   is a claim about a diff, not a measurement — hence the extra rounds.
4. `scripts/trusted-extraction-batch/README.md` was also corrected after round 2 (test count 29 → 32,
   the new receipt step, the artefact list, the selected-input count 15 → 16). The README is not a
   hashed input, so that edit does not invalidate the rounds.
5. Two relative-path invocations returned `77` (`run_dir=not-created`) before reaching the core,
   exactly as documented for this runner; the four rounds above used the absolute path.

## 5. Run-time hashes

```
f06b392be278a3031e7e3329e1113ffd22efaba99ccb6a2bd7a010d960ec3db3  scripts/trusted-extraction-batch/payload.sh
c6b296e4f278920bcdddb0fbe25ce92c7a607b86ec2a58b8d1dcb344239eb9f5  scripts/trusted-extraction-batch/run.sh
789e77ccfcfc33aa9153cf8d63d59907cf954f75faef0212c473b019f1981df2  scripts/runtime-receipt/receipt.mjs
```

## 6. Reproduce

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/trusted-extraction-batch/run.sh
```

Read `baseline.txt`, `runtime-receipt.json` and `fixture.json` in the run directory. Exit codes as
documented in that slice's README.
