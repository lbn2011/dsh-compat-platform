# `dsh-compat-dependency-shape` — bounded acceptance record

**Status: executed. Two bounded rounds, both green.**

The runs, in order, exactly as they happened:

| # | Run directory | Payload rc | Tests | Example | Static contract | `yaml` snapshot |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `…/runs/20261108T172654Z-dependency-shape-batch-855415-26665` | `0` | `37/37` | `pass` | `pass` | `identical` |
| 2 | `…/runs/20261108T172714Z-dependency-shape-batch-855774-21210` | `0` | `37/37` | `pass` | `pass` | `identical` |

Raw artifacts live outside the repository, under
`/data/dsh-ecosystem-test-artifacts/runs/`. This record carries the figures; it is not a
substitute for those files.

## 0. Scope, and what this record does not claim

It records that one command, run as a child process under an explicitly bounded envelope,
produced the counters it documents for one shipped example and refused the malformed inputs its
suite pins.

It does **not** claim any of the following, and none of them was attempted:

- that a real DSH host or a real profile was involved — no export is produced by these scripts;
- that any plugin was loaded, activated, resolved or certified; `certification` stays `false`,
  `completeness` stays `"unknown"`, `runtimeValidation` stays `"not-performed"`;
- that any dependency is satisfied. Counting that a row declares `inject` is a statement about a
  document's shape, not about a service graph;
- that the `yaml` package is installed intact: the two-point manifest compares two instants;
- that the whole package suite is green — one test file is run, not the suite.

## 1. What was added

| File | Bytes of behaviour |
| --- | --- |
| `packages/analyzer/src/dependency-shape.js` | the summariser: parse prologue, safety walk, `inject` projection, closed code table |
| `packages/analyzer/src/dependency-shape.d.ts` | the shape, including the two counter invariants |
| `packages/analyzer/src/dependency-shape-cli.js` | one file in, one JSON document out, closed exit table |
| `packages/analyzer/tests/dependency-shape.test.js` | 37 tests: vocabularies, invariants, refusals, anti-drift cross-check, process-level exits |
| `packages/analyzer/package.json` | `bin` `dsh-compat-dependency-shape`; exports `./dependency-shape`, `./dependency-shape-cli` |
| `examples/dependency-shape/profile.yml` | the synthetic four-row example the run below exercises |
| `scripts/dependency-shape-batch/{run.sh,payload.sh,README.md}` | the bounded runner |
| `packages/analyzer/README.md` §14 | the command's documentation |

Nothing existing was modified except `package.json` (two new entries) and `README.md` (a new
section). `profile-dump.js` and its measured bytes are untouched.

## 2. The envelope, as measured

| Field | Round 1 | Round 2 |
| --- | --- | --- |
| `selected_inputs` | `10` | `10` |
| `hashes` | `identical` | `identical` |
| `envelope_mismatch` | `none` | `none` |
| `mem_available_kib` (gate `819200`) | `1213156` | `1165720` |
| `memory_peak` | `85929984` B | `68214784` B |
| `pids_peak` | `23` | `23` |
| `write_failures` | `0` | `0` |
| terminal | `not-found` / `inactive` / `dead` / `MainPID 0` / `settled` | same |
| unit runtime | `3.2 s`, CPU `1.5 s` | `3.1 s`, CPU `1.6 s` |

Both rounds selected the same ten inputs: `hashes-before.txt` is byte-identical between the two
run directories (`diff -q` → no output).

Both rounds used one transient `systemd-run` unit with `MemoryMax=402653184`,
`MemorySwapMax=0`, `TasksMax=32`, `CPUQuota=50%`, `RuntimeMaxSec=120`, one `MemAvailable` gate at
`819200 KiB`, and a single `flock -n` on `experiments/acceptance/runs/.acceptance.lock`. No round
was retried; both were green the first time they ran.

## 3. The shipped example, as measured

`examples/dependency-shape/profile.yml` → exit `0`, no diagnostics, and:

```
rows=4  rowsWithInject=3  injectAbsent=1  injectNull=1
injectSequence=1  injectMapping=1  injectOther=0
injectSequenceItems=2  injectNames=2  injectMappingKeys=1
```

which is exactly what `payload.sh` step 6a asserts (`example-check.err.txt` is empty, so the
inline checker printed nothing). The four rows are the four shapes the reader tells apart.

## 4. What the suite pins

`tests/dependency-shape.test.js`, `37` tests, `0` failures, on both rounds:

- the closed document shape, key order, and the three literal fields
  (`completeness: "unknown"`, `runtimeValidation: "not-performed"`, `certification: false`);
- the two counter invariants, on every fixture;
- the five `inject` words, including `null` as its own word and `absent` distinct from it;
- item words inside a sequence: `name`, `tagged` (`!!js`, recorded and never read), `non-scalar`;
- twelve refusal fixtures, each with its fixed code;
- the anti-drift cross-check: for every refusal fixture, `dependency-shape` and `profile-dump`
  agree on `ok` and on the refusal-code list;
- eight process-level cases: exit `0` on a clean export, exit `1` on an unmodelled `inject`
  shape, exit `2` on a refused document, a directory, and a non-UTF-8 file, exit `64` on four
  usage shapes, and exit `5` on a lost or throwing stdout write.

No fixture in the suite contains a real profile, a real plugin name or a real service name; the
identifiers are sentinels, and the suite asserts that none of them appears in the output.

## 5. Deviations, recorded rather than smoothed over

1. **Two local `node --test` runs of the new file happened before the bounded rounds**, outside
   any cgroup envelope, to find a broken fixture (round A: `36/37`, the `!!js` collection fixture
   was written as `- id: !!js {} 1`, which is a parse error rather than a tagged collection;
   fixed to `- id: !!js [1]`; round B: `37/37`). Those runs produced no evidence beyond "the file
   parses and runs", and they are not counted as rounds here. Nothing was changed in the
   implementation between the bounded rounds.
2. **`README.md` was edited after the runs** (this record's status line and §14.6). Its hash at
   run time was `780f47f200b47c8a22e544f14a74a583d2fbed2eecd882371ccd2274805e571a`; the committed
   bytes differ. This is stated instead of quietly omitting the file from the manifest.
3. **The file modes needed no fix this time** (both scripts were written `755`), unlike the
   earlier `diagnose-batch` and `profile-dump-batch` slices, where a `600` mode caused a refused
   launch.
4. The runner was produced by copying `scripts/profile-dump-batch` and renaming identifiers, then
   adding the example step and folding it into the verdict chain. The copies are visible in
   `run.sh`/`payload.sh` and their hashes are in §6; the shared envelope logic is byte-identical
   in shape, not in text.

## 6. Selected inputs at run time

From `hashes-before.txt` of round 1 (round 2's file is byte-identical):

```
1050aa20b8f9746ecc3697349e1ba4d2f723319c379ba2a61f3bd26b912e09c3  scripts/dependency-shape-batch/run.sh
91983c3f1d196b176cf58a73995f7e3433a60938ff8c7a3a8a5d6953104abc4c  scripts/dependency-shape-batch/payload.sh
eb4233dd8f23d05fab8e0415f9ace9b24f73a91ca89d170693e2d069241c3f46  packages/analyzer/package.json
780f47f200b47c8a22e544f14a74a583d2fbed2eecd882371ccd2274805e571a  packages/analyzer/README.md
0466b2ac8a3347248639abaa1c6acf87b8cf669fddb8acfabb8d8ed2127e3764  packages/analyzer/src/dependency-shape.js
73331c936ceace13d5fe20198de9c734b2b4e6f991724a04fd889e73b3ae5fcd  packages/analyzer/src/dependency-shape.d.ts
e586e44f4b3d0c67c109881e1c3c70e5677d4b54e4972fa33642e1f47363fecd  packages/analyzer/src/dependency-shape-cli.js
75b0c267e5c889420cacb45820d12b0f8067b49c18e8c0e1994b2cc1103128be  packages/analyzer/src/evidence-cli.js
cca3a576dce157031a55b67a65ccd79a93fa274b866d132839c11b23021f53c2  examples/dependency-shape/profile.yml
7f68a407bb5c39bb305ece07ae259e8dad6674159858849b795308cb35c8a56a  packages/analyzer/tests/dependency-shape.test.js
```

`packages/analyzer/node_modules/yaml` is **not** in this list: the selection is not a closure.
Its regular-file manifest is compared at two instants during each run (`identical` in both).

## 7. Reproduce

```bash
bash projects/dsh-compat-platform/scripts/dependency-shape-batch/run.sh
```

One unit, one workload, no retry. Raw artifacts go to
`/data/dsh-ecosystem-test-artifacts/runs/<stamp>-dependency-shape-batch-<pid>-<n>/`.
