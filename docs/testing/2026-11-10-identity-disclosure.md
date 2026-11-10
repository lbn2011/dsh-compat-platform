# Identity disclosure in the profile dump, and entry text verified in correspondence

Status: **executed, three bounded batches, two green rounds each (2026-11-10)**

Scope: user decision item 1 option **B** — land the D-A-shaped disclosure (the dump may emit entry
`id`/`name` text when explicitly asked) and use it where it removes an assertion rather than adding
one: the correspondence check now reads the same bytes twice and requires the two readings to agree.

## 0. What this does and does not establish

- It establishes that `summarizeProfileDumpText(text, { discloseIdentity: true })` copies the
  literal `id`/`name` strings of each row and that the default path still copies nothing.
- It establishes that the correspondence check refuses a two-sided disagreement between its own
  line scanner and the summarizer.
- It does **not** establish that an entry id is a package identity, that a disclosed name resolves
  to a module, or that a matched entry and a declared plugin are the same thing.
- It does **not** change what any artifact claims about configuration values: no config value is
  emitted on any path, disclosed or not.
- `certification` stays `false` and `correlation` stays `not-established` everywhere.

## 1. Changes

| File | Change |
| --- | --- |
| `packages/analyzer/src/profile-dump.js` | schema `0.3-draft.1`; `identityDisclosed` in the summary; rows gain `id`/`name` (null unless disclosed **and** literal); `PROFILE_DUMP_DISCLOSURE_LIMITATIONS` (3 codes) appended only when disclosure is on; `readDisclosureOption` refuses any other option key |
| `packages/analyzer/src/profile-dump-cli.js` | `--disclose-identity` flag; positional path computed after removing flags |
| `packages/analyzer/src/profile-dump.d.ts` | the three facts above, typed |
| `packages/analyzer/src/correspondence.js` | summary `0.2-draft.1`; `entryTextVerified: true`; `identitySource` → `caller-asserted-entry-text-verified`; asks the summarizer for disclosure internally and cross-checks the two readings; new refusal `CORRESPONDENCE_ENTRY_TEXT_DISAGREES`; two limitation strings replaced |
| `packages/analyzer/src/correspondence.d.ts` | the same shape |
| `packages/analyzer/tests/profile-dump.test.js` | +14 tests (9 in-process, 5 process-level) |
| `packages/analyzer/tests/correspondence.test.js` | +2 tests, 4 contract assertions updated |
| `packages/analyzer/tests/cli.test.js` | stale assertion fixed (see §4) |
| `scripts/profile-dump-retained-export/retained-export.mjs` | schema `0.3`, `identityDisclosed` and per-row `id`/`name` types; the samples must be summarised **without** disclosure |
| `scripts/correspondence-batch/payload.sh` | static-contract pin `correspondence-summary/0.2-draft.1` |
| `scripts/package-install/consumer-check.mjs` | expectation `profile-dump-summary/0.3-draft.1` |

Test counts: `profile-dump` 81 → **95**, `correspondence` 43 → **45**, whole analyzer suite
**595/595** locally.

## 2. Defects found while doing it

1. **The flag was read as the filename.** `profile-dump-cli.js` computed the positional list but
   still took `args[0]`, so `--disclose-identity x.yml` opened a file literally named
   `--disclose-identity` and exited 2 with `INPUT_OPEN_FAILED`. Caught by the new process test, not
   by review. Now `positional[0]`.
2. **An over-eager cross-check turned a legal document into an error.** The first version refused
   any row where the scanner's id differed from the summarizer's, which made `- id: "quoted"` — a
   legal YAML string the parser reads but the bare-token scanner will not — refuse the whole
   document. Narrowed to a **two-sided** disagreement; a row only one reading can address stays
   merely unaddressable, which is what it was before.
3. **A generic sentinel made a test lie.** Asserting that the serialized summary contains `not` and
   `a string` failed on `not-performed`, which is a legitimate value. Replaced with
   `sentinel-name-a`/`sentinel-name-b`.

## 3. Bounded rounds

All three batches ran under the shared bounded runner (384 MiB / swap 0 / 32 tasks / 50 % CPU /
120 s / 192 MiB heap, one `MemAvailable >= 819200 KiB` gate, one launch, no retry loop, terminal
readback of this unit's own invocation).

| Batch | Round | Run dir | Tests | Peak | Pids |
| --- | --- | --- | --- | --- | --- |
| profile-dump | 1 | `20261110T121315Z-profile-dump-batch-1373226-1477` | 95/95 | 66 859 008 B | 23 |
| profile-dump | 2 | `20261110T121355Z-profile-dump-batch-1373807-23789` | 95/95 | 57 421 824 B | 23 |
| correspondence | 1 | `20261110T121457Z-correspondence-1374841-22961` | 45/45 | 52 215 808 B | 23 |
| correspondence | 2 | `20261110T121519Z-correspondence-1375450-8696` | 45/45 | 53 354 496 B | 23 |
| retained-export | 1 | `20261110T121533Z-profile-dump-retained-export-1376045-2308` | 3/3 samples | — | — |
| retained-export | 2 | `20261110T121549Z-profile-dump-retained-export-1376300-22202` | 3/3 samples | 31 432 704 B | 17 |

Every round: `acceptance_exit=0`, `terminal_ok=yes`, `hash_rc=0`, `write_failures=0`, control and
selected manifests identical before and after. Control manifests are byte-identical **between**
rounds of the same batch; the two `profile-dump` rounds share it, as do the two `correspondence`
rounds.

One invocation is preserved as a failure: `20261110T121408Z-correspondence-1374329-2823`, exit 71,
`static_contract_failures=CORRESPONDENCE_SUMMARY` — the payload still pinned the old summary
literal. Fixed in the payload, not by relaxing the check, and the round re-run.

Retained-export round 2 detail, which is what proves the 0.3 shape against real captured bytes:
`sample_probe exit=0 1581 B`, `sample_denied exit=0 1581 B`, `sample_script-probe exit=0 2123 B`,
all `check=pass`, with `identityDisclosed === false` and every row's `id`/`name` null.

## 4. Deviations

1. **A stale test outside this slice was fixed.** `tests/cli.test.js` asserted that
   `packages/analyzer/node_modules` does not exist. The install batch deliberately installs
   `yaml@2.9.1` there, so that assertion has been false on this machine since 2026-11-08 and the
   full suite could not be green. It now asserts that no stray appears that was not already there,
   which is the invariant it was trying to state.
2. **The analyzer is a hashed input of the `profile-dump-install` batch**, which was not re-run
   here: its target already exists and the batch refuses by design. Its success path is unaffected
   by these edits but is not re-measured in this round.
3. **`scripts/package-install/consumer-check.mjs` changed** so the packaging batch would still be
   correct, but the packaging batch was not re-run in this round; its last green run predates the
   0.3 shape.
4. Two `node --test` invocations of the full suite were run locally, outside any envelope, while
   developing. They produce no evidence and are not counted as rounds.
5. `bash <relative path>` refuses with exit 77 by design (the control closure is absolute); all
   rounds were invoked by absolute path.

## 5. Run-time hashes

```
acec4f53992e15449a7b2df9a3ec3a65464c775a78eecf164fd76495da344922  packages/analyzer/src/profile-dump.js
92eb030b29b62c5594cc43666139885a92ed087d8e4444d31674c7d35eacd829  packages/analyzer/src/profile-dump-cli.js
cdcc3d287a1c50d4c8fead3f384bb3066cc75db47df28c2756d831eb33968041  packages/analyzer/src/profile-dump.d.ts
de0c7d4df3208756a0e1e19e679b0d14bcf437665aec371fd460e1cc2fd03657  packages/analyzer/src/correspondence.js
3395b67a2bdcbb7764ebe88166982a78b5f383ff8154a0fda7408d2cc65f7a22  packages/analyzer/src/correspondence.d.ts
2d920d4767b9d9f9e7e268dcaa113e8ab58fc87d2033514a98f7f1bd7dc8920f  packages/analyzer/tests/profile-dump.test.js
cea028fe951b73d278b3d85919961ebaacc14892f98443b474227eaa8d599aba  packages/analyzer/tests/correspondence.test.js
53bb074bc4e0391535ae88c0b30cb7d1244792b04d91c8856e23f559896f65e9  packages/analyzer/tests/cli.test.js
ddebe0f6d0b54fbddcd7f4e91c3c4d49ae45269c15c3a64bb7d25c65a0dec01c  scripts/profile-dump-retained-export/retained-export.mjs
8614e199c0829265541c513263c67d940f075e6153c68946e9478bc434fc17ec  scripts/correspondence-batch/payload.sh
e14c618541d6dcf0e329890d3e198d165e922c77d80d8b18e5535de55c065a52  scripts/package-install/consumer-check.mjs
```

`packages/analyzer/README.md` was edited **after** the rounds (§12.2 and §15.3 examples); its
run-time hash is therefore not pinned above.

## 6. Reproduce

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-batch/run.sh
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/correspondence-batch/run.sh
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-retained-export/run.sh
```

Exit codes: `0` pass, `70` envelope refusal, `71` static contract or precondition, `72` drift or
evidence failure, `73` evidence write failure, `74` workload verdict, `77` relative invocation.
