# tests/integration — the platform's side of the t12 integration suite

Cross-cutting tests that the per-package suites cannot write: they build artifacts
with `dsh-plugin-kit`, judge them with `dsh-compat-spec`, and load the result here.
They live outside `packages/` on purpose — a package's suite may only test that
package, and these test the handoffs between all three repositories.

Run them from the repository root:

```bash
node --test --test-concurrency=1 'tests/integration/*.test.mjs'
```

Thirty-five cases, `--test-concurrency=1` because several of them spawn real
subprocesses and measure process counts. Outside the bounded envelope three
resource-budget cases skip themselves, by design: their subject is the envelope.

## What each file is for

| file | cases | subject |
| --- | --- | --- |
| `conflicts-c1-c11.test.mjs` | 12 | the eleven conflict scenarios, one case each, plus a self-check that the suite still covers the closed list C1…C11 |
| `layers-e2e.test.mjs` | 8 | the Layer 1→4 chain: L1 executes a kit-generated plugin for real, L2 runs A1/A2/A3 over the same declaration, L3 turns a declared patch into YAML the loader would read, L4 merges a bundle block, plus one test that hands a real artifact from each layer to the next |
| `patch-approval.test.mjs` | 5 | propose → review → approve → apply, with the approval digest bound to the patch bytes, and what tampering/expiry/denial do |
| `bundle-install.test.mjs` | 5 | a bundle install through `createLifecycleBootstrap` against a fake host: block appended, one atomic write, operator rows byte-identical, one reconcile requested |
| `resource-budget.test.mjs` | 5 | the envelope's own numbers: 384 MiB, 32 tasks, 120 s, `--max-old-space-size=192`, and the kernel's cgroup agreeing |
| `helpers/contract.mjs` | — | paths, versions, envelope facts, and the cgroup reader the budget test uses |

## What the suite found (recorded, not fixed)

These are properties of the implementation as it stands. The tests assert them so
that a future change is a visible decision rather than an accident:

1. **A bundle patch is merged only for packages that also declare `dsh.lifecycle`.**
   `runOne` returns early when `readLifecyclePlan` yields `null`, so a patch-only
   bundle (a `dsh.bundle.patch` and nothing else) is never applied.
2. **`mergePatchBlock` does not consult an approval record.** Its signature is
   `{homeText, block}`. An approval artifact therefore proves that somebody wrote
   it, not that anybody checked it; the gate has to live in the caller.
3. **`staticPreCheck` takes one platform for a whole package.** A `combined`
   package has a browser row and a host row, so asking about a host platform
   reports C6 against its own client row. Recorded as the tool's single-platform
   assumption; the suite asserts the C6 rather than suppressing it.
4. **The kit sanitises scaffolded tool keys**, so no kit-generated plugin can
   trigger C9 (reserved prefix) — C9 has to be constructed by hand, which the test
   does.

## Recorded runs

Bounded envelope runs are recorded in `docs/testing/2026-11-13-integration-t12-platform.md`;
the raw evidence is under `/data/dsh-ecosystem-test-artifacts/runs/<run id>/`.
The wrapper that produces them is `scripts/integration-batch/` (see its README).

## Limits of this suite

Nothing here certificates anything. Every declaration, patch and approval it builds
is a static artifact; the one case that loads a plugin loads it into a scratch
context, not into a running DSH profile. No host was asked whether it would accept
any of these packages.
