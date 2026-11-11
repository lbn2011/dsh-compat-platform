# `dsh-compat-diagnostics-ui` (host package)

A **host plugin** that serves one read-only view of an existing diagnostic
envelope on the composition's own `webServer` service. It analyses nothing,
reads exactly one configured file per request, and writes nothing.

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
export function apply(ctx, config) // config: { envelopePath, pagePath?, envelopeRoutePath? }
```

- `envelopePath` — required, non-empty; resolved against `process.cwd()`.
- `pagePath` — defaults to `/compat-diagnostics`.
- `envelopeRoutePath` — defaults to `/compat-diagnostics/envelope`.
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

## Tests

```
node --test --test-concurrency=1 "tests/*.test.js"
```

22 tests, no dependencies: a fake carrier records the two registrations, the
real handlers run against real files written into `mkdtemp`, the browser half is
executed inside a stand-in module loader to check what it registers, and the page's
own inline script runs inside a minimal DOM so a node stringified into
`textContent` fails a test instead of reaching a reader. They do
**not** boot the carrier, listen on a socket, run a browser, or render anything —
that is the batch's job and the record's non-claim.

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
