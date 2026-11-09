# profile-dump-retained-export

**STATUS: SOURCE-ONLY migration to the canonical bounded runner. Awaiting Lead bounded
verification.** The three files here were rewritten against `scripts/bounded-runner`
(ABI `bounded-runner/1`, core commit `c8123de`) and have **not** been executed,
syntax-qualified, sourced or launched in this form; no unit has been created from them.

**Pre-migration history — EXECUTED TWICE, PASS EACH TIME (2026-11-08 and 2026-11-09).**
That record describes the *previous* launcher, not these bytes.

- **2026-11-08 — the `0.1-draft.1` shape.** One bounded run returned `verdict=pass` for all three
  samples (`samples_verified=3`, `child_runs=3`, `first_failure=none`) on verifier bytes
  `run.sh ca15a603… / payload.sh 53c2661d… / retained-export.mjs 007a6729…`. Record:
  [`docs/testing/2026-11-08-profile-dump-retained-export.md`](../../docs/testing/2026-11-08-profile-dump-retained-export.md).
- **2026-11-09 — the `0.2-draft.1` shape.** The summariser grew `rows`, `rowsTruncated`,
  `notDerived`, `limitations` and the `maxRows` limit, so this verifier — which pins the published
  shape, including closed row key sets, row vocabularies, exact limit values and both guard lists —
  had to move with it, and was re-executed once against the same three captures: again
  `samples_verified=3`, `child_runs=3`, `first_failure=none`, exit `0`, empty stderr per sample,
  `memory_peak=32686080` B, terminal `MainPID=0`. Verifier bytes for that run:
  `run.sh ca15a603… / payload.sh 53c2661d… / retained-export.mjs 06257f01…`. Record:
  [`docs/testing/2026-11-08-profile-dump-rows.md`](../../docs/testing/2026-11-08-profile-dump-rows.md).

Neither pass is an authorization to rerun without a separate review, and neither is a re-export:
the three input captures are unchanged, byte for byte, in both runs. The sections below describe
the design both runs exercised; where a section names `0.1-draft.1` it is describing the earlier
shape, and §5 states the current one.

One question, asked once:

> Does the committed `dsh-compat-profile-dump` CLI reproduce, on three **retained
> historical captures**, the summary shape and the fixed counters those captures imply —
> under the same reviewed envelope every other acceptance batch uses?

It does not export a profile, does not read a host profile, does not load a plugin and
does not evaluate an expression. It feeds three files that already existed as evidence into
a sandboxed child process and judges that child's JSON against a table fixed in advance.

---

## 0. Invocation

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export/run.sh
```

No arguments; extra arguments are refused `70`. **The path must be absolute.** The core binds
every active shell source frame to its absolute control list, so a relative entry path
(`scripts/…/run.sh`, `./run.sh`) is refused `77` **before** the lock is taken, before a run
directory is created, and before any unit or workload is launched.

### Artifact root — pinned, not passed

The three retained captures are read from an **external** artifact root outside the repository:

```
/data/dsh-ecosystem-test-artifacts/experiments/acceptance/runs/
  20261107T062654Z-profile-export-real-512194-18141/
    1-probe/out/run-root/out/stdout.bin
    2-denied/out/run-root/out/stdout.bin
    3-script-probe/out/run-root/out/stdout.bin
```

Before this migration the root travelled to the payload as a **third** argument, and a transient
systemd service runs in a clean, detached environment, so the canonical two-argument launch
(`unit`, `run`) cannot carry it. The root is therefore **pinned as a constant**, identically in
`run.sh` and `payload.sh`, to the directory the recorded runs used. If the caller sets
`RETAINED_EXPORT_ARTIFACT_ROOT` to any other value, `run.sh` refuses `70` with an explicit message
rather than launch a batch whose payload would read a different tree. Silently ignoring the
override was the alternative and is worse: the caller would believe the batch judged a different
set of captures. **Consequence: redirecting the artifact root is not supported by the migrated
batch.** See §11 item 5 and "Changes in this migration".

## 1. Files

| file | role |
| --- | --- |
| `run.sh` | launcher: refuses an artifact-root override, names the selected inputs, delegates the lock, unit, snapshots and verdict to the core |
| `payload.sh` | in-unit: envelope receipt, syntax and dependency preconditions, before/after snapshots, runs the verifier once, maps the verdict |
| `retained-export.mjs` | the verifier: pins the three inputs, runs the CLI once per sample inside `bwrap`, judges the JSON |
| `README.md` | this file |

Nothing else in the repository is modified. The existing parser, the CLI, and the older
runners (`profile-dump-batch`, `profile-dump-install`) are untouched.

## 2. The three retained samples

| sample | bytes | sha256 | historical stderr |
| --- | --- | --- | --- |
| `probe` | 333 | `222a50d077c792cbdc1d5f248d3cc8888b8330b9fa2c089cd2915379f0f810cc` | 0 B |
| `denied` | 162 | `34ea1fbc81ccc7d9c4c7ba575e34ff8d0c2049287835efdfda20d9c564b9a0f0` | 383 B |
| `script-probe` | 568 | `3af2218cf02f2aae97d9ec37255df5a98fb6d0752d72beb71774a38fd636b44b` | 0 B |

Both the length and the digest are pinned. Inside the verifier a missing or differing file
is a **failure** (exit 60 / 61), never a skip: "the sample is not there" must not read as
"the run passed". Those are the verifier's codes — `run.sh` usually notices an absent
capture first, as `70` from its selected-input check.

The pin, not the path, is what identifies a sample: a symlink at the pinned location is followed
and its bytes are what get hashed, so the path checks are hygiene rather than proof. The public
log records a fixed `source=retained_export_captures_v1` line and never the caller's path; the
path appears only in `retained-export-inputs.txt` under the private run directory.

A byte-identical copy of this run also exists inside the repository at
`experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141/`. The
verifier does **not** read it; the external root is the one under test.

### The `denied` stderr is background, not a comparison

The historical `denied` capture produced 383 bytes on stderr — the original export run
skipping an unresolvable bundle. That text is **source background only**. It is never fed
to the YAML CLI and never compared against the new CLI's stderr. The new CLI's stderr
expectation is **0 bytes for all three samples**.

## 3. What the CLI is invoked as

Once per sample, with the sample path as the single positional argument:

```
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
      --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
      --chdir <analyzer package> \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
        NODE_OPTIONS=--max-old-space-size=192 \
        <node> <pkg>/src/profile-dump-cli.js <sample>
```

Limits on that child, all set by the verifier: **timeout 5000 ms**, **maxBuffer 262144
bytes per stream**, **SIGKILL**, heap cap **192 MiB**, `env -i`. The read-only root is a
bind of `/`; `/tmp` is a private tmpfs; pid/net/ipc/uts are separate namespaces, so the
CLI can reach nothing it was not given.

How a child's ending is read: a numeric exit status is recorded as an exit, whatever the
number; crossing `maxBuffer` (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) is an **output limit**;
being killed by a signal is recorded as **terminated**, with the signal named, and is *not*
asserted to have been the timeout — the verifier cannot observe which timer fired, so it
does not claim one. Elapsed time is recorded for the record only and never decides an
outcome.

The verifier is *not* wrapped in a second `bwrap`: it spawns one sandbox per CLI child
itself, and nesting user namespaces would only add a failure mode without adding a
boundary. The migrated payload keeps that deliberately: the workload line is a plain
`env -i … "$NODE" "$VERIFIER"`, not a `bwrap` invocation.

## 4. The expectation matrix

Fixed in advance, from the CLI's own contract and from the fixture sources.

| sample | `input.bytes` | `input.lines` | `documents` | `root` | `inventory` | `counts.entries` | `counts.jsScalars` | `diagnostics` | exit | stderr |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `probe` | 333 | 7 | 1 | `sequence` | `present` | 1 | 0 | `[]` | 0 | 0 B |
| `denied` | 162 | 7 | 1 | `sequence` | `present` | 1 | 0 | `[]` | 0 | 0 B |
| `script-probe` | 568 | 13 | 1 | `sequence` | `present` | 2 | 2 | `JS_EXPRESSION_NOT_EVALUATED` ×2 | 0 | 0 B |

Every sample must also report `diagnosticsTruncated: false`, `completeness: "unknown"`,
`runtimeValidation: "not-performed"`, `certification: false`, and a non-null `counts`.

Rows on these three captures, from the `0.2-draft.1` shape: `rows.length` must equal
`counts.entries` (1 / 1 / 2) and `rowsTruncated` must be `false`. That is an expectation here
because every sample is far below `maxRows`; a truncated window on a three-entry sample would
mean the cap itself moved. The row *contents* are not pinned to golden values: what is asserted is
their shape and position (§5), not that entry 1 in `probe` has any particular `configKeyCount`.

### Where each expectation comes from

| expectation | source |
| --- | --- |
| root must be a sequence | `packages/analyzer/src/profile-dump.js:637-640` |
| `counts.entries` = number of top-level rows | `packages/analyzer/src/profile-dump.js:403` (`items.length`) |
| `counts.jsScalars` increments per `!!js` scalar | `packages/analyzer/src/profile-dump.js:327-342` (increment `:337`, diagnostic `:339-341`) |
| `input.lines` = 1 + newline count, not `wc -l` | `packages/analyzer/src/profile-dump.js:222-229` (`countLines`) |
| `input.bytes` = UTF-8 byte length | `packages/analyzer/src/profile-dump.js:533` |
| `documents` from `parseAllDocuments` length | `packages/analyzer/src/profile-dump.js:585-589` |
| exit 0 vs 1 (entry diagnostics) | `packages/analyzer/src/profile-dump.js:712-719`, entry codes `:181-187`, bump `:208` |
| fixed `completeness` / `runtimeValidation` / `certification` | `packages/analyzer/src/profile-dump.js` summary builder |
| one positional argument, JSON on stdout | `packages/analyzer/src/profile-dump-cli.js:224`, `:240`, `:263-264` |

Fixture sources that make the counts what they are:

- `experiments/profile-export-fixture/profiles/probe/package.json:7` — one bundle;
  `.../probe/cordis.patch.yml:3-6` — one user-layer row.
- `.../profiles/denied/package.json:7` — two bundles, the second (`@fixture/dsh-bundle-absent`)
  unresolvable and skipped; the bundle row is
  `.../denied/node_modules/@fixture/dsh-bundle-probe/cordis.patch.yml:3-8`.
- `.../profiles/script-probe/package.json:7` plus the bundle row, and
  `.../script-probe/cordis.patch.yml:6-11` — two `!!js` scalars at `:10-11`, hence
  `entries` 2, `jsScalars` 2 and two `JS_EXPRESSION_NOT_EVALUATED` diagnostics.

`input.lines` is **7 / 7 / 13** because the counter is one plus the number of newlines. It
is not `wc -l`, which would report 6 / 6 / 12.

## 5. What is asserted, and what is deliberately not

**Asserted:** the three input digests before any child starts; one child per sample; a
single JSON document on stdout; a closed key set at every level; closed string vocabularies
for `inventory`, `root`, `completeness`, `runtimeValidation`, diagnostic `code` and
`detail`; diagnostic `ordinal` and `line` either `null` or positive integers; for the
`JS_EXPRESSION_NOT_EVALUATED` diagnostics specifically, `detail` must be `null`, `ordinal`
must also be `null` — `pushDiagnostic(code, { line })` passes only a line, so a numeric
ordinal would be a different diagnostic shape — and `line` must be a positive integer
within `input.lines`; the seven `limits` constants (including `maxRows`) against their exact
contract values; the fixed counters in §4; empty stderr; exit 0. The first failing sample ends the
batch: no later child starts, and `child_runs` records what actually ran.

**Asserted about rows** — the part that keeps a window from becoming an inventory:

- `rows` is an array or `null`, never anything else; it is `null` **exactly** when `counts` is
  `null`, and `rowsTruncated` is `false` whenever `rows` is `null`.
- `rows.length` is never greater than `limits.maxRows`, and `rowsTruncated` equals
  `rows.length < counts.entries` in **both** directions: a short window without the flag would
  hide rows silently, and the flag without a short window would claim a loss that did not happen.
- Every row has exactly the ten documented keys, in a closed set — a row that grew an `id`,
  `name` or `config` key holding document text would be rejected here, which is the check that
  keeps operator content out of the public projection.
- `index` is its own 1-based position in the array (the window is the head of the sequence, in
  order), `line` is `null` or a positive integer, `keyCount` and `unmodelledKeyCount` are
  non-negative integers, and `unmodelledKeyCount ≤ keyCount`.
- `idKind` / `nameKind` ∈ `absent|string|non-string`; `group` / `disabled` ∈
  `absent|true|false|null|other`; `config` ∈ `absent|mapping|not-mapping`. `null` and `other` are
  distinct words because `EntryOptions` declares `group`/`disabled` as `boolean | null`, so a
  legal `null` must not be reported as a type error.
- `configKeyCount` is a non-negative integer **exactly when** `config` is `mapping`, and `null`
  otherwise.
- `notDerived` and `limitations` are compared **exactly** against the five verbatim names and the
  eight fixed codes. A reworded limitation or a silently dropped name fails the run rather than
  drifting.

That JS-diagnostic check is a **shape** check only: it does not verify which entry a `!!js`
tag belongs to, so no entry attribution is claimed.

**Not asserted, on purpose:**

- **`entryDiagnostics`.** It is a property of the module's return value, not a field of the
  CLI's JSON. It is never asserted to exist. The closed top-level key set would reject it
  if it ever appeared.
- **No golden values for the other counters.** `entryGroups`, `entriesWithId`,
  `entriesWithName`, `entriesWithConfig`, `entriesDisabled`, `distinctTags`, `nodes`,
  `scalars`, `maxDepth` are only checked to be finite non-negative integers — except that
  `limits` is *not* in this group (§5: those seven are contract constants and are compared
  exactly). Inferring golden counter values from three small samples would be a guess
  dressed as a contract.
- **Golden row contents.** `line`, `keyCount`, `configKeyCount` and `unmodelledKeyCount` are
  checked for type and coupling, not against per-sample golden numbers: the fixture provenance
  for those values is recorded in §4, but the verifier asserts shape and position, so a change in
  the fixture would not silently pass as a shape change.
- **Tag equivalence.** Nothing claims that an untagged or quoted scalar is treated like a
  `!!js` one. A plain or quoted scalar with no tag is never counted as an expression.

## 6. Envelope

Identical to the reviewed batches, with the unit prefix changed. The values and the strict readback
now live in the core (`scripts/bounded-runner/envelope.sh`); this batch names none of them itself.

| property | value |
| --- | --- |
| `Type` | `exec` |
| `MemoryMax` | `384M` (402653184 B) |
| `MemorySwapMax` | `0` |
| `TasksMax` | `32` |
| `CPUQuota` | `50%` (`cpu.max = 50000 100000`) |
| `RuntimeMaxSec` | `120` (`RuntimeMaxUSec = 120000000`) |
| workload heap | `--max-old-space-size=192` |

Readback is strict: `memory.max`, `memory.swap.max`, `pids.max` and `cpu.max` are each read
as **exactly one** non-empty line (several differing lines read as
`<ambiguous-or-missing:…>`), `Type` must appear exactly once, and `RuntimeMaxUSec` is read
via `busctl` `GetUnit` → `get-property`, accepting only a whole `t <digits>` reply. An
unreadable or ambiguous value is a mismatch, never a reason to skip the comparison.

`MemAvailable` is sampled **once**, before the workload, at a threshold of **819200 KiB**.

Every evidence write is counted. If any write fails, the payload stops with exit **73**
*before* the workload starts: an unrecorded run is not a green one. Failures are not
retried.

## 7. Execution shape

Now the core's, not this batch's:

- Shared lock: `experiments/acceptance/runs/.acceptance.lock`, `flock -n`. A held lock is a
  refusal (75), never a wait.
- Active-unit query before launching across every known batch family, including
  `profile-dump-retained-export-*`. A **failed** query is a refusal (70), not "nothing is
  running".
- One `systemd-run --wait --pipe --collect` launch, `timeout 200` around it, `journalctl`
  captured, terminal state read back via `systemctl show`, requiring
  `LoadState ∈ {not-found, loaded, merged}`, `ActiveState:SubState ∈ {inactive:dead,
  failed:failed}` and `MainPID = 0`.
- Before/after `sha256` manifests over the launcher's selected inputs — the three scripts, the
  judged package sources, and the three retained samples — with the control sources and core
  modules added by the host. Drift ⇒ 78; an unreadable manifest ⇒ 77.
- The payload also snapshots the regular files under `packages/analyzer/node_modules/yaml`
  before and after. That is a two-point content snapshot, **not** provenance: equality says
  the file list and contents were identical at those two moments and nothing more. A
  symlinked directory or any symlink inside it is refused rather than silently dropped from
  the manifest.

## 8. Exit codes

`run.sh` / `payload.sh`: `0` green; `60`–`66` the verifier's own failure codes (passed
through); `70` refusal; `71` dependency precondition failed; `72` verifier ran but the batch
is not green; `73` an evidence write failed; `74` the unit did not settle; `75` lock held;
`76` run-directory collision; `77` hash manifest unreadable (and **a relative entry path**);
`78` selected-input drift.

`retained-export.mjs`: `0` all three matched; `60` sample missing; `61` sample size/hash
mismatch (or not a regular file); `62` sandbox or node unusable; `63` a child failed without
producing a usable result (unusable/internal exit, output over `maxBuffer`, killed by a
signal, non-empty stderr); `64` stdout was not exactly one JSON document; `65` the summary
left the closed key/vocabulary set; `66` the summary was legal but did not match the
expectation (this includes exit 1 — parsed with an entry-level diagnostic — and exit 64 —
usage); `73` an evidence write failed.

`60`/`61` are the **verifier's** codes. They are not a promise about the batch: `run.sh`
checks its selected inputs with `-f` before launching, so an absent capture usually stops
the batch earlier as `70`, and a changed one can also surface as `78` drift. The launcher
declares `60`–`66` as allowed workload exits so the core relays them instead of folding them
into `70`; the payload passes one through **only** when both snapshots were identical, and
answers `72` otherwise.

PRECONDITION, NOT PERFORMED BY THIS BATCH: the workload imports `yaml`. Nothing here
installs anything. If `yaml` does not already resolve to exactly **2.9.1** from the
analyzer package, the payload refuses (71) before the workload starts. That check parses
`node_modules/yaml/package.json` as JSON with the same interpreter and heap cap under `env
-i` — not with `sed`/`head`, which cannot tell a top-level `version` from a nested one. It
reads one file; it does not load or run any code from the package.

## 9. Artifacts

All raw output goes to `/data/dsh-ecosystem-test-artifacts/runs/<stamp>-profile-dump-retained-export-<pid>-<rand>/`,
never into the repository.

Written by the core: `status.txt` (final verdict), `selection.txt`, `control-before.txt`,
`selected-before.txt`, `active-units.txt`, `argv.txt` (the exact launch vector),
`requested.txt`, `unit.log` (the host is its sole writer), `launch.txt`, `systemd-run.rc`,
`journal.txt`/`journal.rc`, `terminal-before.txt`/`terminal-after-stop.txt`/`terminal.txt`/
`stop.txt`, `ownership.txt`/`ownership-systemctl.txt`, `envelope-systemctl.txt`,
`envelope-getunit.txt`, `envelope-runtime.txt`, `envelope-effective.txt`,
`memory-gate.txt` (the single `MemAvailable` sample), `control-after.txt`,
`selected-after.txt`, `control-diff.txt`, `selected-diff.txt`, `payload-result.txt`,
`payload-evidence.txt`, `peaks.txt` (memory and pid peaks).

Written by this payload: `syntax.txt` (`bash -n` results), `dependency.txt` (yaml resolution
state), `dependency-verdict.txt`, `samples-before.txt`/`samples-after.txt` (sha256 of the three
retained inputs, before and after), `samples-diff.txt`, `yaml-manifest-before.txt`/
`yaml-manifest-after.txt`/`yaml-manifest-diff.txt` (regular files under `node_modules/yaml`),
`workload.txt` (what was started, and the pinned root), `verifier.log` (the verifier's
fixed-code log), `verifier.rc`, `snapshots.txt` (the snapshot verdicts),
`retained-export-verdict.txt` (`acc_retained_export_verdict`, `acc_samples_snapshot`,
`acc_yaml_snapshot`, `acc_verifier_rc`), plus the verifier's own
`retained-export-inputs.txt`, `retained-export-result.txt` and `child-<sample>.*` files.

Changes relative to the pre-migration runner: the cgroup/envelope readback, the memory gate and
the peak readback are now the core's canonical files and field names, so `envelope-cgroup.txt`,
`envelope-busctl-path.txt`, `envelope-busctl.txt` and `envelope-verdict.txt` are gone
(`envelope-effective.txt` carries `mismatch=`); `terminal-query.txt` is replaced by the core's
three terminal files plus `stop.txt`, `ownership.txt` and `ownership-systemctl.txt`;
`hashes-before.txt`/`hashes-after.txt`/`hashes-diff.txt` are replaced by `control-*` and
`selected-*` pairs; `selection.txt` no longer carries the batch's own `artifact_root=` line (the
pinned root is recorded in `workload.txt` and in the payload's log).

Child stdout/stderr are stored **only** as private files under the run directory. Public
log lines carry fixed codes and byte counts, never sample text, never a parser message.

## 10. Non-claims

This batch does **not** establish, and must not be read as establishing:

1. **Provenance.** The pins are content digests, not an origin chain. The batch proves the
   bytes it read are the bytes that were pinned; it does not prove where they came from.
2. **Build ↔ commit binding.** Nothing ties the CLI that ran to a particular commit, and
   nothing rebuilds it. The selected-input hashes are a named selection, not a closure.
3. **Production fidelity.** The three captures are real CLI output over a **synthetic
   fixture home** (`run-root/home/…` inside the historical run), not the real `/root/.dsh`
   profile and not production configuration.
4. **Completeness.** That the export is complete, or that the summary covers everything a
   real dump contains, is not shown. `completeness` is reported `"unknown"` by the CLI
   itself.
5. **Health.** That any plugin loads, that any `config` block matches a plugin schema, that
   anything would be admitted or is compatible — none of this is exercised.
6. **Expression semantics.** No `!!js` expression is evaluated. `script-probe` proves only
   that two expression scalars are *counted and flagged*, never that they resolve.
7. **Generality.** Three small historical samples are not a corpus. Agreement on them is
   agreement on them.

## 11. Risks and open items

1. **The samples are not in the repository.** A plain clone cannot re-verify this run: the
   three `.bin` files live under `/data`. Whether an absent capture surfaces as `60` (the
   verifier's code) or as `70`/`78` (the runner's preflight and drift checks) depends on
   where it goes missing; in no case does it pass.
2. **The pins are a transcription.** The three digests and lengths in
   `retained-export.mjs` were read from the artifact tree and from
   `/data/dsh-ecosystem-test-artifacts/SHA256SUMS`; they are not computed at run time from
   an independent source. If the pins themselves were transcribed wrongly, the batch would
   fail closed (61) — visible, not silent.
3. **Exit-code semantics are subtle.** Exit 1 is "parsed, with an entry-level diagnostic"
   and exit 2 is "unusable"; conflating them would turn a wrong document into a crashed
   child or vice versa. The verifier maps them separately (§8).
4. **`yaml` snapshot is not provenance.** It can only catch a change that persisted across
   the two sampling instants; a change made and reverted between them is invisible. It also
   does not verify the tarball the dependency came from.
5. **The artifact root is no longer redirectable.** The verifier still accepts
   `--artifact-root`, and the pins are still what stop a substituted tree from passing, but the
   *batch* now pins the root and refuses (`70`) an override: the canonical launch carries two
   arguments and a transient service inherits no environment, so there is no faithful channel for
   it. This is the one capability the migration did not preserve; restoring it would need a
   reviewed change to the canonical launch contract, not a local workaround.
6. **Only the happy path has actually run.** Everything above describes designed behaviour.
   The executed batches hit no failure: no refusal, no output-limit, no terminated child,
   no write failure, no retry. The refusal, limit and write-failure paths therefore remain
   review-only claims — the code implements them, the run did not exercise them. The migrated
   bytes have not run at all. See [§12](#12-running-it) for what the recorded runs did and did
   not establish.

## 12. Running it

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export/run.sh
```

Takes no arguments. The path must be absolute (a relative entry path is refused `77` before
launch). `RETAINED_EXPORT_ARTIFACT_ROOT` is **refused** (`70`) if it names anything other than the
pinned root — see §0.

**What the pre-migration runs established.** From `cwd = /root/dsh-ecosystem-spec` on
2026-11-08, at platform HEAD `276a8b6`, the launcher ran once and exited `0`. The unit
`profile-dump-retained-export-20261108T093731Z-811637-29866.service` read back the full
envelope (memory `402653184`, swap `0`, pids `32`, `cpu.max = 50000 100000`, `Type=exec`,
`RuntimeMaxUSec=120000000`), took one `MemAvailable` sample (`1600992` KiB ≥ `819200`),
ran three children — `probe` `747` B / `denied` `747` B / `script-probe` `991` B on stdout,
`0` B on stderr, exit `0` each — and settled at `MainPID=0`. Peaks were `60952576` B and
`17` pids. Capture, selected-input (`11`) and `yaml` manifest (`233` files) snapshots were
identical before and after. The 2026-11-09 rerun reproduced this on the `0.2-draft.1` shape.

**What neither established, and the migration cannot claim.** Nothing about export completeness,
plugin loadability, host compatibility, hostile hosts, or the failure paths. The three samples are
historical captures of a real CLI over a synthetic fixture, replayed — not a re-export on this
host. The CLI's own suite has its own record — `81/81` on the current `0.2-draft.1` bytes, `65/65`
on the earlier shape; these three samples are not extra test cases. A plain clone cannot
re-verify: the inputs live only under `/data/dsh-ecosystem-test-artifacts` and the run directory
is not published.

Any further execution needs a separate authorisation. The batch that passed is not a standing
permission to rerun it, and this source-only migration is not a run.

## 13. Changes in this migration (for the reviewer)

- `run.sh` no longer computes unit names, hashes, terminal state or the verdict: it validates its
  own invocation, refuses an artifact-root override, names its selected inputs, and calls
  `br_host_run` once. Exit `74` (unit did not settle) is now the core's, and the workload-exit map
  is the core's (`73`→`73`, `124|137|143`→`74`, declared→itself, else `70`).
- The payload's argument contract is exactly two arguments (`unit`, `run`). The historical third
  argument is gone; `ARTIFACT_ROOT` is a constant, re-validated (absolute, no `..`, no `//`,
  directory) because the payload is the process that reads the samples.
- The payload's own envelope readback, memory gate, evidence counter and peak readback are
  replaced by `br_envelope_enter`, `br_evidence_gate` and `br_peaks`; `br_payload_finish` writes
  the canonical `payload-result.txt`/`payload-evidence.txt`/`peaks.txt` and takes the final exit.
- Unchanged: the syntax and dependency preconditions and their exit `71`, the three sample pins
  and the yaml two-point snapshot, the workload line (verifier **not** bwrap-wrapped, `env -i`,
  192 MiB heap), the snapshot-before/verdict/snapshot-after order, the verdict precedence
  (`samples_snapshot` → `yaml_snapshot` → `verifier_rc`), the four `acc_*` verdict field names,
  the pass-through of `60`–`66` only when both snapshots are identical, and `72` otherwise.
- The precedence of `73` (an evidence write failed) over a non-green verdict is unchanged: the
  payload returns `73` before it considers the verifier's code.
