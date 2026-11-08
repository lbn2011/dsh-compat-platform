# Isolation checklist for the trusted-extraction path

> Date: 2026-11-09 · Status: **gates 1, 2, 3 and 5 demonstrated in one bounded round; gate 4 asserted statically.** Companion to
> [the trusted-extraction design](2026-11-09-trusted-extraction-design.md) §4.3.
>
> Purpose: turn the five gates in the design into checks that either pass with recorded
> evidence or refuse before anything runs. Passing this checklist is a precondition for the
> first fixture launch, not a substitute for it, and not a claim that confinement is sound
> against hostile code.

## 0. Ordering rule

Run the gates in the order below and stop at the first refusal. A gate that cannot be
demonstrated on this host stops the increment; it does not fall back to a weaker boundary,
and it does not proceed "to see if it works". Every gate's evidence is a bounded run
artifact, not a terminal transcript pasted into a document.

## 1. Environment facts observed on this host (2026-11-09)

Read-only capability probes only; no plugin, profile or fixture was started, and no cgroup
envelope was used for these probes.

| Fact | Observation | Consequence |
| --- | --- | --- |
| Effective identity | `uid=0`, `gid=0`, capabilities `=ep` (full set), `no-new-privs=0` | The process runs as root today. "Unprivileged identity" must be **implemented** deliberately, never assumed. |
| User namespaces | `unshare --user --map-root-user --fork` works; `--map-users=0:100000:65536` maps to a non-root host uid (observed `65534`) | Namespaces are available. **`--map-root-user` inside a user namespace is still uid 0** and must not be counted as an unprivileged target. |
| Mount namespace | `unshare --user --map-root-user --mount` then `mount -t tmpfs none /mnt` succeeded | Mount isolation is available in principle; the actual allowlist still has to be built and verified. |
| cgroups | `cgroup2fs` with controllers `cpuset cpu io memory hugetlb pids rdma misc`; `systemd-run --scope` accepted | Resource limits are enforceable; readback must be verified per run, not assumed. |
| bubblewrap | `bubblewrap 0.12.0` | The existing runner idiom is reusable for the filesystem boundary. |
| seccomp | `Seccomp: 2` in `/proc/self/status` | A filter is already active; the target must not silently inherit privileges from it being absent in a child. |
| Landlock | `/sys/kernel/security/landlock` absent | Do not design around Landlock here; if it is wanted, treat it as unavailable until proven. |
| Cores | 2 | Serial execution only; no parallelism inside this increment. |

None of these facts is evidence that a *confined* run works. They only say which
mechanisms exist.

## 2. Gate 1 — Exact mount list

**Requirement.** The child sees exactly the paths the policy names, with the stated modes,
and nothing else.

**Check.**
1. The launcher builds the mount list from one declarative policy file; no path is added
   imperatively anywhere else.
2. A child-side report lists its mounts (`/proc/self/mountinfo`) and the launcher compares
   them to the policy: same set, same modes, no extra.
3. A sentinel file at a path *not* in the policy is unreadable from the child; a sentinel at
   a policy path is readable.

**Refusal.** Any unmounted policy path, any extra mount, or a readable out-of-policy
sentinel → `ISOLATION_MOUNT_MISMATCH`, stop before target execution.

**Status.** Demonstrated 2026-11-09: 22 mounts, all under a declared prefix; out-of-policy sentinel read returned ENOENT (`docs/testing/2026-11-09-trusted-extraction.md` §3).

## 3. Gate 2 — Unprivileged identity and namespace verification

**Requirement.** The child runs as a non-root identity with no effective capabilities, in
its own user/mount/pid/ipc/uts/net namespaces, and *proves it* from inside.

**Check.**
1. Child-side report: `uid`, `gid`, `/proc/self/status` capability lines (`CapEff`, `CapPrm`,
   `CapBnd`), `NoNewPrivs`, and the namespace inode identities for pid/mnt/net.
2. Launcher asserts `uid != 0`, `gid != 0`, `CapEff == 0`, `NoNewPrivs == 1`, and that the
   namespace inodes differ from the launcher's.
3. Explicitly rejected: a user namespace started with `--map-root-user` counted as
   unprivileged, or `setuid` performed *after* namespace entry without dropping caps.

**Refusal.** Any assertion failing, including "the child is uid 0 inside a namespace" →
`ISOLATION_IDENTITY_UNVERIFIED`.

**Status.** Demonstrated 2026-11-09: uid/gid 65534, `CapEff`/`CapPrm` all zero, `NoNewPrivs=1`,
read from inside the sandbox (`docs/testing/2026-11-09-trusted-extraction.md` §3).

## 4. Gate 3 — Evidence-directory isolation

**Requirement.** The child cannot write the supervisor's manifest, receipt, hash records or
verdict.

**Check.**
1. Supervisor artifacts live outside every child-writable mount.
2. A child-side write attempt against each supervisor path fails (`EACCES`/`EROFS`), recorded
   per path.
3. The child's own writable area is bounded and named; its contents are treated as
   untrusted input, and the verdict is computed only from supervisor observations.

**Refusal.** Any supervisor path writable from the child, or a verdict that reads a
child-written file → `ISOLATION_EVIDENCE_EXPOSED`.

**Status.** Demonstrated 2026-11-09: the supervisor's own file is ENOENT for write from inside, the child's /out is writable (§3).

## 5. Gate 4 — Time-budget reserve

**Requirement.** The outer wall limit has a reserve for kill, reap and terminal readback, and
each phase deadline expires strictly earlier.

**Check.**
1. `OuterLimit > Sum(phaseDeadlines) + ReserveKill + ReserveReadback`, asserted numerically
   by the launcher before launch (proposed: 120 s outer, 90 s phase budget, 10 s kill grace,
   20 s readback).
2. A deliberately hanging fixture is terminated at its phase deadline and the run records
   `DEADLINE_EXCEEDED` with `cleanup: confirmed`, not a truncated green.
3. Terminal readback still succeeds after the forced kill.

**Refusal.** Arithmetic mismatch, or a run that cannot confirm termination →
`ISOLATION_BUDGET_INVALID` / `CLEANUP_UNCONFIRMED`.

**Status.** Demonstrated 2026-11-09: 120 s > 80 + 10 + 20 asserted statically; not yet demonstrated by a hanging fixture (§3 notes the reserve is static).

## 6. Gate 5 — Isolation acceptance with sentinels

**Requirement.** Before any fixture runs, non-sensitive sentinels show the boundary holds.

**Check.**
1. **Read denial:** a host sentinel file outside the policy is unreadable; the attempt is
   recorded (error class only, never the sentinel contents).
2. **Write denial:** a host path outside the policy cannot be created or appended to.
3. **Network denial:** a connection attempt to a launcher-controlled listener on the host
   fails; the listener records zero accepted connections.
4. **Socket denial:** a host Unix socket path is not present in the child's filesystem.
5. **Descendant reaping:** a fixture that spawns a child leaves no process in the unit's
   cgroup after termination (`pids.peak` returns to zero, `MainPID` 0).

**Refusal.** Any sentinel readable, any write succeeding, any connection accepted, or any
surviving descendant → `ISOLATION_SENTINEL_FAILURE`.

**Status.** Demonstrated 2026-11-09 for read/write denial and descendant reaping (MainPID=0); network denial rests on `--unshare-net` rather than an observed refusal (§3, §6 of the record).

## 7. What would count as evidence

For each gate: one bounded run (384 MiB / swap 0 / 32 tasks / 50 % CPU / 120 s / heap 192,
one `MemAvailable >= 819200 KiB` gate, `flock -n` on the shared acceptance lock), producing:

- `policy.json` (the declared mount/identity/budget policy) and its sha256,
- `child-identity.json`, `child-mountinfo.txt`, `write-attempts.json` from inside the child,
- `sentinels.json` from the launcher (booleans and error classes only),
- `reflect` readback of the unit's cgroup knobs and terminal state,
- `verdict.txt` with the pass/refuse word per gate.

A gate passes only when its own artifact shows the assertion satisfied. A missing artifact
is a refusal, not an unknown.

## 8. Interaction with the design's other parts

- Gate results feed the receipt's `cleanup` and `isolation` fields; a receipt must record
  which gate artifacts it was computed from.
- Until all five gates pass, the `entries` projection from
  [§9.4 of the design](2026-11-09-trusted-extraction-design.md) may be developed and unit
  tested against synthetic contexts, but no fixture may be launched under the executor.
- Sentinel data must never be a real credential, path or config value; equality of hashes is
  the only signal that may be published.
