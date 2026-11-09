# correspondence-batch — bounded verification for the correspondence check

Two scripts, one purpose: run the correspondence check and its suite under a measured envelope,
once, and keep the evidence.

| File | Role |
| --- | --- |
| `run.sh` | Launcher. Starts exactly one unit under `systemd-run`, records its environment, verifies the selected inputs are unchanged afterwards, and reads the terminal state back. |
| `payload.sh` | The workload. Reads the envelope back, checks syntax, runs the static contract, the shipped demo, the stale-bindings refusal, the suite, and writes the evidence. |

## Usage

```bash
bash projects/dsh-compat-platform/scripts/correspondence-batch/run.sh
```

The launcher exits 0 only when the whole chain reported green. It writes everything under
`/data/dsh-ecosystem-test-artifacts/runs/<UTC timestamp>-correspondence-batch-<pid>-<pid>/`
(override with `CORRESPONDENCE_RUNS_ROOT`).

## What one run does

1. **Envelope readback.** `memory.max=402653184`, `memory.swap.max=0`, `pids.max=32`,
   `cpu.max="50000 100000"`, `RuntimeMaxUSec=120000000`. A mismatch is a precondition failure, not
   a result.
2. **One memory gate.** `MemAvailable >= 819200 KiB`, read once, before any workload.
3. **Syntax.** `bash -n` on both scripts, `node --check` on the two sources, the declaration file
   and the test file.
4. **Static contract.** The package is private and `type: module`; its only dependency is the
   pinned `yaml@2.9.1`; `./correspondence` and `./correspondence-cli` export targets exist; the four
   files are present; the two version literals are exact; the output shape states
   `identityDisclosed: false`; the pure module never writes `process.stdout`; the CLI names its bin.
5. **Shipped demo.** Runs the CLI on `examples/correspondence/` and requires **exit 1** — the third
   asserted pair names a plugin the declaration document does not declare, which is exactly one
   finding. The document must parse and carry `counts.pairs == 3`, `counts.matched == 3` and
   `CORRESPONDENCE_PLUGIN_NOT_DECLARED`.
6. **Stale bindings.** Copies the correspondence to the output directory, flips one hex character
   in `bindings.profileSha256`, and requires **exit 2** with a `refused` document carrying
   `CORRESPONDENCE_STALE`. This is the check that stops an assertion being replayed against
   different bytes.
7. **The suite.** `node --test --test-concurrency=1 tests/correspondence.test.js` inside a private
   namespace, heap capped at 192 MiB. The test count is deliberately not pinned; `fail` must be 0.
8. **Peaks and summaries.** `memory.peak`, `pids.peak`, TAP fields, verdict files.

## What one run does **not** establish

- Nothing is loaded, imported or executed beyond Node running the two sources and the tests.
- The correspondence is an **assertion**, not an observation: a green run means the assertion was
  well-formed, bound to these bytes, and consistent with the declarations — not that the plugins
  load, resolve or provide their declared capabilities.
- No version correspondence is checkable here: `EntryOptions` has no version field.
- The profile row set is never proven complete.
- `certification` is always `false` and `correlation` always `not-established`.

## Exit codes

Launcher: `0` green · `70` precondition (envelope, memory, argument) · `71` static contract ·
`72` payload verdict · `73` evidence write · `74` shell toolchain · `75`–`78` launcher-side refusals
(see the header of `run.sh`).

Payload: `0` green · `70` envelope/gate · `71` static contract · `72` workload verdict ·
`73` evidence write.

## Artefacts

`status.txt`, `tap/`, `node-tap.log`, `node-stderr.log`, `tap-summary.txt`, `tap-fields.txt`,
`static-contract.log`, `static-verdict.txt`, `example.stdout.json`, `example.rc`,
`example-verdict.txt`, `stale.stdout.json`, `stale.rc`, `stale-verdict.txt`, `check-output.mjs`,
`hashes-before.txt`, `hashes-after.txt`, `peaks.txt`, `memory-gate.txt`, `envelope-verdict.txt`,
`terminal.txt`.

## Deviations recorded while building this runner

- The two scripts were written with mode `600`; `chmod 755` was applied before the first run, and
  file modes are not part of the sha256 manifest.
- The static contract's dependency assertion was written for a zero-dependency package (copied
  from the `dependency-shape` runner) and corrected to the analyzer's one pinned dependency before
  any run.
- The README was written before the first bounded run.
