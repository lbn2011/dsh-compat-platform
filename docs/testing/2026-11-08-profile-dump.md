# 2026-11-08 — profile-dump: install + acceptance batch (two rounds)

This record documents the one-time install of `yaml@2.9.1` and the two acceptance
runs of the `profile-dump-batch` envelope, in that order. The numeric result fields
below are taken from the run artifacts listed at the end; the prose that connects
them — and the MiB conversions shown in parentheses (e.g. `32501760` B ≈ `30.9` MiB,
`95178752` B ≈ `90.7` MiB, `97046528` B ≈ `92.6` MiB; `MiB = bytes / 1048576`) — is a
reviewer's explanation, not machine output.

> **Later shape change (2026-11-09).** The module has since moved to
> `profile-dump-summary/0.2-draft.1`, which adds `rows`, `rowsTruncated`, `notDerived`,
> `limitations` and the `maxRows` limit. The `65/65` below is the count for the **0.1-draft.1**
> bytes that ran; the current bytes were verified separately in
> [`2026-11-08-profile-dump-rows.md`](./2026-11-08-profile-dump-rows.md) (`78/78`). Neither
> record is retracted and the two counts are not additive.

**Scope caveat.** The acceptance batch runs a **single** test file
(`tests/profile-dump.test.js`) — not the full analyzer suite — under an isolated
`systemd-run` envelope with `bwrap` namespace isolation. It does **not** verify
behavior inside a real DSH host, does not load any exported profile, and does not
exercise any network path. A green result here means: the pinned command's own
tests pass under the approved resource envelope on this machine, at this version.

---

## 1. Install of `yaml@2.9.1`

Run directory: `/data/dsh-ecosystem-test-artifacts/runs/20261108T061801Z-profile-dump-install-797979-14681/`

### Command

Run from `cwd = /root/dsh-ecosystem-spec`; the launcher built and executed this exact argv
(`/data/dsh-ecosystem-test-artifacts/runs/20261108T061801Z-profile-dump-install-797979-14681/argv.txt`):

```
systemd-run --wait --pipe --collect \
  --unit=profile-dump-install-20261108T061801Z-797979-13898.service \
  --property=Type=exec --property=MemoryMax=384M --property=MemorySwapMax=0 \
  --property=TasksMax=32 --property=RuntimeMaxSec=120 --property=CPUQuota=50% \
  --working-directory=/root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install \
  -- /bin/bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install/payload.sh \
     profile-dump-install-20261108T061801Z-797979-13898.service \
     /data/dsh-ecosystem-test-artifacts/runs/20261108T061801Z-profile-dump-install-797979-14681
```

Selected inputs hashed before/after (`selected_inputs=3`): `hashes=identical`, `hash_rc=0`
(`hashes-before.txt` / `hashes-after.txt`):

- `scripts/profile-dump-install/run.sh` sha256 `195b29db3e58f93a0368b2ab43ea036a4c8de9c9537deea89c64e353c45e422f`
- `scripts/profile-dump-install/payload.sh` sha256 `aac114908adb48447d10c9b78746a060daeece775deaa6801c62fc6c7ad0b0f3`
- `packages/analyzer/package.json` sha256 `3ca80a4c58522135dbff56929be5fa31e6f1f90309e06690ce8d6f5a7026dc3a`

### Download and integrity

| Field | Value |
| --- | --- |
| URL | `https://registry.npmjs.org/yaml/-/yaml-2.9.1.tgz` |
| `curl_rc` | `0` (`curl -q`, `env -i`, `--max-time 60`, `--connect-timeout 10`, `--max-filesize 2097152`) |
| tgz bytes | `112114` |
| tgz sha256 | `4ef6c54cf559b8a207b7b518378230805a1c84af239b14960e8c67c7d59de5d3` |
| sha512 (registry) | `3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==`; `sha512_match=yes` |
| Extract | `extract.py` (sha256 `18be1fc6104a8f8e97ff5061f6a2d17424aa3b905a45c6e91223a4908a6a9344`), streaming tar validation, member cap `1000`, total cap `8388608` |
| Files extracted | `233` files / `0` archive directory entries / `686297` bytes (the `0` counts tar *directory entries*, not directories on disk — `extract.py` creates parent directories implicitly) |
| Manifest | `yaml-files.sha256` (233 entries), `manifest_verify_rc=0` (`verify-manifest.log`) |
| Install target | `/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer/node_modules/yaml` |
| Version | expected `2.9.1` = actual `2.9.1` |

`unit.log`: `payload: verdict=installed version=2.9.1 files=233 sha512=yes manifest_verify=0`,
`Finished with result: success`, `status=0/SUCCESS`, `Service runtime: 1.738s`.

### Envelope (read back inside the unit)

`envelope_mismatch=none`. `memory.max=402653184`, `memory.swap.max=0`, `pids.max=32`,
`cpu.max=50000 100000`, `Type=exec`, `CPUQuotaPerSecUSec=500ms`, `TasksMax=32`.
`RuntimeMaxUSec` read via `Manager.GetUnit` → object path (`unit_path_rc=0`,
`unit_path_ok=yes`) → `Service.RuntimeMaxUSec` get-property, whole reply `t 120000000`.

Single memory gate: `MemAvailable=1651552 KiB ≥ 819200` (`meminfo_rc=0`, read once).
Peaks: `memory_peak=32501760` (≈30.9 MiB, swap 0B), `pids_peak=5`.
Terminal: `load_state=not-found / active_state=inactive / sub_state=dead / main_pid=0`,
`confirmation=settled`, no stop/retry. Exit `acceptance_exit=0`.

---

## 2. Acceptance round 1 — FAILED (expected-vs-actual tag classification)

Run directory: `/data/dsh-ecosystem-test-artifacts/runs/20261108T062026Z-profile-dump-batch-798306-21126/`

Command: `bash projects/dsh-compat-platform/scripts/profile-dump-batch/run.sh` (single run).
Envelope, readback, memory gate, yaml snapshot and terminal state were all green; the batch
failed **only** on the test verdict.

| Field | Value |
| --- | --- |
| `acceptance_exit` | `72` |
| TAP | `tests=65, pass=64, fail=1, cancelled=0, skipped=0, todo=0` |
| `acc_smoke_verdict` | `tap_pass_ne_tests` |
| `acc_yaml_snapshot` | `identical` (233 files) |
| Memory gate | `MemAvailable=1664092 KiB ≥ 819200` |
| Peaks | `memory_peak=95178752` (≈90.7 MiB), `pids_peak=23` |

### The failing case

`profile-dump — structure policy` → subtest `a vendor tag is refused, and only its class is
reported` (`tests/profile-dump.test.js:272`, assertion at `:281`):

```
expected: 'EXTERNAL'
actual:   'CORE_NOT_ALLOWED'
```

**This was a test-expectation error, not an implementation bug.** The input is
`name: !!python/object:foo.Bar`. In YAML, `!!` is the standard **tag handle** for
`tag:yaml.org,2002:`; it is not a vendor classification. So `!!python/object:foo.Bar`
expands to `tag:yaml.org,2002:python/object:foo.Bar` — a non-whitelisted tag **in the core
namespace**. `tagClass` classifies by the expanded-URI prefix, so it correctly reports
`CORE_NOT_ALLOWED`. The test's previous expectation (`EXTERNAL`) was wrong; the genuinely
*external* case is a verbatim `!<…>` tag whose URI is outside the yaml.org namespace, which is
tested separately and still expects `EXTERNAL`.

The change was **not** merely flipping one expectation. The `!!python/…` case now asserts
`CORE_NOT_ALLOWED`, and the genuinely tricky side — that a truly *external* tag is still
classified `EXTERNAL` without leaking its URI — was **strengthened** at the same time: the
verbatim-tag case now asserts `detail === 'EXTERNAL'` and asserts that none of the URI text
(`internal.example.invalid`, `https://`, `key`) appears in the summary. The implementation was
**not** changed to accommodate the old, wrong expectation. Current test file sha256:
`93c74e522bf19b2a71dbead4bf86e5fac81dfda0c0df283719931f3005579382`.

---

## 3. Acceptance round 2 — PASSED

Run directory: `/data/dsh-ecosystem-test-artifacts/runs/20261108T062549Z-profile-dump-batch-798957-25141/`

Preflight hash check (matched the approved bytes before the run):

- `run.sh` sha256 `2089f8e44b9f20d2162a406a1aa4dce0395619735f77a61b1cae9818b9788f1c`
- `payload.sh` sha256 `defa2ef7f1d7f0d12bf465558ea4a0d737269d5255be0ff14761264fc880f20d`
- `tests/profile-dump.test.js` sha256 `93c74e522bf19b2a71dbead4bf86e5fac81dfda0c0df283719931f3005579382`

Command: `bash projects/dsh-compat-platform/scripts/profile-dump-batch/run.sh` (single run).

| Field | Value |
| --- | --- |
| `acceptance_exit` | `0` |
| `systemd_run_rc` / `payload_rc` | `0` / `0` |
| `write_failures` | `0` |
| selected inputs | `9`, `hashes=identical`, `hash_rc=0` |
| TAP | `tests=65, pass=65, fail=0, cancelled=0, skipped=0, todo=0` |
| `acc_smoke_verdict` | `pass` |
| `acc_yaml_snapshot` | `identical` (233 files) |
| `node_rc` | `0`, stderr `0` bytes |

### Envelope (read back inside the unit)

`envelope_mismatch=none`. `memory.max=402653184`, `memory.swap.max=0`, `pids.max=32`,
`cpu.max=50000 100000`, `Type=exec`, `CPUQuotaPerSecUSec=500ms`, `TasksMax=32`.
`RuntimeMaxUSec`: `Manager.GetUnit` → object path (`unit_path=/org/freedesktop/systemd1/unit/
profile_2ddump_2dbatch_2d20261108T062549Z_2d798957_2d1753_2eservice`, `unit_path_rc=0`,
`unit_path_ok=yes`, single non-empty reply line) → `Service.RuntimeMaxUSec` get-property, whole
reply `t 120000000` → `acc_runtime_usec=120000000` (`source=busctl`).

Single memory gate: `MemAvailable=1703588 KiB ≥ 819200` (`meminfo_rc=0`, read once).

Peaks: `memory_peak=97046528` (≈92.6 MiB, swap 0B), `pids_peak=23`.

Terminal: `load_state=not-found / active_state=inactive / sub_state=dead / main_pid=0`,
`confirmation=settled`, `stop_attempted=no`, no auto-retry. `unit.log`:
`Main processes terminated with: code=exited, status=0/SUCCESS`, `Service runtime: 1.535s`,
`Memory peak: 92.5M (swap: 0B)`.

yaml dependency snapshot: before/after both 233 files, `diff` empty (`yaml-manifest-diff.txt`
0 bytes). This is a two-point regular-file snapshot only — it does not prove installation
integrity or provenance. What §1 actually establishes is narrower: the extracted content matches
fixed digests (tgz sha256, registry sha512, per-file manifest over the extracted files) on this
machine and at this moment. None of it proves where the tarball came from or that it was not
altered at the source.

---

## 4. Deviations and limitations

- **Test expectation, not code, was corrected** between rounds (§2). The implementation
  (`src/profile-dump.js` `tagClass`, by expanded-URI prefix) was left unchanged.
- **Single file, not the full suite.** Only `tests/profile-dump.test.js` ran (65 cases). The
  other analyzer test files are out of scope for this batch.
- **Not a real-DSH-host verification.** The real `yaml` library *is* what the suite exercises,
  but inside a real DSH host nothing here is verified: profile loading, config/plugin schema
  conformance, and `!!js` expression evaluation are all unexercised; the suite asserts on this
  package's own summary, not on DSH behavior.
- **Raw evidence is not published here.** The run directories live on this machine under
  `/data/dsh-ecosystem-test-artifacts/runs/`; the three full absolute paths are listed in §5.
  They are not part of the repository and are not downloadable.

## 5. Evidence paths

- Install: `/data/dsh-ecosystem-test-artifacts/runs/20261108T061801Z-profile-dump-install-797979-14681/`
- Round 1 (fail): `/data/dsh-ecosystem-test-artifacts/runs/20261108T062026Z-profile-dump-batch-798306-21126/`
- Round 2 (pass): `/data/dsh-ecosystem-test-artifacts/runs/20261108T062549Z-profile-dump-batch-798957-25141/`
