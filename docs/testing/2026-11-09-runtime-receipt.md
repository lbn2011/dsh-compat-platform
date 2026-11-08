# Runtime resolution receipt — acceptance record

Status: **executed, 2026-11-09, read-only, one host.**

## 0. Scope and non-claims

Records which runtime files a DSH installation resolves and the sha256 of each, so the
trusted-extraction design can cite bytes rather than a version string.

Not claimed:

- that any process loaded these files — the receipt hashes what resolution *would* load;
- a dependency closure — ten files are covered, not their transitive imports;
- loadability, activation, compatibility, admission or certification;
- anything about a profile: no profile was read, no plugin was started, no namespace was created.

`certification` is `false` and `limitations` is a fixed four-entry list in every receipt.

## 1. Command

```bash
node scripts/runtime-receipt/receipt.mjs \
  --installation /www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh
```

Exit `0`. Two consecutive runs produced byte-identical output:
`sha256 49b52d11f0cf786acfe1b1f3ab95d238c66cd345d962572555557aa2580426f6`.

## 2. Measured receipt (this host)

Node `v24.21.0`, `linux`, `x64`.

Installation `@deepseek-ai/dsh` `0.2.2-rc.1`, `package.json` sha256
`3e14837ceb3bbc0ba419ed08e9b5ba164338369b1268b93c3c25d89f7b1c9953`.

| Module | Version | Resolved file (relative to installation) | Bytes | sha256 |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/cordis` | 4.1.0 | `node_modules/@deepseek-ai/cordis/lib/index.js` | 64121 | `627409afa06a265f7253200d3bc4648e88805c39fd3768568eb9b9518a31fe8f` |
| `@deepseek-ai/cordis-plugin-loader` | 1.1.0 | `node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js` | 28635 | `4f0a93a1ef5bb09bd6e1c64b30df11be25efd46c316b9505c5ddf308974367a6` |
| `@deepseek-ai/cordis-plugin-include` | 1.1.0 | `node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js` | 23265 | `067dbc75da6d18e243b9ec72ce1d12a36c1a03663f48e58eee85036ee8568594` |
| `@deepseek-ai/cordis-plugin-group` | 1.1.0 | `node_modules/@deepseek-ai/cordis-plugin-group/lib/index.js` | 165 | `68f178f2836fafb52b3959aa71ae90aecd321c3f9a189d9f686233fcb000e419` |
| `@deepseek-ai/dsh-app-boot` | 0.2.2-rc.1 | `node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` | 225678 | `346f832224737cd9ab1b5e37d111ae232fdd78b5ab892fa3179c112baf6f0a22` |
| `@deepseek-ai/dsh-cmdline` | 0.2.2-rc.1 | `node_modules/@deepseek-ai/dsh-cmdline/lib/index.js` | 6973 | `7253190611566485f8b6f836fae6e0f2a7abbc59bb807c42e874844016e6d3a0` |
| `@deepseek-ai/dsh-home-paths` | 0.2.2-rc.1 | `node_modules/@deepseek-ai/dsh-home-paths/lib/index.js` | 8228 | `9877a6117c5def69b61fae12f70a7a7400894a9dc4a9f7069ce4cc58aeb66e9d` |
| `@deepseek-ai/dsh-official-bundles` | 0.2.2-rc.1 | `node_modules/@deepseek-ai/dsh-official-bundles/lib/index.js` | 17360 | `5c73437f17397f70df11441abce125240c363e05aca0f9aa47bbbe107e634a3a` |
| — (own file) | 0.2.2-rc.1 | `lib/bin.js` | 11772 | `b6640801a5a65aae9f53ca21bcce3b2ea28bd9e9554c939c1ff7c4448d91fa18` |
| — (own file) | 0.2.2-rc.1 | `lib/profile-boot-e2mS45fC.js` | 13890 | `25c966fcb5ab8e58e31c2610ccec3360b0cb2069bbef844640d5afdf27aebe5c` |

`unresolved: []`.

## 3. Why this matters to the design

The trusted-extraction design (section 9.3, step 1) requires pinning the runtime before
adapter work. This receipt supplies the pin for version selection and bytes: the DSH
installation resolves the **nested** Cordis `4.1.0` and loader `1.1.0`, not the global
Cordis `4.0.5` that also exists on this host. Evidence is a hash of the file each name
resolves to, not an assumption from the directory layout.

## 4. Deviations

- The script was run outside any cgroup envelope. It reads ten files, writes none, and
  starts no process, so the bounded carrier used for test suites would add no safety
  here; the run is recorded as a plain observation, not as a bounded acceptance round.
- `--installation package.json` (a path that does not exist relative to the repository
  root) was used as a negative case and returned `INSTALLATION_NOT_FOUND`; a true
  not-a-directory case was not exercised.

## 5. Files

| File | sha256 |
| --- | --- |
| `scripts/runtime-receipt/receipt.mjs` | `789e77ccfcfc33aa9153cf8d63d59907cf954f75faef0212c473b019f1981df2` |
| `scripts/runtime-receipt/README.md` | `9828bbed00b38c8a6d4c73ed5d191f3275b85b666085bf3ffc35321db91cc9f3` |

## 6. Reproduce

```bash
cd projects/dsh-compat-platform
node scripts/runtime-receipt/receipt.mjs \
  --installation /www/server/nodejs/v24.21.0/lib/node_modules/@deepseek-ai/dsh \
  | sha256sum
# expect 49b52d11f0cf786acfe1b1f3ab95d238c66cd345d962572555557aa2580426f6
```

A different host, Node build or installation will produce a different digest; the
digest is an observation of this host, not a published constant.
