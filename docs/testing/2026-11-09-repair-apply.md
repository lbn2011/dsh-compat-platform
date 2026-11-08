# Repair approval and apply — bounded verification record (2026-11-09)

Status: **executed, three invocations, two green rounds (the first failed on a typo in
the generated static contract, not in the package)**. Every number below is read from
`/data/dsh-ecosystem-test-artifacts/runs/` and was produced under the standard bounded
envelope. This is local evidence for one slice; it is not a certification, not a
loadability result, and not the full package suite.

## 0. Scope and non-claims

- What ran: `scripts/repair-plan-batch/` — static contract, the shipped preview example,
  the four-path approval/apply demonstration, then `tests/*.test.js` (42 tests).
- **No repair was applied to anything but a temporary copy.** The four-path step copies
  `examples/repair/profile.yml` into the sandbox's private `/tmp` and never writes the
  checkout; the batch compares that fixture's sha256 before and after and fails if it
  changed.
- **An approval is not authentication.** Nothing signs or verifies anything. The receipt
  records `approver: <label as written>`.
- **A backup is not a rollback.** `restoreFixture` rewrites one file from the byte copy
  taken before the write; it says nothing about anything else that happened.
- Nothing was loaded or activated; no DSH runtime, loader or profile was involved.
- 42/42 here is not additive with the earlier 25/25 of the plan/preview slice; the suite
  grew, and the earlier number describes earlier bytes.
- The accepted vocabulary is one operation: set `disabled` on one entry of an
  entry-list fixture. That is deliberate, not a limitation of the tests.

## 1. What changed

| File | Change |
| --- | --- |
| `packages/repair/src/repair-approval.js` | new. Digest-bound approval record: closed six-key schema, `allow`/`deny`, expiry as epoch ms, nine closed issue codes. |
| `packages/repair/src/repair-apply.js` | new. Pure decision (`decideApply`) plus frozen receipt construction; thirteen closed receipt keys, ten apply reason codes, six limitations. |
| `packages/repair/src/fixture-applier.js` | new. **The only module that writes.** Confinement checks, write-then-verify so `partial` is real, `restoreFixture` for recovery. |
| `packages/repair/src/repair-plan.js` | one limitation replaced: `NO_APPLY_PATH_EXISTS_IN_THIS_DELIVERY` → `APPLY_PATH_IS_CONFINED_TO_A_FIXTURE_DIRECTORY`, because an apply path now exists. |
| `packages/repair/src/repair-preview.js` | every verdict now carries `afterText` (null unless `ready`) so the applier writes exactly the text the preview showed. |
| `packages/repair/package.json` | exports `./repair-approval`, `./repair-apply`, `./fixture-applier`; description updated. |
| `packages/repair/tests/repair.test.js` | the S3 writer test narrowed to the pure modules; new test asserts the applier is the package's only writer. |
| `packages/repair/tests/repair-apply.test.js` | new. 17 tests: approval schema, expiry, denial, digest binding, stale plan, confined paths, applied, partial, recovery. |
| `examples/repair/four-paths.mjs` | new. Exercises expired / denied / partial / recovery on a temporary copy; exits 0 only when all four behave and the four receipts differ. |
| `scripts/repair-plan-batch/*` | new step 5d for the four paths; static contract extended (exports, confined-apply limitation, stale-claim check, writer located in exactly one module); 15 hashed inputs. |

## 2. Round table

| Round | Run directory | exit | tests | four paths | memory_peak | pids |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (failed) | `20261108T200300Z-repair-plan-batch-874443-5389` | 71 | — | — | — | — |
| 2 | `20261108T200401Z-repair-plan-batch-874769-6773` | 0 | 42/42 | pass | 36208640 B | 16 |
| 3 | `20261108T200418Z-repair-plan-batch-875087-26903` | 0 | 42/42 | pass | 36614144 B | 16 |

Round 1 died at the static contract with `SyntaxError: Unexpected token 'of'` because a
destructuring pattern in the heredoc was missing its closing `]` (`for (const
[moduleName, module of …)`). The package was untouched; the heredoc was corrected and
the contract block was then syntax-checked outside the envelope with `node --check`
before relaunching. Round 1 is kept here rather than deleted.

Rounds 2 and 3: `hashes-before.txt` byte-identical to each other (same 15 selected
inputs), each round's before == after, `envelope_mismatch=none`, `acc_static_contract=pass`,
`stderr_bytes=0`, terminal `load_state=not-found active_state=inactive sub_state=dead
main_pid=0`, `confirmation=settled`, `mem_available_kib` above the 819200 gate,
`MemorySwapMax=0`.

## 3. The four paths, as measured

From `four-paths.txt` of round 3 (`four_paths_rc=0`):

```
expired   status=refused  reasons=[APPLY_APPROVAL_EXPIRED]            wrote=false untouched=true
denied    status=refused  reasons=[APPLY_APPROVAL_DENIED]             wrote=false untouched=true
partial   status=partial  reasons=[APPLY_POSTCONDITION_NOT_OBSERVED]  wrote=true
          expectedDigest=06003af1…  actualDigest=97220b1b…
recovery  status=restored reasons=[]                                  digest=cb17e292…
```

Read as claims:

- The two refusals happened **before any byte was written**: `wrote=false` and the
  document digest still equalled `cb17e292…`.
- `partial` is a real state, not a hypothetical one: the file on disk no longer matched
  the postcondition, and the receipt carries both digests so a reader can see that.
- `recovery` restored the file to the exact digest it had before the attempt, using the
  `<name>.before` copy the applier took.
- The four receipts are distinct (`receipts-distinct` check).

The `partial` path uses a documented test seam: `hooks.afterWrite` rewrites the file in
the instant after the write to simulate a concurrent writer. Any write-then-verify
applier has that window; the hook makes it reproducible. No production caller passes it,
and the receipt does not pretend the interference came from the applier.

## 4. What the 42 tests pin

Approval: closed key set both directions, exact version, digest shape, decision
vocabulary, non-empty approver within 128 chars, integer expiry, note as string within
1024, unreadable expiry treated as lapsed.

Apply decision: plan invalid, approval invalid, approval-of-a-different-plan, expired,
denied, stale (document digest moved), postcondition mismatch, and the ready case that
returns the exact text the preview showed.

Confinement: absolute names, `..` escapes, missing root, root that is a file, missing
file, symlink, oversize; the applier never accepts a path outside the root it was given.

Receipt: closed thirteen keys, frozen `limitations`, `certification: false`, exactly one
of `refused`/`applied`/`partial`.

Recovery: restore returns `restored` only when the observed digest equals the backup's.

## 5. Deviations

1. Round 1 failed on a typo in the generated contract (see §2). No retry loop: one fix,
   then a fresh round.
2. The contract block was syntax-checked with `node --check` **outside** the envelope
   after that failure. It is a parse check that produces no evidence.
3. `packages/repair/README.md` and the platform `README.md` were edited after rounds 2–3,
   so their current bytes differ from the hashes in §6. Their run-time hashes are listed
   there; the record of what was measured stays valid.
4. Both rounds ran back to back on a host with ~1.6 GiB available, above the 819200 KiB
   gate; no round was launched while another unit was active.
5. `scripts/repair-plan-batch/*.sh` were already mode 755, so no `chmod` was needed.
6. `scripts/repair-plan-batch/run.sh` was edited **after** the rounds (one stale comment
   that still said the batch never applies anything). Its run-time hash is the one in §6;
   the edit changes no executable line. The runner was not re-run for a comment.
7. `docs/requirements-and-design/2026-11-09-platform-dev-plan.md` line 94 ("`apply`
   arrives in S5 only if S3 and S4 both land") was amended to record that S4 delivered the
   apply path, because S4's own gate required exercising four apply outcomes.

## 6. Hashes at run time (from `hashes-before.txt`, round 3)

```
64d227aa…  scripts/repair-plan-batch/run.sh
e9f19437…  scripts/repair-plan-batch/payload.sh
4576dd58…  packages/repair/package.json
5d379c86…  packages/repair/README.md          (edited after the rounds)
1396763d…  packages/repair/src/repair-plan.js
c29ccc0a…  packages/repair/src/repair-preview.js
1c4147b3…  packages/repair/src/repair-approval.js
bc8e22f4…  packages/repair/src/repair-apply.js
508b08d7…  packages/repair/src/fixture-applier.js
00f11d4c…  packages/repair/tests/repair.test.js
7f50c7c3…  packages/repair/tests/repair-apply.test.js
cb17e292…  examples/repair/profile.yml
c9d9a97d…  examples/repair/plan.json
fddfa4ac…  examples/repair/preview.mjs
774a59c4…  examples/repair/four-paths.mjs
```

## 7. Reproduce

```
bash projects/dsh-compat-platform/scripts/repair-plan-batch/run.sh
```

Exit codes: `0` pass, `70` envelope/argument problem, `71` static contract or syntax,
`72` a work step failed (tests, example, four paths), `73` evidence write failure,
`74` TAP fields unusable, `75`–`78` launcher-level failures (lock held, unit start,
terminal readback, hash mismatch).
