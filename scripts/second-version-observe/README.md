# Second-version observation batch

One bounded round answers: do the installed `0.2.2-rc.1` and the published
`0.2.2-alpha.2` reach the **same per-entry verdicts** for the same three fixtures, when the
same adapter observes both?

## Files

- `run.sh` — launcher (core `scripts/bounded-runner`, prefix `second-version-observe`).
- `payload.sh` — closure digest check, two adapter runs in bwrap, comparison.
- `compare.mjs` — compares per-entry `state` and, for a failed entry, `failurePhase`.

## Invocation

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-observe/run.sh
```

Absolute path only (a relative entry is refused `77`). No arguments. **No network.**

## The pinned closure

The alpha.2 dependency closure is an artefact, not something this batch builds:

```
/data/dsh-ecosystem-test-artifacts/closures/alpha2-0.2.2-alpha.2
  closure.json     339 packages, name/version/sha256 per package.json
  node_modules/    the extracted trees
```

Manifest sha256 `127632a801bf26e631160cedbc99c213acba48d2932aa48298b3d7d76ca58fc9`. The payload
refuses (`72`) on any mismatch, so a round cannot silently observe a different runtime than
the record names. Assembling it takes 3 m 26 s — three times the 120 s envelope — which is why
it is prepared once and digested rather than rebuilt per round.

## What one round does

1. Envelope receipt from the core (384 MiB, swap 0, 32 tasks, 50 % CPU, 120 s, one
   `MemAvailable >= 819200` KiB gate).
2. `bash -n` ×2, `node --check compare.mjs`.
3. Verify the closure manifest digest and that both trees exist.
4. Run `packages/runtime/src/trusted-extraction-adapter.js` against each runtime in a bwrap
   sandbox (`--ro-bind / /`, `--unshare-net`, `--unshare-pid`, `--die-with-parent`), writing
   `observed-installed.json` / `observed-alpha2.json`.
5. `compare.mjs` writes `comparison.json`; a disagreement is recorded as a **result**, not a
   failure.

## Exit codes

Payload: `0` green, `70` envelope/argument, `71` static contract, `72` a step failed (including
a closure digest mismatch), `73` evidence write failed.

Launcher (from the core): `0` green, `70` refusal, `71`/`72`/`73` relayed, `74` unit did not
settle, `75` lock held, `76` run-directory collision, `77` control/selected frame unreadable,
`78` drift.

## What one round does not establish

That the two releases are interchangeable; that the closure equals an `npm install` tree (no
lockfile, no integrity check); behaviour beyond these four entries; timing, log text, module
identity, or which bytes each runtime loaded. `comparison.json` lists those as `notCompared`.
`certification` stays `false`.

See `docs/testing/2026-11-10-second-version-observe.md`.
