# 2026-11-08 — profile-dump-retained-export: one bounded replay of three retained captures

This record documents **one** execution of the `profile-dump-retained-export` batch: the
committed `dsh-compat-profile-dump` CLI was run once per retained sample, inside one
`systemd-run` unit, and its JSON was judged against a table fixed before execution.

The numeric fields below are transcribed from the run artifacts listed in §9; the MiB
conversions in parentheses (`MiB = bytes / 1048576`) and the connecting prose are a
reviewer's explanation, not machine output.

> **Later shape change (2026-11-09).** The verifier that pins the summary shape moved to
> `profile-dump-summary/0.2-draft.1` and was re-executed against the same three retained
> captures, again `3/3`. This record still describes the **0.1-draft.1** replay and keeps its
> own hashes (`retained-export.mjs` was `007a6729…` here, `06257f01…` in the later run). The
> later run is recorded in
> [`2026-11-08-profile-dump-rows.md`](./2026-11-08-profile-dump-rows.md); it does not revise
> anything below.

**Scope caveat, first.** A green result here means: on this machine, at platform HEAD
`276a8b6`, the committed CLI reproduces the summary shape and the fixed counters implied by
three specific 333/162/568-byte files. It does **not** mean the exporter is healthy, the
exported profile is complete, or that any plugin would load. It is not host integration, not
a certification, and not a re-export.

---

## 1. Command and working directory

Run once from `cwd = /root/dsh-ecosystem-spec`:

```
bash projects/dsh-compat-platform/scripts/profile-dump-retained-export/run.sh
```

The launcher built and executed this exact argv
(`/data/dsh-ecosystem-test-artifacts/runs/20261108T093731Z-profile-dump-retained-export-811637-19337/argv.txt`):

```
systemd-run --wait --pipe --collect \
  --unit=profile-dump-retained-export-20261108T093731Z-811637-29866.service \
  --property=Type=exec --property=MemoryMax=384M --property=MemorySwapMax=0 \
  --property=TasksMax=32 --property=RuntimeMaxSec=120 --property=CPUQuota=50% \
  --working-directory=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export \
  -- /bin/bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export/payload.sh \
     profile-dump-retained-export-20261108T093731Z-811637-29866.service \
     /data/dsh-ecosystem-test-artifacts/runs/20261108T093731Z-profile-dump-retained-export-811637-19337 \
     /data/dsh-ecosystem-test-artifacts/experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141
```

`systemd_run_rc=0`, `payload_rc=0`, launcher exit `0` (`status.txt`).

## 2. Executed bytes

The three executed files were frozen before the run and their hashes were checked against a
value the reviewing agent had verified independently; the launcher then hashed the same
three again immediately before launch and again after the unit settled, with an empty diff.

| file | bytes | sha256 |
| --- | --- | --- |
| `scripts/profile-dump-retained-export/run.sh` | `14591` | `ca15a6037027b800692ff351f0247a9c2a23be551920a077af5f3552fa62a038` |
| `scripts/profile-dump-retained-export/payload.sh` | `19541` | `53c2661d47e72aaaf0a1c2caa3085ba48d6f7c54a93c143048195feb33c14de3` |
| `scripts/profile-dump-retained-export/retained-export.mjs` | `31558` | `007a67291312b58ae33607bcc608c46414c24741a06b1f1b34f533122227f074` |

`selected_inputs=11`, `hashes=identical`, `hash_rc=0` (`hashes-before.txt`,
`hashes-after.txt`, `hashes-diff.txt` empty). The remaining eight hashed entries are the package
manifest plus four source/type files: `package.json`, `src/profile-dump.js`, `src/profile-dump.d.ts`,
`src/profile-dump-cli.js`, `src/evidence-cli.js` and the three capture files of §3.

## 3. Inputs: three retained captures

Read from an **external** artifact root — outside the repository, not downloadable, not
published:

```
/data/dsh-ecosystem-test-artifacts/experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/
  1-probe/out/run-root/out/stdout.bin
  2-denied/out/run-root/out/stdout.bin
  3-script-probe/out/run-root/out/stdout.bin
```

| sample | bytes | sha256 |
| --- | --- | --- |
| `probe` | `333` | `222a50d077c792cbdc1d5f248d3cc8888b8330b9fa2c089cd2915379f0f810cc` |
| `denied` | `162` | `34ea1fbc81ccc7d9c4c7ba575e34ff8d0c2049287835efdfda20d9c564b9a0f0` |
| `script-probe` | `568` | `3af2218cf02f2aae97d9ec37255df5a98fb6d0752d72beb71774a38fd636b44b` |

All three were `verified` before any child started (`retained-export-inputs.txt`:
`sample_count=3`, `verified=3`, `problems=0`).

**Where these bytes come from.** They are the captured stdout of a **real** DSH CLI —
`experiments/dsh-live-lab/build-checkout/apps/cli/lib/bin.js` — over an **isolated synthetic
fixture home**, produced on 2026-11-07 by the `profile-export-real` batch
(`experiments/acceptance/profile-export-real/README.md`, run
`20261107T062654Z-profile-export-real-512194-18141`). They are **not** production
configuration, not a real user profile, and not `/root/.dsh`.

## 4. What ran

Per sample, one child process:

```
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
      --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
      --chdir <package dir> -- \
  env -i PATH=… HOME=… TMPDIR=… NODE_OPTIONS=--max-old-space-size=192 \
      <node> <package dir>/src/profile-dump-cli.js <capture path>
```

`child_timeout_ms=5000`, `child_max_buffer=262144`, `child_heap_mb=192`
(`verifier.log`). The child feeds an existing file to the CLI; nothing is exported, no host
profile is read, no plugin is loaded, no expression is evaluated, and no package code from
`node_modules` is executed by the launcher itself.

## 5. Result

The following expectations were fixed from the retained bytes and the committed contract before
execution; all three summaries satisfied them:

| sample | input bytes | input lines | entries | jsScalars | diagnostics | CLI exit |
| --- | --- | --- | --- | --- | --- | --- |
| `probe` | 333 | 7 | 1 | 0 | none | 0 |
| `denied` | 162 | 7 | 1 | 0 | none | 0 |
| `script-probe` | 568 | 13 | 2 | 2 | two `JS_EXPRESSION_NOT_EVALUATED` | 0 |

All three required `documents=1`, `root=sequence`, `inventory=present`,
`diagnosticsTruncated=false`, `completeness=unknown`, `runtimeValidation=not-performed`, and
`certification=false`. Line counts follow the command's newline-count-plus-one convention,
including the trailing empty line, not `wc -l`. JS diagnostics require null ordinal/detail
and a positive line within the input line count. Other counters were checked for finite,
nonnegative integer shape, not assigned post-run golden values.

`retained-export-result.txt`:

```
verdict=pass
first_failure=none
samples_verified=3
child_runs=3
write_failures=0
```

| sample | outcome | exit | signal | stdout B | stderr B | elapsed ms | check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `probe` | `exited` | `0` | `none` | `747` | `0` | `175` | `pass` |
| `denied` | `exited` | `0` | `none` | `747` | `0` | `136` | `pass` |
| `script-probe` | `exited` | `0` | `none` | `991` | `0` | `161` | `pass` |

`retained-export-verdict.txt`: `acc_retained_export_verdict=pass`,
`acc_samples_snapshot=identical`, `acc_yaml_snapshot=identical`, `acc_verifier_rc=0`.

**`denied` needs one sentence of history.** The 2026-11-07 export run recorded
`383` bytes on stderr for the `denied` sample — a `dsh: skipping profile bundle "<absent>":`
line emitted by the *exporter* while preparing that fixture home. Those bytes were never fed
to the CLI, and they are not a parser message. **This run's `denied` child recorded `0`
stderr bytes.** The two facts belong to different processes and are not in tension; neither
makes the sample "healthy".

## 6. Envelope, readback

Fixed envelope, `Type=exec`, `MemoryMax=384M`, `MemorySwapMax=0`, `TasksMax=32`,
`RuntimeMaxSec=120`, `CPUQuota=50%`, workload heap `192 MiB`.

Effective values read back inside the unit (`envelope-effective.txt`,
`envelope_mismatch=none`):

| knob | readback |
| --- | --- |
| `memory.max` | `402653184` |
| `memory.swap.max` | `0` |
| `pids.max` | `32` |
| `cpu.max` | `50000 100000` |
| `Type` | `exec` |
| `RuntimeMaxUSec` | `120000000` (via `busctl` `GetUnit` → `get-property`) |

**One** capacity sample, taken once before the workload (`memory-gate.txt`):
`mem_available_kib=1600992` ≥ threshold `819200`, `meminfo_rc=0`.

Peaks (`peaks.txt`): `memory_peak=60952576` B (≈ `58.1` MiB, against the `384` MiB cap);
`pids_peak=17` (against `32`).

Terminal state (`terminal-query.txt`): `load_state=not-found`, `active_state=inactive`,
`sub_state=dead`, `main_pid=0`, `terminal_ok=yes`, `confirmation=settled`,
`stop_attempted=no`. Journal: `Started` → `Deactivated successfully`, `journal_rc=0`.

## 7. Snapshots: what changed (nothing)

| snapshot | before | after | diff |
| --- | --- | --- | --- |
| capture files | `3` lines | `3` lines | empty |
| selected inputs | `11` lines | `11` lines | empty |
| `node_modules/yaml` manifest | `233` files | `233` files | empty |

`dependency.txt`: `yaml_state=exact`, `yaml_version=2.9.1`, `expected_version=2.9.1`;
`syntax.txt`: `acc_syntax_run_sh_rc=0`, `acc_syntax_payload_sh_rc=0`.

**This is a two-point comparison, not a closure and not provenance.** It shows the `yaml`
tree held the same 233 file hashes before and after this run. It does not show where those
bytes came from, does not bind them to a registry tarball, and would not detect a
modify-then-restore between the two samples.

## 8. Contract note: the `ordinal` correction

Before execution, the reviewing agent corrected one expectation: `JS_EXPRESSION_NOT_EVALUATED`
diagnostics carry `ordinal === null`, not a positive integer, because the parser calls
`pushDiagnostic(code, { line })` and passes only a line
(`packages/analyzer/src/profile-dump.js:327-342`). The verifier was changed to require
`detail === null`, `ordinal === null`, and a positive `line` within `input.lines`; the README
was synced and says explicitly that this is a **shape** check, not entry attribution.

This was a **pre-execution correction of a wrong expectation**, made while reading the
parser — not a post-failure adjustment of a golden value. No execution had occurred, no
result existed to fit, and the parser was not touched to accommodate the test.

## 9. Artifacts

Run directory (external, not published, not downloadable):

```
/data/dsh-ecosystem-test-artifacts/runs/20261108T093731Z-profile-dump-retained-export-811637-19337/
```

`status.txt`, `retained-export-result.txt`, `retained-export-verdict.txt`,
`retained-export-inputs.txt`, `envelope-effective.txt`, `envelope-cgroup.txt`,
`envelope-systemctl.txt`, `envelope-busctl.txt`, `envelope-verdict.txt`, `memory-gate.txt`,
`peaks.txt`, `terminal-query.txt`, `journal.txt`, `launch.txt`, `argv.txt`,
`selection.txt`, `snapshots.txt`, `samples-before/after.txt`, `hashes-before/after.txt`,
`yaml-manifest-before/after.txt`, `dependency.txt`, `syntax.txt`, `workload.txt`,
`verifier.log`, `verifier.rc`, `systemd-run.rc`, and per-sample private
`child-<id>.stdout.bin` / `child-<id>.stderr.bin`.

The child byte streams are retained there as private evidence and are **not** rendered in
this document or in any log: only sizes and fixed status words appear here.

## 10. Non-claims

- **Not** a statement that the exporter, the parser, or the export is correct, complete,
  healthy, or hostile-host safe.
- **Not** a plugin-loadability, admission, or compatibility check. Nothing was loaded.
- **Not** a re-export on this host. No DSH host ran; no `/root/.dsh` was read; no port was
  contacted.
- **Not** an accumulation: the analyzer's `tests/profile-dump.test.js` result stays at
  `65/65` from its own record. This batch adds **no** test cases, and `3` samples here are
  not "68 tests".
- **Not** proof that untagged or quoted scalars behave like `!!js` ones.
- The `denied` sample is a successful *parse* of a small file whose fixture preparation
  logged a skipped bundle. That is the whole of what it shows.
- **Failure paths were not exercised.** This run had no failure, no retry, and no negative
  branch triggered; nothing here demonstrates that the refusal, output-limit, terminated or
  write-failure paths behave as designed. Those remain review-only claims.
- A plain clone cannot re-verify this record: the three inputs live only under
  `/data/dsh-ecosystem-test-artifacts`, pinned here by size and hash.

## 11. Status

One bounded run, green, on platform HEAD `276a8b6`. The scripts remain byte-frozen at the
hashes in §2; this record does not authorize a rerun, a retry, or an unbounded execution.
