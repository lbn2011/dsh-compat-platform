# What this platform can and cannot tell you

A short, honest capability statement for `dsh-compat-platform`. Every claim below is backed by a
recorded, bounded run in `docs/testing/`; nothing here is a certification, a loadability verdict,
or a statement about a production profile.

## The rule everything here follows

1. **Structure, never values.** No artifact emits a configuration value, a credential, or an
   entry's `id`/`name` unless a caller explicitly opts in. Counts, closed words and sha256 digests
   only.
2. **Bounded or not at all.** Every run executes inside one `Type=exec` unit: 384 MiB memory,
   swap 0, 32 tasks, 50 % of one core, 120 s wall clock, Node heap 192 MiB, one
   `MemAvailable >= 819200 KiB` gate, a `flock` so two runs never overlap, and **one launch with
   no retry-to-green**.
3. **Inert unless disclosed.** Analysis tools read text. Exactly one capability executes code
   (trusted extraction), and it says so in its own artifact.
4. **Absence is `unknown`, never `clear`.**

## Capabilities

| # | Capability | Command | Artifact version | Evidence |
|---|---|---|---|---|
| 1 | Static declaration analysis | `dsh-compat-analyze` | — | analyzer suite 448/448 |
| 2 | Admission diagnostics | `dsh-compat-admission` | `admission-evidence/0.1-draft.1` | spec 105/105 |
| 3 | Combined report | `dsh-compat-report` | — | analyzer suite |
| 4 | Snapshot comparison | `dsh-compat-compare` | — | analyzer suite |
| 5 | Profile dump summary | `dsh-compat-profile-dump` | `profile-dump-summary/0.3-draft.1` | 95/95 |
| 6 | Dependency-shape summary | `dsh-compat-dependency-shape` | `dependency-shape-summary/0.1-draft.1` | 37/37 |
| 7 | Correspondence check | `dsh-compat-correspondence` | `correspondence-summary/0.2-draft.1` | 45/45 |
| 8 | Unified read-only diagnostics | `dsh-compat-diagnose` | `dsh-compat-diagnose/0.2-draft.1` | 54/54 + wiring 6/6 |
| 9 | Configuration checker | `dsh-compat-config-check` | `config-check-summary/0.1-draft.1` | 59/59 |
| 10 | Repair plan + preview (inert) | (library) | `repair-plan/0.1-draft.1` | 25/25 |
| 11 | Repair approval + confined apply | (library) | `repair-receipt/0.1-draft.1` | 42/42 |
| 12 | Trusted extraction (fixture-only) | (library + batch) | `trusted-extraction-receipt/0.1-draft.1` | 32/32 |
| 13 | Read-only diagnostics GUI | (host route) | `dsh-compat-diagnose/0.2-draft.1` | 16/16 + 7 HTTP checks |
| 14 | Packaging + publish audit | `scripts/package-install` | `publish-audit/0.1-draft.2` | 24 probes |
| 15 | Second install tree (published older) | `scripts/second-install-tree` | `runtime-receipt/0.1-draft.1` | 10 of 10 modules resolved, 2 rounds |

Test counts are **per suite and not additive**: they measure different scopes on different days.

## What each one proves, and what it does not

**1–4 (analysis, reports, comparison).** That a document satisfies or violates the declared schema
and the closed rule sets, and that two artifacts differ in the ways reported. It does **not** prove
that a plugin works, loads, or is compatible with any host build.

**5 (profile dump).** That a YAML export satisfies the accepted subset (no tags, anchors, aliases or
merge keys), how many entries it has, and per-row structural facts. It reports
`completeness: 'unknown'` because a denied bundle contributes no row and a skipped bundle is stderr
prose — **a row count is not an inventory**.

**6 (dependency shape).** How many rows declare `inject`, and whether each value is a sequence, a
mapping, `null` or absent. Names are never emitted. Counting a declaration says nothing about
whether the service is provided.

**7 (correspondence).** That a caller-asserted `entryId` → `pluginId` mapping is consistent with
both documents' sha256-bound bytes. The identity is an **assertion**, not a derivation.

**8 (unified diagnostics).** A single envelope over four sources, each lane `provided`/`absent`,
with a per-source `provenance` row saying whether a baseline commit was `recorded`,
`not-reflected`, `not-provided` or `not-readable`. Lanes are never merged and no score exists.

**9 (configuration checker).** That one caller-supplied configuration value conforms to a declared
`configSchema`, with expectation summaries (types, bounds, enum sizes) rather than values. It does
not read a profile: decision **D-D** keeps configuration values out of every tool here.

**10–11 (repair).** That a typed plan validates, that a preview renders the exact diff it would
make without writing, that an apply requires a digest-bound approval matching the current bytes, and
that `expired`, `denied`, `partial` and `recovery` each produce a distinct receipt — all on a
**temporary copy of a fixture**. There is no production path, and a backup is never presented as a
rollback.

**12 (trusted extraction).** That a synthetic three-entry profile is observed inside a bwrap
boundary — child `uid` 65534, `CapEff` zero, `NoNewPrivs` 1 — across five phases, distinguishing an
import failure from an activation failure, with the network verdict taken from the child's own
errno. Isolation gates 1, 2, 3 and 5 are demonstrated; gate 4's kill path is measured at the shipped
80 s budget. It does **not** establish that any real plugin loads.

**13 (GUI).** That two exact routes serve the envelope and a rendered page, refusing unknown paths,
foreign `Host` headers and non-GET methods. **No browser ever rendered it** in these runs.

**14 (packaging).** That each tarball contains exactly what its `files` allowlist says, installs into
a consumer directory with no sibling checkout, resolves every documented subpath by package name, and
fails loudly (`ERR_MODULE_NOT_FOUND`) when a dependency is deliberately removed. **Nothing is
published.**

**15 (second install tree).** That the published `0.2.2-alpha.2`, placed as an installation
directory with its pinned dependency closure under it, resolves **ten of ten** modules a runtime
receipt names — `unresolved=0`, receipt bytes identical across two rounds. The tree is
**reconstructed**, not installed: no lockfile, no peer resolution, no lifecycle scripts. Resolving a
path and hashing its bytes is not loading it, and this row makes no compatibility claim.

## Deliberately not built

These are decisions, not omissions:

- **Reading a profile's configuration values** — refused by D-D, in every tool.
- **An automatic configuration-mismatch verdict from a profile** — it would need that reading.
- **A CLI that writes** — the repair apply path is a library call confined to a caller-named
  directory.
- **A loadability or compatibility verdict** — that needs a real host executing a real profile.
- **Publishing** — no credentials, no registry write, no `npm publish` anywhere. Versions stay
  `0.1.0-draft.1`.

## Where the evidence lives

Every capability has at least one record under `docs/testing/`. The most load-bearing are:

- `2026-11-10-publishable.md` — both audit standards at zero blockers.
- `2026-11-10-second-version-observe.md` — the behavioural cell of the version matrix.
- `2026-11-11-second-install-tree.md` — the tree cell: ten of ten modules resolve over a reconstructed `0.2.2-alpha.2`.
- `2026-11-09-trusted-extraction.md` — phases, entry outcomes, isolation gate evidence.
- `2026-11-09-diagnose-provenance.md` — the `0.2-draft.1` envelope.
- `2026-11-09-profile-dump-rows.md` — the row window.
- `2026-11-09-repair-apply.md` — the four apply paths.

## Reproducing one capability

Any registered batch is run by absolute path; the shared core refuses a relative entry with `77`
rather than guessing.

```
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/package-install/run.sh
```

Each run writes its own directory under `/data/dsh-ecosystem-test-artifacts/runs/` with the envelope
readback, hash manifests, terminal readback and workload output.
