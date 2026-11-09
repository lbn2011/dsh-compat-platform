# Bounded runner bootstrap qualification

**Executed 2026-11-10:** the first invocation refused at bubblewrap mount setup (exit 71), before syntax/tests; the second passed syntax and both mock suites (exit 0). See [the retained record](../../docs/testing/2026-11-10-bounded-runner-core.md). No Node process, package installation or plugin workload ran. This proves bounded mock qualification only, not real lifecycle integration of the shared core.

## Controls and review gates

- [Host launcher](./run.sh) and [payload](./payload.sh) do not source or import the core under qualification. The core is loaded only by the mock suites inside the sandbox.
- Requires the existing acceptance lock at `/root/dsh-ecosystem-spec/experiments/acceptance/runs/.acceptance.lock`; acquires it nonblocking and never creates or truncates it. Refuses absent tools, inputs, a held lock, active guarded units, or failed guard queries.
- Before launch, validates the exact five-module manifest against **actual current file digests**, rejecting missing, duplicate, unknown, malformed, or unterminated records. The Lead must refresh [the core manifest](../bounded-runner/core.manifest) after edits; this bootstrap neither refreshes it nor accepts stale digests.
- Requires [the parser/envelope suite](../bounded-runner/negative-tests.sh) and [the host lifecycle suite](../bounded-runner/host-negative-tests.sh). The latter was still being authored when preparation began. Missing files refuse admission; there is no skip mode.
- Snapshots the five core modules, manifest, both suites, both bootstrap shell controls, and this README before and after the single launch. This is a selected-input stability check, not a complete operating-system dependency closure or an atomic immutable filesystem snapshot. Concurrent writers must honor the shared lock; edit-and-restore races are not detected.

## Intended execution contract (not execution evidence)

An authorized operator would invoke the host launcher with Bash and no arguments. No execution is authorized by this document itself.

The host prepares a fresh mode-0700 artifact directory under `/data/dsh-ecosystem-test-artifacts/runs`, then attempts exactly one `systemd-run --wait --pipe --collect` service:

| Property | Required value |
| --- | --- |
| Type | `exec` |
| MemoryMax | `384M` / `402653184` bytes |
| MemorySwapMax | `0` |
| TasksMax | `32` |
| CPUQuota / period | `50%` / `100ms` |
| RuntimeMaxSec | `120` |
| KillMode / TimeoutStopSec | `control-group` / `10s` |
| Node heap environment | `NODE_OPTIONS=--max-old-space-size=192` |

The launcher timeout is 160 seconds with a five-second kill grace. Manager readbacks and journal collection have separate finite timeouts; there are no retries. systemd's configured runtime enforcement remains responsible for the service lifetime. Killing a timed-out launcher client is not proof that its service stopped.

The payload independently reads the real unified cgroup membership, requiring exactly `0::/system.slice/<this-unit>`, and checks the four exact cgroup knobs. It checks `Type=exec` and performs strict two-step `busctl` lookup (`GetUnit`, then `RuntimeMaxUSec`), preserving trailing newlines for ambiguity rejection. It then samples `MemAvailable` exactly once, requiring a singleton numeric `kB` field at or above `819200` KiB. **All syntax checks and workload execution follow this gate.** Host metadata reads are read-only admission evidence, not mock fixtures.

Inside bubblewrap it first runs Bash syntax checks on all five modules, both suites, and both bootstrap controls. Only if those pass does it execute the two suites serially, each with a 30-second timeout and two-second kill grace. A failure exits immediately; it does not retry or run the remaining suite.

## Sandbox and mock boundary

The sandbox uses a read-only root, isolated user/network/PID/IPC/UTS namespaces, dropped capabilities, a private `/proc` and `/dev`, and empty private `/run`, `/var`, and `/sys` mounts. Host systemd sockets are hidden. The environment is rebuilt with `env -i`, including the explicit heap setting. Tests must create fixtures through `TMPDIR=/tmp/qualification/scratch`, with `HOME=/tmp/qualification/home`. A private `/tmp` is created before the run's work directory is bound at `/tmp/qualification`; no new mountpoint is created directly under the read-only root. Persistent writes are limited to that bound work directory; private tmpfs mounts are writable but ephemeral.

Fail-closed executable stubs precede the normal command PATH for `systemctl`, `systemd-run`, `busctl`, `journalctl`, `loginctl`, and `machinectl`. Available canonical binaries are bind-masked too, including absolute-path access through merged-/usr aliases. Any fallback invocation records a denial and returns 97; a nonempty denial log invalidates even a zero-exit suite. Suite-defined Bash mocks are expected to intercept all intended lifecycle calls. Runtime sockets are hidden and network access unshared as a separate backstop.

This is containment for audited mock tests, **not a hostile-code security boundary**: the read-only root still exposes host file contents, including potentially sensitive metadata; binaries and alternate communication mechanisms are not exhaustively inventoried. The stubs and denial log are not tamper-proof against malicious test code. Do not run arbitrary scripts here. No disk quota is supplied. Kernel, bubblewrap, namespace permissions, and systemd compatibility are unverified. The default `system.slice` layout is deliberately required rather than guessed.

## Evidence and terminal handling

Retains the command line, selected-input hashes and diff, manifest verdicts, active-unit query, unit output, journal and query return code, terminal readback, envelope readbacks, memory gate, syntax and suite output/return codes, scratch fixtures, denial log, payload completion marker, and final status. Empty syntax/suite output or a missing completion marker cannot produce a green result after a successful launcher return. Prelaunch refusals print a reason and keep any evidence already written; they need not have a final status file.

Terminal settlement requires a successful query, exactly one of each requested field, `LoadState` in `loaded|merged|not-found`, `ActiveState:SubState` in `inactive:dead|failed:failed`, and **`MainPID=0`**. The bootstrap never calls `stop`, `kill`, `reset-failed`, or any cleanup operation against a unit name. It never stops a foreign name, and it does not infer ownership from a launch attempt. A nonsettled or unreadable terminal state produces **74** unless a higher-priority evidence (73) or hash (77/78) failure exists. Verdict precedence is evidence > hash > terminal > workload; every defect remains recorded. Manual investigation is required before any later acceptance attempt.

Other results: 70 admission/envelope refusal; 71 syntax failure; 72 suite failure; 73 evidence failure; 75 lock held; 76 artifact collision; 77 hashing/manifest-format failure; 78 digest drift. A zero result would describe only this bounded mock qualification of the selected bytes, not installation, integration, production readiness, or release approval.
