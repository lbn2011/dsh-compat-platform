# dsh-compat-lifecycle-bootstrap

A host plugin that finishes what an install started.

Two things are left undone when a plugin is installed into a DSH profile: a
package that ships a build step expects someone to run it, and a bundle that
ships a patch block expects it to be merged into the profile's
`cordis.patch.yml`. This plugin does both, bounded, and says what it did.

```
plugin-manager/*  ──trigger──▶  re-read the package set  ──diff──▶  new module
                                                                      │
                                          package.json dsh.lifecycle.postInstall
                                                                      │
                                          run (deadline, output ceiling, allow-listed env)
                                                                      │
                                          exit 0 ──▶ dist/.dsh-patch.yml merged ──▶ HMR
```

## Why the events are only triggers

`plugin-manager/install-state` is emitted by the plugin manager as
`PluginInstallProgress`:

```ts
// @deepseek-ai/dsh-plugin-manager lib/types/types.d.ts:302-311
interface PluginInstallProgress {
  requestId: string;
  phase: 'installing' | 'cancelling' | 'applying';
  attempt?: { registry: string; index: number; total: number };
}
```

There is no package name, no path and no manifest in that payload. So this
plugin never reads an identity out of an event. An event means "re-read", and a
package is *new* when its module name appears in
`pluginManager.listBundles()` / `listPlugins()` after having been absent from the
previous read.

Two consequences are stated as limitations rather than papered over:

- `NEW_PACKAGE_IS_INFERRED_FROM_A_SET_DIFF_NOT_FROM_THE_EVENT`
- `INSTALL_THAT_CHANGES_NO_MODULE_NAME_IS_INVISIBLE_HERE`

An install that replaces the contents of an already-known module is invisible
here. And an empty answer from the plugin manager is treated as "no information",
not as "everything was removed": the service returns without touching its known
set, so a transient failure cannot make every installed package look new.

## Declaring a post-install script

In the package's own `package.json`:

```json
{
  "name": "my-plugin",
  "dsh": {
    "lifecycle": {
      "postInstall": {
        "script": "scripts/build.js",
        "args": ["--production"],
        "timeoutMs": 120000
      }
    }
  }
}
```

`postInstall` may also be a bare string (`"scripts/build.js"`) — the shorthand
form takes the defaults.

| Field | Type | Default | Bound |
| --- | --- | --- | --- |
| `script` | string | required | relative path inside the package, extension `.js` / `.mjs` / `.cjs` |
| `args` | string[] | `[]` | at most 16, each at most 512 characters |
| `timeoutMs` | number | `60000` | 100 … 600000 |

The declaration is a **file path**, never a shell string: the runner spawns
`process.execPath` with `shell: false`. There is no `PATH` lookup, so
`"postInstall": "npm run build"` is refused as an unsupported extension rather
than executed as a command line.

A declaration is checked as a whole. Any issue refuses the whole declaration and
the script does not run; a partly-understood declaration is not a declaration.

Codes (closed set, `src/lifecycle-manifest.js`): `PKG_NOT_OBJECT`,
`DSH_NOT_OBJECT`, `LIFECYCLE_NOT_OBJECT`, `LIFECYCLE_UNKNOWN_KEY`,
`POST_INSTALL_NOT_STRING_OR_OBJECT`, `POST_INSTALL_UNKNOWN_KEY`, `SCRIPT_MISSING`,
`SCRIPT_NOT_STRING`, `SCRIPT_EMPTY`, `SCRIPT_ABSOLUTE`, `SCRIPT_OUTSIDE_PACKAGE`,
`SCRIPT_EXTENSION_UNSUPPORTED`, `SCRIPT_RESOLVES_TO_PACKAGE_ROOT`,
`ARGS_NOT_ARRAY`, `ARGS_TOO_MANY`, `ARG_NOT_STRING`, `ARG_TOO_LONG`,
`TIMEOUT_NOT_NUMBER`, `TIMEOUT_OUT_OF_RANGE`.

## Running it

The child gets the host's `process.execPath`, an allow-listed environment
(`PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP`, `LANG`, `LC_ALL`, `TZ`,
`SYSTEMROOT`, `COMSPEC`, `PATHEXT`) plus `DSH_COMPAT_LIFECYCLE=1`, and:

- a wall-clock deadline (`timeoutMs`) that sends `SIGKILL`;
- a grace timer (`killGraceMs`, default 2000 ms) so a child that ignores
  `SIGKILL` cannot keep the host waiting;
- an output ceiling (`maxOutputBytes`, default 65536) that truncates at a UTF-8
  boundary and kills the child. The ceiling is enforced in bytes, so a chunk
  that would half-encode a character cannot push the recorded total past the cap.

Statuses are `ok`, `failed` (non-zero exit), `timeout`, `output-limit`,
`spawn-error`, `refused`.

## Merging the generated patch block

If the run is `ok` and the package ships `dist/.dsh-patch.yml`, the block is
merged into `$DSH_HOME/cordis.patch.yml` (home resolved from the plugin config,
then the `dshHomePath` service, then `DSH_HOME`, then `process.env.DSH_HOME`).

The merge is append-only and needs no YAML parser:

1. every `id:` in the block is collected (`- id: x`, `id: 'x'`, quoted or not);
2. if all of those ids already appear in the home file as bounded tokens on
   non-comment lines → `skipped`, nothing is written;
3. if some appear and some do not → `refused` with `PARTIAL_OVERLAP`, nothing is
   written (a half-applied patch block is worse than an unapplied one);
4. if none appear → a marker line and the block verbatim are appended.

The operator's existing bytes are never rewritten, re-indented or re-serialised;
the only edit is an append. A file that cannot be appended to safely (tabs,
multiple documents, a non-sequence root, over 1 MiB) is refused with a code
instead of being normalised.

Writing is `write tmp → rename`. Only after the rename does the plugin ask the
HMR service to reconcile (`hmr.runExclusive(() => hmr.reconcileProfile())`).
`HMR_IS_REQUESTED_NOT_VERIFIED`: the plugin knows it asked, not that the host
reloaded.

## Events

All names are namespaced under `dsh-compat/` so they cannot collide with host
events.

| Event | When | Payload |
| --- | --- | --- |
| `dsh-compat/lifecycle-state` | plan refused, run started, run finished | `{package, phase, code, jobId, exitCode, signal, durationMs, outputBytes, outputTruncated, output?, issues?, limitations?}` |
| `dsh-compat/lifecycle-log` | one output chunk, and a final marker carrying `exitCode` | `{jobId, argv, cwd, stream, text, exitCode?}` |
| `dsh-compat/lifecycle-patch` | merge outcome, and the reconcile request | `{package, status, code, addedIds, skippedIds}` / `{package, status:'reconcile-requested', warnings, pending, restartReason}` |

Output is **also** forwarded to the host's own `plugin-manager/install-log`
channel by default, because "I installed a plugin and it ran something" belongs
in the install log the GUI already shows. Forwarded chunks leave `requestId`
empty (they are not part of a registry request) and use
`jobId = dsh-compat-lifecycle:<package>:<sequence>` so they can be told apart
from pnpm output.

Set `forwardToHostLog: false` to keep only the structured event.

## Config

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `forwardToHostLog` | boolean | `true` | also emit `plugin-manager/install-log` |
| `mergePatches` | boolean | `true` | merge `dist/.dsh-patch.yml` after a successful run |
| `dshHome` | string | resolved | override the profile home directory |
| `bundlePatchPath` | string | `dist/.dsh-patch.yml` | block location inside a package |
| `maxOutputBytes` | positive integer | `65536` | per-run output ceiling |

Unknown keys throw: a misspelled `forwardToHostLog` must not silently keep
forwarding.

## What this plugin does not do

`BOOTSTRAP_LIMITATIONS` is part of the module's public surface:

- `NEW_PACKAGE_IS_INFERRED_FROM_A_SET_DIFF_NOT_FROM_THE_EVENT`
- `INSTALL_THAT_CHANGES_NO_MODULE_NAME_IS_INVISIBLE_HERE`
- `PATCH_MERGE_ASSUMES_A_WELL_FORMED_GENERATED_BLOCK`
- `HMR_IS_REQUESTED_NOT_VERIFIED`
- `SCRIPT_RUNS_ONCE_PER_DECLARATION_CHANGE`

And from the runner: `CHILD_INHERITS_HOST_PRIVILEGES`,
`CHILD_MAY_OUTLIVE_THE_DEADLINE_IF_IT_IGNORES_SIGKILL`,
`OUTPUT_IS_TRUNCATED_AT_THE_CEILING_NOT_COMPLETE`,
`ENV_ALLOW_LIST_WITHHOLDS_VARIABLES_A_SCRIPT_MAY_NEED`, `KILL_IS_NOT_A_SANDBOX`.

In particular this is **not** a sandbox. The child runs with the host's
privileges, the environment allow-list withholds variables rather than granting
new isolation, and killing a process is not containing it. The plugin also never
inspects the script's contents: `SCRIPT_CONTENT_IS_NOT_INSPECTED_OR_TRUSTED`.
Running a package's declared build step is a decision to trust that package.

## Tests

```
node --test --test-concurrency=1 "tests/*.test.js"
```

| File | Covers |
| --- | --- |
| `tests/lifecycle-manifest.test.js` | declaration grammar, containment, bounds, run identity |
| `tests/lifecycle-runner.test.js` | fake-spawn success/failure/signal, deadline, grace timer, output ceiling in bytes, env allow-list |
| `tests/patch-merge.test.js` | id collection, bounded-token detection, appended/skipped/partial-overlap, refusal codes |
| `tests/lifecycle-bootstrap.test.js` | baseline, set-diff, single-flight triggers, log forwarding, patch + HMR, refusals, detach |

The runner tests never spawn a real process: `spawn` is injectable, and the
fake child lets each test decide when data and `close` arrive. The orchestration
tests never touch a real file: `readFile` / `writeFile` / `rename` are injected.
