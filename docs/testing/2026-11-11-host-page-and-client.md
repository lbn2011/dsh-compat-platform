# The Chinese page and the browser half (2026-11-11)

Status: **EXECUTED.** One bounded round on 2026-11-11, green. The page was
rewritten in Chinese and the package gained a browser half — a `settings.section`
in the Web client that frames the host route. Both were then installed into a
live DSH web profile at the owner's request; that install is a deployment act,
recorded here, not a compatibility claim.

Run: `20261111T124439Z-diagnostics-gui-1520708-25303`
(`acceptance_exit=0`).

## 0. Scope and non-claims

What this record establishes:

- the package's own suite passes `21/21` inside the bounded batch, with the
  selection hashed before and after and identical;
- the browser half, executed in a stand-in module loader, registers exactly one
  `settings.section`, frames `/compat-diagnostics`, and contains no fetch,
  socket, process or file primitive;
- the host routes still answer the same way they did in the 2026-11-08 rounds.

What it does **not** establish:

- **No browser rendered the page or the section in this batch.** The suite
  executes the browser half as a module, which is not a render. A human looked at
  the live profile; that is not batch evidence and is not claimed as such.
- The batch boots a **fake carrier**, not the composition that serves
  `http://127.0.0.1:3080`.
- No plugin beyond this package was loaded or exercised.
- `certification` remains `false`; nothing here says anything is compatible,
  loadable or certified.
- The live-profile install mutates a running service and is **outside** any
  bounded envelope. It installs tarballs by extraction, touches no lockfile, and
  is reversible from named backups (see §5).

## 1. What changed

| File | Change |
|---|---|
| `packages/host/src/page.js` | rewritten (~430 lines): Chinese prose, light/dark via `prefers-color-scheme`, cards and panels. Every machine word is still printed verbatim, now with a Chinese gloss beside it. |
| `packages/host/src/client.js` | **new**: the browser half, in the loader format this installation uses. |
| `packages/host/tests/client.test.js` | **new**: five tests over the browser half. |
| `packages/host/tests/gui.test.js` | five prose assertions retargeted to the Chinese strings; no literal was changed. |
| `packages/host/package.json` | `exports` gained `./client`; new `dsh.client` block naming the one client package that really provides the slot. |
| `scripts/diagnostics-gui-run/run.sh` | selection gained `src/client.js` and `tests/client.test.js`. |
| `scripts/diagnostics-gui-run/payload.sh` | the workload now runs both test files, and the static contract requires both to be the ones the package's glob selects. |

Two invariants were held deliberately through the rewrite:

- **Colour never means fine.** Only `attention`, `invalid` and `error` are tinted;
  there is no green state. A reader must not be able to infer "all good" from a
  colour.
- **The two literals are unmissable.** `certification: false` and
  `correlation: not-established` appear in the header banner and again in the
  footer. The batch asserts both strings are present in the served HTML.

## 2. Two facts that were wrong until the installed code was read

Both were assumptions in the first draft of the browser half, and both would have
shipped a section that never appeared:

1. **The slot is `settings.section`.** There is no `settings.plugins.tab` in this
   installation. Inventory of the client bundles: `settings.section` is used by
   six packages, `settings.general.item` by more, `plugins.item` by five — and
   `settings.plugins.tab` by none. The real descriptor shape, taken from
   `@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js`, is
   `ctx.slots.register({ name, id, order, label, locale?, inject? }, Component)`.
2. **The `slots` client service is not a plugin package.** It is provided by the
   core client runtime `@deepseek-ai/dsh-cordis-client-runner/lib/client.js`
   (`provide('slots')`), which is why naming `@deepseek-ai/dsh-client-ui-slots` in
   `dsh.client.inject` pointed at a package that does not exist anywhere in the
   installation. The manifest now names only
   `@deepseek-ai/dsh-client-ui-settings`, the package that actually provides the
   section slot. `inject` in the module itself still lists `slots`, because that
   is a client **service** name, not a package name.

Also established while reading: the module graph orders rows by
`dsh.client.external`, and an `inject` name that matches no client row adds no
edge rather than failing — so a wrong name here degrades silently, which is
exactly why it had to be checked rather than assumed.

## 3. The round

| Field | Value |
|---|---|
| run | `20261111T124439Z-diagnostics-gui-1520708-25303` |
| `acceptance_exit` | `0` |
| test file | `tests/client.test.js tests/gui.test.js` |
| TAP | `tests=21 pass=21 fail=0` |
| `test_verdict` | `pass` |
| selection | 17 inputs, `selected-diff.txt` empty |
| control | `control-diff.txt` empty |
| `memory_peak` | `53972992` B |
| `pids_peak` | `27` |
| terminal | `terminal_ok=yes`, `confirmation=settled` |

## 4. What the five new tests pin

1. The bundle registers under the package name, in the loader shape, and the
   manifest advertises `dsh.client.platform = 'web'` plus `exports['./client']`.
2. The module declares exactly the `slots` service and the manifest names exactly
   the one client package that provides the slot.
3. `apply` registers exactly one `settings.section` — id `compat-diagnostics`,
   order `200`, label `兼容性诊断`, component identity `Panel`.
4. The panel is an `iframe` whose `src` is `/compat-diagnostics`, with
   `referrerPolicy: 'no-referrer'`.
5. The source contains no `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
   `child_process`, `spawn`, `readFileSync`, `eval(` or `new Function(`.

Test 5 is the load-bearing one: a framed page needs no data plumbing of its own,
so any such primitive appearing here would mean the panel had started rendering a
second, possibly disagreeing, view of the evidence.

## 5. Live-profile install (deployment, not evidence)

Performed at the owner's request in `/root/.dsh/profiles/web`. Not covered by any
bounded run.

- Backups: `package.json.bak-compat-20261111-185203`,
  `cordis.patch.yml.bak-compat-20261111-185203`,
  `pnpm-lock.yaml.bak-compat-20261111-185203`.
- Five packages installed by `npm pack` + `tar -xzf --strip-components=1` into
  `node_modules/`, no lockfile touched; nine CLI symlinks added to
  `node_modules/.bin`.
- One patch entry `compat-diagnostics` inserted, pointing at
  `/root/.dsh/profiles/web/.compat-diagnostics/envelope.json`.
- The route is served publicly through nginx with a Host rewrite scoped to
  `/compat-diagnostics` only (`/www/server/panel/vhost/nginx/dsh.conf`, backup
  `dsh.conf.bak-compat-20261111-185651`).
- **That public path has no authentication.** It publishes exactly what the
  envelope contains, which is counts and closed words; it still should not be
  assumed private.
- Rollback: restore the two backups, delete the package directories and
  `.compat-diagnostics/`, `systemctl restart dsh-web`, then `nginx -s reload`.

## 6. Deviations

1. The browser half's first draft used a slot that does not exist and a package
   that does not exist. Both were corrected only after reading the installed
   client bundles; the shipped bytes never contained the wrong names for more than
   one install cycle.
2. The GUI batch's selection did not include `src/client.js` or
   `tests/client.test.js` until this slice: the package could have passed while
   the new file was never executed. The selection now carries both, and the static
   contract requires both to be the ones the package's own glob selects.
3. Local `node --test` runs happened before the bounded round, and one of them
   failed on a realm artifact (`deepStrictEqual` comparing an array across `vm`
   contexts). The test was fixed by spreading into this realm; no product code
   changed for it.
4. The live-profile install and the nginx change were performed outside any
   envelope, because they mutate a running service and a shared web server
   configuration. They are deployment steps, deliberately not folded into a green
   batch.
5. `page.js` was repacked and reinstalled twice (once for the Chinese rewrite,
   once for the client half); the batch ran against the final bytes only.

## 7. Selected-input hashes at run time

```
f21ccbd244b5738bff32f05aca8941570f3aacdf2b7aa87958209b756d378f20  packages/host/package.json
b46610d4eddfb4b77e485e74f10a403d7c2b210a8c24791c0aa90a5ad30c212e  packages/host/src/index.js
d655157e0ab063926c72b8bade9408d89da5b6cc3fba46401bfd1545351ddfa5  packages/host/src/envelope.js
a3df2c1198678c8e5e92ec5138fb0ff962b3851a15b59d4299ada8ac588b95c1  packages/host/src/page.js
32f19d6b12df7d415580d5e79fe9285dc5641939e9f321d8edaffd32d232f3ff  packages/host/src/client.js
2e6a2bd19aa74be7ff2368dad611dfa8389bba44748bc8bc4ed91d296cdec253  packages/host/tests/client.test.js
8fea71d49dc54f89bfe3dcc479f2e7a0c237bc3a3e2c226d02b042e7c32e8745  packages/host/tests/gui.test.js
```

Control sources at run time: `scripts/diagnostics-gui-run/run.sh`
`6ea2d8d2cdd97d9d863cc5f2a584284e35e5ce61d470d8ab20f89f2e90e58c46`,
`payload.sh` `dcfd04b3c17a90b6e8c48e19198efe5d7df5028066002d4097fd9c495c688212`,
`core.manifest` `e3c854fe2be5ef2b39d3fda0c03200b65d5080885c71cb2b38b94a0c4aaa11b1`.

## 8. Reproduce

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/diagnostics-gui-run/run.sh
```

Absolute path required: the shared core refuses a relative entry with `77` before
creating a run directory.
