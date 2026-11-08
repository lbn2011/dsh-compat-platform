# Read-only diagnostics GUI — bounded execution record (2026-11-08)

> **Later shape change (2026-11-09).** The envelope the GUI serves is now
> `dsh-compat-diagnose/0.2-draft.1` and the page renders its `provenance` array under "Baseline
> per source"; the host suite grew from 15 to 16 tests. The `15/15` below describes the earlier
> bytes and is not additive. Current numbers: [2026-11-09-diagnose-provenance.md](2026-11-09-diagnose-provenance.md).

Status: **EXECUTED**. Two bounded rounds under the acceptance envelope; the second
is green. Round 1 is recorded in full, including the three defects it exposed and
the fix for each.

This record is evidence about one carrier process, one page route and one JSON
route on one loopback port. It is **not** a compatibility, loadability or
certification result, and `certification` stays `false` in every document served.

## 0. Scope and non-claims

What this run establishes:

1. The installed `@deepseek-ai/dsh-host-webserver` accepts this plugin into a
   composition and listens on a loopback port the OS assigned.
2. At that exact origin, `GET /compat-diagnostics` answers `200 text/html` with
   the page that states `certification: false` and `correlation: not-established`
   before any data.
3. `GET /compat-diagnostics/envelope` serves the envelope **byte for byte**: body
   sha256 equals the file's sha256, so the page's data source can be checked.
4. `POST` → `405` with `Allow: GET, HEAD`; a foreign `Host` → `403`; an
   unregistered path → `404`.
5. A missing envelope → `503 {code:"ENVELOPE_UNREADABLE",reason:"ENVELOPE_MISSING"}`
   on **both** routes, and the page route does not fall back to serving HTML.
6. The package's own 15 unit tests pass on these bytes.

What this run does **not** establish, and must never be quoted as establishing:

- **No browser rendered anything.** No browser binary exists on this machine and
  none was installed. The HTML bytes were fetched over HTTP and inspected as text;
  the page's inline script never executed. This is not visual acceptance.
- **No plugin was loaded, activated or exercised.** The envelope's own lanes come
  from synthetic example documents; nothing here loads a DSH plugin.
- **No host observed the evidence documents**, and `correlation` remains
  `not-established`.
- The production GUI at `http://127.0.0.1:3080` was untouched: this run bound an
  OS-assigned high port, and the payload asserts the port is not `3080`.
- This is not the full package test suite; it is one selected test file.

## 1. What was built

| Piece | Path | Role |
| --- | --- | --- |
| Host plugin | `packages/host/src/index.js` | `name`, `inject: ['webServer']`, `apply(ctx, config)`; registers exactly two `kind: 'exact'` routes through one `ctx.effect` |
| Bounded reader | `packages/host/src/envelope.js` | 1 MiB ceiling, closed refusal reasons, shape gate, final `diagnoseExitCode` guard |
| Page | `packages/host/src/page.js` | self-contained HTML, CSP `default-src 'none'`, `textContent` only, no build step |
| Unit tests | `packages/host/tests/gui.test.js` | 15 tests over a fake carrier and real files in `mkdtemp` |
| Composition | `scripts/diagnostics-gui-run/boot.mjs` | two plugins only: installed `WebServer` + this plugin |
| Probes | `scripts/diagnostics-gui-run/probe.mjs` | HTTP assertions, happy path and refusal path |
| Launcher | `scripts/diagnostics-gui-run/run.sh` | one transient unit, shared lock, hash manifests, terminal readback |
| Payload | `scripts/diagnostics-gui-run/payload.sh` | envelope self-check, gates, workload, verdicts |

Routes and fence: `/compat-diagnostics` and `/compat-diagnostics/envelope`, both
`kind: 'exact'`; `GET`/`HEAD` only; the `Host` header must be the carrier's own
bind authority, or `localhost:<port>` when the carrier is bound to a loopback
literal.

## 2. The composition, and why it is this small

The subject of the batch is one route pair on the carrier contract. Booting the
full `dsh web` profile would drag the SPA, the model providers and dozens of
third-party plugins into a run whose evidence is a handful of HTTP assertions.
`boot.mjs` therefore composes exactly two plugins and resolves both from
`/www/server/nodejs/v24.21.0/lib/node_modules` by `require.resolve`, so the
composition uses the **installed** carrier rather than a copy.

Two deliberate deviations from the CLI-case sandbox, both about the sandbox
itself:

1. **No `--unshare-net`.** A fresh network namespace has its loopback interface
   down, so a loopback listener would be unreachable and the probe would measure
   the sandbox instead of the page.
2. **`--bind $gui_dir $gui_dir`** on top of `--ro-bind / /`, so the child can
   write its readiness file and the probe its report. Everything else stays
   read-only.

## 3. Rounds

### Round 1 — `20261108T152206Z-diagnostics-gui-837028-3353`

Unit `diagnostics-gui-20261108T152206Z-837028-2376.service`. `acceptance_exit=72`,
`write_failures=0`, `terminal_ok=yes` (`settled`), `hashes=identical`,
`selected_inputs=16`, `mem_available_kib=1179080` (gate 819200),
`memory_peak=46686208`, `pids_peak=20`, unit CPU 1.046 s.

| Stage | Result |
| --- | --- |
| Envelope self-check | `envelope_mismatch=none` |
| Static contract | `static_contract_rc=0` |
| Dependencies | `deps_rc=0` (yaml 2.9.1; cordis 4.0.5; dsh-host-webserver 0.2.1-rc.2) |
| Two-point yaml snapshot | 233 files, `identical` |
| CLI envelope step | exit `1` (expected), `provided=4 absent=0 clear=3 attention=1 invalid=0 error=0 next_steps=1` |
| Carrier (happy) | **failed**: `ready=missing`, `carrier_exit=1` |
| Carrier (refusal) | **failed**: `ready=missing`, `carrier_exit=1` |
| Test file | **failed**: 15 tests, 14 pass, 1 fail |

Three defects, all found by this round and all fixed in bytes (not worked around):

1. **`boot.mjs` crashed the composition.** `Object.assign(guiApply, {name, inject})`
   threw `TypeError: Cannot assign to read only property 'name' of function`.
   A function's own `name` is read-only. Fixed by handing cordis a fresh record:
   `const gui = { name: guiName, inject: guiInject, apply: guiApply }`.
2. **`allowedAuthorities` was too permissive.** For a `::1` bind it admitted
   `127.0.0.1:<port>` and `localhost:<port>` as well as `[::1]:<port>`; the test
   asserted only the bind authority. The test was right about the reachable set:
   the carrier does not listen on the other literal, so a request naming it
   cannot arrive, and admitting it widens the fence for no reachable reason. The
   **implementation** was tightened to the bind authority plus `localhost:<port>`
   for a loopback bind, and the test was updated to that narrower contract.
3. **The payload pointed at a file the CLI never writes.** `ENVELOPE_FILE` named
   `$env_dir/envelope.json`, but the CLI writes the envelope to **stdout**; the
   byte count therefore read `unavailable`. Fixed by pointing the envelope at
   `$env_dir/stdout.json`, which is exactly the bytes the JSON route serves.

Nothing was retried until green: round 2 differs from round 1 in three files
(`src/index.js`, `tests/gui.test.js`, `scripts/diagnostics-gui-run/{boot.mjs,payload.sh}`)
and in nothing else.

### Round 2 — `20261108T152433Z-diagnostics-gui-837605-15948`

Unit `diagnostics-gui-20261108T152433Z-837605-25064.service`. `acceptance_exit=0`,
`payload_rc=0`, `write_failures=0`, `terminal_ok=yes` (`settled`, `MainPID=0`),
`hashes=identical` (16/16 selected inputs, before and after),
`mem_available_kib=1225256` (gate 819200), unit CPU 1.554 s.

| Stage | Measured |
| --- | --- |
| Envelope self-check | `envelope_mismatch=none` |
| Syntax | `run.sh` 0, `payload.sh` 0, `node --check` failures none |
| Static contract | `static_contract_rc=0` |
| Dependencies | `deps_rc=0` — yaml 2.9.1, cordis 4.0.5, dsh-host-webserver 0.2.1-rc.2 |
| Two-point yaml snapshot | 233 files, `identical` |
| CLI envelope step | exit `1` (expected), 5988 bytes |
| Carrier (happy) | `origin=http://127.0.0.1:41825`, `carrier_exit=143` (SIGTERM, as designed) |
| Carrier (refusal) | `origin=http://127.0.0.1:43311` |
| Test file | `exit=0`, 15 tests, 15 pass, 0 fail |
| Peaks | `memory_peak=46383104`, `pids_peak=27` |

HTTP assertions, as captured (not summarised): page `200 text/html; charset=utf-8`,
8737 bytes, containing both literals; envelope `200 application/json;
charset=utf-8`, 5988 bytes, body sha256 `dccb3f616e720595d5c13c944e35f7a048eae8f5d74d4a916f019afba2cd50d0`
equal to the file's; `POST` → `405` with `allow: GET, HEAD` and body
`{"code":"METHOD_NOT_ALLOWED","allow":"GET, HEAD"}`; foreign `Host: example.test`
→ `403 {"code":"HOST_NOT_ALLOWED"}`; unknown path → `404` with an empty body;
missing envelope → `503 {"code":"ENVELOPE_UNREADABLE","reason":"ENVELOPE_MISSING"}`
on both routes with no HTML served.

## 4. What stays forbidden to claim

- "The GUI works" as a user-facing statement. What was measured is two routes
  answering over HTTP on one loopback port in one isolated composition.
- "Rendered", "displays correctly", "screenshot", "visually verified" — no
  browser ran.
- "Integrated with DSH" — the plugin was composed with the installed carrier
  service directly; no profile, no bundle resolution, no plugin manager.
- Any number here as a compatibility or certification score. `certification` is
  `false` in the served envelope and in `combinedReport`.

## 5. Reproducing

```
bash projects/dsh-compat-platform/scripts/diagnostics-gui-run/run.sh
```

Raw artifacts live outside the repository under
`/data/dsh-ecosystem-test-artifacts/runs/<stamp>-diagnostics-gui-<pid>-<rand>/`
(`status.txt`, `envelope-*.txt`, `static-contract.json`, `deps.json`,
`envelope-step/`, `gui-ok/`, `gui-refusal/`, `test-file/`, `hashes-*.txt`,
`peaks.txt`, `journal.txt`). Only this narrative is committed; a clone cannot
download those artifacts — see `docs/testing/runs/README.md`.

## 6. Selected inputs at commit

| File | sha256 |
| --- | --- |
| `scripts/diagnostics-gui-run/run.sh` | `51c55198a7432bb106699ea4ba2f4d3556eb1477d87a975fcd58db6f1f22b800` |
| `scripts/diagnostics-gui-run/payload.sh` | `b4588367bfdacef7a76cc5ebfb8cf6fad056fb494b2260223b8c5462210a920a` |
| `packages/host/package.json` | `e74c975e76ec7285aaef25ba854c70de00a6fd4543175e106ffe7980d2478b7a` |
| `packages/host/src/index.js` | `b46610d4eddfb4b77e485e74f10a403d7c2b210a8c24791c0aa90a5ad30c212e` |
| `packages/host/src/envelope.js` | `a0fbd3bbace82b79dee98373def979aa3d4da29f1a02462aac4e7fac2ee9f030` |
| `packages/host/src/page.js` | `fff01966ca89ea0ed5cecec5ace34acbd11c48f3f09b520dcb76c8ce47c3857e` |
| `packages/host/tests/gui.test.js` | `12e6b7cb8cb8677fa95a8db546d02c57958847dee5b387ec1e53dbe450d79b24` |
| `examples/diagnose/profile.yml` | `bf4cdb0e5ca124c77c57601ab1dc51cd9ddf614f6791c2155e57e1adb385bf7d` |
| `examples/diagnose/runtime-evidence.json` | `f1968b084fe48115e4d676c872c7ac8f9e901d3dad015ac9f7060d8effa6d4de` |
| `examples/diagnose/admission-evidence.json` | `f633199123bdb87564763eb2902dc9fa0f8c332b8c3ca34d4640f33bc149a323` |
| `packages/analyzer/fixtures/clean.json` | `0f278eea33cee61ea6bf90798db57e378f40998d7ed762c71b091848c74516ac` |

`scripts/diagnostics-gui-run/{boot.mjs,probe.mjs}` are executed by the payload but
are not in the selected-input set; their bytes at commit are recorded in the
slice README so a reader can still tell whether the executed bytes changed.
