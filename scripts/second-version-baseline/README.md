# Second-version baseline batch

One bounded round answers: what does a **published, older** DSH release say about itself, and does
the `@deepseek-ai/dsh-app-boot` version it depends on expose the entry-outcome interface
(`boot`, `auditStartupEntries`) that this repository's fixture observation is built on?

## Files

- `run.sh` — launcher (core: `scripts/bounded-runner`, prefix `second-version-baseline`).
- `payload.sh` — the workload.
- `probe-release.mjs` — reads the release manifest and the extracted app-boot build.

## Invocation

```bash
bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/second-version-baseline/run.sh
```

Absolute path only: the core binds every active source frame to the absolute control list, so a
relative entry is refused with `77` before a unit exists.

## What one round does

1. The core's envelope receipt, unchanged (384 MiB, swap 0, 32 tasks, 50 % CPU, 120 s, one
   `MemAvailable >= 819200` KiB gate).
2. `bash -n` ×2, `node --check probe-release.mjs`.
3. Static contract: runtime package private + zero dependencies, receipt script still declares
   `receiptVersion`.
4. `npm view @deepseek-ai/dsh@0.2.2-alpha.2 --json`. That command answers with an **array**, even for
   one version.
5. `npm pack @deepseek-ai/dsh-app-boot@<the version that release depends on>` and extract it with
   `python3 -I` + `tarfile`, refusing escaping members.
6. `probe-release.mjs` scans the extracted `lib/index.js` **as text** for its export names.

**Network**: steps 4–5 only, the only registry access in this repository. They run with `env -i` and
an explicit `HOME`/`TMPDIR`/`--cache` inside the run directory. Without network the round fails `72`.

## Not attempted, on purpose

Installing the release's whole tree. `@deepseek-ai/dsh@0.2.2-alpha.2` declares 91 direct
dependencies; an attempt was killed at the 120 s envelope. So this batch produces **no runtime
receipt** for that release, and `baseline.txt` says
`receipt_scope=release-manifest-and-interface-package-only`. The installed-tree receipt lives in the
installed-rc.1 record instead.

## Exit codes

Payload: `0` green, `70` envelope/argument, `71` static contract, `72` a step failed (including a
failed registry read), `73` evidence write failed.

Launcher (from the core): `0` green, `70` refusal, `71`/`72`/`73` relayed, `74` unit did not settle,
`75` lock held, `76` run-directory collision, `77` control/selected frame unreadable, `78` drift.

## What one round does not establish

That the published tarball was built from commit `ce7073d…`; that alpha.2 behaves like rc.1; that a
consumer could install it here; or anything about a real profile. `certification` stays `false`.
