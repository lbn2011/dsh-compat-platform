# The envelope route as an inlined literal (2026-11-12)

Status: **EXECUTED.** One bounded round on 2026-11-12, green (26/26).

## 0. Scope and non-claims

This record covers one question: when the diagnostics page embeds the envelope
route in its inline script, does the embedded literal (a) name the route the
plugin actually serves, for both the default and a configured route, and (b)
survive a route string that tries to end the `<script>` element or smuggle a
second one?

What it establishes:

- the page the plugin serves fetches the envelope route that the same
  configuration registers, proven by executing the shipped inline script in a
  stub DOM and recording the URL it actually fetches — not by matching HTML text;
- a route containing `</script>`, an injected `<img onerror>`, U+2028/U+2029 and
  quote/backslash characters still yields exactly one `<script>` element, and its
  literal round-trips byte for byte into the script's own `fetch` call;
- a configured `envelopeRoutePath` is registered as an exact route, answers JSON,
  and is the route the page fetches;
- the narrow-viewport (`max-width:40rem`), `:focus-visible` and
  `prefers-reduced-motion` rules are present in the shipped stylesheet.

What it does **not** establish:

- **No browser rendered the page.** Executing the inline script in `node:vm`
  against stub DOM nodes is not a render, and the CSS assertions are existence
  checks on bytes — they say nothing about layout, colour or contrast. This is
  not a visual acceptance.
- The suite boots no carrier, opens no socket and proves nothing about the
  composition serving any live URL.
- No compatibility, loadability or certification claim is made;
  `certification` remains `false` in every envelope used here.

## 1. What changed

| File | Change | Author |
|---|---|---|
| `packages/host/src/page.js` | `renderPage(envelopeRoutePath)` embeds `JSON.stringify(route)` with `<`, U+2028 and U+2029 escaped as `\uXXXX`; CSS additions for narrow viewports, focus and reduced motion | captain |
| `packages/host/src/index.js` | `handlePage` passes `settings.envelopeRoutePath` into `renderPage` | captain |
| `packages/host/tests/gui.test.js` | **this task**: four tests added (see §3); no existing test or literal changed | spec-developer |
| `docs/testing/2026-11-12-host-envelope-route-injection.md` | **this task**: this record | spec-developer |

## 2. Baseline

| Item | Value |
|---|---|
| Repository | `/root/dsh-ecosystem-spec/projects/dsh-compat-platform` |
| HEAD | `8fc16aacfcee1c58c65f79bdfd6679d2f337e480` (2026-11-12 03:36:12 +0800) |
| Node | v24.21.0 |
| Package | `dsh-compat-diagnostics-ui@0.1.0-draft.1` |
| Working tree | sources under test are **uncommitted**; hashes below pin the exact bytes |

| File | SHA-256 |
|---|---|
| `packages/host/src/page.js` | `77eb3ae4d4e9e06556f9a59f80699419c851a197487cece1e64e7a9832516d71` |
| `packages/host/src/index.js` | `be95d70d7a1cf8022defdf1748904494a88dccd56d073cbc2c26f55f813e10c5` |
| `packages/host/tests/gui.test.js` (as edited) | `eabbe1be8de4ff4a5a35570e47be780d253248815ff8f11f26d0ba4a78e1405f` |
| `packages/host/tests/gui.test.js` (HEAD version) | `ef4ae321abca22afd87ca3f5ee91989a110a82faa54d2b96ecc3ef9bffa9c6b1` |
| `packages/host/package.json` | `f21ccbd244b5738bff32f05aca8941570f3aacdf2b7aa87958209b756d378f20` |

Change under test (source, as shipped in the working tree), SHA-256 of
`git diff -- packages/host/src/page.js packages/host/src/index.js`:
`9cebad32434150d91b090fbdfde2055c873e0f08af22dfda9d989c873423ea0d`
(page.js +22/−3, index.js +1/−1).

## 3. Tests added

All four live in `packages/host/tests/gui.test.js`. Each parses the served page,
extracts its single inline script, and executes that script in `node:vm` against
stub DOM nodes; the “route” assertions read the URL the script passes to
`fetch`, so they describe runtime behaviour rather than page text.

1. `the page fetches the exact route it serves, default and custom` — default
   `renderPage()` must fetch `DEFAULT_ENVELOPE_PATH`; `renderPage('/ops/private/envelope')`
   must fetch exactly that string.
2. `a route cannot end the inline script or smuggle a second element` — four
   payloads: `</script><script>alert(1)</script>`, `</script ><img src=x onerror=alert(1)>`,
   U+2028/U+2029, and `"`/`'`/`\`. For each: exactly one `<script>` and one
   `</script>`, the script body contains no `</script` and no raw U+2028/U+2029,
   and the `fetch` argument equals the payload verbatim.
3. `a custom envelope route is registered as an exact route and reached by the page` —
   with `envelopeRoutePath: '/ops/private/envelope'`, the registered routes are
   exactly `{DEFAULT_PAGE_PATH, /ops/private/envelope}`, the page fetches the
   configured route, and that route answers `200`.
4. `the narrow-viewport, focus and motion rules ship in the page CSS` — presence
   of `.grid > *{min-width:0;}`, `summary:focus-visible{…}`, and inside the
   `max-width:40rem` block the single-column `.grid`, single-column `dl.rows` and
   `footer{position:static;}`, plus `.card{transition:none;}` under
   `prefers-reduced-motion`. Existence only — not a visual claim.

## 4. Bounded execution

Method: the package's own script (`node --test --test-concurrency=1 "tests/*.test.js"`)
inside one transient systemd scope carrying the repository's established hard
limits, with `TMPDIR=/root/kit-scratch/tmp`. Serial by construction: one scope,
one workload, no retry, and a team-wide serial lock so no other member's heavy
job runs at the same time.

Effective limits are read back from the workload's own cgroup, not asserted.

## 5. Results

**EXECUTED — 2026-11-12 22:30:05 +08:00 (14:30:05Z). One bounded round, green.**

Command (verbatim):

```
TMPDIR=/root/kit-scratch/tmp systemd-run --scope --quiet \
  -p CPUQuota=50% -p MemoryMax=384M -p MemorySwapMax=0 -p TasksMax=32 \
  -- /bin/bash -c 'cd .../packages/host
                   export TMPDIR=/root/kit-scratch/tmp
                   timeout 180 node --test --test-concurrency=1 "tests/*.test.js"'
```

Effective limits, read back from the workload's own cgroup (not asserted):

| Knob | Readback | Required |
|---|---|---|
| cgroup | `0::/system.slice/run-p1704718-i1705018.scope` | one dedicated transient scope |
| `cpu.max` | `50000 100000` | CPUQuota=50% |
| `memory.max` | `402653184` | MemoryMax=384 MiB |
| `memory.swap.max` | `0` | no swap headroom |
| `pids.max` | `32` | TasksMax=32 |
| `TMPDIR` | `/root/kit-scratch/tmp` | as required |
| Node | `v24.21.0` | — |

Outcome: **26 tests, 26 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo,
`duration_ms` 533.87, exit code 0.** The 26 are the 22 pre-existing tests (17 in
`gui.test.js` at HEAD + 5 in `client.test.js`) plus the 4 added here; no existing
test was modified or removed, so compatibility is shown by the same assertions
passing unchanged. (The earlier record's "21/21" predates one test added since.)
The four tests added here all pass:

```
✔ the page fetches the exact route it serves, default and custom (42.371855ms)
✔ a route cannot end the inline script or smuggle a second element (89.658117ms)
✔ a custom envelope route is registered as an exact route and reached by the page (24.447477ms)
✔ the narrow-viewport, focus and motion rules ship in the page CSS (0.577822ms)
```

### 5.1 The guard is load-bearing (why the tests are not vacuous)

A passing test means nothing if the defect it names could not be produced. Run
under the same scope:

```
naive_has_closing_tag=true
guarded_has_closing_tag=false
```

`JSON.stringify(route)` alone leaves `</script>` inside the output for the payload
`/e</script><script>alert(1)</script>`; the `\u003c` replacement removes it. So
test 2 fails against an unescaped literal and passes against the shipped one — it
is testing the guard, not the weather.

### 5.2 Source findings

**None.** The shipped implementation behaved correctly on every case exercised;
no source file was changed by this task. One observation worth recording, not a
defect: `renderPage.length === 0` because the parameter is a defaulted parameter,
so callers cannot introspect arity to discover the parameter's existence.

### 5.3 Evidence locations

- Raw run artifacts: [docs/testing/runs/20261112T143005Z-t13-envelope-route/](runs/20261112T143005Z-t13-envelope-route/)
  — `argv.txt`, `limits.txt`, `unit.log`, `result.txt`, `hashes-before.txt`,
  `hashes-after.txt` (the last two are identical: no source drift across the run).
- Console log copy outside the repository: `/root/kit-scratch/t13-gui-run.log`.
- Per the folder's [README](runs/README.md), run directories describe historical
  bytes and are excluded from Git; the numbers above are not reproducible from a
  clone alone (they depend on this host, this systemd envelope and Node v24.21.0).

## 6. Non-claims repeated once

No browser rendered anything. The CSS test asserts that certain declarations
exist in the served bytes; it does not say the layout is correct at any width, and
it is not a substitute for a visual check. Nothing here was deployed, installed
into a profile, committed or pushed; `certification` remains `false`.

