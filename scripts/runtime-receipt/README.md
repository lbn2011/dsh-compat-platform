# Runtime resolution receipt

Read-only. Records which copy of each runtime package a DSH installation resolves,
and the sha256 of the file that copy loads.

## Why

Two Cordis versions can exist on one host — a global one and the nested one inside
the DSH installation. A version string alone does not say which bytes will run. This
receipt names the resolved file and hashes it, so a later execution record can state
which build it used instead of guessing.

## Usage

```bash
node scripts/runtime-receipt/receipt.mjs --installation /path/to/node_modules/@deepseek-ai/dsh
```

The script prints one JSON document to stdout and nothing else.

## What it reads

Only inside `--installation`: each module's `package.json`, each resolved entry file,
and `lib/bin.js` plus `lib/profile-boot-*.js`. It refuses to hash an entry that
resolves outside the installation (`ENTRY_OUTSIDE_INSTALLATION`).

It writes no files, imports nothing from the installation, starts no process, and
opens no socket. It reads this Node's own `process.version`, `platform` and `arch`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Complete receipt: every listed module resolved inside the installation |
| `2` | Refused: installation missing or not a directory, unreadable manifest, or one module unresolved/escaped |
| `5` | Internal error |
| `64` | Usage error |

A partial receipt is printed (with `unresolved[]`) but the exit code is `2`: a
receipt that silently omits a module would mislead the record that cites it.

## What it does not establish

- That a process actually loaded these files — it hashes what resolution *would* load.
- A dependency closure: only the ten listed files are covered, not their transitive imports.
- Loadability, activation, compatibility or certification. `certification` is always `false`.

## Verification status

Executed once on this host on 2026-11-09; two consecutive runs produced byte-identical
output (`sha256 49b52d11f0cf786acfe1b1f3ab95d238c66cd345d962572555557aa2580426f6`).
See `docs/testing/2026-11-09-runtime-receipt.md`.
