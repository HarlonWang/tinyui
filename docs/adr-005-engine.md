# ADR-005 · JS 引擎：从 MicroQuickJS 切换到 QuickJS

- 状态：已定（2026-09-15）
- 结论：**引擎改用 QuickJS（bellard/quickjs，ES2025），通过新建的 quickjs-kmp 接入；MicroQuickJS / mquickjs-kmp 不再是 TinyUI 的引擎。原生 ES 模块为必选能力；语言目标 ES2025，不再降级 ES5；热下发不在本期**
- 影响：ADR-001 §1 / §3.1 的 ES5 论证、ADR-002 §1 事实基础与 §3.4 K0、README 硬约束表——均以"2026-09-15 修订"标注，不改写历史

## 1. 背景

ADR-001～004 是在 MicroQuickJS（mquickjs-kmp）的约束下定的。讨论业务可用语法时发现，相当一部分设计约束不是想要的，而是被 ES5 子集逼出来的：动态 prop 必须写 thunk、无 Proxy 所以不能有 store 式深层响应式、Promise 要自己 polyfill 且"已 settled 同步续行"的非标语义、async/await 走降级状态机、Map/Set/Date/`includes` 全要 polyfill 或绕道宿主、固定堆导致每页内存叠加与 OOM 直接抛。而 MicroQuickJS 的优势——10 KB RAM、几十 KB 二进制——在手机上不构成收益。

## 2. 候选方案

| | MicroQuickJS | QuickJS（bellard 本尊） | quickjs-ng |
|---|---|---|---|
| 语言 | ES5 子集 | **ES2025**（文档："Almost complete ES2025 support"，test262 接近 100%） | ES2025+，特性更超前 |
| 微任务 | 无 | 有（`JS_ExecutePendingJob`） | 有 |
| 内存 | 固定缓冲区 + 压缩 GC | malloc + 引用计数 + 环检测；`JS_SetMemoryLimit` | 同 |
| 模块 | 无 | 原生 ESM，loader 回调，模块字节码 | 同 |
| 体积 | 几十 KB | 约 1.2 MB / 架构 | 同量级 |
| 成熟度 | 2025-12 发布，单作者，定位嵌入式 | 2019 年起；Lynx（PrimJS）、Kuikly、Weex 2 均采用 | 社区分叉，活跃，API 缓慢分化 |
| 用户资产 | mquickjs-kmp 刚完成 M1～M3 | quickjs-wrapper（Android）为用户代表作；KMP 版待建 | — |

## 3. 依据

### 3.1 Benchmark（同一份 ES5 脚本跑三个构建）

数据：[bench/results/2026-09-15-engines.md](../bench/results/2026-09-15-engines.md)。机器当时负载偏高，取比值不取绝对值。

| 场景 | mqjs -Os | qjs | qjs / mqjs |
|---|---:|---:|---:|
| S1 挂载 1000 行（signal） | 5.6 ms | 14.5 ms | 2.6× |
| S2 单属性更新 ×200k（signal） | 276 ms | 580 ms | 2.1× |
| S3 100 行/轮 ×2000（signal） | 187 ms | 175 ms | 0.9× |
| S4 删除重建 ×30（signal） | 239 ms | 268 ms | 1.1× |
| S2（static-fine） | 329 ms | 285 ms | 0.9× |
| 常驻堆 1000 行（signal） | 2.93 MB | 3.65 MB | 1.25× |
| 最小可运行堆（signal） | 4.3 MB | 8.0 MB | 1.9× |

结论：QuickJS 在建树与单点更新路径上慢 2～2.6×，批量与结构变化路径持平；常驻内存多 25%，Runtime 基线让最小堆翻倍。绝对值上单次更新 + flush 约 2.9 µs、1000 行挂载 15 ms，均不构成问题。三个构建的 patch 流逐 flush 一致，说明脚本语义在两个引擎上相同。

### 3.2 MicroQuickJS 的内存安全 bug

`static-fine` 模型的 S4（1000 行删除重建）在 MicroQuickJS 的 -Os 与 -O2 构建上稳定段错误，5 轮即崩；前一日同一脚本 30 轮曾通过，说明依赖内存布局。ASan：

```
negative-size-param (size=-5472) in __asan_memmove
  JS_MakeUniqueString  mquickjs.c:2041
  JS_ToPropertyKey     mquickjs.c:4212
  JS_Call              mquickjs.c:6079
```

纯 ES5 工作负载、无宿主函数参与，属性键驻留表算出负长度。同一脚本在 QuickJS 上正常。这是"9 个月大的引擎在 1000 行列表增删上就能踩到内存安全问题"的直接证据。

### 3.3 语言完整度即产品

引擎的语言完整度直接决定业务开发者体验，而体验就是这个框架的产品。每一条"不能用 Map/Set/Date/微任务"都是永久的采用摩擦——MicroQuickJS 的定位决定它不会补齐 ES2015+。QuickJS 2026-06-04 版已含 Iterator helpers、Set 方法、resizable ArrayBuffer、`Promise.try`、`RegExp` v 标志等 ES2025 乃至提案阶段特性，且 bench-v8 较前版快 30%。

### 3.4 赛道已验证

Lynx、Kuikly、Weex 2 三个头部动态化框架独立选择了 QuickJS（或其分叉），说明这类框架对引擎的需求——完整语言、无 JIT 可上 iOS、可预编译、体积可接受——恰好落在 QuickJS 的区间。

### 3.5 bellard 本尊 vs quickjs-ng

选本尊：TinyUI 只需 ES2025 + 上表 API，本尊全有；作者 2024 年起恢复稳定发版（2025-04、2025-09、2026-06）；单一上游可追溯。ng 作为将来可切换选项——shim 的 API 面很小，切换成本可控。

## 4. 决策

| 项 | 结论 |
|---|---|
| 引擎 | QuickJS，bellard/quickjs main，锁 commit `04be246`（版本 2026-06-04） |
| 接入 | 新建 **quickjs-kmp**（`wang.harlon:quickjs-kmp`，包 `wang.harlon.quickjs`），复制 mquickjs-kmp 的骨架，Kotlin 公共 API 与之同形；实现思路见 quickjs-kmp 仓 `docs/` |
| 语言目标 | **ES2025**，CLI 只做 TS 擦除与 JSX → `h()`，不降级 |
| 模块 | **原生 ESM 必选**：运行时（`tinyui-core` / `tinyui-native`）与页面都是模块字节码；引擎侧"名字 → 预编译模块"表，CLI 保证模块图里只剩表内的裸说明符（业务内部 import 构建期合并进页面模块，运行时模块 `external`） |
| 页面加载 | 每页一 Runtime（ADR-002 不变）：注册运行时模块 → 求值页面模块（Promise，排空微任务）→ 调 `default` 导出挂载；页面模块允许顶层 `await`，但只用于同步依赖（等运行时初始化之类），数据获取走 `createResource` |
| 运行时 API 调整（复盘 ADR-001） | 编译器自动 thunk（v1）；`createResource` + "组件函数必须同步"（v1）；`createStore` v1.1 |
| 错误分类调整（复盘 ADR-002） | 新增 E7 未处理 Promise rejection；E6 增加栈溢出 |
| source map | CLI 输出 source map，E1 / E2 上报的行列号映射回 TSX 源；ES5 降级时代不可行，现在只是转译 |
| 模块名 | 即说明符：`tinyui-core`、`pages/home`，无后缀无路径前缀；`import.meta.url` 为 `tinyui:pages/home`（2026-09-19 修订：页面模块名改为含包名的 `<pkg>/home`，见 [ADR-006](./adr-006-hot-updates.md) §2.10 与 build-chain.md §2） |
| 热下发 | **不在本期**；本期字节码全部内置 App。Kotlin 回调式 loader（动态取源码）留给热下发那一期（2026-09-18 修订：热下发已定，见 [ADR-006](./adr-006-hot-updates.md)；loader 不接入，页面级分发在宿主侧） |
| mquickjs-kmp | 独立 SDK 继续存在，与 TinyUI 无关；不做"低端档位"抽象 |

## 5. 后果与遗留

对既有 ADR 的修订（各处以"2026-09-15 修订"标注）：
- ADR-001：ES5 / 无 Proxy 的论证段改为历史背景；thunk 写法保留，"Proxy store（Solid `createStore` 式深层响应式）"进入待定；Promise polyfill 与"已 settled 同步续行"作废——微任务原生，在宿主调用返回前排空
- ADR-002：§1 事实基础换成 QuickJS；K0 改为"注册运行时模块 + 求值页面模块"；J3/K3 的 Promise 对接改为原生 Promise；"每引擎一个程序"的硬限制消失
- ADR-003 / 004：不受影响
- README：定位去掉"页面可热下发"；硬约束表重写

待定 / 待验证：
- 真机上 QuickJS 的比值与 Runtime 创建 + 模块加载耗时（roadmap B 组）
- 每页 Runtime 基线内存（bench 显示最小堆 8 MB 量级）对返回栈深度的影响
- Proxy store 是否提供
- 字节码是否与字长无关（armeabi-v7a 实测）
- 向 bellard/mquickjs 上报 §3.2 的崩溃（用户决定）
