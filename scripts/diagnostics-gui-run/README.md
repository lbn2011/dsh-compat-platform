# `diagnostics-gui-run` — bounded batch for the read-only diagnostics GUI

Status: **EXECUTED**, two rounds on 2026-11-08, the second green. Record:
[`docs/testing/2026-11-08-read-only-diagnostics-gui.md`](../../docs/testing/2026-11-08-read-only-diagnostics-gui.md).

One run of this launcher does, once, under a bounded envelope and with no retry:

1. checks the envelope the unit actually runs under (384 MiB, swap 0, 32 tasks,
   50 % CPU, 120 s, `Type=exec`) and refuses on any deviation;
2. takes a single `MemAvailable` reading and refuses below 819200 KiB;
3. parses both scripts and `node --check`s every JS file the batch runs;
4. asserts the package's static contract (no dependencies, both export targets
   present, `apply`/`name`/`inject`, both default paths, the closed refusal
   vocabulary, the page's two literals, exactly one discovered test file);
5. asserts the dependency precondition (yaml 2.9.1 from the analyzer; the
   installed `@deepseek-ai/cordis` and `@deepseek-ai/dsh-host-webserver` resolve
   from the global module root) and that the sibling `dsh-compat-spec` validators
   exist — an absent sibling is a refusal, never a skip;
6. **step A** produces ONE real envelope with `dsh-compat-diagnose` (expected
   exit **1**: the admission example is attention on purpose);
7. **step B** boots the two-plugin composition over that envelope and probes the
   page, the JSON route and the fence;
8. **step C** boots a second composition whose envelope is missing and probes the
   refusal path;
9. **step D** runs `node --test --test-concurrency=1 tests/gui.test.js` inside the
   package;
10. takes a second yaml snapshot and reads `memory.peak` / `pids.peak`.

## Usage

```
bash projects/dsh-compat-platform/scripts/diagnostics-gui-run/run.sh
```

No arguments. One transient systemd unit, one workload, one acceptance lock taken
with `flock -n` (a held lock is a refusal, never a queue). Raw artifacts land in
`/data/dsh-ecosystem-test-artifacts/runs/<stamp>-diagnostics-gui-<pid>-<rand>/`
(`DIAGNOSE_RUNS_ROOT` overrides the root).

## Requirements

- `systemd-run`, `systemctl`, `journalctl`, `busctl`, `bwrap`, `flock`, `awk`,
  `sha256sum` on PATH.
- Node 24 at `/www/server/nodejs/v24.21.0/bin/node`.
- The installed DSH module tree at
  `/www/server/nodejs/v24.21.0/lib/node_modules` (carrier + cordis).
- `packages/analyzer/node_modules/yaml` at exactly 2.9.1.
- A sibling checkout `projects/dsh-compat-spec` with `src/index.js` and
  `src/admission-evidence.js`.

Nothing is installed by this batch.

## Exit codes

Launcher: `0` green, `70` refusal before/inside the launch, `71` static contract
or dependency precondition failed (no workload started), `72` an HTTP assertion or
the CLI envelope step did not match, `73` an evidence write failed, `74` the unit
did not settle, `75` lock held, `76` run-directory collision, `77` hash manifest
unreadable/unwritable, `78` selected-input drift.

Payload: `0` green, `70` argument/envelope refusal, `71` static contract or
dependency precondition, `72` assertion mismatch, `73` evidence write failed,
`74` the selected test file was not a clean run.

## Files

| File | Role |
| --- | --- |
| `run.sh` | launcher: lock, unit, journal, terminal readback, hash manifests |
| `payload.sh` | in-envelope payload: gates, envelope step, carriers, probes, tests, verdict |
| `boot.mjs` | minimal composition: installed `WebServer` + the GUI plugin |
| `probe.mjs` | HTTP assertions, happy path and `--expect-refusal` path |

`run.sh`/`payload.sh` and the package's own files are in the launcher's selected
hash set. `boot.mjs` and `probe.mjs` are executed but not hashed; their bytes at
the recorded run are:

| File | sha256 |
| --- | --- |
| `boot.mjs` | `cf75446106254aa2aeac4febd1c9e37c2ec5ca4ac8045ca02179c8982404830a` |
| `probe.mjs` | `73a3ee61fe46b9e66d4685bbb47d6f6a3ab32d4102dfdb088d20962a97df978e` |

## Deviations recorded while executing

- **`chmod 755` on both scripts** before the first launch (they were written
  `600`, and the first invocation was refused with `rc=126`, starting no unit).
  File modes do not enter the hash manifest.
- **The carrier steps do not pass `--unshare-net`.** A fresh network namespace has
  its loopback interface down, so the probe would measure the sandbox instead of
  the page.
- **The carrier binds the run's own `gui/` directory writable** on top of
  `--ro-bind / /`, so the child can write `ready.json` and the probe its report.
- **Round 1 exposed three defects, all fixed in bytes**: a read-only `name`
  assignment that killed the composition, an over-permissive `Host` allowlist,
  and an envelope path pointing at a file the CLI never writes (it writes stdout).
  Round 2 differs from round 1 in those files only.

## What this batch cannot show

No browser rendered the page — there is no browser binary on this machine and
none is installed. The HTML was fetched and inspected as text; the page's inline
script never ran. No plugin was loaded or activated, no host observed the evidence
documents, and `certification` stays `false`.
