# C2 lifecycle bootstrap — post-install scripts and patch merge

Scope: `packages/lifecycle-bootstrap` (t10, `[platform-c2]`). This record covers
the design decisions that are not obvious from the code, the one bounded
verification round, and what that round does not establish.

State: **verified green — one bounded round**. Run
`20261112T162712Z-lifecycle-bootstrap-batch-1729920-16455` (2026-11-13 00:27
Asia/Shanghai), `acceptance_exit=0`.

---

## 1. Why the events are only triggers

The requirement document this work descends from shows the install event arriving
with a package identity:

```js
// docs/requirements-and-design/2026-11-12-dsh-plugin-extension-capability-boundary.md:179-181
{ state: 'installed', path: '/…/node_modules/x', pkg: { … } }
```

> **NOTE (documentation defect).** That example does not match the implementation
> it names. The real signal is `plugin-manager/install-state`, and its payload is
> `PluginInstallProgress` in
> `@deepseek-ai/dsh-plugin-manager/lib/types/types.d.ts:302-311`:
>
> ```ts
> interface PluginInstallProgress {
>   requestId: string;
>   phase: 'installing' | 'cancelling' | 'applying';
>   attempt?: { registry: string; index: number; total: number };
> }
> ```
>
> There is no package name, no path and no manifest. The design document was
> written during the UI-design phase without checking the emitted type; it should
> be corrected in a documentation pass. Nothing in this implementation depends on
> the wrong shape.

Because the payload carries no identity, a package is **inferred from a set
diff**: `pluginManager.listBundles()` / `listPlugins()` are re-read on every
trigger and a module name that was absent from the previous answer is new. Two
consequences are declared as limitations rather than papered over:

- `NEW_PACKAGE_IS_INFERRED_FROM_A_SET_DIFF_NOT_FROM_THE_EVENT`
- `INSTALL_THAT_CHANGES_NO_MODULE_NAME_IS_INVISIBLE_HERE`

A re-install that replaces the contents of an already-known module is invisible
to this design. An empty answer from the plugin manager is also treated as "no
information" — the known set is left untouched — so a transient failure cannot
make every installed package look new and re-run every script.

## 2. What the declaration is, and is not

`dsh.lifecycle.postInstall` names a **file inside the package**:

```json
{ "dsh": { "lifecycle": { "postInstall": { "script": "scripts/build.js", "args": ["--production"], "timeoutMs": 120000 } } } }
```

It is never a shell string. The runner spawns `process.execPath` with
`shell: false` and no `PATH` lookup, so `"postInstall": "npm run build"` is
refused as `SCRIPT_EXTENSION_UNSUPPORTED` — a decision, not an accident: a
declaration that can only be interpreted by a shell is not a declaration this
plugin can bound.

The declaration is checked as a whole (`readLifecyclePlan`): containment
(`SCRIPT_ABSOLUTE`, `SCRIPT_OUTSIDE_PACKAGE`), extension
(`SCRIPT_EXTENSION_UNSUPPORTED`), bounds (`ARGS_TOO_MANY`, `ARG_TOO_LONG`,
`TIMEOUT_OUT_OF_RANGE`), grammar. Any issue refuses the declaration and the
script does not run — a partly-understood declaration is not a declaration.

## 3. The run is bounded, and the bounds are honest

| Bound | Mechanism | Declared limitation |
| --- | --- | --- |
| time | wall-clock `setTimeout` → `SIGKILL`, plus a `killGraceMs` timer that settles the run even if the child ignores `SIGKILL` | `CHILD_MAY_OUTLIVE_THE_DEADLINE_IF_IT_IGNORES_SIGKILL`, `KILL_IS_NOT_A_SANDBOX` |
| output | ceiling counted in **bytes**, cut backed off to a UTF-8 boundary | `OUTPUT_IS_TRUNCATED_AT_THE_CEILING_NOT_COMPLETE` |
| environment | allow-list (`PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP`, `LANG`, `LC_ALL`, `TZ`, `SYSTEMROOT`, `COMSPEC`, `PATHEXT`) + `DSH_COMPAT_LIFECYCLE=1` | `ENV_ALLOW_LIST_WITHHOLDS_VARIABLES_A_SCRIPT_MAY_NEED` |
| privilege | none | `CHILD_INHERITS_HOST_PRIVILEGES`, `SCRIPT_CONTENT_IS_NOT_INSPECTED_OR_TRUSTED` |

The byte ceiling found a real defect during development: the first
implementation sliced the chunk at `room` bytes and decoded it, so a cut inside a
multi-byte character produced `U+FFFD`, which re-encodes to three bytes and
pushed the recorded total *past* the ceiling. `truncateUtf8` now backs the cut off
by at most three bytes until the decoded text re-encodes inside the room, with a
bounded number of attempts so a chunk of invalid bytes cannot turn this into a
scan. The regression test is
`tests/lifecycle-runner.test.js: "the ceiling counts bytes, not characters"`
(`'你好'` is six UTF-8 bytes against a five-byte ceiling).

## 4. The patch merge never rewrites the operator's file

`dist/.dsh-patch.yml` is merged into `$DSH_HOME/cordis.patch.yml` by string
append, with no YAML parser and no re-serialisation:

1. collect every `id:` in the block;
2. all ids already present as bounded tokens on non-comment lines → `skipped`,
   nothing written;
3. some present, some not → `refused` / `PARTIAL_OVERLAP`, nothing written;
4. none present → marker line + the block verbatim appended, then
   `write tmp → rename`, then `hmr.runExclusive(() => hmr.reconcileProfile())`.

A home file that cannot be appended to safely (tabs, multiple documents, a
non-sequence root, over 1 MiB) is refused with a code instead of normalised. This
is the conservative alternative to importing `dsh-plugin-kit`'s `patch-yaml.js`
across repositories: duplicating a YAML implementation in two places would be
worse than a narrower merge rule, and rewriting comments and indentation the
operator wrote would be worse than either.

`HMR_IS_REQUESTED_NOT_VERIFIED`: the plugin knows it asked the HMR service to
reconcile, not that the host reloaded.

## 5. Log forwarding

Output goes to the host's own `plugin-manager/install-log` channel by default, on
the captain's ruling that "I installed a plugin and it ran something" belongs in
the install log the GUI already shows. The forwarded chunks leave `requestId`
empty (they are not part of a registry request) and use
`jobId = dsh-compat-lifecycle:<package>:<sequence>` so they can be told apart
from pnpm output. The structured `dsh-compat/lifecycle-log` event is emitted in
parallel, and `forwardToHostLog: false` turns the host channel off without
losing the structured one.

## 6. The bounded round

Command (absolute entry path is mandatory — a relative path fails the core
closure check with 77):

```
TMPDIR=/root/kit-scratch/tmp bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/lifecycle-bootstrap-batch/run.sh
```

| Fact | Value | Source file |
| --- | --- | --- |
| run directory | `/data/dsh-ecosystem-test-artifacts/runs/20261112T162712Z-lifecycle-bootstrap-batch-1729920-16455` | wrapper stdout |
| acceptance | `acceptance_exit=0`, `phase=completed`, `terminal_ok=yes`, `hash_rc=0`, `write_failures=0` | `status.txt` |
| tests | `tap_tests=58 tap_pass=58 tap_fail=0 cancelled=0 skipped=0 todo=0` | `tap-summary.txt` |
| TAP fields | all six `tap_field_*=ok` | `tap-fields.txt` |
| TAP verdict | `tests_exit=0 tap_check_rc=0 verdict=pass` | `tap-verdict.txt` |
| static contract | `acc_static_contract=pass` (39 checks, `static_contract_failures=none`) | `static-verdict.txt`, `static-contract.log` |
| envelope | `MemoryMax=384M MemorySwapMax=0 TasksMax=32 CPUQuota=50% RuntimeMaxSec=120` | `argv.txt` |
| peaks | `memory_peak=34488320` (32.9 MiB), `pids_peak=16`, both `measured` | `peaks.txt` |
| control closure | `control_files=8`, `control-before.txt` = `control-after.txt` | `selection.txt`, `control-diff.txt` (empty) |
| selected inputs | `selected_workload_files=12`, before = after | `selected-before.txt`, `selected-diff.txt` (empty) |
| workload | `workdir=…/packages/lifecycle-bootstrap`, `test_glob=tests/*.test.js`, `node_rc=0` | `workload.txt`, `node.rc` |

The slice takes **no `yaml` snapshot** because this package has no `yaml`
dependency; `yaml-manifest-before.txt` / `-after.txt` do not exist in the run
directory. (A first self-check that diffed those two paths printed "DIFFERS";
that was `diff`'s exit status for two absent files, not a content change.)

### 6.1 Name-level verification

`tap_tests=58` is a total, and a total can be right for the wrong reason. Every
declared test name was matched against the `# Subtest:` headers in
`node-tap.log`:

| File | Declared | Missing |
| --- | --- | --- |
| `tests/lifecycle-bootstrap.test.js` | 18 | 0 |
| `tests/lifecycle-manifest.test.js` | 14 | 0 |
| `tests/lifecycle-runner.test.js` | 14 | 0 |
| `tests/patch-merge.test.js` | 12 | 0 |
| **total** | **58** | **0** |

`# Subtest:` headers: 58. Unmatched headers left over: 0. So the 58 passing
tests are the 58 tests this package declares — none was replaced by a file-level
shortcut.

## 7. What this round does not establish

- No real install was performed. The trigger path is exercised against a fake
  plugin manager whose answer the test controls; the events carry no package
  identity, and that gap is the reason for the set-diff design, not something the
  round closes.
- No real script was executed. `spawn` is injected in every runner test; the
  deadline, grace timer, ceiling, and environment filter are driven by a fake
  child. `KILL_IS_NOT_A_SANDBOX` is unaffected by passing tests.
- No real `cordis.patch.yml` was edited. The merge is a pure function over
  strings; `writeFile`/`rename` are injected in the orchestration tests.
- No HMR reload happened. `HMR_IS_REQUESTED_NOT_VERIFIED`.
- The slice's static contract checks the package's own shape, the exported
  vocabulary, and a handful of behavioural invariants — it is not a review of the
  design.

## 8. Files

| Path | Role |
| --- | --- |
| `packages/lifecycle-bootstrap/src/lifecycle-manifest.js` | declaration grammar and containment |
| `packages/lifecycle-bootstrap/src/lifecycle-runner.js` | bounded child process |
| `packages/lifecycle-bootstrap/src/patch-merge.js` | append-only patch merge |
| `packages/lifecycle-bootstrap/src/lifecycle-bootstrap.js` | triggers, set diff, orchestration, events |
| `packages/lifecycle-bootstrap/src/index.js` | Cordis entry, config closure, `compatLifecycle` |
| `packages/lifecycle-bootstrap/tests/*.test.js` | 58 cases |
| `scripts/lifecycle-bootstrap-batch/{run.sh,payload.sh,README.md}` | bounded slice |
| `scripts/bounded-runner/{policy.sh,core.manifest}` | allow-list entry (captain-authorised) and regenerated hashes |
