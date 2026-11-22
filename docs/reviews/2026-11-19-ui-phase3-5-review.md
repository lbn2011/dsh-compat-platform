# UI Phase 3–5 独立评审

日期：2026-11-19（Asia/Shanghai）· 评审人：reviewer（团队 dsh-ui-phase3-5-review）
基线：`840fb18`，评审对象为未提交的工作区改动（`git diff 840fb18` + 未跟踪文件）。
方式：只读阅读代码、对照真实服务实现、核对证据目录。只运行了 `node --check`、`bash -n`、
`node --test tests/gui-phase3-4.test.js`（10/10 pass）和 `node --test tests/chrome-driver.test.js`（23/23 pass）。
没有跑 Chrome，也没有跑全量测试或 bounded slice。

## 已确认无问题的部分

- **TasksMax=256 的范围**：`policy.sh:6` 新增 `readonly BR_TASKS_CHROME=256`，`BR_TASKS=32` 不变。
  `host.sh:161-164` 只在 `prefix = e2-chrome-batch` 时请求 256，`envelope.sh:68-71` 只在 unit 名匹配
  `e2-chrome-batch-*` 时期望 256。`br_prefix_allowed` 是精确列表，没有别的已允许前缀以 `e2-chrome-batch-` 开头，
  所以两处判断一致。仓库里 `BR_TASKS_OVERRIDE` 已无残留。payload 拿不到能调高配额的环境变量或参数：
  systemd-run 不继承调用方环境，`run.sh` 没设 `BR_SETENV`，常量在 payload 里重新 source 并且是 readonly。
  `BR_UNIT_FAMILIES` 已加入 `e2-chrome-batch-*`（active-unit guard 能看到它）。`requested.txt` 记录的是实际请求值。
- **core.manifest**：五个模块的 sha256 与磁盘文件一致。
- **XSS**：`page.js` 里没有 `innerHTML`、`insertAdjacentHTML`、`outerHTML` 或 `document.write`。新增 UI 全部经过
  `el()`（`page.js:463-474`，用 `textContent`）或直接写 `textContent`。CSP（`page.js:55`）没有放宽。
  真实浏览器检查 `summary inserted as text, not markup` 通过（`<b>` 数量为 0）。
- **证据一致性**：证据目录 `20261118T162618Z-e2-chrome-batch-3241772-2719` 里的 `selected-after.txt` 和
  `control-after.txt` 用 `sha256sum -c` 对当前文件逐一校验，全部 OK，说明评审的就是跑出证据的那份代码。
  测试记录 `docs/testing/2026-11-19-ui-phase3-5.md` 里的数字与证据一致：acceptance_exit=0、pids.max=256、
  mismatch=0、memory_peak=221847552、pids_peak=100、TAP 103/103、ui-e2e 12/12、截图 243197 字节、
  Chromium 150.0.7871.181（dpkg 一致）。32 配额回归 run 的 TasksMax、pids.max、TAP 和 pids_peak 也与记录相符。
- **双击防重复与预览请求体**：`page.js:1004-1008` 在发请求前同步禁用按钮，执行的是 `previewedBody`，
  不是当时的 textarea 内容。单测（`gui-phase3-4.test.js:225-246`）和真实浏览器 E2E 都覆盖了这一点。
- **轮询与手动刷新并发**：`conflictBusy`（`page.js:869-871`）保证同一时刻只有一个请求在途，
  不会出现旧响应覆盖新响应。

## 评审意见

### R1 · blocker · `packages/host/src/api.js:30-33, 216-219, 350-353, 412-417`

**问题**：仓库里没有任何代码提供 `repairService`（或 `repair`）这个服务，也没有任何实现带
`previewPlan(plan, beforeText)` / `applyPlan(plan, approval, beforeText, nowMs)` 这两个方法
（全仓 grep 只命中 `packages/host/src/api.js` 和 `packages/host/tests/api.test.js`）。真实的 repair 包
`packages/repair` 导出的是对象参数函数：`previewRepair({ plan, beforeText })`
（`packages/repair/src/repair-preview.js:229`）、`decideApply({ plan, approval, beforeText, nowMs })`
（`packages/repair/src/repair-apply.js:114`），以及真正写文件的 `applyApproved({ root, name, plan, approval, nowMs })`
（`packages/repair/src/fixture-applier.js:118`）。`applyApproved` 自己从限定目录里读文档，不接受客户端传来的
`beforeText`，也不知道该写哪个文件；HTTP 契约里根本没有 `root`/`name`。所以在真实宿主上，preview 和 apply 两个接口
永远返回 503，Phase 4 只在桩上成立，团队目标里「在 3080 上用真实服务验证」做不到。
api.js 的单测和 ui-e2e 都只用了按 api.js 假设写的桩，所以没有发现这个问题。

**要求的修复**：先决定由谁提供 repair 服务。可以写一个适配插件，基于 `previewRepair` / `applyApproved`
实现 `previewPlan` / `applyPlan`，并定下写入目标（root/name）的来源和限定范围；也可以修改 api.js，让它直接调用
repair 包，同时明确目标文件。至少补一条集成测试：用真实的 `previewRepair` 和 `decideApply`/`applyApproved`
（写在临时目录）走一遍 `/api/repair-preview` 和 `/api/repair-apply`。在适配完成之前，测试记录必须写明
「repair 接口在真实宿主上没有服务提供者，会返回 503」。

### R2 · high · `packages/host/src/api.js:306-324`；`packages/host/tests/api.test.js:595-613`

**问题**：`handleConflictReport` 把 `claims()`、`conflicts()`、`snapshot()` 抛出的异常全部吞掉，替换成 `[]`，然后返回
200。页面看到 200 加空列表，就显示「✓ 未检测到冲突」（`page.js:858-859`）。也就是说，服务出错时页面会显示为无冲突，
这违反了 Phase 3「未就绪/出错时不能显示为无冲突」的要求。测试 `conflict-report tolerates a service that throws`
把这个错误行为写成了预期。

**要求的修复**：任何一个调用抛出异常时返回非 2xx（例如 503 `CONFLICT_SERVICE_ERROR` 或 500），或者在 200 里带上
`degraded: true` / `errors`，页面据此显示「读取失败/不完整」，而不是「未检测到冲突」。同时修改上面那条测试，并补一条
页面测试：服务异常时绝不出现「未检测到冲突」。

### R3 · high · `packages/host/src/api.js:396-430`；`packages/host/package.json:5`；`packages/repair/src/repair-approval.js:14-15`

**问题**：`POST /api/repair-apply` 是这个包的第一条写入路径。旧的 api.js 头注释写着「no write path」，这次被删掉了；
但 `package.json` 的描述仍然写着「performs no analysis and writes nothing」。审批（approval）是调用方在同一个请求体里
自己提交的，而 repair 包明确说明审批不是认证（`repair-approval.js:14`：「It is not authentication」）。
所以只要能通过 connection 栅栏，任何人都能自己算 `planDigest`，自己签一个 `decision: 'allow'`，然后执行任意计划。
目前因为 R1 没有服务提供者，这个问题还没有暴露，但一旦接上真实服务就会生效。

**要求的修复**：接入真实 apply 之前，确定审批的来源。审批不能来自同一个 HTTP 请求体，应该从服务端受信任的位置读取，
或者加一道额外的服务端授权（例如只接受 host 配置里列出的 approver，或要求单独的 apply 开关默认关闭）。
同时更新 `package.json` 的 description 和 api.js 头注释，如实说明存在写入路径及其约束。

### R4 · high · `packages/host/src/api.js:627-719`；`packages/host/src/index.js:213`

**问题**：
1. `applyChromeCaptureApi` 在整个仓库里没有调用方（`index.js:213` 只调用 `applyHostApi`）。测试记录第 13 行把
   `/api/chrome-capture` 列为已交付的后端接口，实际上它没有挂载，也没有任何测试（`tests/` 里搜不到 `chrome-capture`）。
2. 如果挂载，每个 GET 请求都会在宿主进程里启动一个 `--no-sandbox` 的 Chromium（`api.js:688`，参数来自
   `chrome-driver.js:86-91`）。没有并发上限，没有超时，也没有频率限制，几个并发请求就能耗尽宿主内存和进程数。
3. 导航目标写死为 `http://127.0.0.1:3080`（`api.js:689`），没有使用宿主实际监听的地址。
4. 文档注释（`api.js:632-634`）说只有设置了 CHROME_PATH 才注册，但代码无条件注册，在请求时才返回 503。
5. 响应里带了 `chromePath`（`api.js:694`）和原始异常信息（`api.js:705`）。

**要求的修复**：要么从本次范围里移除这个接口，并在 README 和测试记录里改为「未挂载」；要么正式挂载，同时满足：
并发上限为 1（忙时返回 429/503）、设置 launch 和 navigate 超时、目标 URL 从宿主配置取得、注释与行为一致、
不回传路径和原始异常，并补上 503 / 并发 / 超时的单测。

### R5 · medium · `packages/host/src/api.js:376-379`；`packages/host/src/page.js:928, 944-953, 990-994`

**问题**：preview 返回的 operations 与真实 repair 结果的形状对不上。
- `previewRepair` 对一个计划操作返回一个 `diff`（`{line, removed, added}`，没有 `kind`）和一个 `edit`（`{kind, line}`）。
  api.js 把两者拼成一个两项数组，所以一个操作在页面上显示为「2 项操作」，其中 diff 那项的 kind 显示为占位的 `diff`。
- `DANGER_OPS` 里的 `disable-later` 和 `remove-entry` 不在真实词表里。真实的操作类型是
  `set-entry-flag`、`set-entry-config`、`reorder`、`disable-conflicting`、`patch-insert`
  （`packages/repair/src/repair-plan.js:53-59`）。`set-entry-flag` 在 `value: true` 时也会把条目禁用，却不会标红。
- 页面拿不到 `beforeDigest`、`afterDigest` 和 `afterText`，用户看不到改动后的实际文本。
- 单测和 E2E 用的桩操作是 `{kind:'disable-conflicting', entryId:'e9'}`，而真实的 `edit` 从不带 `entryId`，
  所以 `page.js:949` 的 `entryId=` 显示分支在真实数据下永远不会触发。

**要求的修复**：api.js 返回一个与真实结果对应的结构，例如 `{edit, diff, beforeDigest, afterDigest}`，或者每个操作一项
并带上 diff。`DANGER_OPS` 改成真实词表（`disable-conflicting`，以及 `value === true` 的 `set-entry-flag`）。
把测试桩换成 `previewRepair` 的真实输出，最好直接调用 `previewRepair` 生成。

### R6 · medium · `packages/host/src/page.js:930-1002`

**问题**：预览成功以后，如果用户继续编辑计划 textarea，「执行修复」仍然可用，并且会执行旧的预览请求体。
这符合「执行的是预览时的请求体」，但页面没有任何提示，用户会以为执行的是编辑后的内容。
另外，apply 返回 422 或 `partial`，或者遇到网络错误后，`previewedBody` 保留，按钮重新可用，可以反复执行。
网络错误时，服务端可能已经写入了。

**要求的修复**：给 textarea 加 `input` 监听，一旦编辑就清掉 `previewedBody`、禁用执行按钮，并提示「计划已修改，请重新预览」。
apply 的结果不是 `applied`（含 `partial` 和网络错误）时，也清掉 `previewedBody`，要求重新预览。补对应的单测。

### R7 · medium · `packages/host/src/page.js:895-899, 910-916`

**问题**：
- 请求出错（`.catch`）时只更新 `conflictState`，不更新 `conflictStatus`。状态条会继续显示上一次的
  「冲突 N 条 · 最后检查 …」，和错误提示互相矛盾。
- 轮询在页面隐藏时不会暂停。轮询和手动刷新的互斥（`conflictBusy`）本身是正确的，但单测从没调用过
  `intervals[0].fn`，也没覆盖请求在途时触发轮询会被跳过的情况（`gui-phase3-4.test.js:151-162`）。

**要求的修复**：catch 分支也写 `conflictStatus`（「请求出错 · 最后检查 …」）。补一条测试：在途请求未完成时调用
interval 回调，断言 fetch 只发出一次。页面暂停轮询（`visibilitychange`）可以作为可选项。

### R8 · medium · `packages/host/tests/chrome-driver.test.js:262-277`

**问题**：`launch throws PuppeteerNotAvailable when puppeteer-core absent (simulated)` 只是在测试里自己 `throw new PuppeteerNotAvailable()`
再断言它被抛出，完全没有调用 `ChromeDriver.launch` 或 `loadPuppeteer`。这是一条假阳性。文件头注释（第 4-14 行）声称用
register hook / module-mock 注入，实际上都没做。`launch()` 的参数合并（`chrome-driver.js:83-93`，`...options` 会覆盖
`args` 和 `headless`）和新增的 `evaluate()`（`chrome-driver.js:150-154`，非函数参数时抛 TypeError）都没有单测。
真实路径只在 bounded slice 的 chrome-live 和 ui-e2e 里被间接覆盖。

**要求的修复**：删掉或重写这条测试。可以通过 `--import` loader 或给 `launch` 注入一个 loader 参数，真正走一遍
「import 失败 → PuppeteerNotAvailable」。补 `evaluate` 的单测（转发参数、非函数抛 TypeError、关闭后抛错）。
同时修正文件头注释，写明实际采用的测试策略。

### R9 · medium · `packages/host/tests/api.test.js:563-660`

**问题**：新增的 conflict-report 测试只注入名为 `conflictService` 的桩，并用 async 的 `claims`/`conflicts`。而真实服务是
`packages/analyzer/src/conflict-service.js:355` 以 `compatConflicts` 名字 provide 的同步方法。名字回退和同步返回值
（`await` 一个数组）没有测试，也没有一条测试使用 `createConflictService` 的真实输出。repair 测试同理（见 R1），
桩直接返回 api.js 期望的形状。

**要求的修复**：补一条测试：用 `createConflictService(ctx)` 构造真实服务，通过 `ctx.compatConflicts` 注入，
`upsert` 两个 owner 抢同一个 tool，断言 `/api/conflict-report` 返回真实的 C2 记录和 summary。

### R10 · medium · `scripts/e2-chrome-batch/ui-e2e.mjs:59-63, 66-67, 98, 111, 121`

**问题**：
- `waitFor` 的返回值从不检查。等待超时后，检查项虽然还是会失败，但报出来的是表面症状，看不出是超时。
- `screenshot written` 的检查条件写死为 `true`（第 121 行），不论截图是否真的写出都算通过。
- 真实浏览器路径没有覆盖 503 → 「未就绪」、`valid=false` 时执行按钮保持禁用、轮询这三条 Phase 3/4 关键行为，
  只覆盖了正常路径。
- 桩数据与真实服务形状不一致（见 R5），所以 E2E 证明的是页面能处理 api.js 的假设形状，不能证明能处理真实服务的数据。

**要求的修复**：每个 `waitFor` 都把结果作为一条检查项。截图后用 `fs.statSync` 检查文件大小大于 0。至少增加
「conflict-report 返回 503 → 状态里出现『未就绪』并且没有『未检测到冲突』」和「`valid:false` → 执行按钮 disabled」
两条浏览器检查。桩数据改成真实服务的输出形状。

### R11 · low · `packages/host/src/api.js:9, 29, 250-255`

**问题**：头注释写的是 `GET /api/repair-preview`，实际注册的是 POST。注释说超大请求体返回 400，实际返回 413。
`readJsonBody` 先用 `req.text()` 把整个请求体读进内存，再检查大小，1 MiB 上限挡不住内存占用；这依赖 carrier 自己
的 buffered 上限。

**要求的修复**：修正注释。如果 carrier 不保证上限，就先检查 `content-length` 再读，或者用流式读取并在超限时中止。

### R12 · low · `packages/host/src/api.js:366-369, 419-422`

**问题**：500 响应把服务抛出的原始 `error.message` 直接返回给客户端，可能带出文件路径等内部信息。

**要求的修复**：只返回 code，原始信息写日志。

### R13 · low · `packages/host/package-lock.json:17-20, 25`

**问题**：新增的未跟踪 lockfile 与 `package.json` 不一致：lockfile 里 `peerDependenciesMeta.puppeteer-core.optional` 是
`false`，package.json 里是 `true`。`resolved` 全部指向 `registry.npmmirror.com`。这个包原来没有 lockfile。

**要求的修复**：决定是否要提交 lockfile。如果要，用当前的 package.json 重新生成，并确认 registry 符合项目约定；
如果不要，就不要把它纳入改动。

### R14 · low · `scripts/e2-chrome-batch/README.md:3-7, 24-25, 32, 37-41, 48-59, 67-73`

**问题**：README 已经过时，与实际状态不一致：
- 写着「Status: prepared, not yet executed」并要求申请 policy 改动，实际上 policy 已改、slice 已经跑绿。
- 说 chrome-driver 测试有 24 条，实际 23 条（`node --test` 输出 tests 23）。
- 说 Chromium 通过 npx 装在 `/data/chromium`，实际用的是 apt 安装的 `/usr/bin/chromium`（证据里的 `chrome-path.txt`）。
- 「would not establish」一节说不证明真实浏览器能启动，但 payload 现在已经跑了 chrome-live 和 ui-e2e。
- 没有提到 `ui-e2e.mjs`。

**要求的修复**：按当前实现重写 README 的状态、浏览器来源、测试数量、运行内容和非声明。

### R15 · low · `docs/testing/2026-11-19-ui-phase3-5.md:13, 15, 78`

**问题**：
- 第 13 行把 `/api/chrome-capture` 列为已交付的后端接口，实际没有挂载（R4）。
- 第 15 行说「所有页面文本都通过 textContent 插入」，这一点属实；但记录里没写 repair 接口在真实宿主上没有服务提供者（R1），
  也没写服务异常时页面会显示「无冲突」（R2）。
- 第 78 行的非声明是准确的，但应该更明确，说明真实宿主上 repair 两个接口会返回 503。

其余数字与证据一致（见上文「已确认无问题的部分」）。

**要求的修复**：修复 R1、R2、R4 之后更新这份记录。如果不修，就在非声明里写明这些限制。

### R16 · low · `scripts/e2-chrome-batch/payload.sh:2-6, 40`

**问题**：注释说 payload 从环境变量接收 CHROME_PATH，但 transient unit 不会继承调用方环境，`run.sh` 也没有通过
`BR_SETENV` 声明它，所以 `${CHROME_PATH:-}` 永远是空的，实际总是走自动探测（证据里探测到的是 `/usr/bin/chromium`）。
这不影响配额安全，但会误导以后的使用者。

**要求的修复**：修正注释。如果确实需要指定 Chromium 路径，就通过 `BR_SETENV=(--setenv=CHROME_PATH=...)` 显式声明。

## 结论

**需修改。**

bounded-runner 的 TasksMax=256 改动范围正确：只对 `e2-chrome-batch` 前缀生效，没有让 payload 自己调高配额的通道，
其他切片保持 32，manifest 与文件一致。页面没有 XSS 注入点，证据与当前代码逐字节一致。

阻断问题是 Phase 4 与真实 repair 服务的契约不一致（R1）：真实宿主上没有服务提供者，repair 接口只会返回 503，
因此无法完成「在 3080 上用真实服务验证」。另外有三条 high：
- R2：冲突服务异常时页面会显示「未检测到冲突」。
- R3：apply 写入路径的审批由请求方自己提交，不构成授权。
- R4：`/api/chrome-capture` 没有挂载，也没有资源上限，测试记录却把它列为已交付。

R1、R2 必须修复，R3、R4 必须修复或明确缩小范围，之后才能进入 3080 真实服务验证。medium 项建议在同一轮一起修复。
