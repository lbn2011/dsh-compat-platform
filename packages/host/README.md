# `dsh-compat-diagnostics-ui` (host package)

A **host plugin** that serves one read-only view of an existing diagnostic
envelope on the composition's own `webServer` service, plus diagnostic API routes
(page snapshot, frontend log, conflict report, repair preview/apply). It analyses
nothing itself.

**It has exactly one write path:** `POST /api/repair-apply`, which rewrites one
allow-listed document inside the configured `repair.root` (keeping a `.before`
copy). That route is off unless `repair.applyEnabled` is `true`, and it applies
only a plan whose approval file an operator has put into `repair.approvalsDir`.
Every other route reads only. See [Repair routes and their trust boundary](#repair-routes-and-their-trust-boundary).

Status: **EXECUTED** — earlier rounds on 2026-11-08 (second green, 15/15 tests,
seven HTTP assertions) and a later bounded round on 2026-11-11 covering the
Chinese page and the browser half (22/22 tests, hashes identical; the round before
it caught a rendering defect the suite could not — see the record's §2.5).
Records: [`docs/testing/2026-11-08-read-only-diagnostics-gui.md`](../../docs/testing/2026-11-08-read-only-diagnostics-gui.md)
and [`docs/testing/2026-11-11-host-page-and-client.md`](../../docs/testing/2026-11-11-host-page-and-client.md).
Design: [`docs/requirements-and-design/2026-11-08-read-only-diagnostics-gui-design.md`](../../docs/requirements-and-design/2026-11-08-read-only-diagnostics-gui-design.md).

## What it is not

- Not a second HTTP server: it registers routes on the carrier the composition
  already booted.
- Not a Loader, a registry, a skill manager or a plugin manager.
- Not a client-UI package. A native client surface needs a `dsh.client` bundle and
  a `tsdown` build step this repository does not have; that is deliberately
  deferred rather than faked.
- Not an authentication story. When composed inside the shipped Web profile, the
  composition's `connection` service owns the real `Host`/`Origin` and login-token
  gate; this plugin's fence sits **behind** it.

## Contract

```js
export const name = 'dsh-compat-diagnostics-ui'
export const inject = ['webServer']
export function apply(ctx, config) // config: { envelopePath, pagePath?, envelopeRoutePath?, includeMessageText?, repair? }
```

- `envelopePath` — required, non-empty; resolved against `process.cwd()`.
- `pagePath` — defaults to `/compat-diagnostics`.
- `envelopeRoutePath` — defaults to `/compat-diagnostics/envelope`.
- `repair` — optional `{ root, documents, applyEnabled?, approvalsDir? }`; see below.
  Absent or with no documents, the repair routes answer `503 REPAIR_NOT_CONFIGURED`.
- Route paths must be absolute pathnames without a trailing slash, and the two
  must differ. Both routes are `kind: 'exact'`.
- There is no schemastery `Config` on purpose: this package declares **no
  dependencies at all**, so a schema would buy coercion the page does not need. A
  bad config throws a `TypeError` naming the field.

## Routes

| Route | Method | Answer |
| --- | --- | --- |
| `/compat-diagnostics` | `GET`, `HEAD` | `200 text/html; charset=utf-8` — the page |
| `/compat-diagnostics/envelope` | `GET`, `HEAD` | `200 application/json; charset=utf-8` — the envelope bytes verbatim, with `x-envelope-sha256` |
| either | anything else | `405 {"code":"METHOD_NOT_ALLOWED","allow":"GET, HEAD"}` |
| either | foreign `Host` | `403 {"code":"HOST_NOT_ALLOWED"}` |
| either | unreadable/mis-shaped envelope | `503 {"code":"ENVELOPE_UNREADABLE","reason":…}` — the page is **not** served |

Admitted authorities: the carrier's own bind authority at its own port, plus
`localhost:<port>` when the carrier is bound to a loopback literal. The other
loopback literal is deliberately **not** admitted: the carrier is not listening on
it, so a request naming it cannot arrive, and admitting it would widen the fence
for no reachable reason.

## Reading discipline

`src/envelope.js` never trusts the file:

- 1 MiB ceiling, checked before and after the read;
- closed refusal vocabulary — `ENVELOPE_MISSING`, `ENVELOPE_UNREADABLE`,
  `ENVELOPE_TOO_LARGE`, `ENVELOPE_NOT_JSON`, `ENVELOPE_SHAPE` — so no filesystem
  detail leaks into a response;
- `provenance` must be an array: the envelope's per-source baseline projection is the
  field that stops a reader assuming every source names a commit, so a page that
  dropped it would be worse than one that never showed it;
- explicit field checks name the field that failed, and a final local contract
  check re-tests the two facts this router relies on and the field checks do not
  cover: the `correlation` literal, and the closed outcome word of every lane
  block that is present. A disagreement is reported as
  `{reason: 'ENVELOPE_SHAPE', field: 'contract'}`.

  This check used to call `diagnoseExitCode` from the analyzer across a relative
  path. That made the package uninstallable from a tarball — `../../analyzer/src/diagnose.js`
  does not exist outside the checkout — so the two facts it added are now checked
  here instead. The analyzer remains the owner of the deeper block-shape rules; a
  reader who needs them calls `diagnoseExitCode` themselves.

`src/page.js` renders every value with `textContent` (no `innerHTML`), carries no
absolute origin, touches no process API, and prints `certification: false` and
`correlation: not-established` above any data. Its CSP is
`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; form-action 'none'; base-uri 'none'`.

## The two diagnostic endpoints (E1)

`src/api.js` mounts these two read-only routes (and the conflict/repair routes below) when the composition provides a `connection`
service, and mounts **nothing** when it does not — a plugin whose routes cannot inherit
the carrier's trust policy must not invent its own.

| Route | Shape | Transport |
| --- | --- | --- |
| `GET /api/page-snapshot` | `{ pageSnapshot, sources, counts, truncated, messages, plugins, slots, activeSession, codes, limitations, certification }` | `connection.fetch.register` |
| `/api/frontend-log` | `{ entries, maxEntries, dropped, codes }`, plus a WebSocket upgrade carrying page log lines | `connection.fetch.register` **and** `webServer.registerUpgrade` |

**A snapshot is assembled from host state, not observed in a browser.** `src/page-snapshot.js`
is a pure function over lists the caller passes (`sessions`, `messages`, `plugins`,
`slots`, `activeSessionId`, `includeMessageText`); the adapter in `src/api.js` collects
those lists from `sessionQuery`/`sessions`, `pluginManager` and a slot cache fed by
`slots/changed`. There is no DOM read, no screenshot and no rendering: the limitation
list says so in `SNAPSHOT_IS_STRUCTURE_NOT_A_DOM_OR_A_SCREENSHOT` and
`SNAPSHOT_IS_ASSEMBLED_FROM_HOST_STATE_NOT_OBSERVED_IN_A_BROWSER`.

The design decision worth stating: **an absent source is not an empty list.** When a
service is missing the snapshot reports `sources.<part> = 'unavailable'` plus a code
(`SESSIONS_UNAVAILABLE`, `MESSAGES_UNAVAILABLE`, `PLUGINS_UNAVAILABLE`,
`SLOTS_UNAVAILABLE`) instead of `[]`, because "I could not see it" and "it is empty" are
different facts and a reader must be able to tell them apart. Message text is withheld
(`text: null`, `textLength: n`) unless the composition sets `includeMessageText`, and
every bounded list reports its pre-bound total with `*_TRUNCATED` next to the bound.

`src/frontend-log.js` is the page half, hand-written to RFC 6455 with zero
dependencies: `acceptKey`/`handshakeResponse` for the upgrade, a masked-frame decoder
that reassembles a frame split across TCP chunks, and explicit refusals for unmasked
frames, fragmented messages, unknown opcodes and an announced length over the 64 KiB
ceiling **before** allocating it. Parsed entries go into a 100-entry ring; each entry is
frozen, and an over-long field is truncated and flagged rather than stored whole. A page
cannot smuggle extra fields: only `level`, `message`, `stack` and `source` survive the
parse.

`scripts/host-api-batch` covers these routes. One bounded round on 2026-11-12 ran green
(`/data/dsh-ecosystem-test-artifacts/runs/20261112T153350Z-host-api-batch-1720994-2776`):
`acceptance_exit=0`, `tap_tests=54 tap_pass=54 tap_fail=0`, `acc_static_contract=pass`,
`memory_peak=41201664` and `pids_peak=20` both measured. The 28 endpoint tests in
`tests/api.test.js` are matched name-by-name against the TAP headers, so the total is not
standing in for a file that failed to load. Receipts: `docs/testing/2026-11-12-repair-d2-e1.md` §3.

## Conflict report (Phase 3)

`GET /api/conflict-report` reads the conflict service the composition provides as
`conflictService` or `compatConflicts` (the analyzer's `createConflictService`). It
answers `{ claims, conflicts, summary: { byKind, bySeverity } }`.

- No service: `503 {"code":"CONFLICT_SERVICE_UNAVAILABLE"}`.
- The service throws, or answers something that is not a list:
  `500 {"code":"CONFLICT_SERVICE_ERROR"}`. The message goes to the host log, never
  into the response. An error is **never** reported as an empty list, so the page
  can only say 「未检测到冲突」 after a real, successful, empty answer.

## Repair routes and their trust boundary

The repair routes call the real `dsh-compat-repair` package (`previewRepair`,
`planDigest`, `readFixture`, `applyApproved`). It is loaded lazily on first use: first
by package name (`dsh-compat-repair/repair-preview`, `/repair-plan`,
`/fixture-applier`; declared as an optional peer dependency), then from the monorepo
sibling `../../repair/src/`. If both fail, the preview and apply routes answer
`503 {"code":"REPAIR_PACKAGE_UNAVAILABLE"}`. **An installed tarball of this package
does not contain `../../repair`**, so an installation needs `dsh-compat-repair` in the
same `node_modules`, or those two routes stay 503.

Configuration (`config.repair`; unknown keys and relative paths throw a `TypeError`):

| Key | Meaning |
| --- | --- |
| `root` | absolute directory holding the documents |
| `documents` | allow-list of bare file names inside `root` (no `/`, `\`, `..`) |
| `applyEnabled` | `false` by default; `true` requires `approvalsDir` |
| `approvalsDir` | absolute directory, different from `root`, holding `<planDigest>.json` approval files |

| Route | Body | Answers |
| --- | --- | --- |
| `GET /api/repair-targets` | – | `{ documents, applyEnabled }` (names only, never a path) |
| `POST /api/repair-preview` | `{ name, plan }` | `{ name, verdict, valid, issues, operations: [{ kind, value?, edit, diff }], beforeDigest, afterDigest, planDigest, afterText \| null, afterTextWithheld, limitations }` |
| `POST /api/repair-apply` | `{ name, plan }` | `200` receipt with `status: "applied"`; `422` receipt for `refused`/`partial` |

The server reads the document itself; a client `beforeText` is refused
(`400 BODY_UNKNOWN_FIELD`), and so is any `approval` field on apply
(`400 BODY_APPROVAL_NOT_ACCEPTED`). Bodies above 1 MiB are `413 BODY_TOO_LARGE`,
checked against `content-length` and while streaming. `afterText` above 64 KiB is
withheld; the digests are still returned.

Apply checks, in order: not configured → `503`; `applyEnabled` false →
`403 REPAIR_APPLY_DISABLED`; package missing → `503`; body/name/plan errors → `400`;
then, one apply at a time, the approval file `approvalsDir/<planDigest>.json` (opened
without following symlinks, at most 16 KiB): missing → `409 REPAIR_APPROVAL_MISSING`
with the server's `planDigest`, unreadable → `409 REPAIR_APPROVAL_UNREADABLE`. Only
then does `applyApproved` run, which re-checks the approval (digest match, expiry,
`allow`) and the document digest before writing.

**Trust boundary.** The approval file is not authentication. Requests reach these
routes through the carrier's `connection` fence; anyone past that fence can preview,
and can apply any plan that already has an approval file. So the approval is exactly
as trustworthy as write access to `approvalsDir`. The `approver` field inside it is a
label for the receipt, not an identity. Keep `applyEnabled` off unless that directory
is writable only by the operator.

The host mounts no `/api/chrome-capture` route.

## Tests

```
node --test --test-concurrency=1 "tests/*.test.js"
```

Currently **54 tests by static count** — 26 across `tests/gui.test.js` and
`tests/client.test.js`, 28 in `tests/api.test.js` — no dependencies, in two groups with
two different stand-ins. No bounded round has counted this file yet, so the 22 in the
2026-11-11 records below is what that round measured then, not today's count.

The page/envelope tests use a fake carrier that records the two registrations; the real
handlers run against real files written into `mkdtemp`, the browser half is executed
inside a stand-in module loader to check what it registers, and the page's own inline
script runs inside a minimal DOM so a node stringified into `textContent` fails a test
instead of reaching a reader. They do **not** boot the carrier or run a browser.

The endpoint tests include one real `node:net` server and client: the upgrade request is
sent as bytes, the accept header is compared against the RFC 6455 example value, and a
masked client frame has to arrive in the ring before that case passes. Everything else
in those tests runs against in-memory transcript doubles. No case boots the real DSH
carrier, renders a page, or reaches a real browser — that is the batch's job and the
record's non-claim.

## The browser half

`src/client.js` is the same package's contribution to the Web client's module
graph: one `settings.section` that frames `/compat-diagnostics` in an `<iframe>`.
It is hand-written in the loader format this installation uses
(`window.__ModuleLoader__.load({ id, factory })`) — no build step, so the shipped
bytes are the executed bytes. It declares no remote API, registers no command,
writes nothing and reads no file; if the host route refuses, the frame shows that
refusal.

Two facts were established by reading the installed client bundles rather than
assuming: the settings slot is `settings.section` (there is no
`settings.plugins.tab`), and the `slots` client service comes from the core
client runtime, not from a plugin package — so the manifest's
`dsh.client.inject` names only `@deepseek-ai/dsh-client-ui-settings`, the one
client package that really provides the slot.

## Limits, stated so they cannot be misread

- The page is a display of one file. A clean page is not a compatibility,
  loadability or certification result; `certification` stays `false` and
  `correlation` stays `not-established`.
- No browser has rendered this page. HTTP-level bytes were verified; the page's
  script never executed on a real browser engine.
- No plugin is loaded or activated by this package.
- The host mounts **no** `/api/chrome-capture` route (宿主内没有 chrome-capture 接口).
  `src/chrome-driver.js` is only used by `scripts/e2-chrome-batch` inside the bounded
  runner; no request to this plugin starts a browser.
- The repair approval is a file, not authentication: whoever can write
  `repair.approvalsDir` can approve any plan. The `approver` field is a label.
