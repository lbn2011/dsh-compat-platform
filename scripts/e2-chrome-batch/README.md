# `e2-chrome-batch` — E2 headless Chrome heavy test suite (Phase 5)

Bounded slice for `packages/host`. It runs only through the bounded runner, one run at
a time, with the absolute path:

```
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/e2-chrome-batch/run.sh
```

(a relative path is refused with exit 77). Status: **executed.** The `e2-chrome-batch`
unit prefix is in `scripts/bounded-runner/policy.sh` and `core.manifest` matches. Run
ids, results and resource peaks are kept in the test records, not here:
[`docs/testing/2026-11-19-ui-phase3-5.md`](../../docs/testing/2026-11-19-ui-phase3-5.md)
(first round) and
[`docs/testing/2026-11-19-ui-phase3-5-repair.md`](../../docs/testing/2026-11-19-ui-phase3-5-repair.md)
(after the review fixes).

## What it runs

`payload.sh` runs three steps in order inside the transient unit; any failure stops the run.

1. **chrome-live**: launches the real Chromium through `ChromeDriver.launch()`, loads a
   one-page local server on an OS-assigned port and checks `captureDOM()`.
   `chrome-live-rc.txt`.
2. **ui-e2e** (`ui-e2e.mjs`): serves the real `renderPage()` HTML on an OS-assigned
   port (never 3080). `/api/*` is answered by the real `createHostApi()` routes, backed
   by the real `createConflictService()` and the real `dsh-compat-repair` package
   working on a `mkdtemp` copy of `examples/repair/profile.yml`. It checks the
   "down" state (503 shows 「未就绪」 and never 「未检测到冲突」), a real C2 conflict, the
   severity filter, a stale preview that keeps apply disabled, a ready preview with its
   edit line, diff and planDigest, invalidation on edit, the 409 for a missing server
   approval, and an approved apply sent once on a double click that rewrites the copy
   and keeps `.before`. Every wait counts as a check, and the screenshot check reads the
   PNG signature. `ui-e2e-rc.txt`, `ui-e2e.log`, `ui-phase3-4.png`.
3. The full host suite:
   `node --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.js'` in
   `packages/host`. `tap-summary.txt`, `tap-verdict.txt`.

## Limits

| Resource limit | Value | Reason |
| --- | --- | --- |
| MemoryMax | 384 MiB, swap 0 | standard bounded-runner policy |
| CPUQuota | 50% | standard |
| RuntimeMaxSec | 120 s | standard |
| **TasksMax** | **256** | Chromium starts renderer, GPU and zygote helpers |

TasksMax 256 comes from the read-only constant `BR_TASKS_CHROME` in `policy.sh` and is
selected only for the `e2-chrome-batch` unit prefix. No environment variable or
argument can raise it, and every other slice keeps `BR_TASKS=32`.

## Chromium

The transient unit does not inherit `CHROME_PATH` (run.sh passes no `--setenv`), so
`payload.sh` always discovers the binary: `/usr/bin/chromium` (the Debian package
installed on this machine), `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`, then
the first executable `chrome` under `/data/chromium`. The chosen path is recorded in
`chrome-path.txt`. puppeteer-core is an optional peer dependency of `packages/host`,
installed in `packages/host/node_modules` (gitignored) and not bundled.

## Inputs

`run.sh` declares every input file to the runner: this README, `ui-e2e.mjs`, the host
`package.json` and README, all of `packages/host/src/**` and `tests/**`,
`packages/repair/src/**`, `packages/analyzer/src/conflict-service.js` and
`conflict-detector.js`, and `examples/repair/profile.yml`.

## Files

| File | Purpose |
| --- | --- |
| `packages/host/src/chrome-driver.js` | Wrapper around puppeteer-core with a lazy import. `launch()` rejects with `PuppeteerNotAvailable` when the import fails; caller options cannot replace `executablePath`, `headless` or `BASE_LAUNCH_ARGS`. |
| `packages/host/tests/chrome-driver.test.js` | Unit tests with fake Browser/Page objects; `launch()` is tested through its `importModule` seam. |
| `scripts/e2-chrome-batch/ui-e2e.mjs` | The browser E2E described above. |

The host plugin mounts **no** `/api/chrome-capture` route (宿主内没有 chrome-capture 接口).
Nothing in the host starts a browser; Chromium only runs inside this slice.

## Exit codes

`0` green · `70` wrapper/usage/envelope-entry refusal · `71` syntax/static contract failed ·
`72` chrome-live, ui-e2e, verdict or hash failure · `73` evidence gate/write failure ·
`74` timeout or signal · `75`–`78` core-envelope refusals (see `scripts/bounded-runner`).

## What a green run establishes, and what it does not

It establishes that on these bytes, inside the envelope, the real Chromium launches,
the real page drives the real host routes as described above, and the full host suite
passes. It does **not** establish anything about the DSH Web GUI on port 3080: the
installed copy there is a separate tarball, and its repair routes need
`dsh-compat-repair` in the same `node_modules` (otherwise they answer 503).
