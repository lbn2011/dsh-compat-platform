# Migration of the install, packaging and extraction runners (2026-11-10)

Status: **executed**. Two of the three migrated launchers ran green; the third
refused by design because its target already exists. Every figure below is read
from a named artifact in the run directory, not from memory or from the prose of
an earlier record.

Scope: the last three of the twelve maintained launcher/payload pairs, moved onto
the canonical shared bounded runner (ABI `bounded-runner/1`, core commit
`c8123de`). The workload of each pair is carried over unchanged; only the host
layer changed.

Non-claims, stated before the numbers:

- Three of twelve pairs. This is not the full package suite.
- No host acceptance, no plugin loading, no profile read, no certification, no
  loadability claim.
- One sample per pair (two for two of them); repetition here is not a
  distribution.
- Historical records remain valid for their own bytes and are not superseded by
  this one.
- The configuration checker does not exist yet, and this record says nothing
  about it.

## 1. Disclosure

The three pairs were rewritten to the core by a subagent **without executing
anything**. The Lead reviewed each payload and launcher, then ran them. Where a
run exposed a gap the Lead edited the payload and re-ran, both runs are listed.

Absolute entry paths are required: the core binds every source frame to the
absolute control list, so a relative invocation refuses with 77 before any lock,
run directory or unit.

## 2. Shared envelope

All runs: 384 MiB memory, swap 0, 32 tasks, 50 % of one core, 120 s wall clock,
`Type=exec`, `mismatch=0` against the expected cgroup values, settled terminal
state, `hash_rc=0`, `write_failures=0`, `acceptance_exit=0`.

Read-back quirk, repeated from the earlier records: `envelope-runtime.txt` is
truncated by the manager's output format; `envelope-effective.txt` carries the
authoritative `RuntimeMaxUSec=120000000`.

## 3. Results

### 3.1 `package-install` — green, twice

| run | envelope | tarballs | install | consumer probe | missing dependency | peaks |
|---|---|---|---|---|---|---|
| `…20261109T185531Z-package-install-1155859-11026` | exact | `pack_failures=none tarballs=5` | `install_rc=0` | `consumer_rc=0`, 24 checks | `ERR_MODULE_NOT_FOUND` | 64425984 B / 15 pids |
| `…20261109T190148Z-package-install-1162612-1918` | exact | `tarballs=5` | `install_rc=0` | `consumer_rc=0`, 24 checks | `ERR_MODULE_NOT_FOUND` | 61542400 B / 15 pids |

The second run exists because the Lead moved `br_envelope_enter` in front of the
payload's preconditions, matching the other two payloads: the envelope must be
established before any subprocess runs, including a presence check. Both runs are
green, so the reorder did not change the workload outcome.

The five tarballs are byte-identical to the 2026-11-09 record except the platform
tarball:

| tarball | sha256 | bytes |
|---|---|---|
| `dsh-compat-diagnostics-ui-0.0.0-draft.1.tgz` | `3779941b003b8452ab8c627b3970e17f2e6a9212752206c2fafd8e5d891848c0` | 10984 |
| `dsh-compat-platform-0.0.0.tgz` | `1d7c3ae257073ff79dc7d6085e68235f0f280b59a1d0ff513131390d1818a99f` | 166491 |
| `dsh-compat-repair-0.0.0-draft.1.tgz` | `bf2086dad71fab6795f8e69a1431e82763d70bd459ad5ea9078b329d52275719` | 13587 |
| `dsh-compat-trusted-extraction-0.0.0-draft.1.tgz` | `b220d0766b43b84a45d4c5984317fe2cf41df7b33a09e563521f4f8f7f42bbe0` | 10730 |
| `yaml-2.9.1.tgz` | `5648e80d3e8969770b61c1e3a48b701dea49cf6b690b039221bfd3df91a2a0c1` | 112446 |

The platform tarball differs from 2026-11-09 (`9c17a643…`, 152807 B) because the
analyzer sources gained modules since then — the correspondence command, the
provenance projection and the dependency-shape command. That is a content change
the packaging step is supposed to notice, not drift.

Selection: 8 control files, 19 selected workload files,
`workload_dependency_closure=no`; both diffs empty.

### 3.2 `profile-dump-install` — refused by design, success path unverified

One invocation. It exited non-zero **before creating any unit or run directory**:

```
refusing: install target already exists (this batch never replaces it):
/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer/node_modules/yaml
```

This is the batch's standing rule — a one-time installer never replaces an
existing installation — so the refusal is correct behaviour, not a defect. It
also means the migrated installer's success path was **not exercised** in this
round, and no figure is claimed for it. The pre-migration numbers quoted in that
runner's README remain the only measurement of an install on this machine, and
they describe different bytes.

`profile-dump-install` is therefore the one pair counted as "migrated and
refusal-verified, workload unverified" in the migration status.

### 3.3 `trusted-extraction-batch` — green, twice, after an added artifact

This pair is an **uplift, not an equivalence refactor**. The workload is
unchanged: the uid 65534 sandbox with `--unshare-net`, the sentinel probe, the
observed `ENETUNREACH` errno, the phase-budget `SIGKILL`/hang path and the six
failure-path checks. What it gains is a host layer it never had:

| before | now |
|---|---|
| `Type=simple` (systemd default) | `Type=exec` |
| no ownership record; a name-only stop could hit a foreign or reused unit | invocation receipt plus ownership-gated stop |
| `systemctl show …` appended with `|| true`, never read | verified terminal state with a settled-or-74 verdict |
| relative `sha256sum` list, no drift verdict | declared control closure and two-point hashing |
| node's exit status alone | strict TAP with the six-field gate |

Limits are not weakened: the old launcher already declared 384 MiB / swap 0 /
32 tasks / 50 % CPU / 120 s, which is exactly the core's envelope, so no override
was needed. The core adds two constraints this batch lacked: a 192 MiB V8 heap and
its own `MemAvailable ≥ 819200 KiB` gate.

| run | six-field TAP | phases | cleanup | failure-path checks | isolation | peaks |
|---|---|---|---|---|---|---|
| `…20261109T185614Z-trusted-extraction-batch-1156894-15514` | absent (payload predates the artifact) | all five `observed` | `confirmed` | six true, `failed=[]` | gate `none`, `uid=65534` | 37621760 B / 21 pids |
| `…20261109T185908Z-trusted-extraction-batch-1159776-4134` | `tests=29 pass=29 fail=0 cancelled=0 skipped=0 todo=0` | all five `observed` | `confirmed` | six true, `failed=[]` | gate `none`, `uid=65534` | 37056512 B / 21 pids |

The first run already enforced the six-field contract through `br_tap_check`
(`tests == pass`, zero fail/cancelled/skipped/todo, normalisation success), but
wrote the fields only into a human-readable summary. The Lead added a
`tests-fields.txt` artifact that is written **after** that check and re-ran. The
second run's `abi=bounded-runner/1` line and ownership receipt confirm the launch
went through the core, not through the old hand-rolled `systemd-run` path.

## 4. Artifacts changed by this migration

| pair | before | after |
|---|---|---|
| all three | own launcher wrote limits, hashes and terminal state in its own idiom | core writes `envelope-*`, `ownership*`, `control-*`, `selected-*`, `status.txt` |
| `profile-dump-install` | own `envelope-cgroup.txt`, `envelope-busctl*.txt`, `envelope-verdict.txt`, `evidence-gate.txt` | core equivalents |
| `package-install` | `run.txt`, `tap-verdict.txt` | gone; that workload has no TAP stream |
| `trusted-extraction-batch` | payload took one argument (run dir) | payload takes two (`unit`, `run`), as the core launches it |
| `package-install` | 21 hashed inputs | 19 selected inputs; the two scripts became control sources covered by the control closure — same bytes, different mechanism |

Exit-code vocabularies are **not** interchangeable between versions. The old
launchers used 75/76/77 for mkdir, lock-open and lock-held; those meanings are the
core's 75 lock-held, 76 run collision and 77 manifest-or-relative-path. The three
READMEs warn against carrying the old reading forward.

#### One capability lost

`trusted-extraction-batch` used `-p PrivateTmp=no`. The core's `systemd-run` argv
is fixed and cannot express it. Nothing in that workload depends on a shared
`/tmp`: the supervisor mounts its own `--tmpfs /tmp` inside the sandbox and every
artifact lives under `$RUN`. The loss is real but not load-bearing, and it is
stated here rather than silently dropped.

## 5. What a green run does not establish

- Nothing about a real profile, a real plugin, or any production host.
- Nothing about whether the packages are *correct*, only that they install and
  that their documented subpaths resolve in a throwaway consumer on this machine.
- Nothing about `npm`'s behaviour beyond the pinned offline cache contract: the
  packs and the install all run `--offline` with an explicit `--cache` under the
  run's own `HOME`.
- Nothing about the extraction workload beyond the six synthetic fixtures it
  already had.
- Nothing about the configuration checker, which does not exist yet.

## 6. Reproduce

```
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/package-install/run.sh
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/profile-dump-install/run.sh   # refuses while yaml is installed
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/trusted-extraction-batch/run.sh
```

Absolute paths, one at a time: the core holds a shared lock, so concurrent
invocations collide by design (76).
