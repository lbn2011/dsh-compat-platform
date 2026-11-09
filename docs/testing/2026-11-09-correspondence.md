# Correspondence check — bounded verification

**Status: executed. Three invocations; the first failed at the runner, the second and third are green on byte-identical inputs.**

## 0. Scope and non-claims

What this record establishes

- `dsh-compat-correspondence` parses a correspondence artifact, binds it to the profile and
  declaration bytes, resolves each asserted `entryId`, and reports the three findings the design
  allows — under a measured envelope, with the selected inputs hashed before and after.
- The shipped example refuses with **exit 1** and exactly one `CORRESPONDENCE_PLUGIN_NOT_DECLARED`.
- The stale-binding path refuses with **exit 2** and `CORRESPONDENCE_STALE` when one hex character
  of `bindings.profileSha256` changes.

What it does **not** establish

- No plugin was loaded, imported, resolved or executed. The only code that ran is Node executing the
  analyzer's two source files and its own test file.
- The correspondence is an **assertion made by the caller**. A green run means the assertion was
  well-formed, bound to these exact bytes, and internally consistent with the declaration document —
  not that any plugin exists, loads, or provides what it declares.
- No version correspondence is checked, and none is checkable: `EntryOptions` has no version field,
  so a profile dump cannot carry one without resolving the module.
- The profile row set is never proven complete; configuration values are never read.
- `certification` is always `false`, `correlation` is always `not-established`, and
  `identityDisclosed` is always `false`.
- The 43 tests are this file's own suite; they are not additive with any other suite in this
  repository, and none of them is a host or browser acceptance result.

## 1. What was added

| Path | Change |
| --- | --- |
| `packages/analyzer/src/correspondence.js` | new — the pure checker |
| `packages/analyzer/src/correspondence.d.ts` | new — declarations |
| `packages/analyzer/src/correspondence-cli.js` | new — CLI: one JSON document on stdout |
| `packages/analyzer/tests/correspondence.test.js` | new — 43 tests |
| `packages/analyzer/package.json` | `bin` + exports `./correspondence`, `./correspondence-cli` |
| `packages/analyzer/README.md` | §15 |
| `examples/correspondence/{profile.yml,declaration.json,correspondence.json}` | new — the shipped demo |
| `scripts/correspondence-batch/{run.sh,payload.sh,README.md}` | new — the bounded runner |
| `docs/requirements-and-design/2026-11-09-correspondence-design.md` | the design this implements |

No other package or file was touched; `profile-dump`'s shape is unchanged (`0.2-draft.1`), because
the correspondence artifact carries the identity text instead.

## 2. Rounds

| # | Run directory | Exit | Verdict | Tests | Memory peak | PIDs |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `20261109T131628Z-correspondence-947027-10410` | 72 | `example_fail`, `stale_fail` | 43/43 | — | — |
| 2 | `20261109T131838Z-correspondence-947714-21536` | 0 | pass | 43/43 | 51462144 B | 23 |
| 3 | `20261109T131903Z-correspondence-948176-31662` | 0 | pass | 43/43 | 51322880 B | 23 |

Round 1 is kept at its own numbers. It is not retracted and it is not counted as a successful round.

Common to rounds 2 and 3: `terminal_ok=yes`, `confirmation=settled` (`load_state=not-found`,
`active_state=inactive`, `sub_state=dead`, `main_pid=0`), `hashes=identical` (before == after),
`selected_inputs=11`, `write_failures=0`, `stderr_bytes=0`, `mem_available_kib` 1889580 and
`threshold_kib=819200`. Their `hashes-before.txt` files are byte-identical to each other.

## 3. Why round 1 failed

`acceptance_exit=72`. The static contract passed, and the suite was already 43/43 — but both demo
steps exited **64** and printed the usage envelope `{"refused":true,"code":null,"limitations":[]}`.

Cause: the payload invoked the CLI as

```
src/correspondence-cli.js <correspondence.json> <profile.yml> <declaration.json>
```

while the command's documented usage is

```
dsh-compat-correspondence <correspondence.json> --profile <dump.yml> --declaration <manifest.json>
```

So the runner passed two documents as stray positional arguments. The fix was two characters of
runner text (`--profile`, `--declaration`) at both invocation sites; **no shipped code changed**.
The module had already been verified by hand on those same three files before the batch was written.

## 4. What the tests pin

43 tests in `tests/correspondence.test.js`, including:

- artifact closure in both directions (extra keys, missing keys, wrong version, duplicate `entryId`);
- binding mismatch ⇒ `CORRESPONDENCE_STALE`, checked before any other work;
- label hygiene (untrimmed labels refused, empty labels refused);
- the id scan reading **both** `- id: <value>` on the opener line and `  id: <value>`, with a quoted
  or tagged id making that row permanently unaddressable rather than letting a later line stand in;
- zero matches ⇒ `CORRESPONDENCE_ENTRY_NOT_FOUND`; two rows with the same id ⇒
  `CORRESPONDENCE_ENTRY_AMBIGUOUS`;
- a matched row outside the summarizer's 64-row window ⇒ `ENTRY_NOT_FOUND`;
- the three findings, and only those three: `CORRESPONDENCE_PLUGIN_NOT_DECLARED`,
  `CORRESPONDENCE_DUPLICATE_PLUGIN_ID`, `CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES`;
- a summarizer refusal collapsing to one `CORRESPONDENCE_PROFILE_UNREADABLE` (the summarizer's own
  code is never echoed);
- non-`{declarations:[…]}` declaration text, including malformed JSON;
- the privacy test: sentinel ids, plugin ids, note text, capability names and resource names are
  present in the three input files and absent from stdout.

## 5. Measured output (round 3)

Shipped example — exit **1**:

```json
{"counts":{"pairs":3,"matched":3,"refused":0,"findings":1},
 "findings":[{"pair":3,"code":"CORRESPONDENCE_PLUGIN_NOT_DECLARED"}],
 "identitySource":"caller-asserted","identityDisclosed":false,
 "notDerived":7,"limitations":8}
```

Stale bindings — exit **2**: `{"refused":true,"code":"CORRESPONDENCE_STALE", …}` with the same
eight limitations. In both documents the per-pair rows carry only shape words and counts
(`index`, `line`, `disabled`, `config`, `keyCount`, `unmodelledKeyCount`, `pluginDeclared`,
capability counts, resource counts, findings) — never an id, name or config value.

## 6. Deviations

1. **Round 1 is a runner defect, kept as its own round.** Two invocation sites passed documents
   positionally; fixed in `payload.sh`; shipped code untouched.
2. **The static contract's dependency assertion was wrong before any run.** It asserted a
   zero-dependency package (copied from the `dependency-shape` runner) while this package must keep
   `yaml@2.9.1`. Corrected to `only_pinned_yaml` before round 1.
3. **Both scripts were mode 600**; `chmod 755` applied before round 1. File modes are not part of
   the sha256 manifest.
4. **`payload.sh` differs between round 1 and rounds 2–3**, so there is no single payload hash for
   all three rounds. Round 1's hash is not reported here as if it applied to the green rounds.
5. **`packages/analyzer/README.md` was edited after the rounds** (§15 and the §14 wording), so its
   run-time hash below is the pre-edit value, not the committed one.
6. **Work outside any envelope during development**, none of it evidence: several
   `node --test --test-concurrency=1 "tests/correspondence.test.js"` runs while the module was being
   written (including runs against mid-edit bytes that failed 14 tests and later showed
   `readFileSync is not defined`), one manual CLI run on the shipped example, and two attempts to
   import a copied module tree under `/tmp` for debugging.

## 7. Hashes of the selected inputs (round 3, before == after)

```
0ab5d99e9c3aa5763221db084b8b5cc90d13a9c891919e8590c0db868423c554  scripts/correspondence-batch/run.sh
6a669c72ad4681b1b091d40a7a7b46bba1bdbeeb369deffad36503a92c82bada  scripts/correspondence-batch/payload.sh
c9f1fa6a58ef135e71758244126d3e064f3112d4bcb795378d18f2b761a0b766  packages/analyzer/package.json
01882b673e6c96a7abb9e2bdd238619ea77b065306d3ecbc43200939a691950d  packages/analyzer/README.md   (pre-edit)
fb1241c5534c80d00ac2a127b29d4c5a50ccaee0a517ddb726fb7684ca9f977b  packages/analyzer/src/correspondence.js
3a3fe1e4d5a9f6ae2139a9eb9857cdac348308d2e6b2a6cd3324cfa5311496d7  packages/analyzer/src/correspondence.d.ts
902f55ede7aa883efc6bba7b3e52e9039bdcacaaf64b2caa63a2c744409739da  packages/analyzer/src/correspondence-cli.js
6512b8fe1909d8591a3aa2286a436c1e8825ec2163d7ad37b724ef962c401806  examples/correspondence/profile.yml
fe18f32d3a47d9f749721a44eb8b27c8203e8c3a9017b77ed0eda7384b961f0a  examples/correspondence/declaration.json
be1d9bae3af89e0af45b0d595c942f769f1ba7c542bd8570332af28fac438724  examples/correspondence/correspondence.json
287435d13640dc9a60b37e51560ba369058af4afc7dcefd2785781dfc73a5cc7  packages/analyzer/tests/correspondence.test.js
```

## 8. Reproduce

```bash
bash projects/dsh-compat-platform/scripts/correspondence-batch/run.sh
```

One invocation; the launcher exits 0 only when the static contract, the shipped demo (exit 1), the
stale refusal (exit 2) and the 43-test suite all report green.
