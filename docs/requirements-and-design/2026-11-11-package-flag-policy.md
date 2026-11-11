# The `private` flag across the four repositories (2026-11-11)

## The question this answers

On 2026-11-10 `private` was cleared from the five `dsh-compat-platform` packages and from
`dsh-compat-spec`, but left set on `dsh-plugin-kit` and `dsh-agent-test-driver`. That asymmetry
was a judgement call made in one slice and never written down as a rule, so it read as an
accident. This document makes it a rule, and each repository enforces its own side of it in a test.

## The rule

**`private` may be cleared only in a repository that can show its own evidence that the package is
publishable. Where that evidence does not exist, the flag stays `true`, and a test asserts that it
stays `true`.**

The flag is not a release decision — nothing here is published. Clearing it means "no local
safeguard is silently blocking a publish", not "this is released".

## Where each repository stands

| Repository | Packages | `private` | The evidence that justifies it | Enforced by |
| --- | --- | --- | --- | --- |
| `dsh-compat-platform` | 5 (`dsh-compat-platform`, `@dsh-compat/config-check`, `dsh-compat-diagnostics-ui`, `dsh-compat-repair`, `dsh-compat-trusted-extraction`) | **cleared** (2026-11-10) | `scripts/package-install/publish_audit.py` audits every tarball's members against an allowlist and reports blockers under `--standard public`; measured **0 blockers on all five** | `scripts/package-install/payload.sh` static contract (`private_absent_<dir>`) plus the audit |
| `dsh-compat-spec` | 1 (`dsh-compat-spec`) | **cleared** (2026-11-10) | `src/test/package.test.js` asserts the identity, the exact version and that `LICENSE` is the decided MIT text | that test |
| `dsh-plugin-kit` | 1 (`dsh-plugin-kit`) | **stays `true`** | No tarball audit and no publish path touches this package; it generates text and installs nothing | `tests/exports.test.js` (`pkg.private === true`) |
| `dsh-agent-test-driver` | 1 (`dsh-agent-test-driver`) | **stays `true`** | Same: no audit, no tarball, no publish path | `tests/package-identity.test.js` |

Clearing the flag on the kit or the driver without adding the evidence first would replace one
unexplained asymmetry with an unsubstantiated claim. If either should become publishable, the
missing piece is an audit of its tarball, not the flag alone.

## What the flag does not mean, in either direction

- `private: true` does **not** mean "unusable" — the kit and the driver are kept private because no
  publish path exists for them, not because they are incomplete.
- `private` cleared does **not** mean "released" or "supported" — no package is published, no npm
  scope or remote is decided, versions stay `0.1.0-draft.1`, and every artifact that prints a
  certification word still prints `false`.

## Verification on 2026-11-11

| Repository | Suite | Result |
| --- | --- | --- |
| `dsh-compat-platform` | analyzer / config-check / host / runtime / repair | 448 / 59 / 16 / 32 / 42, all pass |
| `dsh-compat-spec` | `src/test/*.test.js` | 105 / 105 |
| `dsh-plugin-kit` | `tests/*.test.js` | 189 / 189 (was red before this round; see its own record) |
| `dsh-agent-test-driver` | `tests/*.test.js` | 278 / 278, plus the new identity test |

Counts are per suite, measured on this machine, and **not additive**. These are local package runs,
not bounded envelope runs; no host was involved and nothing was loaded or installed.
