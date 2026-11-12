# dsh-compat-asset-proxy (C3)

Declared plugin assets, injected into the boot page — from a warm cache, on the
host's own injection table.

## Why this plugin exists

DSH plugins that ship browser code declare it through `package.json`
`dsh.client`, whose real shape is `{ platform, inject?, immediately?, external? }`.
There is no field for extra scripts or stylesheets, so a plugin that needs one
today either must be a first-party client module or has no way to say it.

This plugin implements `dsh.client.assets` as a **proposed extension**:

```json
{ "dsh": { "client": { "assets": ["/vendor/widget.js", "/vendor/widget.css"] } } }
```

or, when the kind is not implied by the extension:

```json
{ "dsh": { "client": { "assets": { "scripts": ["/vendor/widget.mjs"], "styles": ["/vendor/widget.css"] } } } }
```

The host does **not** read this field. `dsh.client.assets` is our convention; a
plugin that declares it works with this plugin installed and is inert without it.
That is stated as the limitation `ASSETS_FIELD_IS_A_PROPOSED_EXTENSION_NOT_A_HOST_FEATURE`
rather than presented as an existing host feature.

## The event is a trigger, not the data

`webserver/index-inject` has the signature

```
'webserver/index-inject'(table: IndexInjection[], peer: PeerScope): void
```

and is emitted synchronously on every index render. A listener appends its
**current** rows to `table`. The payload says nothing about which plugins exist.

Reading every installed `package.json` inside that emit would put filesystem I/O
on the render path. So this service keeps a warmed cache:

| Signal | What happens |
| --- | --- |
| `plugin-manager/changed` | schedules a single-flight refresh |
| `webserver/index-inject` | pushes the cached rows into `table` |

A cold cache renders the page **without** our rows and records
`CACHE_COLD_AT_FIRST_INJECT` once; the refresh it schedules is already in flight,
so the next render carries them. A late row is better than a slow index.

## Rows come from the host's real kinds

`IndexInjection` has six kinds and none of them is a stylesheet link, so:

| Declared asset | Row |
| --- | --- |
| `script` (`.js`, `.mjs`) | `{ kind: 'script-src', placement: 'head' \| 'body', src }` |
| `style` (`.css`) | `{ kind: 'html', placement: 'head', html: '<link rel="stylesheet" href="…">' }` |

Placement defaults to `head` and is configurable. Rows are ordered by plugin
entry id (code-unit order, not the host locale) and then by declaration order
within one plugin, so the same install always produces the same page. A source
declared by two plugins loads once; the duplicate is reported as an
`ASSET_ISSUE` with `reason: 'DUPLICATE_ASSET_EMITTED_ONCE'`.

## What is refused, and why refusing beats dropping

A declaration is refused whole-entry when a path is:

* not a string, empty, or longer than 2048 characters;
* carrying a scheme (`https:`, `data:`) or protocol-relative (`//host/…`);
* not root-relative (`/assets/app.js`);
* containing control characters or `" ' < > ` \`;
* of unknown extension (the kind cannot be inferred);
* beyond 32 assets for one plugin.

Each refusal becomes an `ASSET_ISSUE` naming the plugin, the reason, and the
index. Dropping a bad path silently would leave an operator wondering why a
stylesheet never loaded.

## CSP

This plugin emits **no** CSP header (`NO_CSP_HEADER_IS_EMITTED_BY_THIS_PLUGIN`).
It only ever emits `script-src` rows (external classic scripts) and
`html` link rows — never inline script or style text — so a deployment that
forbids inline code keeps working as long as it allows the asset origins.

## What it does not do

* does not verify that an asset exists or that it loads;
* never reads or digests asset content;
* does not differentiate peers (`PeerScope`), because a declared list is static;
* does not resolve conflicts between two plugins claiming the same path beyond
  reporting them.

## Configuration

```yaml
- id: dsh-compat:asset-proxy
  name: dsh-compat-asset-proxy
  config:
    scriptPlacement: head   # head | body
    prepend: false          # pass { prepend: true } to the injection listener
    maxPlugins: 500         # inventory ceiling per refresh
```

Unknown keys are refused with a `TypeError`.

## Events

| Event | Payload |
| --- | --- |
| `dsh-compat/assets-changed` | `{ ok, plugins, rows, declared }` |

## Tests

```
TMPDIR=/root/kit-scratch/tmp node --test --test-concurrency=1 "tests/*.test.js"
```

65 cases: `tests/asset-declaration.test.js` (22), `tests/asset-rows.test.js` (13),
`tests/asset-proxy.test.js` (30). Bounded verification runs through
`scripts/asset-proxy-batch/`.
