# repair-plan-batch — source-only bounded-runner migration

**Source-only; awaiting Lead bounded verification.** These migrated bytes have not
been executed, syntax-checked or tested. The historical two-green-round statement
for 2026-11-09 does not qualify this migration. No commits were made.
The local [core](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner/README.md>) is canonical `c8123de`; spec pilot `1615ecf` informed this integration.

## Interface and retained workloads

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/repair-plan-batch/run.sh
```

No arguments. `REPAIR_PLAN_RUNS_ROOT` can override the absolute artifact root
(default `/data/dsh-ecosystem-test-artifacts/runs`). [run.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/repair-plan-batch/run.sh>) makes one core call in a
dedicated subshell with `set +e` and `set -uo pipefail`; no retry.
[payload.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/repair-plan-batch/payload.sh>) preserves:

- Both in-envelope Bash syntax checks, then the original static contract: exact
  package name/private/module, no dependencies in all four dependency fields,
  string export targets present, all five expected exports, plan version,
  one operation kind, disabled-only flag vocabulary, confined-apply limitation,
  no stale no-apply limitation, no writer-named functions in pure modules, exactly
  applyApproved/restoreFixture applier writers and 1048576-byte fixture ceiling.
- The [preview example](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/examples/repair/preview.mjs>) at exit 0, checking the original exact output lines
  `preview: ready` and `nothing was written; no apply path exists`, plus unchanged
  checkout fixture digest. The latter line is a retained example assertion, **not
  a claim that the package has no apply path**.
- The [four-path example](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/examples/repair/four-paths.mjs>) at exit 0: pass marker, refused/partial/restored statuses,
  untouched=true and unchanged checkout fixture digest. It exercises approval/apply
  on a copy in private sandbox scratch; no checkout fixture is applied to.
- The serial TAP command with the original quoted `tests/*.test.js` argument.

The core enforces ownership/cgroup identity, memory384 MiB, swap0, tasks32,
CPU50%, runtime120s and one MemAvailable>=819200 KiB gate; shared nonblocking lock.
All Node invocations use an explicit cleaned environment and heap192. Each command
has an evidence gate and preopened stdout/stderr. All normal valid-argument exits
(including refusal) reach br_payload_finish. The strict six-field core TAP check
requires tests=pass>0 and fail=cancelled=skipped=todo=0, rejecting malformed,
missing and duplicate fields. This intentionally fixes the old repair verdict's
missing zero checks for cancelled/skipped/todo.

## Hash selection and scope

Core control hashes include wrapper, payload, manifest and all five modules;
no additional controls are sourced. Workload selection includes this README,
package manifest/README, every regular file recursively under repair src/tests
(including helpers/fixtures), and all repair examples. Original two test names
and both example scripts remain explicit required guards. This is a comprehensive
local selection, **not dependency closure**; Node/system tools are not hashed.
A green run would not prove a repair safe, authorized or applicable to a real host,
that a digest grants authority, or that DSH honours a field. Two-point fixture
hash equality cannot rule out an intermediate change reverted before the second hash.

## Exits

0 green; 70 argument/preflight/envelope refusal; 71 syntax/static contract;
72 preview/four-path/TAP verdict; 73 evidence failure; 74 timeout or unsettled
unit; 75 held lock; 76 directory collision; 77 hash failure; 78 control/selected
drift. Evidence failure overrides other verdicts.

## Artifact changes

`control-{before,after,diff}.txt` and `selected-{before,after,diff}.txt` replace
`hashes-{before,after,diff}.txt`; `selection.txt` now distinguishes counts and records
workload_dependency_closure=no. Core `terminal-before.txt`, optional
`terminal-after-stop.txt`, and `terminal.txt` replace terminal-query/stop-confirm
artifacts. `active-units.txt` combines query rc/output instead of a separate stderr
file. Ownership evidence, requested envelope, `payload-result.txt` and
`payload-evidence.txt` are added; status and peaks use core schemas.
Envelope records are `envelope-systemctl.txt`, `envelope-getunit.txt`,
`envelope-runtime.txt`, `envelope-effective.txt` and `memory-gate.txt`; peaks are
no longer appended to the former envelope-cgroup artifact.

Retained workload names: `syntax.txt`, `static-contract.mjs`, `static-contract.log`,
`static-verdict.txt`, `example-preview.txt`, `example-preview.err`,
`example-verdict.txt`, `four-paths.txt`, `four-paths.err`, `four-paths-verdict.txt`,
`workload.txt`, `node-tap.log`, `node-stderr.log`, `node.rc`, `tap-fields.txt`,
`tap-summary.txt`, `tap-verdict.txt`. Static stderr and rc are split into
`static-contract.err` and `static-contract.rc`; syntax streams/first-check rc are
separate artifacts. TAP fields become ok|invalid, summaries contain the six core
values (or <invalid>) without old byte/line counts, verdict adds tap_check_rc.
Host owns `unit.log`; no evidence files were generated by this source migration.
