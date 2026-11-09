# correspondence-batch — source-only bounded-runner migration

**Source-only; awaiting Lead bounded verification.** No execution, syntax checks,
tests or commits were performed for these migrated bytes. Historical runs do not
qualify this revision. The repository-local [core](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/bounded-runner/README.md>) is canonical `c8123de`; spec pilot `1615ecf` informed the integration.

## Interface and retained workloads

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/correspondence-batch/run.sh
```

No arguments. `CORRESPONDENCE_RUNS_ROOT` may override the absolute artifact root
(default `/data/dsh-ecosystem-test-artifacts/runs`). The original unit prefix is
`correspondence`, not `correspondence-batch`; the core guards both families.
[run.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/correspondence-batch/run.sh>) makes one core call, no retry, in a dedicated subshell with
`set +e` and `set -uo pipefail`. [payload.sh](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/correspondence-batch/payload.sh>) preserves these substeps:

1. Both Bash syntax checks; if both pass, all four original Node `--check` calls
   (module, declaration, CLI, test). A declaration parse is not a type check.
2. Static contract: private/module package, only pinned `yaml@2.9.1`, correspondence
   exports/files present, both exact version literals, identityDisclosed false,
   no module stdout writing, CLI bin name. Existing assertions are not strengthened
   into claims they do not check (export targets are not dereferenced here).
3. Shipped [correspondence](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/examples/correspondence/correspondence.json>), [profile](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/examples/correspondence/profile.yml>) and [declaration](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/examples/correspondence/declaration.json>) CLI invocation: **expected exit 1**. The checker retains
   pairs=3, matched=3, findings count=1 when supplied, a nonempty findings array,
   CORRESPONDENCE_PLUGIN_NOT_DECLARED and the original identity-leak checks.
4. Flip exactly one hex character of bindings.profileSha256 in an artifact copy;
   same CLI arguments with that copy: **expected exit 2**, a refusal carrying
   CORRESPONDENCE_STALE and the original identity-leak check. Both expected nonzero
   outcomes remain checked as workload data, not ignored or turned into runner errors.
5. Serial TAP invocation of [correspondence.test.js](</root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer/tests/correspondence.test.js>), unchanged arguments.

The core enforces ownership/cgroup identity, memory 384 MiB, swap 0, tasks 32,
CPU 50%, runtime 120s, one MemAvailable >= 819200 KiB gate and a shared nonblocking
lock. Every Node invocation (including syntax, checker and stale generator) uses
an explicit cleaned environment and heap192. Every command has a separate evidence
gate and preopened stdout/stderr. The stale document is also preopened before its
writer starts. Every normal valid-argument exit reaches the core finalizer.
Strict core TAP requires six singleton fields: tests=pass>0,
fail=cancelled=skipped=todo=0; malformed/duplicate/missing fields fail.

## Hashes and non-claims

Both scripts, core manifest and all five core modules are control-hashed before
and after; no additional controls are sourced. Selected workload inputs are this
README, package manifest/README, every regular analyzer src/tests file (helpers
and nested fixtures included), analyzer fixtures and the correspondence example
tree. This is a broad **selection, not dependency closure**; installed dependencies,
Node and system tools are not included. It does not prove real plugin loading,
capability provision, assertion truth, version correspondence or profile completeness.
Certification remains false; correlation remains not-established.

## Exits

0 green; 70 argument/preflight/envelope refusal; 71 syntax/static precondition;
72 demo/stale/TAP verdict; 73 evidence failure; 74 timeout or unsettled unit;
75 held lock; 76 directory collision; 77 hash failure; 78 control/selected drift.
Evidence failures override otherwise green or non-green workload results.

## Artifact changes

The former `hashes-before.txt`/`hashes-after.txt`/`hashes-diff.txt` are replaced by
separate `control-{before,after,diff}.txt` and `selected-{before,after,diff}.txt`.
`selection.txt` separates counts and explicitly says workload_dependency_closure=no.
Core `terminal-before.txt`, optional `terminal-after-stop.txt`, and `terminal.txt`
replace terminal-query/stop-confirm artifacts. `active-units.txt` combines query rc
and output; no separate active-units stderr. The core adds ownership evidence,
requested envelope, `payload-result.txt` and `payload-evidence.txt`; status and
peaks use core schemas. Envelope files are `envelope-systemctl.txt`,
`envelope-getunit.txt`, `envelope-runtime.txt`, `envelope-effective.txt` and
`memory-gate.txt`. `argv.txt`, launch/unit/journal artifacts remain core-owned.

Retained workload artifacts include `syntax.txt`, `static-contract.mjs`,
`static-contract.log`, `static-verdict.txt`, `check-output.mjs`, `make-stale.mjs`,
`stale-correspondence.json`, example/stale stdout, stderr, rc, checker logs and
verdicts, `workload.txt`, `node-tap.log`, `node-stderr.log`, `node.rc`,
`tap-fields.txt`, `tap-summary.txt`, `tap-verdict.txt`.
Static stderr/rc are now separate `static-contract.err`/`static-contract.rc`;
syntax stdout/stderr and intermediate Node check rc files, checker rc files and
`stale-flip.err`/`stale-flip.rc` are added. No fictitious tap directory is produced.
TAP field states are now ok|invalid, summaries contain six values (or <invalid>)
without old byte/line counts, and verdicts include tap_check_rc.
Only the host writes `unit.log`. No run artifacts were produced by this migration.
