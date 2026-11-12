# 2026-11-13 — 集成测试与资源验证（任务 t12）

三仓联动集成套件在 bounded-runner envelope 内的运行记录。记录包含版本、命令、
结果、资源限制与证据路径；也写明这套运行**没有**证明什么。

## 版本

| 项 | 值 |
| --- | --- |
| dsh-compat-spec | 0.1.0-draft.1（`PROTOCOL_VERSION` 0.1.0-draft.1） |
| dsh-plugin-kit | 0.1.0-draft.1（`PROTOCOL_VERSION` 0.1.0-draft.1） |
| dsh-compat-platform | 0.1.0-draft.1（packages/analyzer） |
| node | v24.21.0（`/www/server/nodejs/v24.21.0/bin/node`） |
| bounded-runner | core.manifest 五行摘要全 OK；policy.sh 因新增 `integration-batch` 前缀由队长授权修改后重建（`sha256sum -c` 见运行目录 `argv.txt` 邻近证据） |

## 命令

```bash
TMPDIR=/root/kit-scratch/tmp bash /root/dsh-ecosystem-spec/projects/dsh-compat-platform/scripts/integration-batch/run.sh
```

绝对路径是强制的：`br_control_closure` 把 `BASH_SOURCE` 与声明路径逐帧比对，用相对
路径调用会以 77 拒绝（本次首跑即撞到，记录在下方"过程中修正的三处"）。

一个单元、串行、无重试。payload 依次执行：`bash -n` 两个脚本 → 静态契约 →
platform 集成套件 → kit 集成套件（kit 仓无自带 bounded-runner，故在此单元内跑）。

## 结果

运行目录 `/data/dsh-ecosystem-test-artifacts/runs/20261112T171443Z-integration-batch-1747086-11664/`

| 项 | 值 |
| --- | --- |
| acceptance_exit | **0** |
| platform 集成套件 | **35 tests / 35 pass / 0 fail / 0 skip**（`platform-tap-summary.txt`） |
| kit 集成套件 | **6 tests / 6 pass / 0 fail / 0 skip**（`kit-tap-summary.txt`） |
| static contract | pass（`static-verdict.txt`），失败项 none |
| syntax | run.sh 0、payload.sh 0（`syntax.txt`） |
| control 前后一致 | `control-diff.txt` 空 |
| selected 输入前后一致 | `selected-diff.txt` 空（16 项跨仓输入逐个摘要） |
| evidence 写入失败 | 0（`payload-evidence.txt`） |

## 资源限制（实测，均 `measured`）

| 限制 | 声明值 | 内核回读 | 证据 |
| --- | --- | --- | --- |
| memory.max | 402653184（384 MiB） | 402653184 | `envelope-effective.txt` |
| memory.swap.max | 0 | 0 | 同上 |
| pids.max | 32 | 32 | 同上 |
| cpu.max | `50000 100000` | 同 | 同上 |
| Type | exec | exec | 同上 |
| RuntimeMaxUSec | 120000000 | 120000000 | 同上 |
| NODE_OPTIONS | `--max-old-space-size=192` | 已传入沙箱 | `platform-workload.txt` |
| MemAvailable 门限 | ≥ 819200 KiB | 达标 | `memory-gate.txt` |
| **memory_peak** | < 384 MiB | **44896256（42.81 MiB）** | `peaks.txt` |
| **pids_peak** | < 32 | **27** | `peaks.txt` |

`envelope-effective.txt` 的 `mismatch=0`，即内核实际应用的六项限制与 `policy.sh`
声明逐项相同；`peaks.txt` 的 peak 来自 `memory.peak` / `pids.peak`，在单元消失前读取。

**pids_peak=27/32 值得记录**：两个套件都 spawn 真实子进程（bwrap、node --test、
kit CLI），余量只有 5 个任务。再往上加并发用例会先撞 TasksMax 而不是内存。

## 证据清单（运行目录内）

`syntax.txt`、`static-contract.log`、`static-verdict.txt`、`platform-workload.txt`、
`platform-tap.log`、`platform-tap-summary.txt`、`platform-verdict.txt`、`platform.rc`、
`kit-workload.txt`、`kit-tap.log`、`kit-tap-summary.txt`、`kit-verdict.txt`、`kit.rc`、
`integration-verdict.txt`、`peaks.txt`、`envelope-effective.txt`、`memory-gate.txt`、
`control-before.txt`/`control-after.txt`/`control-diff.txt`、
`selected-before.txt`/`selected-after.txt`/`selected-diff.txt`、
`ownership.txt`、`payload-result.txt`、`payload-evidence.txt`、`journal.txt`、`status.txt`。

## 覆盖矩阵（35 + 6 例）

- **Layer 1→4 链路（8 例）**：L1 真实执行 kit 生成的 host-tool（把 DSH 安装目录的
  peer 包软链进 scratch，import、`apply()`，断言注册的 tool 名等于声明里的名字、
  `execute()` 返回 `Hello, Ada!`）；L1 client-slot 静态一致性；L2 A1 `upsert/report`
  声明声明的 claims、A2 `staticPreCheck` 对同一 package.json、A3 `classifyFailure`
  + `decideArbitration`；L3 `DSHPatchAPI` insert/replace/disable → `commit` → 
  `mergePatchBlock`（appended / skipped / PARTIAL_OVERLAP refused）；L4 bundle 块合并
  且操作员行逐字节不变；最后一例把 L1 产物一路交到 L4。
- **C1–C11（12 例）**：每个冲突场景一个用例，第 1 例是"清单没漏"的自检。
- **Patch 审批流（5 例）**：propose（`planPack`/`writePack`）→ review（id 语法）→
  approve（sha256 摘要 + `validateApproval`）→ apply（`mergePatchBlock` appended，
  操作员 YAML 原文保留，重新打包字节相同，二次合并 skipped）；篡改（摘要不匹配）、
  拒绝/过期/畸形（错误摘要、错误 decision、未知字段、129 字符 approver）；
  最后一例断言"合并层不看审批记录"。
- **Bundle 安装（5 例）**：安装追加块 + 一次 tmp 写 + rename、操作员行不变、追加一条
  PATCH 记录且先要一次 reconcile；已存在则 skipped 且不写不 reconcile；部分重叠
  refused 且文件未动；**只有 patch、没有 `dsh.lifecycle` 的 bundle 永不合并**；
  lifecycle 运行失败则不合并。
- **资源预算（5 例）**：版本与 envelope 指纹；envelope 内限值契约 + 内核 cgroup 一致；
  当前 RSS 在限内；200 条 claim 扫描 RSS 增长 < 64 MiB；不猜 peaks、只读运行目录。
- **kit 侧（6 例）**：`scaffold → pack → verify-patch` 真子进程退出码；
  verify-patch 对 loader 会拒绝的块返回 1；`conflict-check` 联调真 analyzer + spec
  validator（同 tool 键=RESOURCE_CONFLICT warning→默认 exit 0、`--fail-on any`→1；
  重复 plugin id=DUPLICATE_PLUGIN_ID error→1）；同一模板源；无 patch 声明的包被拒。

## 过程中修正的三处（真实缺陷，均在本记录覆盖的脚本/测试内）

1. `payload.sh` 的 `local label=$1 ... log="$RUN/$label-tap.log"` —— 同一条 `local`
   语句里引用尚未赋值的 `label`，在 `set -u` 下报 unbound variable，payload 秒退
   （unit 状态 1/FAILURE，`journal.txt` 可见）。改为两条 `local`。
2. `DSH_ECOSYSTEM_ROOT` 传成了 `.../projects`（应为 `.../dsh-ecosystem-spec`），导致
   spec 套件 `import` kit 失败而**静默跳过 3 例**。这不是测试通过，是测试没跑——
   `br_tap_check` 要求 `skipped=0`，是它把这种"绿"挡住了。
3. `cgroupLimits()` 原先读挂载根 `/sys/fs/cgroup/{memory.max,pids.max}`（恒为 `max`），
   改为按 `/proc/self/cgroup` 的 membership 读本单元目录，`envelope-effective` 与
   测试断言才真正对上。

## 没有证明什么

- 不是认证。所有声明/patch/审批都是静态产物；唯一真实加载的那一例加载进 scratch
  上下文，没有进入运行中的 DSH profile，也没有任何宿主被问过"你是否会接受这个包"。
- 测试通过 ≠ 可安装。`certification:false`、`correlation:'not-established'` 仍是
  analyzer 的既有立场。
- 未部署生产、未 push、未改写任何 profile：运行只写
  `/data/dsh-ecosystem-test-artifacts/` 与各套件自己的临时目录。
- kit 套件是在 **platform 单元**内跑的，没有 kit 专属 bounded 单元（kit 仓无
  bounded-runner）；kit 仓的记录从另一侧写同一句话。
