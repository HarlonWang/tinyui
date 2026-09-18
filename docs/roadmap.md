# 下一阶段清单

四份 ADR 的"待定 / 待验证"汇总（2026-09-15），按性质分四组。条目状态在此更新，不回改 ADR。

## A. 立项骨架（一切的前置）

| 项 | 说明 | 状态 |
|---|---|---|
| 框架命名与建仓 | 命名 TinyUI、域名 tinyui.app、仓 `HarlonWang/tinyui` 均已定 | 已定 |
| 仓库结构 | 已定单仓，目录见 README"仓库结构"一节 | 已定 |
| 构建链骨架 | Gradle（build-logic / compose / sample 含 iOS 壳）+ pnpm workspace（core / native / cli）+ CI（PR 门禁 Android / host / apiCheck，iOS 全量在 ios.yml tag / 手动）；quickjs-kmp 本地 composite、CI 走 Central | 已完成（PR #1，2026-09-16） |
| **quickjs-kmp** | 新建 SDK 接入 QuickJS（ADR-005），复制 mquickjs-kmp 骨架，API 同形；M1 shim + 三端构建，M2 句柄表 + Runtime + 微任务 + **ESM 模块表**，M3 字节码 + 宿主编译工具 + 发布。TinyUI 的 `compose/` 依赖它 | 已完成（M1～M3，`wang.harlon:quickjs-kmp:0.1.0` 2026-09-16 发 Central；桥形验收见 `bench/results/2026-09-16-quickjs-kmp.md`） |
| 构建链打通 | CLI：TSX → `h()`（ES2025）→ 每页一个 ESM 模块字节码，运行时模块 `external`；运行时两个模块字节码内置 | 已完成（PR #2，2026-09-16；方案与踩坑见 [build-chain.md](./build-chain.md)） |

## B. 验证实验（数据驱动，互相独立，可并行）

整体延后（2026-09-17 定）：运行时仍在变，早测的绝对值会作废；B3 的退路只涉及 `NodeTree.apply` 跑在哪个线程，只要节点表写入口保持唯一，延后不会让退路变贵。何时开做由人工判断，不设自动触发条件。

| 项 | 来源 | 为什么要早做 | 状态 |
|---|---|---|---|
| 真机比值：Signal bench 在 Android / iOS 跑一遍（QuickJS） | ADR-001 / 005 | 所有性能判断都基于 macOS 数字，真机慢几倍要知道 | 待开 |
| Runtime 创建 + 运行时模块 + 页面模块加载耗时；Runtime 基线内存 | ADR-002 / 005 | 决定"每页一 Runtime"的进页延迟与返回栈深度 | 待开 |
| JS 线程写快照 vs 主线程重组的锁争用 | ADR-003 | 有问题要退回 op 列表投主线程，越早知道改动越小 | 待开（M1 的 `NodeTree.apply` 已按 `withMutableSnapshot` 写，可直接测） |
| Kotlin 侧流式 patch 解析器 | ADR-003 §3.2 | M1 用 kotlinx `parseToJsonElement` 建树，ADR 定的是逐 token 直写节点表；B 组真机数据出来再决定值不值得 | 待开 |
| "一行一个 effect"内存优化 | ADR-001 | 非阻塞，可最后做 | 待开 |

## C. 实现期定稿（要写文档，不需要 ADR，实现前必须定）

| 项 | 来源 | 状态 |
|---|---|---|
| JS 运行时 API：`signal` / `memo` / `effect` / `onCleanup` / `For` / `Show` / `ref` + `cmd` / **`resource`**（原拟名 `createResource`）；"组件函数必须同步"规则；J3 / K3 用原生 Promise | ADR-001 / 004 / 005 | 已定（2026-09-16，[js-runtime.html](./js-runtime.html) + [runtime-api.md](./runtime-api.md)） |
| CLI 的 JSX 变换：自动 thunk（Solid 式 getter 包裹）、source map 输出 | ADR-005 | 已定（2026-09-16，[jsx-transform.md](./jsx-transform.md)） |
| patch 协议：六种 op、JSON 形态、是否带协议版本号 | ADR-001 / 002 / 004 | 已定（2026-09-16，[patch-protocol.md](./patch-protocol.md)） |
| schema DSL 形态 + 由 schema 生成 TS 类型定义的工具链 | ADR-003 | 已定（[components.md](./components.md) §1，`tinyui schema`） |
| 公共布局 prop 清单与 `Modifier` 合成顺序 | ADR-003 | 已定（components.md §2） |
| 内置组件集首批（`Column` / `Row` / `Box` / `Text` / `Image` / `Button` / `TextField` / `LazyColumn` / `Spacer`）及各自 prop / 事件 / 命令清单 | ADR-003 / 004 | 已定（components.md §3）；`Image` 推迟到图片加载管线选型 |
| J2 白名单清单与注册方式 | ADR-002 | 已定（[native-api.md](./native-api.md) §1） |
| `tinyui-native` 的 `navigation` / `store` / `events` API 面与 `Navigator` 接口（[app-model.md](./app-model.md)）；`push` 的 Promise 糖做不做 | app-model.md | 已定（native-api.md §2–§5；Promise 糖不做） |
| E3 错误 code 表、K 入口超时阈值、连续事件节流阈值 | ADR-002 / 004 | 已定（native-api.md §6） |
| `Placeholder` 在 release 的表现 | ADR-003 | 已定（components.md §5：零尺寸空 Box） |
| 错误上报：`PageError` 单 sink、E7 接入、栈经 source map 回映射到 `.tsx`、buildId | ADR-002 §3.5 | 已完成（2026-09-17，[build-chain.md](./build-chain.md) §7） |
| 宿主自定义能力 `host.call`、`Button` children、`RadioButton`、作为 included build 被宿主 App 吃（`gradle/composite-substitutions`） | TrendingAI 订阅页 | 已完成（2026-09-17，[native-api.md](./native-api.md) §7、[components.md](./components.md) §3） |

## D. 明确推迟（记录不做，触发条件写清）

| 项 | 来源 | 触发条件 |
|---|---|---|
| ~~`createStore`（Solid 式 Proxy 深层响应式）~~ | ADR-005 | 已完成（2026-09-17，定名 `observable`，[runtime-api.md](./runtime-api.md) §2.6）：直接赋值、属性级订阅、只深代理纯对象与数组；`reconcile` / `produce` 不做，触发条件"服务端全量刷新导致整表重绑成为性能问题" |
| ~~热下发~~ | ADR-005 | 已定（2026-09-18，[ADR-006](./adr-006-hot-updates.md) + [updates.md](./updates.md)；2026-09-19 定服务端与签名），实现待开，顺序见下方第 7 条；ADR-006 §4.3 的推迟项（控制台、遥测、D1、非 CF 适配器、计费）各带触发条件 |
| `qjsc-kmp` 宿主二进制分发 | build-chain.md §5 | **触发已到**（2026-09-19，第二个 App 接入，其 CI 不能现编 quickjs-kmp）：形态改为 npm 平台包（`qjsc-kmp-darwin-arm64` / `-linux-x64` 等作 `tinyui-cli` 的 `optionalDependencies`，esbuild 模式）而非 GitHub Release——内网 npm 代理天然能拉；属 quickjs-kmp 仓改动，待做 |
| App 级共享模块（业务共享代码进 external 列表与模块表） | build-chain.md §3 | 页面间重复代码让安装包体积成问题 |
| 向 bellard/mquickjs 上报 S4 段错误 | ADR-005 §3.2 | 用户决定 |
| `ErrorBoundary` 分支级兜底 | ADR-002 | 整页失败的比例成为问题 |
| 二进制编码路径 | ADR-002 | 真机 profiling 证明 Kotlin 解析占主导 |
| 命令回执（`cmd()` 返回 Promise） | ADR-004 | 出现必须知道结果的命令 |
| 窗口化 `For` | ADR-003 | 出现万行级列表需求 |
| 返回栈深页引擎回收策略 | ADR-002 | 真机内存数据出来后定，可能提前 |
| 应用级服务 Runtime（不挂 UI、随 App 生命周期的引擎） | app-model.md | 业务出现不属于任何页面的常驻 JS 逻辑 |
| 手势组合内置组件 | ADR-004 | 业务需求出现 |
| `Image` 与图片加载管线（coil3 vs 宿主 loader） | components.md §3 | 出现需要图片的页面 |
| ~~`weight`~~ / `alignSelf` 等需要父作用域的布局 prop | components.md §2 | `weight`、`border`、`Column` / `Row` 的 `scroll` 已加（2026-09-17，TrendingAI 订阅页触发）；`alignSelf` 等需求 |

## 建议顺序与里程碑

1. **A 立项骨架**——先 quickjs-kmp（M1～M3），再 TinyUI 构建链，否则 B、C 都没有落点
2. **B 前三项并行**——半天到一天的实验，结果决定 C 里几个数值和 ADR-003 的退路
3. **C 前三项定稿**（运行时 API、patch 协议、schema DSL）——两侧代码的契约，定了才能分头写
4. ~~**M1：Counter 端到端**——一个引擎、一页、一个 `Text` + 一个 `Button`，J1 / K1 / K2 全链路跑通，验证 ADR-001～004 主干~~ 已完成（PR #3，2026-09-16）：`tinyui-core` 运行时（30 测试）、CLI JSX 变换（19 测试）、compose 节点表 / schema DSL / 注册表 / `PageHost` / `TinyUIPage`（9 测试），Counter 在 Android 与 iOS 模拟器上跑通。顺带修了 quickjs-kmp 的字节码注册入口不刷新栈顶的 bug（quickjs-kmp PR #12），真机需要 quickjs-kmp ≥ 0.1.1（2026-09-18 已发并 bump catalog）
5. ~~**C 剩余项 + 内置组件集，M2：列表页**——`For` / `LazyColumn` / `TextField` / J3 网络，覆盖所有权、命令、流式输入~~ 已完成（PR #4，2026-09-16）：schema 生成链、八个内置组件、`HostServices`、`tinyui-native`；todos 页在 Android 与 iOS 模拟器上跑通输入提交、行增删改、命令滚动、分页
6. **实战接入：TrendingAI 订阅页**（2026-09-17 起，代替多页业务样例）——页面源码在 `~/TrendingProjects/trendingai-tinyui`，产物经 `pnpm sync` 入 TrendingAI；框架缺什么以这一页为准补（第一批：主题 token、weight / border / scroll、`host.call`、`Button` children、`RadioButton`、宿主 include）。已在 Android 模拟器跑通拉价、选档、深浅色（TrendingAI 分支 `feat/tinyui-subscription`）；合入 TrendingAI main 的前提——tinyui 0.1.0（Maven + npm 三包 `tinyui-core` / `tinyui-native` / `tinyui-cli`）与 quickjs-kmp 0.1.1——已于 2026-09-18 发出（PR #11）；iOS 模拟器 smoke 通过，三条状态验证（结账失败 / 未登录 / 已是 Pro）不做
7. **热下发实现**（ADR-006 定稿后）：CLI（manifest 扩展、`bundle` + 签名、`keys`）→ core 库 `Bundle` → `updates/` 模块 → `tinyui-updates-server` 仓 MVP（投递 + 发布 + 管理端点，部署 `updates.tinyui.app`）→ CLI `publish` / `apps` / `tokens` / `releases` → TrendingAI 接入 → 第二个 App 接入。前置：`qjsc-kmp` npm 平台包

