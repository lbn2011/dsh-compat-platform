# profile-dump acceptance batch — canonical-core migration

**SOURCE-ONLY: awaiting Lead bounded verification.** No migrated script has been
executed, syntax-checked or tested by this migration. Historical acceptance of older
bytes does not qualify these bytes. Canonical local [bounded-runner](<../bounded-runner/README.md>)
is the core from `c8123de9f7bec62f9b09b5a542cd8fe383169a67`; the spec pilot at
`1615ecf` informed this migration, without importing its workload or claiming its result.
The core remains `bounded-runner/1 source-review-unreleased` and is not modified here.

## Invocation and scope

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-batch/run.sh
```

No arguments. Use the absolute entry path so control-source closure matches.
`PROFILE_DUMP_RUNS_ROOT` retains its default `/data/dsh-ecosystem-test-artifacts/runs`;
any override must be absolute. One launch, no retries and no installation.
[run.sh](<run.sh>) calls `br_host_run` inside a dedicated subshell with errexit disabled.
[payload.sh](<payload.sh>) enters the verified envelope, retains both future syntax
substeps, the static Node contract, YAML snapshots and the original single-file test.
These future syntax substeps were not run during migration.

The static contract is unchanged: exact package test script, YAML `2.9.1` as the
only dependency, profile-dump bin and default/types export, required source/test
files, declared test glob and installed YAML version. Missing, unreadable or wrong
YAML produces static exit `3`, recorded as `acc_static_contract=blocked` and
`acc_block_reason=yaml_dependency_not_installed`, then acceptance `71`. It is not
silently skipped and never installs. Other static failures also map to `71`.

The workload arguments and sandbox remain:

```bash
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --chdir /root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer \
  -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
     NODE_OPTIONS=--max-old-space-size=192 \
     /www/server/nodejs/v24.21.0/bin/node --test --test-concurrency=1 \
       --test-reporter=tap tests/profile-dump.test.js
```

Only that test is executed, not the full package suite. Root is read-only; private
scratch, PID/network/IPC/UTS namespaces and die-with-parent are retained. The run
directory is not writable from the sandbox. The shipped diagnose profile example
used by the process-level tests remains an explicitly required selected input.

## Envelope, evidence and verdict

Fixed core policy: Type=exec, memory 384 MiB, swap 0, tasks 32, CPU 50%, runtime
120 seconds, Node heap 192 MiB, and one MemAvailable >= 819200 KiB gate. The core
checks actual cgroup membership and InvocationID in addition to effective limits.
Both cleaned Node environments explicitly receive `BR_NODE_OPTIONS`. The shared
nonblocking lock and expanded canonical unit-family guard precede launch; cleanup
can stop only the exact unit with a verified ownership receipt.

Evidence gates precede each syntax subprocess, static Node and test workload.
Node output destinations are opened and checked before starting Node; a failed
write or relay cannot become a green verdict. All explicit outcomes after valid
arguments call `br_payload_finish`; missing final evidence after a crash/signal is
also non-green at the host. The host alone writes the unit log.

YAML snapshots retain the sorted regular-file hashes immediately before/after the
test and reject a symlinked YAML directory or any symlink below it. Missing/broken
snapshots are evidence failure `73`; changed snapshots are workload failure `72`.
Diff execution/output errors are now explicitly evidence failures. Equality is only
a two-point observation, not provenance, installation integrity or transient-edit
protection. Strict core six-field TAP requires exactly one valid tests/pass/fail/
cancelled/skipped/todo summary, tests=pass>0, every other count zero and Node exit 0.
Malformed duplicates, missing fields, skipped tests and TODOs cannot pass.

Exits: `0` green; `70` refusal/unknown workload exit; `71` syntax/static/dependency
failure; `72` test/TAP/YAML drift; `73` evidence failure; `74` timeout/unconfirmed
terminal; `75` lock held; `76` run collision; `77` hash read/manifest failure;
`78` selected/control input drift. Precedence: evidence > hash > terminal > workload.
Raw syntax, static and Node return codes are retained separately from mapped exits.

## Selection and artifact changes

The core hashes [run.sh](<run.sh>), [payload.sh](<payload.sh>), its manifest and all
five modules, including payload-only imports. No additional sourced controls exist.
Workload selection requires the original package/source/test/example inputs and
adds this README, all regular files under analyzer source, tests (including helpers),
fixtures, and diagnose examples. Glob arrays include hidden/nested entries and
refuse empty required categories; selected paths must be absolute regular files.
This conservative selection is **not a dependency closure**. YAML is covered by
its separate snapshots; external tools/runtime, newly added files after selection
and transient edits restored between samples are not covered. Keep the checkout
immutable for an authorized run.

Artifact consumers must migrate:

- Combined `hashes-before/after/diff.txt` become `control-before/after.txt`,
  `selected-before/after.txt` and their diffs; selection counts distinguish controls
  and selected workload files and explicitly disclaim dependency closure.
- Old terminal-query/stop-confirm records become canonical terminal-before,
  optional terminal-after-stop, terminal and ownership records. Active-unit output
  and query status are combined; journal return code has its own record.
- Envelope/busctl records use canonical envelope-systemctl/getunit/runtime/effective,
  requested and memory-gate schemas; peaks explicitly mark measured/unavailable.
- Syntax, static contract/log/verdict, YAML manifests, workload, raw Node TAP/stderr,
  Node return code and TAP evidence remain. A syntax-run record and separate static
  return-code record are added. TAP diagnostics use `invalid` for missing, malformed
  or duplicate fields; the old byte/line diagnostic counts are not retained.
- Canonical payload-result/payload-evidence and host status replace the old local
  evidence counter/reporting. Raw logs remain authoritative.

## Historical evidence and non-claims

The [2026-11-08 record](<../../docs/testing/2026-11-08-profile-dump.md>) concerns the
pre-migration runner: first 65 tests / 64 pass / 1 fail, exit `72`; after correcting
only the tag-class expectation (`CORE_NOT_ALLOWED` for `!!python/…`, external URI
kept separate), one rerun passed 65/65, exit `0`. Dependency acquisition was a
separate authorized step that day. None of those observations verify this migration.
The decoded-byte-length documentation correction was also historical, not a new
workload change here.

A future green result would not establish real DSH host/plugin loading, configuration
schema validity, dependency provenance, complete exports, or `!!js` evaluation.
The suite exercises this package's inert summary; it does not qualify the full
package suite or prove that other tests are unaffected. Lead must perform the
separately authorized bounded verification before any current execution claim.
