# `evidence-cli` — summarizing one reported runtime-evidence receipt

`src/evidence-cli.js` reads **exactly one explicitly named** UTF-8 JSON file, hands
the parsed value to `summarizeRuntimeEvidence` from `src/runtime-evidence.js`, and
prints the resulting summary as deterministic JSON.

- Added by this change: `src/evidence-cli.js`, `tests/evidence-cli.test.mjs`, this
  document.
- **Not** wired in: `src/index.js`, `src/cli.js`, `src/exit-codes.js`,
  `package.json` and `src/analyze.js` are untouched. There is no `bin` entry, so
  the only way to run it is by explicit path:
  `node src/evidence-cli.js <receipt.json>`.
- **NOT RUN:** neither the CLI nor the new suite has been executed. Nothing here is
  a claim that the tests pass; this document states what they assert.

```
node src/evidence-cli.js <receipt.json>
```

## Two lanes, never merged

`src/analyze.js` answers *"what do these declarations claim"*. This CLI answers
*"what did some other process report about a real host"*. It therefore imports
nothing from the static lane — not `analyze.js`, not `report.js`, not even
`exit-codes.js` — and its output uses none of that lane's vocabulary
(`evidenceLevel`, `findings`, `analysisComplete`). A receipt can never upgrade,
refute or annotate the static analysis, and the static analysis is never printed
here.

## What it does

| Step | Guarantee |
| --- | --- |
| Arguments | Exactly one path. Zero, two or more, `-`, or anything starting with `-` is a usage error. No default path, no directory scan, no glob, no stdin. |
| Read | `open` → `fstat` on the descriptor → cap check → bounded loop → strict UTF-8 decode. 1 MiB hard cap. |
| Type | Only a **regular file**. Directory, FIFO, socket, device are refused after `fstat`, before a byte is read. |
| Parse | `JSON.parse` on the text. The receipt is data: nothing in it is imported, resolved as a specifier, or evaluated. |
| Summarize | `summarizeRuntimeEvidence(value)` — the existing module, unchanged. No second validation rule set is implemented here. |
| Output | One JSON document on stdout, one fixed diagnostic line on stderr. No file is written. |

Imports are limited to three Node built-ins (`node:fs`, `node:path`, `node:url`)
and the one fixed local module. There is no dynamic `import()`, no `require`, no
plugin/config/validator import, no subprocess, no network and no model call. A
test asserts that over the CLI's own source with comments stripped.

## Exit codes — a documented choice

| Code | Meaning | stdout |
| --- | --- | --- |
| `0` | Structurally valid **and complete**: all three required cases are `passed`. | full summary |
| `1` | Structurally valid but **incomplete**: at least one case is `failed` or `not-run`. | full summary |
| `2` | **Unusable**: usage, IO, oversize, non-UTF-8, parse failure, schema refusal, internal failure. | refusal document, or nothing |

The alternative — exit `0` for any structurally valid report, whatever its own
recorded statuses say — was considered and rejected, for one reason: `0` is the
only code a caller reads as *"this evidence is finished"*. A receipt whose own
statuses say `failed` or `not-run` is well formed but does not cover the matrix,
so it must not be indistinguishable from a clean one; `1` keeps it distinct while
still being distinct from *"there is no usable evidence at all"* (`2`).

Because the mapping is mechanical, a caller that disagrees can recompute its own
from the printed `summary.cases[].status` without re-reading the file. Any status
that is not exactly `passed` counts as incomplete, so an unexpected value degrades
to `1` rather than to `0`.

## Output shape

Valid receipt (exit `0` or `1`):

```json
{
  "valid": true,
  "issues": [],
  "summary": {
    "cases": [
      {
        "id": "same-name-conflict",
        "status": "passed",
        "evidenceTier": "real-host",
        "assertionCount": 1,
        "failedAssertionCount": 0,
        "limitations": ["only two host builds were exercised"]
      }
    ],
    "baseline": { "commit": "<40 hex>", "node": "v24.21.0" },
    "limitations": ["evidence came from one operator machine"],
    "certification": false
  }
}
```

Fields are emitted in a fixed order and cases in canonical `CASE_IDS` order, so
the same bytes give byte-identical output. Two runs are asserted equal.

`certification` is **passed through, never computed and never flipped**. It is
`false` because the module sets it so: `evidenceTier` is a string copied out of an
untrusted receipt, and nothing in a pure validator can authenticate that a real
host produced it. The CLI adds no certification claim of its own — exactly one
`certification` field appears in the output, and a test counts it.

Schema refusal (exit `2`):

```json
{
  "valid": false,
  "issues": [{ "code": "INVALID_SCHEMA_VERSION" }],
  "summary": null
}
```

Only issue **codes** are republished — never the validator's `message`, never its
`path`. Both can quote values from the receipt (a message may embed a field value
such as a commit string, and a field *name* can itself be as long as the file), so
message text is kept out of terminals and CI logs. Codes come from the module's
closed enum, are de-duplicated in document order, and are capped at 64 entries.
Callers that want the full, structured issue records call
`summarizeRuntimeEvidence` directly; the module is the documented API, and this CLI
is a verdict.

## The read: cap, type and encoding

- **1 MiB, refused rather than truncated** (`MAX_EVIDENCE_BYTES = 1048576`). A
  truncated document either fails to parse — indistinguishable from a broken
  receipt — or, worse, parses as a *smaller valid* document whose missing tail is
  invisible. Both are worse than an honest refusal, so a declared size over the cap
  is refused before reading, and the read loop stops at the cap and then probes one
  further byte so a file that grew (or a `fstat` that lied) is still refused.
- **`fstat` on the open descriptor, not `stat` on the path.** The type checked is
  the one actually reachable through the descriptor that will be read, so the check
  cannot be raced by swapping the path afterwards. `open` is the only step that
  resolves the path.
- **`O_NONBLOCK` on open.** Opening a FIFO for reading normally blocks until a
  writer appears; with `O_NONBLOCK` the open returns immediately, `fstat` sees a
  FIFO, and the file is refused instead of hanging the CLI. On a regular file the
  flag has no effect.
- **Strict UTF-8.** `new TextDecoder('utf-8', { fatal: true })` refuses an invalid
  byte sequence instead of substituting U+FFFD, which would silently rewrite the
  document. A leading BOM is consumed (the default `ignoreBOM: false`), so a
  BOM-prefixed receipt still parses.
- **Exactly one file is opened.** Nothing is read twice, and no second path is ever
  derived from the receipt.

## Error text

Every diagnostic this CLI prints is a fixed, non-secret string:

- no OS error message, no JSON parser message, no file path, no receipt content, no
  stack trace — none of them is ever interpolated into a message;
- a foreign thrown value (an `EACCES` naming the path, a dependency failure) is
  replaced by `evidence-cli: internal failure while summarizing; no summary was
  produced.`, so its text cannot reach the terminal;
- `--help` / `-h` prints usage on **stderr** and exits `0`: help is not an error,
  and it keeps stdout parseable as "a summary or nothing".

The one place receipt text does reach stdout is the summary itself: `limitations`
strings are copied into the output by the module. That is the data the operator
asked to summarize, not a diagnostic, and it is bounded by the 1 MiB cap.

## Symlinks, and why this is not a sandbox

Symbolic links are **followed**. Resolving or refusing them is the operator's
choice, not this tool's: a receipt is normally a file in a checkout or a link to
one, and a CLI that silently rejected links would be less predictable than one that
reports on what the descriptor actually refers to. `fstat` therefore judges the
*target* — a symlink to a directory is still refused as a non-regular file.

This is **not a sandbox**, and nothing here should be read as confinement:

- it does not confine the process: the file is opened with this process's
  privileges, anywhere on the filesystem the operator can already read;
- it does not make a hostile *document* harmless beyond what
  `summarizeRuntimeEvidence` already guarantees (parsed JSON carries own data
  properties only; accessor/proxy tricks are refused structurally or as a closed
  refusal);
- it does not promise termination for a pathologically slow filesystem, and the
  `O_NONBLOCK` note above is about one specific blocking case, not about isolation;
- it proves nothing about the receipt's truthfulness: `evidenceTier: "real-host"`
  is a claim copied from the file, and `certification` stays `false`.

## Testable API

`main(argv, io)` is exported and **returns** the exit code; it never calls
`process.exit`, never sets `process.exitCode` and touches no module-global state.
Every side effect goes through an injected `io`:

```js
import { main } from './src/evidence-cli.js';

const out = [];
const err = [];
const code = main(['receipt.json'], {
  stdout: (text) => out.push(text),
  stderr: (text) => err.push(text),
  readFile: (path) => '{"schemaVersion": ...}',   // may throw
});
```

- `readFile` receives exactly the one path argument, so a test can prove that no
  directory scan, no second read and no derived path happens;
- a throwing `readFile` exercises the IO refusal without touching the filesystem;
- the default `io` writes to `process.stdout` / `process.stderr` and reads with
  `readEvidenceFile`.

Auto-run is guarded: the CLI calls `main` only when this module is the process
entry point. The comparison resolves `process.argv[1]` to an absolute path, then to
a real path (so a symlinked shim or a differently-encoded URL still matches), and
falls back to a plain resolved-path comparison if `realpath` fails — a missing file
must never make an *imported* module execute. A test imports the module from a
scratch file and asserts that it prints nothing and exits `0`.

## Tests

`tests/evidence-cli.test.mjs` — deliberately `.mjs`: the package test script globs
`tests/*.test.js`, so this suite never joins a run already in progress. Run it
explicitly:

```
node --test tests/evidence-cli.test.mjs
```

Coverage, by group:

| Group | What it pins |
| --- | --- |
| Constants | exit table is `{0,1,2}` and frozen; the cap is exactly 1 MiB |
| Valid path | exit `0`, key order, no stderr, canonical case order, determinism |
| Certification | printed, `false`, exactly one occurrence, never derived |
| Incomplete | `failed` and `not-run` both exit `1` with a full summary; exit code is a function of the printed statuses |
| Lane separation | no `evidenceLevel` / `findings` / `analysisComplete`; only built-in + one local import; no dynamic load, subprocess, network or file write in the source; importing runs nothing |
| Usage | no arg, two args, `-`, unknown option → `2`; `--help` → `0` on stderr |
| IO/encoding | foreign throw → fixed internal text only; malformed JSON → no content echoed; empty file; parsed-but-not-evidence; wrong schema version; huge field cannot inflate the refusal output; status/assertion mismatch |
| Bounded reader | under cap, exactly at cap, one byte over (refused), directory, character device, invalid UTF-8, BOM, missing file |
| End to end | spawned `node src/evidence-cli.js`: `0`, `1`, `2`; directory; oversize; malformed; schema refusal |

## Limitations, stated plainly

- One file, one document: no batch mode, no stdin, no directory input.
- No schema negotiation: only `coexistence-evidence/0.1` is understood, because the
  module is the single source of truth and an unknown revision is refused there.
- The exit code is a convenience mapping, not a verdict about compatibility; `0`
  means "a well-formed receipt says every case passed", never "these plugins are
  compatible".
- The suite has not been run, and the CLI is not registered as a `bin`; wiring it
  into `package.json`, `index.js` or the existing `cli.js` is left to whoever owns
  those files.
