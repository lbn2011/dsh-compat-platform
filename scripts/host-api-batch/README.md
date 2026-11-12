# `host-api-batch` — bounded slice for `packages/host`

Prepared 2026-11-12 by platform-developer for task t9 (E1 diagnostic endpoints).
**Status: executed once, green.** The unit base `host-api-batch` is in
`scripts/bounded-runner/policy.sh` `br_prefix_allowed` (added by the captain, exact match)
and `scripts/bounded-runner/core.manifest` was regenerated from the five module hashes
because `policy.sh` is one of them.

```
run dir: /data/dsh-ecosystem-test-artifacts/runs/20261112T153350Z-host-api-batch-1720994-2776
acceptance_exit=0   phase=completed   hash_rc=0   write_failures=0
tap_tests=54  tap_pass=54  tap_fail=0  cancelled=0  skipped=0  todo=0
acc_static_contract=pass
memory_peak=41201664 (measured)   pids_peak=20 (measured)
```


## Why it exists

`packages/host` gained three modules and 28 tests for the E1 endpoints
(`/api/page-snapshot`, `/api/frontend-log`). No existing slice can carry them:

| Candidate | Why it does not fit |
| --- | --- |
| `diagnostics-gui-run` | pins `EXPECT_SELECTED_TESTS=(tests/client.test.js tests/gui.test.js)`, a forbidden port and a live GUI; it would not run `tests/api.test.js`, and editing its expectations would change what its past record measured |
| `repair-plan-batch` | fixed to `packages/repair` (`PKG=$REPO/packages/repair`) |
| `spec-test-batch` | fixed to `packages/analyzer` |
| every other slice | fixed to one package and usually one pinned test file |

`br_prefix_allowed()` is an **exact match**, so a slice name that merely starts with an
allowed name is refused. `policy.sh` is also one of the five modules hashed by
`core.manifest`, so adding a unit base changes the control closure every slice verifies;
that is a captain decision, not a worker edit — which is why the unit base was requested
in writing before the round ran.

## What it would run

```
node --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.js'
```

in `packages/host`, inside the standard envelope: 384 MiB memory, swap 0, 32 tasks,
50 % CPU, 120 s runtime, `NODE_OPTIONS=--max-old-space-size=192`, `bwrap` with a
read-only root and no network. The suite is 54 tests by static count today (21 in
`gui.test.js`, 5 in `client.test.js`, 28 in `api.test.js`), and `tests/api.test.js` opens
one real `node:net` loopback
socket for the WebSocket handshake; that is why the slice needs the net-namespace
isolation `bwrap` already provides rather than a wider permission.

## The static contract

Before any test runs, a node script asserts facts about the package that the tests
themselves should not have to re-derive on every run:

- manifest `name`, `type: module`, no `private`, and **no dependency of any kind**;
- every `exports` target exists on disk, and the seven expected subpaths are declared;
- the client contribution is `platform: web` injecting only
  `@deepseek-ai/dsh-client-ui-settings`;
- **zero-dependency re-checked from the sources**: no import specifier in `src/*.js` is
  anything but `./…`, `../…` or `node:…`;
- `page-snapshot-summary/0.1-draft.1`, the 50-message cap, the
  `SNAPSHOT_IS_STRUCTURE_NOT_A_DOM_OR_A_SCREENSHOT` limitation, an absent source
  reporting `unavailable` rather than an empty list, text withheld by default, and
  `certification: false`;
- the 100-entry ring, the 64 KiB frame ceiling, the RFC 6455 GUID, and
  `acceptKey('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='`;
- both route paths, and `applyHostApi` mounting nothing when the composition has no
  `connection` service.

The contract body was first executed standalone against the package (not a suite run),
where it reported `static_contract=pass` over 40 lines and caught a real gap: the frame
ceiling and the RFC GUID were module-private, so a caller could not know the limit. Both
are now exported, and the contract passed again.

## Exit codes

`0` green · `70` wrapper/usage/envelope-entry refusal · `71` static contract failed ·
`72` verdict or hash mismatch · `73` evidence gate/write failure · `74` timeout or signal
· `75`, `76`, `77`, `78` core-envelope refusals (see `scripts/bounded-runner`).

## What a green run here would and would not establish

It would establish that the package's own tests pass under the envelope on these bytes.
It would **not** establish that a real DSH carrier mounts these routes, that the carrier's
trust policy is inherited as designed, that a browser sent a log line, or that any
snapshot matches a rendered page. Those are separate observations and are not claimed.
