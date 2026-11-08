# Trusted extraction — first fixture-only observation (2026-11-09)

Status: **executed, two bounded green rounds**, fixture only, one host.

## 0. Scope and non-claims

Runs one synthetic profile — three fixture entries, no real plugin, no network, no
config values — inside a bubblewrap boundary, and records which pipeline phases were
observed and what final state each entry reached.

This is **not**:

- a loadability, activation or compatibility result for any real plugin;
- a sandbox proof against hostile code — it is a boundary that stops accidental host
  access, not a security claim;
- a dependency closure, a declaration check, or an admission result;
- anything about a production profile: `/root/.dsh` was never read, only probed as an
  out-of-policy sentinel and found absent.

`certification` is `false`, `correlation` is `not-established`, and the receipt carries
a fixed nine-code `limitations` list including `FAILURE_PHASE_READ_BY_REIMPORT`.

## 1. What was added

| File | Purpose |
| --- | --- |
| `packages/runtime/package.json` | `dsh-compat-trusted-extraction`, private, zero dependencies |
| `packages/runtime/src/isolation-policy.js` | declarative mount allowlist, budget arithmetic, ordered gates |
| `packages/runtime/src/child-probe.js` | child-side probe: identity, mounts, write/read attempts |
| `packages/runtime/src/trusted-extraction-adapter.js` | child-side `boot()` + per-entry outcome reader |
| `packages/runtime/src/trusted-extraction-receipt.js` | inert receipt shape, guard lists, status rule |
| `packages/runtime/src/trusted-extraction-supervisor.js` | builds the sandbox, runs both children, writes the receipt |
| `packages/runtime/tests/*.test.js` | 28 pure tests |
| `examples/trusted-extraction/` | synthetic config + three fixture plugins |
| `scripts/trusted-extraction-batch/` | bounded launcher and payload |

## 2. Rounds

All five invocations ran under the standard envelope (384 MiB, swap 0, 32 tasks, 50 % CPU,
120 s, one `MemAvailable >= 819200 KiB` gate). Three were refused at a **harness** step and
one was green-but-misprinted; two clean green rounds closed the slice. No retry-to-green:
each fix was a real correction to the harness, then a fresh round.

| Round | Run dir suffix | Result |
| --- | --- | --- |
| 1 | `…190035Z-…-865848` | exit 70 `envelope_memory` — payload read the cgroup root instead of `/proc/self/cgroup`'s path |
| 2 | `…190104Z-…-865911` | exit 70 `yaml_lookup` — snapshot pointed at `packages/runtime/node_modules/yaml`, which does not exist (yaml belongs to analyzer); isolation, fixture, static contract and unit tests had all passed |
| 3 | `…190121Z-…-866083` | exit 0, first green; `sentinels=null` printed because the payload read the wrong key name |
| 4 | `…190144Z-…-866405` | exit 0 |
| 5 | `…190146Z-…-866611` | exit 0, **recorded round** |

Rounds 4 and 5 each: `verdict=pass`, `static_contract=pass`, `tests_exit=0`
(`28/28`), `isolation_exit=0`, `fixture_exit=0`, `hashes=identical` (14 selected inputs),
terminal `LoadState=not-found ActiveState=inactive SubState=dead MainPID=0`,
`yaml_version=2.9.1`.

| Round | `memory_peak` | `pids_peak` |
| --- | --- | --- |
| 4 | 34832384 B | 21 |
| 5 | 37027840 B | 21 |

## 3. Isolation gate evidence (round 5)

```
gate=none
refusal=none
uid=65534
capEff=0000000000000000
noNewPrivs=1
mounts=22
sentinels={"outOfPolicyRead":"denied","outOfPolicyWrite":"denied","networkConnect":"denied","unixSocket":"absent","descendants":"none"}
sentinel_read_codes=["ENOENT"]
write_codes=["supervisor:…/scripts/runtime-receipt/README.md:ENOENT","own-write:written"]
child_exit=0
```

- Gate 1 (mounts): 22 mounts, all under a declared prefix; a host path outside the policy
  is absent (`ENOENT`).
- Gate 2 (identity): uid 65534, gid 65534, `CapEff`/`CapPrm` all zero, `NoNewPrivs=1`.
- Gate 3 (evidence): the supervisor's own file inside the sandbox is `ENOENT` for write,
  while the child's `/out` is writable.
- Gate 4 (budget): 120 s outer > 80 s phase + 10 s kill + 20 s readback, asserted statically.
- Gate 5 (sentinels): an out-of-policy sentinel read is denied, no socket is visible, and the
  unit reaped its descendants (`MainPID=0`).

## 4. Fixture observation evidence (round 5)

```
status=observed, cleanup=confirmed
phases: resolve/import/activate/settle/cleanup = observed
entries:  include active
          ok active
          import-throw failed  failurePhase=import
          activate-throw failed  failurePhase=activation
runtime: node v24.21.0 / linux / x64
inputWitness: config sha256, adapter sha256
```

The two failure phases are distinguished by re-importing each failed entry's module inside
the sandbox: a throw means the import failed, a resolution means the module imported and its
`apply()` threw. That re-import runs module side effects twice, so it is recorded as the
limitation `FAILURE_PHASE_READ_BY_REIMPORT`, not presented as a clean observation.

## 5. Corrections to the review's claims

The 2026-11-09 design review listed `captureStartupComposition`, `inactiveEntries` and
`pluginState` as exported observation functions. Reading the **installed** build shows
`dsh-app-boot` exports only `boot` and `auditStartupEntries`; the three richer helpers exist
in the source mirror but are not in this build's export list. The adapter therefore uses
`boot()` and reads per-entry `fiber.state` directly. The design's §9.4 surface table is
corrected by this record.

## 6. Deviations

- Several exploratory runs happened before the bounded rounds: an unconfined adapter dry-run,
  an unconfined `boot()` probe, and unconfined `bwrap` probes of identity/mounts. They
  produced no evidence and are not counted as rounds.
- Rounds 1–3 fixed harness defects (cgroup path, yaml path, a printed key name) after the
  subject code had already been written; the subject bytes were not edited between rounds 3
  and 5 in ways that change behaviour (`isolation-policy.js` was edited **before** round 3
  for the mount-prefix and budget fixes, and the selected hashes confirm stability from round
  3 onward — see the hash table).
- `sentinels` and `networkConnect` are launcher-derived booleans, not child observations: the
  child cannot see a host listener, so "network denied" rests on `--unshare-net` plus the
  absence of any listener inside the netns.

## 7. Files at run time (round 5, from `hashes-before.txt`)

| File | sha256 |
| --- | --- |
| `packages/runtime/src/isolation-policy.js` | `17f69dd6b87155261e34723d2f7987e60120e4233272336f8d22e906476f75d7` |
| `packages/runtime/src/child-probe.js` | `295e90a7d2de03d8f7ddc9be0b14377bd4a167732fd47f508075f2479b804680` |
| `packages/runtime/src/trusted-extraction-adapter.js` | `ebeddaec674821f1ac5e3059c8cd5f9aa622a5a3c441a9daca3193bf8ae726ca` |
| `packages/runtime/src/trusted-extraction-receipt.js` | `0cdf87e7dd9f60824c4af4b212ff3d36e4101605ec624fbf55630dc735896424` |
| `packages/runtime/src/trusted-extraction-supervisor.js` | `aabe5e5a455a1c4561cf221e77d5c9953d5c61cee74752d21abd773bec813ed2` |
| `packages/runtime/tests/isolation-policy.test.js` | `598b1c95b102a810457982b7b354ef12f3f42d203fe720489726a385d59a7507` |
| `packages/runtime/tests/trusted-extraction-receipt.test.js` | `8cf296b930b91213c619a5995193d9d4de0adfcc76f9e8930a3504c2f2ab7d92` |
| `packages/runtime/package.json` | `6fe35d56ac0008acd4e5c5c84a2871e753bb588ad6302b30ff7e633d81d10b52` |
| `scripts/trusted-extraction-batch/payload.sh` | `a8e2a83455bff70aee707b0a111fd61f497a4fec96f5530cad92ab79a600e04f` |
| `scripts/trusted-extraction-batch/run.sh` | `f21063604bab983d92f8a16974c939008e20b4cb6fb93207fd5bb0257c58b3a0` |
| `examples/trusted-extraction/config.yml` | `7f63b873961781c1cc1024d27eac2041771206fc09f860cb86cd68d84aefb1b2` |
| `examples/trusted-extraction/plugin-ok.mjs` | `cb5529f827d0a1ad87d37096967128368e4f1e943e07590b2f46c1393dc6b920` |
| `examples/trusted-extraction/plugin-import-throw.mjs` | `1e0fa77c97f05247bd78af37de622b0bfabaa70619a760d3486fdb5eca7f6435` |
| `examples/trusted-extraction/plugin-activate-throw.mjs` | `8c5786091fc5eff5bfe0ef9d3324777085bccefeca0ce40d761a5c976ca0c1a9` |

## 8. Reproduce

```bash
bash projects/dsh-compat-platform/scripts/trusted-extraction-batch/run.sh
# read <run_dir>/summary.txt, <run_dir>/isolation.txt, <run_dir>/fixture.json
```

Each invocation is one bounded round; two identical rounds are the bar for this slice.
