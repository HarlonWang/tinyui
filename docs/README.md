# JS 桥接 UI 框架 · 设计文档

基于 [mquickjs-kmp](https://github.com/HarlonWang/mquickjs-kmp) 与 Compose Multiplatform 的动态化 UI 框架：业务页面用 JS 写声明式组件，Android / iOS 双端由 Compose 渲染，页面可热下发。本目录是各项关键技术选型的决策记录（ADR），一项决策一个文件；本文只放各决策共享的背景，不重复写进单项 ADR。

## 框架定位

- **逻辑和 UI 描述都在 JS**：JS 侧维护组件树与状态，产出节点树 / patch；Kotlin 侧只负责把 patch 映射到 Compose 原生组件（Text / Column / LazyColumn …）
- **业务感知是声明式组件**：写法接近 React / Solid 的组件函数 + JSX，构建期 TS → ES5，再由 `kmpjsc` 预编译成字节码下发
- **渲染不自己画**：直接映射到 Compose 组件，双端一致性由 CMP 保证

## mquickjs 硬约束（所有选型的前提）

来源：`native/mquickjs/README.md`（mquickjs-kmp 仓内的上游副本）与 mquickjs-kmp 的 shim 设计。

| 约束 | 对设计的直接影响 |
|---|---|
| ES5 子集、始终严格模式；无 Proxy / class / Promise / Map / Set / 箭头函数 / 模板字符串 | 业务代码可用 TS 写再降级，但**框架运行时不能依赖 Proxy 与 Promise**；Vue 式 Proxy 响应式出局；异步靠 ES5 Promise polyfill（纯闭包） |
| 固定大小堆 + 压缩 GC，无 JIT | 常驻对象数与分配率直接决定 GC 频率；解释器下函数调用不免费 |
| 无事件循环，JS 的每次执行都是宿主调进来的 | "宿主调用返回前统一 flush" 天然就是事务边界，不需要 microtask 调度 |
| 值跨界只走原始类型 / UTF-8 字符串，Kotlin 永不持有 JSValue | JS 侧节点就是整数 id；树 / patch 以 JSON 字符串过桥 |
| `Date` 只有 `Date.now()`；`for of` 仅支持数组 | 业务代码写法约束，构建期可检查 |

## 总体运行模型

```
JS                                   桥                          Kotlin
组件函数只跑一次，建出节点表          __host.apply(json)   →       NodeTree.apply：patch 写入
状态变化 → 只重算受影响的绑定                                     SnapshotStateMap / List
→ 攒 patch，本次宿主调用返回前 flush   ←  __dispatch(id, event)     Compose 重组做最小刷新
```

- JS 不做整树 diff，Kotlin 不做任何比对：两边都只处理"真正变了的那几个属性"（详见 [ADR-001](./adr-001-reactivity-model.md)）
- 结构变化只发生在 `For`（keyed reconcile，限于单个父节点的子列表）和 `Show` 两个原语里
- 文本输入、滚动位置等高频交互状态**默认留在 Kotlin 侧自治**，JS 只收 `onChange` 通知，需要改时发命令（`x` op）而非回写 prop——避免受控组件跨桥往返造成的输入卡顿（详见 [ADR-004](./adr-004-events-and-input-ownership.md)）

## 决策索引

| 编号 | 主题 | 状态 | 结论 |
|---|---|---|---|
| [ADR-001](./adr-001-reactivity-model.md) | 状态管理与更新模型 | 已定（2026-09-14，所有权 / 清理 2026-09-15 补定） | 运行时 Signal（细粒度绑定），不做 vdom diff，不走编译期静态依赖；作用域只开在结构边界，同步渲染期外创建 effect 抛错 |
| [ADR-002](./adr-002-bridge-communication.md) | JS 与 Kotlin 通信机制（含序列化） | 已定（2026-09-15） | 双向入口 5 + 5；JS 专用线程、K 入口不等待；一次 K 入口一个事务；每页一个引擎；错误六类一个 sink；JSON 文本载荷 |
| [ADR-003](./adr-003-kotlin-node-tree-and-registry.md) | Kotlin 侧节点表与组件注册 | 已定（2026-09-15） | 节点即重组单元；JS 线程直接写快照状态、主线程只重组；App 级注册表 + 清单下发；prop / event schema 写入时转换 |
| [ADR-004](./adr-004-events-and-input-ownership.md) | 事件与输入状态归属 | 已定（2026-09-15） | 事件三分（离散 / 流式输入 / 连续），60 fps 状态留 Kotlin；新增 `x` 命令 op（ref + cmd）；文本框 initial prop + 命令 + 事件，不受控回写 |

## 命名

框架名 **TinyUI**（2026-09-15 定，接续 2021 年同名项目的方向）。三种拼写各有固定位置，不随手混用：

| 拼写 | 用在哪 | 理由 |
|---|---|---|
| **TinyUI** | 品牌与行文：文档标题、README 首行、日志前缀、对外提及 | 大小写体现 Tiny + UI 两个词 |
| **tinyui** | 所有机器标识符：GitHub 仓 `HarlonWang/tinyui`、Maven `wang.harlon:tinyui`、Kotlin 包 `wang.harlon.tinyui`、CLI 命令、环境变量前缀 `TINYUI_`、目录名 | 无连字符是唯一在每种标识符里都合法的形态；避开 npm 上他人的 `tiny-ui` React 库 |
| **@tiny-ui** | 仅 npm scope：`@tiny-ui/core`、`@tiny-ui/ui`、`@tiny-ui/cli` | scope 已归项目所有且不可改名；scope 下包名回到无连字符 |

npm 裸包 `tinyui` 不可用：npm 防仿冒规则判定其与已有的 `tiny-ui` 过于相似（2026-09-15 实测 E403）。域名 **tinyui.app** 已于 2026-09-15 在 Cloudflare Registrar（个人账号）注册，自动续费 $14.20/年，DNS 在 Cloudflare。

## 仓库结构

单仓 `HarlonWang/tinyui`（2026-09-15 定）：两侧契约（patch 协议、schema → TS 类型）在一处，一次 PR 同时改两侧，示例 App 直接联调；代价是一个仓里同时有 Gradle 与 pnpm 两套工具链。

```
tinyui/
├── docs/               README、ADR、roadmap
├── packages/           所有 npm 包，目录名 = 包名去掉 scope（pnpm workspace）
│   ├── core/           @tiny-ui/core    JS 运行时（signal / effect / owner / h / For / Show / ref + cmd / Promise polyfill）+ 内置组件的 TS 类型（由 schema/ 生成，无运行时代码）
│   ├── native/         @tiny-ui/native  业务调用的宿主能力 API（http / storage / toast / navigation / i18n …，即 ADR-002 的 J2 / J3）
│   └── cli/            @tiny-ui/cli     构建工具：TSX → h() → ES5 → kmpjsc 字节码，`tinyui build`
├── compose/            wang.harlon:tinyui  KMP 库（Compose Multiplatform 侧）：节点表、注册表、桥、内置组件
├── schema/             内置组件 schema 的唯一真值 → 生成 packages/core 的 .d.ts 与 compose/ 的注册代码
├── sample/             示例 App（Android + iOS），M1 Counter / M2 列表页在这里跑
├── bench/              响应式模型 benchmark（引擎从 mquickjs-kmp 现场编译进 .engine/，见 bench/README.md）
└── build-logic/        Gradle convention plugins
```

命名依据：
- `packages/`：npm 生态惯例，`pnpm -r` / changesets 零配置；目录名与包名一一对应
- `core`：主包，业务 `import from "@tiny-ui/core"`；内置组件类型并入而不单独成包（只有 `.d.ts`，不值得多一个依赖；宿主 App 自己扩展的组件类型由它自己的 schema 生成到它自己的包里，不经过本仓）
- `native`：回答业务的问题"怎么调原生"；与 `core` 互补——core 是 JS 世界里的东西，native 是伸到 JS 外面的手。否掉 `host`（与运行时视角的"宿主"一词混）、`platform`（泛）、`capabilities`（长）
- `compose/`：直说它是 Compose Multiplatform 那一侧，将来若有第二渲染端可并列扩展；否掉 `host/`（运行时视角的词不适合做目录）、`library/`（多生态仓里"library of what"不清）、`container/`（国内直觉好但海外联想 Docker）、`kmp/`（说构建方式不说职责）
- `schema/`：两侧共同真值，独立顶层目录以体现"契约在中间"
- `sample/`：Gradle 工程按 Android / KMP 惯例叫；`bench/`、`build-logic/` 沿用现有

约定：顶层只放这八个目录；新 npm 包进 `packages/`，新 Kotlin 模块进 `compose/` 作为子模块，不在顶层增生。ADR 文本中的"宿主"仍指 Kotlin 侧这一运行时角色，与目录名 `compose/` 不冲突。

## 下一阶段

四份 ADR 遗留项的汇总、分组与建议顺序见 [roadmap.md](./roadmap.md)，状态在那里更新。

## ADR 写法

每份固定五段：**背景**（要解决什么、受哪些约束，引用本文不重复）→ **候选方案**（机制、代价、前提，一张对比表）→ **依据**（推理 + 实测数据、复现路径）→ **决策**（选什么、为什么；事先判据与实际偏离要写明）→ **后果与遗留**（接受的代价、待验证项、派生出的下游决策）。
