# Read-only diagnostics GUI — boundary design

> Version: v1.0　　Date: 2026-11-08　　Related modules: `projects/dsh-compat-platform/packages/host`, `packages/analyzer`
>
> **Confirmed decisions (pre-existing, restated; none newly made here)**:
> - **The envelope is the contract.** `dsh-compat-diagnose` emits one JSON document whose version string is `dsh-compat-diagnose/0.1-draft.1` (`packages/analyzer/src/diagnose-internal.js:66-77`), and `certification` is literally `false`, `correlation` literally `not-established`. Any view of it must keep those literals visible, not soften them.
> - **No second HTTP server.** Roadmap P3 says "Do not create another HTTP server, Loader, registry or skill manager" (`docs/requirements-and-design/2026-11-04-platform-next-roadmap-dev-plan.md`, P3).
> - **Production is off limits.** Port 3080 and `/root/.dsh` stay untouched unless separately authorised; the gate requires an *explicitly authorized isolated development GUI* (same roadmap, P3 gate).
> - **The GUI must not become the analysis.** Historical records reject "dump the config and call it loadability": a view of a report is not evidence of a plugin loading, activating or being compatible.
>
> This document **proposes** one narrow increment. Everything about a real client-UI package, in-process analysis and multi-envelope navigation is `[Pending]` with a lean, not a verdict.

## 1. Requirement overview

The question: **what is the smallest graphical surface that displays what the diagnostics already produce, without inventing a second product?**

Core points:

- **Display only.** The page renders one diagnostic envelope that already exists on disk. It performs no analysis, reads nothing else, and writes nothing anywhere.
- **Reuse the host that exists.** DSH already owns an HTTP carrier and a route-registration contract; a compat page is one more named route on it, not a server of its own.
- **Refuse to upgrade the envelope.** A green page must not read as "everything works". The page shows `certification: false` and `correlation: not-established` as first-class content, alongside the per-source outcomes and every `limitation` code.
- **Stay inside what can be verified here.** No browser binary is installed in this workspace (checked: no `chromium`, `chromium-browser`, `google-chrome`, `firefox` on `PATH`; no puppeteer cache). Browser *rendering* therefore cannot be claimed from this machine, and the record must say so rather than imply it.

Out of scope for this increment: a client-UI package (sidebar tab / in-app route), live re-analysis, comparing two envelopes side by side, any write or repair action, and any change to the analyze/diagnose libraries.

## 2. Current state analysis

### 2.1 What exists in the platform repo

```
projects/dsh-compat-platform/packages/
  analyzer/          real code — static/admission/runtime diagnostics, combined report,
                     snapshot diff, profile dump, unified `diagnose` entry + CLI
  host/              .gitkeep only — no package.json, no code
  client/            .gitkeep only
  runtime/           .gitkeep only
```

Evidence: `ls packages/host` → `.gitkeep`. So there is no host-side package to extend and no packaging decision to honour; this document makes the first one.

The envelope itself is produced by `packages/analyzer/src/diagnose-cli.js` (bin `dsh-compat-diagnose`, `package.json` `bin` + `exports` `./diagnose` / `./diagnose-cli`) and validated shape-wise by `diagnoseExitCode` in `packages/analyzer/src/diagnose.js`, which refuses a malformed report with a fixed `TypeError`.

### 2.2 What the installed DSH (0.2.2-rc.1) offers, and what it costs

Two very different extension surfaces exist, and the difference decides this design:

| surface | evidence | cost to use from this repo |
| --- | --- | --- |
| **Client UI package** — a browser plugin registering React components into declared UI slots | `packages/experimental/client-ui-forge/package.json` declares `"dsh": { "client": { "inject": [...], "platform": "web" } }`, `exports["./client"]`, and a `bundle` script running `tsdown`; `src/client/index.ts` exports `apply(ctx)` and `inject`; `src/client/mount.ts` registers into `slots`, `sidebarRightTabs`, `sessions` | TypeScript + React + a bundler (`tsdown`) + `declare module` type augmentation, and a slot declared by a parent package. This repo has **no build step today** and the plugin kit explicitly defers it: `projects/dsh-plugin-kit/src/scaffold.js:87` — `'client': 'Deferred: no generated client code until the actual client registration signature and build artifacts are reviewed and smoke-tested against a real host.'` |
| **Host plugin** — a plain function plugin using host services | `packages/host/open-in-app/src/index.ts:81-83` `export const name`, `export const inject = ['webServer', ...]`, `:138` `export function apply(ctx, config)`, `:193` `ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), label)` | plain ESM JavaScript, **no bundle**, no React. Runs on Node 24 as-is. |

The host carrier's contract (`packages/host/webserver/src/index.ts`):

- `declare module '@deepseek-ai/cordis' { interface Context { webServer: WebServer } }` (`:28-34`) — the service a plugin injects.
- `WebRoute` = `{ kind: 'exact' | 'prefix', path, handler(req, res) }` (`:52`), `WebResourceRoute` = `{ kind, path, resource(request, peer?) }` (`:68`), both registered through `register(route)` which "returns a disposer that removes the registration" (`:445`).
- The server "serves no files — the `/api` bridge, plugin bundles, the HMR event stream and the SPA dist belong to the plugins that register them" (package README, summary). A compat page is exactly such a plugin-owned route.

So the host surface costs nothing new and the client surface costs a build chain that the kit already decided not to generate before its signature is smoke-tested. **This increment takes the host surface and says so in the non-claims**, rather than pretending a host route is the native client page the roadmap eventually wants.

### 2.3 The gap table

| ID | Current | Required for this increment |
| --- | --- | --- |
| D1 | `packages/host` is an empty placeholder | One package with a manifest, a plugin entry and tests |
| D2 | Nothing renders an envelope outside the terminal | A read-only HTML view of one envelope |
| D3 | No route exists on the host carrier for compat data | Two exact routes, both read-only, both loopback-only |
| D4 | No isolated GUI launch path exists in this repo | A bounded launcher that boots a **separate** DSH home and a free port, never 3080 |
| D5 | Non-claims live only in prose | The page itself states `certification: false`, `correlation`, and limitations, so a screenshot cannot be over-read |

## 3. Proposed design

### 3.1 Package

`projects/dsh-compat-platform/packages/host/` — `@dsh-ecosystem/dsh-compat-diagnostics-ui` (private, `type: module`, no dependencies beyond Node built-ins and the analyzer package by **relative path inside the same repo**).

Plain ESM JavaScript, no build step, no bundler, no React. Rationale: the deliverable is one page showing one document; a bundler would add a compilation artefact whose absence of browser verification would then be the weakest link (see §6).

### 3.2 Routes

| route | kind | method | answer |
| --- | --- | --- | --- |
| `/compat-diagnostics` | `exact` | `GET`/`HEAD` | one self-contained HTML document (inline CSS, inline JS, no external host, no build artefact), 200 |
| `/compat-diagnostics/envelope` | `exact` | `GET`/`HEAD` | the envelope JSON **verbatim**, `application/json`, 200 |
| anything else on those paths | — | other methods | `405` with `Allow: GET, HEAD` |

The page fetches its own `/compat-diagnostics/envelope` — a same-origin request to the composition's carrier — and renders:

- header: `diagnoseVersion`, and the two literals `certification: false`, `correlation: not-established` **always visible**, never a green badge;
- one card per named source (`profile`, `combinedReport.channels.static|runtime|admission`) with `state` (`provided` / `absent`), `outcome`, the block's `issues[].code` list and, when present, the lane `result.summary`;
- a `limitations` list rendered in full, never truncated;
- `nextSteps` with code, source and message;
- profile `entryDiagnostics` count and the dump's own refusal/diagnostic classes.

The page is **plain text and lists**. No charts, no colours that imply success, no "score".

### 3.3 Where the envelope comes from

The plugin takes exactly one configured envelope path (`config.envelopePath`), resolved once at load:

- read at request time (so a re-run of the CLI is reflected without restarting), bounded by the same 1 MiB ceiling the analyzer uses for inputs;
- parsed and **shape-checked** before serving (`diagnoseVersion` string, `certification === false`, `correlation` string, `combinedReport` object-or-null, `profile` object) — a document that fails the check is answered `503` with a fixed `ENVELOPE_UNREADABLE` body and the reason code, never a half-rendered page;
- nothing else is read: no directory scan, no glob, no second file, no environment probe.

`[Pending] lean: keep exactly one envelope path per plugin instance.` Multiple envelopes want a selector, a selector wants an index, an index is a scan — and a scan is a trust-surface change that deserves its own review.

### 3.4 Trust boundary

- **Loopback only.** The route answers only when the request's `Host` header names the loopback authority the carrier bound (`127.0.0.1` or `::1` with the actual port); any other `Host` is `403`. This is a deliberate, small fence, not the composition's authentication.
- **The composition's own fence is not replaced.** When the plugin is composed inside the real Web profile, the `connection` service's Host/Origin rejection (`packages/host/open-in-app/src/index.ts:1-14` describes that fence) is what a real page must go through. `[Pending] lean: when `connection` is present, delegate to it first and treat its rejection as final; this increment injects only `webServer` because the isolated composition has no connection service, and the record must state that the shipped page relies on the loopback fence alone.`
- **No writes of any kind**: no file, no socket beyond the response, no child process, no model call, no telemetry.

### 3.5 Isolated launch, and how it is bounded

`scripts/diagnostics-gui-run/{run.sh,payload.sh,README.md}` — same discipline as `diagnose-real-wiring`:

- separate `HOME`, `DSH_HOME`, `TMPDIR` under the run directory; production `/root/.dsh` untouched by construction;
- a **free high port** chosen and asserted (`≠ 3080`), `host: 127.0.0.1`;
- 384 MiB `/ swap 0 / 32 tasks / 50 % CPU / 120 s` envelope, node heap 192, one `MemAvailable ≥ 819200 KiB` gate, shared `flock -n`, terminal `MainPID=0` readback;
- the workload boots the host composition with the plugin, issues `GET /compat-diagnostics`, `GET /compat-diagnostics/envelope`, a `POST` (expect `405`), a foreign-`Host` request (expect `403`), and a request for an unregistered path (expect `404`), recording status, `content-type`, byte count and a sha256 of each body;
- the page's own JS is **not** executed by the runner — that is the browser gap, declared in the record, not papered over.

`[Pending] lean: boot a minimal cordis composition (the installed `@deepseek-ai/dsh-host-webserver` + this plugin) rather than the full `dsh web` profile.` The full profile is the eventual target, but it drags the SPA, the model providers and dozens of third-party plugins into a run whose subject is one page; a minimal composition exercises exactly the carrier contract the page depends on, and the later profile boot can be a separate, separately authorised increment.

## 4. What the page must never imply

- That a plugin in `profile.yml` loads or activates — no lane in the envelope establishes loadability.
- That `clear` means compatible — `clear` means "this source raised nothing", and absent sources are `absent`/`unknown` and do not move the exit code.
- That the runtime/admission documents were observed by a host — they are documents; `certification` stays `false`.
- That a green page is a green system. The page shows `limitations` and `nextSteps` unconditionally, including `CORRELATION_NOT_ESTABLISHED` and `CERTIFICATION_NOT_CLAIMED`.

## 5. Risks

| risk | mitigation |
| --- | --- |
| A screenshot of a clean page is quoted as a compatibility statement | the two literals and the full `limitations` list are rendered as first-class content, and the page carries a fixed, non-dismissible footer stating what it does not establish |
| The page slowly grows analysis (a button that re-runs the CLI) | scope is enforced by the route table: exactly two routes, `GET`/`HEAD` only, `405` otherwise; a new route needs a new review |
| The isolated launcher is mistaken for a production deployment | launcher never touches `/root/.dsh`, asserts a non-3080 port, and the record states the port and home it used |
| A stale envelope is read as current | the JSON route's response carries `Cache-Control: no-store` and the page shows the envelope's own version and the file's mtime; staleness is visible, not hidden |
| Host-fence duplication drifts from the composition's real fence | §3.4 marks the delegation to `connection` as `[Pending]` with a lean, and the record states which fence actually ran |

## 6. Verification plan, and the one thing it cannot show

Bounded, once, under the envelope of §3.5:

1. the carrier answers `200 text/html` at the exact page path;
2. the JSON route answers `200 application/json` with a body whose sha256 equals the configured envelope file's;
3. `POST` → `405` with `Allow: GET, HEAD`; foreign `Host` → `403`; unregistered path → `404`;
4. an unreadable or mis-shaped envelope → `503` with a fixed code, page not served;
5. terminal state settled, `MainPID=0`, memory/pid peaks recorded.

**Not shown: browser rendering.** No browser binary exists on this machine. The record will state the exact URL, that the bytes were verified over HTTP, and that no browser executed the page's script — so nobody can quote this run as visual acceptance. Anything stronger needs a browser installed by explicit authorisation.

## 7. File:line quick reference

| subject | evidence |
| --- | --- |
| host package is empty | `projects/dsh-compat-platform/packages/host/` — `.gitkeep` only |
| envelope version, exit codes | `packages/analyzer/src/diagnose-internal.js:66-77` `DIAGNOSE_EXIT_CODES`, `DIAGNOSE_VERSION` |
| envelope shape refusal | `packages/analyzer/src/diagnose.js` `diagnoseExitCode` — fixed `TypeError` on a malformed report |
| host carrier service | `packages/host/webserver/src/index.ts:28-34` `interface Context { webServer: WebServer }` |
| route contract | `packages/host/webserver/src/index.ts:52` `WebRoute`, `:68` `WebResourceRoute`, `:445` `register(route)` returns a disposer |
| plugin boilerplate | `packages/host/open-in-app/src/index.ts:81` `name`, `:83` `inject`, `:138` `apply(ctx, config)`, `:193` `ctx.effect(() => ctx.webServer.register(...))` |
| client UI needs a bundle | `packages/experimental/client-ui-forge/package.json` `dsh.client`, `exports["./client"]`, `scripts.bundle = tsdown`; `src/client/index.ts` `apply(ctx)` |
| kit defers client templates | `projects/dsh-plugin-kit/src/scaffold.js:87` |
| P3 prohibition and gate | `docs/requirements-and-design/2026-11-04-platform-next-roadmap-dev-plan.md`, P3 |

## 8. Execution status (2026-11-08)

Status: **implemented and executed**; see
[`docs/testing/2026-11-08-read-only-diagnostics-gui.md`](../testing/2026-11-08-read-only-diagnostics-gui.md).

| Design item | As built |
| --- | --- |
| §3.1 package `packages/host/` | `dsh-compat-diagnostics-ui@0.0.0-draft.1`, plain ESM, **zero dependencies**, no bundler |
| §3.2 two exact routes | `/compat-diagnostics` and `/compat-diagnostics/envelope`, `GET`/`HEAD` only |
| §3.3 one configured `envelopePath` | resolved against `process.cwd()`, read per request, 1 MiB ceiling |
| §3.3 shape check | explicit fields + a final `diagnoseExitCode` guard → `503 ENVELOPE_UNREADABLE` with a closed reason |
| §3.4 trust boundary | bind authority plus `localhost:<port>` for a loopback bind; everything else `403`; methods `405` |
| §3.5 isolated launch | `scripts/diagnostics-gui-run/` — one transient unit, 384 MiB/swap 0/32 tasks/50 % CPU/120 s, single `MemAvailable` gate, flock, `MainPID=0` readback |
| §6 verification | **seven** happy-path HTTP checks and **three** refusal checks were measured, not the six sketched above |

Corrections to what this document assumed before execution:

- The launcher does not boot a profile: it composes exactly two plugins (the
  installed `WebServer` plus this one) and resolves both from the global module
  tree. Booting `dsh web` would have added the SPA, the model providers and dozens
  of third-party plugins to a run whose evidence is a handful of HTTP assertions.
- §6's "six assertions" became seven happy-path checks (`page-200-html`,
  `page-states-certification-false`, `page-states-correlation-literal`,
  `envelope-200-json-verbatim`, `post-405-with-allow`, `foreign-host-403`,
  `unknown-path-404`) plus three refusal checks on both routes.
- The carrier steps run **without** `--unshare-net`: a fresh network namespace has
  its loopback interface down, so the probe would have measured the sandbox rather
  than the page. This is recorded as a deviation in both the record and the slice
  README.
- Two defects the first round exposed are fixed in bytes: an assignment to a
  function's read-only `name` in the composition, and an over-permissive `Host`
  allowlist that admitted a loopback literal the carrier was not listening on.
- **Not shown, unchanged:** no browser rendered the page. No browser binary exists
  on this machine. The HTML bytes were fetched and inspected as text; the page's
  inline script never executed. Nothing here is visual acceptance.
