# `dsh-compat-diagnose` worked examples

Three input documents, one per lane that takes a file. They exist so that a
reader can run the command once and see what a report looks like, and so that
`packages/analyzer/tests/diagnose-spec-wiring.test.js` has something stable to
point at.

**All three are synthetic.** None was produced by a DSH host run; each was
authored to its grammar by hand. Nothing here is evidence about any real
plugin, and a `clear` outcome below says only "this document has nothing this
reader flags", never "this profile works".

## The files

| File | Lane | What it exercises |
| --- | --- | --- |
| `profile.yml` | `--profile` | A two-entry `--dump-config` export: both rows carry a `group` label, one is `disabled: true`, both have a `config` block, and the `# ==` origin comments are present as a real export writes them. |
| `runtime-evidence.json` | `--runtime` | A coexistence-evidence document reporting all three required cases as `passed`. |
| `admission-evidence.json` | `--admission` | An admission-evidence document with the four required catalog cases, one of them reported `refused`. |

## Running them

Each lane may need its own validator, resolved from this checkout's sibling spec
repository. From the **repository root** (`projects/dsh-compat-platform`):

```console
$ node packages/analyzer/src/diagnose-cli.js \
    --profile examples/diagnose/profile.yml \
    --static packages/analyzer/fixtures/clean.json \
    --declaration-validator ../dsh-compat-spec/src/index.js \
    --runtime examples/diagnose/runtime-evidence.json \
    --admission examples/diagnose/admission-evidence.json \
    --admission-validator ../dsh-compat-spec/src/admission-evidence.js
```

The two validators are the reference grammars from the spec repository, passed
by path: the CLI imports them, and nothing else about that checkout is used.
Those sibling paths are relative to the repository root, so run the command
from there, or pass absolute paths (a `file:` URL works too). The CLI resolves
a relative specifier against the current working directory, not against the
script's location.

## Expected outcomes

| Lane | Outcome | Why |
| --- | --- | --- |
| `profile` | `clear` (exit 0 on its own) | The export parses, every row is a mapping, no duplicate ids, no refused tags. |
| `static` | `clear` (exit 0 on its own) | `fixtures/clean.json` is valid per the reference declaration grammar. |
| `runtime` | `clear` (exit 0 on its own) | Three required cases, all `passed`, consistent with their assertions. |
| `admission` | **`attention` (exit 1 on its own)** | Valid grammar, but one case is reported `refused` (`ADMISSION_CASE_REFUSED`) and the four optional catalog cases are unreported (`ADMISSION_COVERAGE_UNKNOWN`). |

So the whole command exits `1`: at least one requested source needs attention.
That is the intended, documented reading — a `refused` case is an *observation*
the document carries, and an unreported optional case is *unknown coverage*,
never a pass. Neither is an error and neither is a refusal to read the document.

To see a clean exit, drop `--admission`:

```console
$ node packages/analyzer/src/diagnose-cli.js \
    --profile examples/diagnose/profile.yml \
    --static packages/analyzer/fixtures/clean.json \
    --declaration-validator ../dsh-compat-spec/src/index.js \
    --runtime examples/diagnose/runtime-evidence.json
$ echo $?
0
```

## What these examples deliberately do not show

- **No plugin is loaded, admitted or activated.** No lane in this command loads
  anything: `--static` validates grammar, `--runtime` summarises a self-report,
  `--admission` validates a document's shape and passes its own findings
  through.
- **No cross-source correlation.** The report says so: `correlation` is
  `"not-established"` and every lane keeps its own result object. The id in
  `profile.yml` and the ids in the other files have nothing to do with each
  other.
- **`runtime-evidence.json` is not a host record.** Its `baseline.commit` is a
  placeholder of forty zeroes and its own `limitations` say it is synthetic. A
  real record has a real commit; this one has nothing to authenticate.
- **The `!!js` case is not here.** To see `JS_EXPRESSION_NOT_EVALUATED` — an
  informational diagnostic that stays at exit 0 — add a `!!js` scalar to the
  profile export. It is never evaluated and its text is never copied out.
