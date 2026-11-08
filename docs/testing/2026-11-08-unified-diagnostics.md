# 2026-11-08 — unified diagnostics: two bounded runs of `tests/diagnose.test.js`

This record documents **two** executions of the `diagnose-batch` acceptance batch against the
`dsh-compat-diagnose` slice: a first run that ended with eight failing cases, and a re-run after
**test-side-only** corrections that ended green. Both runs are recorded, including the failing
one, because the failing run is what the later pass is measured against.

Every numeric field below is transcribed from the run artifacts listed in §10. MiB values in
parentheses (`MiB = bytes / 1048576`) and the connecting prose are a reviewer's explanation, not
machine output.

**Scope caveat, first.** A green result in round 2 means: on this machine, these twelve selected
inputs, `tests/diagnose.test.js` passes 49/49 inside one transient `systemd-run` unit under the
stated envelope. It does **not** mean the diagnose implementation has no defects (§7), it is not
a CLI-subprocess test, not a real protocol-validator run, not a host run, and not the full
package suite (§6). Nothing here certifies cross-version behaviour, packaging or publication.

---

## 1. Command, working directory, scripts

Launched once per round from `cwd = /root/dsh-ecosystem-spec`:

```
bash projects/dsh-compat-platform/scripts/diagnose-batch/run.sh
```

The launcher takes no arguments and built this exact argv in round 1
(`/data/dsh-ecosystem-test-artifacts/runs/20261108T132247Z-diagnose-batch-826539-12878/argv.txt`):

```
systemd-run --wait --pipe --collect \
  --unit=diagnose-batch-20261108T132247Z-826539-14117.service \
  --property=Type=exec \
  --property=MemoryMax=384M --property=MemorySwapMax=0 \
  --property=TasksMax=32 --property=RuntimeMaxSec=120 --property=CPUQuota=50% \
  --working-directory=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnose-batch \
  -- /bin/bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnose-batch/payload.sh \
     diagnose-batch-20261108T132247Z-826539-14117.service \
     /data/dsh-ecosystem-test-artifacts/runs/20261108T132247Z-diagnose-batch-826539-12878
```

Round 2 differs only in the unit name, the run directory and the payload arguments derived from
them (`argv.txt` in the round-2 directory). The unit name always carries the `.service` suffix —
the payload derives the `busctl` object path from it, and a suffixless name addresses the wrong
object.

## 2. Runs at a glance

| | round 1 | round 2 (re-run after test fixes) |
| --- | --- | --- |
| stamp | `20261108T132247Z` | `20261108T134246Z` |
| unit | `diagnose-batch-20261108T132247Z-826539-14117.service` | `diagnose-batch-20261108T134246Z-828115-89.service` |
| `systemd_run_rc` / `payload_rc` | `72` / `72` | `0` / `0` |
| `node_rc` | `1` | `0` |
| TAP | 48 tests, 40 pass, 8 fail, 0 skipped/todo/cancelled | 49 tests, 49 pass, 0 fail |
| `acc_smoke_verdict` | `tap_pass_ne_tests` | `pass` |
| `acc_static_contract` | `pass` | `pass` |
| `acc_yaml_snapshot` | `identical` | `identical` |
| `acceptance_exit` | `72` | `0` |

`72` is the batch's "test verdict not green" code, not a launcher or envelope failure: the
envelope readback, the memory gate, the syntax step, the static contract and the yaml snapshot
all passed in round 1. The unit was collected and its terminal state settled in both rounds.

## 3. Executed bytes

The runner hashes twelve selected inputs immediately before the launch and again after the unit
settles, and requires an empty diff. Both rounds report `selected_inputs=12`,
`hashes=identical`, `hash_rc=0`, `write_failures=0`, with an empty `hashes-diff.txt`.

| file | sha256 | round 1 | round 2 |
| --- | --- | --- | --- |
| `scripts/diagnose-batch/run.sh` | `f605ce19a9f148ec64121e351adfc8eadcdc9e43916a7b34f26873cac40c76be` | same | same |
| `scripts/diagnose-batch/payload.sh` | `d2b09c77bf835cb68eed50a6963d99fcfc9bd61174ee3bd8d05bf44453e2df2c` | same | same |
| `packages/analyzer/package.json` | `dc9610cb40d200478aaa132d0304ae7083100985c24ad0451e9d4a1fa69031dd` | same | same |
| `src/diagnose-internal.js` | `02c960cebd306551fa5e1c7df0b84ec25622d500cc2a7987d10a4acd6db1b1d2` | same | same |
| `src/diagnose.js` | `5e116eaf1a95e2bbe6ed5fd0e0061b61cfa4ea1d7beef266cacc22c1d1f1ef51` | same | same |
| `src/diagnose-cli.js` | `d328b19a527c2b6dde95062d8d6b0143f8d4269adcfc11e7cc5eb754ead16573` | same | same |
| `src/diagnose.d.ts` | `73cc7e81fb3f6b262ee922aeaf302634fbcf944e340ed12b593247abba4a540f` | same | same |
| `src/combined-report.js` | `d2ac0315a3798286c51fb648c8680d63df373147a589beb1f526afe05fbb5f1e` | same | same |
| `src/combined-cli.js` | `609bea15082cf1617241224656452b32d65d050613d774b447e30bb38b1a9b86` | same | same |
| `src/profile-dump.js` | `8a4a8f1e3a66d409776d6ccae51655d98d665b72f22ad8337a8caa6a8b38faa9` | same | same |
| `src/evidence-cli.js` | `75b0c267e5c889420cacb45820d12b0f8067b49c18e8c0e1994b2cc1103128be` | same | same |
| `tests/diagnose.test.js` | **round 1** `ca9dc2ffb707bf2bb6af745bc136f71ff4b96c7f1090737e9a70b90e79dfbdeb`<br>**round 2** `5934d724832ef2c08fb7dfbd219ca9fd53bc22adaf31693538298b21f32a5c1c` | `ca9dc2ff…` | `5934d724…` |

The executed `run.sh` and `payload.sh` bytes are byte-identical to the files now in the
repository (`f605ce19…`, `d2b09c77…`); the executed test file is byte-identical to the current
`tests/diagnose.test.js` (`5934d724…`). Between the two rounds **only** `tests/diagnose.test.js`
changed — the other eleven hashed paths are identical line for line (§5).

## 4. Resources, read back once per round

Every limit is read back from the cgroup and from systemd **inside** the payload and compared
against the approved values; a mismatch would refuse (`70`) before any test runs. Both rounds
report `envelope_mismatch=none` and `envelope-verdict.txt` = none.

| knob | requested | read back (rounds 1 / 2) | source |
| --- | --- | --- | --- |
| `memory.max` | `402653184` | `402653184` | `envelope-cgroup.txt` |
| `memory.swap.max` | `0` | `0` | `envelope-cgroup.txt` |
| `pids.max` | `32` | `32` | `envelope-cgroup.txt` |
| `cpu.max` | `50000 100000` | `50000 100000` | `envelope-cgroup.txt` |
| `Type` | `exec` | `exec` | `envelope-effective.txt` |
| `RuntimeMaxUSec` | `120000000` | `120000000` (`busctl`) | `envelope-busctl.txt` |
| `MemAvailable` gate | ≥ `819200` KiB | `1518368` / `1324168` KiB (`1448.0` / `1262.9` MiB) | `memory-gate.txt` |
| memory peak | — | `71798784` / `71000064` bytes (`68.47` / `67.71` MiB) | `peaks.txt` |
| pid peak | — | `16` / `16` | `peaks.txt` |

The gate is read **once**, before the workload, and is a precondition rather than a limit:
`meminfo_rc=0` in both rounds. Peak values are observed, not enforced; they are recorded so a
later reader can see the workload stayed well inside `384 MiB`.

Terminal state, read after the unit was collected (`terminal-query.txt`, both rounds):

```
terminal_query_rc=0
load_state=not-found
active_state=inactive
sub_state=dead
main_pid=0
terminal_ok=yes
confirmation=settled
stop_attempted=no
```

`not-found` is expected after `--collect`: the transient unit is unloaded once it exits. The four
facts agree, so no stop was attempted in either round.

Two more recorded facts, identical in both rounds:

- `selection.txt`: `selected_inputs=12`.
- `yaml-manifest.txt`: `yaml_dir=…/packages/analyzer/node_modules/yaml`,
  `yaml_manifest_files_before=233`, `yaml_manifest_snapshot_state=identical`.

## 5. Round 1 — 48 tests, 40 pass, 8 fail

`node-tap.log` (15918 bytes, 453 lines), `node.rc=1`, `tap-verdict.txt` =
`acc_smoke_verdict=tap_pass_ne_tests`, `acc_yaml_snapshot=identical`. All six TAP counter fields
were extracted exactly once (`tap-fields.txt`: tests/pass/fail/cancelled/skipped/todo all `ok`),
so the counts are parsed fields, not a guess over text.

The eight failing cases, with the assertion text recorded in the TAP log:

| # | case | failure |
| --- | --- | --- |
| 8 | profile-only: one document, no entry diagnostics, clear | `'invalid' !== 'clear'` (expected `clear`, actual `invalid`) |
| 9 | profile with entry diagnostics: attention, and the counter decides it | `'invalid'` vs expected `'attention'` |
| 11 | next steps name each cause specifically, and absence changes no exit code | `2 !== 4` (expected `4`, actual `2`) |
| 15 | mixed: attention on one lane outranks clear on another | `'invalid' !== 'clear'` |
| 17 | a lane document the validator rejects is attention, not an error | `'invalid'` vs expected `'attention'` |
| 20 | the mapper never fills in a missing or null channel | `the intact envelope is clear` — `2 !== 0` |
| 35 | the loaded validator is the one the assembler receives | `undefined !== [Function: acceptAll]` |
| 45 | a real-envelope mixed run keeps a failed lane beside a successful one | `'invalid' !== 'clear'` |

Every one of these is a **test-side** failure: the fixtures or expectations disagreed with the
implementation's documented contract, not the reverse. Case-level diagnosis, in the terms the
later fixes used:

- **#8 and #15** — the profile fixture used a YAML mapping root, whereas the summarizer
  requires a sequence. #15 additionally used incomplete runtime evidence.
- **#9** — the fixture was a mapping, and its expectation also incorrectly treated an
  informational `!!js` diagnostic as entry-level attention. Both were corrected.
- **#11** — the test required all next-step messages to be unique, although absent sources
  legitimately share the same fixed message.
- **#45** — the runtime fixture lacked the three required case IDs; the profile read failure
  in this mixed case was intentional, not the cause of this failed runtime assertion.
- **#17** — the case asserted `attention` for a lane document the validator rejects; the contract
  records a rejected document as `invalid` with the lane's own fixed code.
- **#20** — the "intact envelope is clear" precondition used a runtime-evidence document that
  `runtime-evidence.js` refuses (it requires all three fixed `CASE_IDS` exactly once and a closed
  assertion shape), so the whole full-report fixture was `invalid` and the mapper returned `2`
  before any tampering was attempted.
- **#35** — the assertion read the validator under its lane name rather than the assembler's
  option key; the CLI maps `static` → `validateDeclaration`, so the observed value was
  `undefined`.

## 6. Round 2 — 49 tests, 49 pass, exit 0

`node-tap.log` (9615 bytes, 304 lines), `node.rc=0`, `status.txt` =
`systemd_run_rc=0`, `payload_rc=0`, `acceptance_exit=0`; `tap-verdict.txt` =
`acc_smoke_verdict=pass`, `acc_yaml_snapshot=identical`; `tap-summary.txt` = 49/49 with zero
fail/cancelled/skipped/todo and `stderr_bytes=0`.

The case list (`node-tap.log`, `ok 1` … `ok 49`) is the same file, one case longer. Case names
appear in the TAP stream; two of them are worth naming here because they carry the corrected
semantics:

- `ok 9 - a JS value is informational, so it leaves the profile clear`
- `ok 10 - a non-string entry id is an entry diagnostic: attention, and the counter decides it`

### Corrections made between the rounds

Only `tests/diagnose.test.js` was edited. In the order the failures were addressed:

1. **Mapping fixture → sequence fixture.** The narrative profile fixture was rebuilt as a
   one-row (and, for the clear case, two-row) sequence root, so the summarizer no longer refuses
   it with `ROOT_NOT_SEQUENCE`.
2. **`!!js` is informational, not attention.** The `!!js` case now asserts outcome `clear`,
   `entryDiagnostics: 0` and an empty `issues` array, with `JS_EXPRESSION_NOT_EVALUATED` carried
   only in `summary.diagnostics` — `jsScalars: 1`, no evaluation.
3. **A new entry-attention case.** Because `!!js` no longer raises attention, the attention path
   needed its own fixture: a sequence whose single row has a non-string `id`
   (`ENTRY_ID_NOT_STRING`). That case asserts outcome `attention`, `entryDiagnostics: 1`,
   issues `[PROFILE_ENTRY_DIAGNOSTICS]` and exit `1`. **This is where the +1 test comes from**
   (48 → 49).
4. **Runtime document shape.** The full-report fixture now builds `cases` from the exported
   `CASE_IDS` (`import { CASE_IDS as RUNTIME_CASE_IDS } from '../src/runtime-evidence.js'`), so
   all three fixed case ids are present exactly once, and a failing case's `assertions` stay a
   closed `{ id, passed }` set **without** a `message` field — a `message` there makes the whole
   document invalid instead of one failed case.
5. **Absence text may be shared.** The absence step's fixed phrase is shared across the three
   lane sources; the assertion now only requires that a refusal is *not* explained by that
   absence text, instead of requiring per-source wording.
6. **Validator rejection is `invalid`.** The rejected-lane case now asserts outcome `invalid`,
   issues `[INVALID_DECLARATION]` and `result.summary.analysisComplete === false`.
7. **Validator option keys.** The wiring case reads validators under the assembler's option keys
   — `validateDeclaration` (and `validateAdmissionEvidence` for admission) — not under the lane
   names the CLI accepts.

**The eight round-1 failures are preserved here on purpose.** A 49/49 result for a file whose
earlier version failed eight cases is not evidence that the implementation is free of bugs; it
is evidence that these 49 cases, in this form, pass. The failures above were attributed to
fixtures and expectations, but a reader should treat "the implementation is correct" as an open
claim, not something this batch establishes.

## 7. A fixed defect that was never executed

Before either run, a **validator-wiring defect** in the diagnose slice was found by static
reading and corrected in source: the CLI keys validators by lane option name
(`static` → `validateDeclaration`, `admission` → `validateAdmissionEvidence`), while the
assembler accepts only its own option keys. Passing lane-name keys (`static` or `admission`)
would have triggered its unknown-option TypeError, which the CLI maps to exit 5.

That correction is **not** covered by an executed record. The defective form was never run —
neither under this batch nor anywhere else — so no artifact shows the old behaviour or the
failure it would have produced. The first execution of any form of this code is round 1, which
already contained the fix. What round 2's case `ok 36 - the loaded validator is the one the
assembler receives` establishes is that the *current* mapping puts the loaded function under
`validateDeclaration`; it does not retroactively verify the earlier form, and it cannot show the
bug was the only defect of that kind.

## 8. What the tests do and do not cover

Covered, as the test file's own header states:

- decision-level cases over `src/diagnose.js`, `src/diagnose-cli.js` and the package-internal
  assembler `src/diagnose-internal.js`;
- **`main(argv, io)` integration** driven with injected sinks and dependencies, and with real
  temporary files created under `mkdtemp`;
- a **synthetic validator module** written to that scratch directory and loaded through dynamic
  `import()` by absolute path (the sandbox's `--tmpfs /tmp` is what makes that path writable);
- a bad-JSON "no import" sentinel proving a lane's validator is imported only after its document
  parses;
- real-envelope cases where the profile summarizer, the combined report and the runtime
  summarizer are the real modules, because a stub there would only re-assert the stub.

Not covered — and not claimed:

- **no CLI subprocess**: `main()` is called in-process, so process exit status, `argv` handling by
  the OS and real stdout/stderr plumbing are exercised only through injected sinks;
- **no real protocol validator**: the injected validator is a synthetic module and documented
  test doubles elsewhere, not the protocol repository's validator;
- **no host**: no DSH host, driver root, real profile or installed plugin participates;
- **not the full suite**: one file. `node --test "tests/*.test.js" "tests/*.test.mjs"` is the
  package suite of record (§ its README) and this batch runs neither glob — the workload names
  `tests/diagnose.test.js` explicitly.

## 9. Process deviations in the work around these runs

Recorded because the review trail matters more than a tidy narrative. These actions happened
outside any resource envelope and are **not** evidence for this batch:

1. A bare `python3` + `json.load` pass over the package manifest was used to check manifest
   shape, outside the enclosure and outside any hashed selection.
2. A hand-written bracket/parenthesis pairing scan stood in for JS syntax validation. It is not
   syntax validation — it cannot see token-level or semantic errors. The batch's own `bash -n`
   step covers only the two shell scripts, and the static contract checks manifest/export shape,
   not JS parsing.
3. Two edits were made through Python rather than an editor: a documentation typo fix and an
   unused-import removal.

None of these ran under a cgroup limit, produced an independent log, used a separate parser path
or recorded its own exit code. Their only record is the session narrative summarized above. This
document does **not** reconstruct equivalent scripts and does not re-run them: they remain
recorded deviations, and they count toward no acceptance verdict here.

## 10. Freezing, and the `PREPARED` header

The batch scripts are **byte-frozen** at the hashes in §3. They are not edited by this record or
by the accompanying documentation update, and neither run's scripts were touched afterwards.

The frozen execution scripts still carry header text written **before
the first execution** ("PREPARED, NEVER EXECUTED"); the separate README now records both runs. That text describes the state of the bytes at
the time they were written, not the state of the batch now. It is deliberately left unchanged
rather than edited to match reality: rewriting a comment after execution would change the bytes
of a script that has now been executed twice, and this record would then be describing files that
never ran. Readers should take the header as a historical note and §2 of this record as the
current status.

The design document `docs/requirements-and-design/2026-11-08-unified-diagnostics-design.md` is
**not** modified by this record; its §9 already states the same two-round outcome and points
here.

## 11. Evidence

Raw artifacts are **local to the maintainer's machine and not publicly downloadable** — outside
the repository, not on GitHub, not in any archive:

```
/data/dsh-ecosystem-test-artifacts/runs/20261108T132247Z-diagnose-batch-826539-12878/
/data/dsh-ecosystem-test-artifacts/runs/20261108T134246Z-diagnose-batch-828115-18957/
```

A clone of this repository cannot fetch them; see
[`docs/testing/runs/README.md`](runs/README.md). Files relied on by this record, per round:
`status.txt`, `argv.txt`, `selection.txt`, `hashes-before.txt`, `hashes-after.txt`,
`hashes-diff.txt`, `envelope-cgroup.txt`, `envelope-systemctl.txt`, `envelope-busctl.txt`,
`envelope-busctl-path.txt`, `envelope-effective.txt`, `envelope-verdict.txt`, `memory-gate.txt`,
`peaks.txt`, `syntax.txt`, `static-contract.mjs`/`.log`, `static-verdict.txt`,
`yaml-manifest.txt`/`-before.txt`/`-after.txt`/`-diff.txt`, `workload.txt`, `node-tap.log`,
`node-stderr.log`, `node.rc`, `tap-fields.txt`, `tap-summary.txt`, `tap-verdict.txt`,
`terminal-query.txt`/`-raw.txt`, `systemd-run.rc`, `launch.txt`, `journal.txt`, `unit.log`,
`active-units.txt`/`.err`.

Note on the `yaml` snapshot: the runner's twelve hashed paths are a **named selection, not a
dependency closure**, and `yaml` is deliberately not among them. The payload only takes a
two-point snapshot — 233 regular files under `packages/analyzer/node_modules/yaml`, listed and
`sha256sum`-ed immediately before the test and again immediately after, required to be
identical. Equality means those regular files were the same at those two instants; it does not
prove the package was installed intact, does not vouch for its provenance, and cannot rule out a
change that happened and was reverted between the snapshots. The installed version reads
`2.9.1`, matching the pin, and the snapshot refuses if the directory or any entry is a symlink.
