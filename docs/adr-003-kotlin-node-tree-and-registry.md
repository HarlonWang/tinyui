# ADR-003 · Kotlin 侧节点表与组件注册

- 状态：已定（2026-09-15）
- 结论：**节点即重组单元（每节点一个 `SnapshotStateMap` + 一个 `SnapshotStateList`）；JS 线程在 `withMutableSnapshot` 内直接写节点表，主线程只重组；App 级不可变组件注册表 + 类型 / 能力清单在 `__mount` 时下发；组件声明 prop 与 event schema，写入时转换类型；handler 标记决定是否挂手势**

## 1. 背景

ADR-001 / 002 把 Kotlin 侧收成 patch 的哑执行器：不比对、不理解业务、不持有逻辑。剩下要定的是这条链上的每一环：

```
J1 到达（JS 线程）→ 流式解析 → 写节点表 → Compose 按节点类型渲染
                                              ↑
                                      组件注册表：type → composable
```

六个子问题：节点表的数据模型（决定重组粒度）；解析与投递在哪个线程；组件注册表的形态与扩展方式；prop 的类型约定；事件接线；列表对接。

## 2. 候选方案

| 子问题 | 候选 |
|---|---|
| 节点模型 | A. 每节点一个 `SnapshotStateMap` / B. 每 prop 一个 `MutableState` |
| 解析与投递 | A. JS 线程解析成 op 列表投主线程写 / B. JS 线程解析并直接写节点表 / C. 字符串投主线程解析 + 写 |
| 组件注册 | A. 框架内 `when(type)` 硬编码 / B. 注册表，框架注册内置、宿主注册扩展 / C. 注解或反射自动发现 |
| prop 类型 | A. 存原始值、读时转换 / B. 组件声明 schema、写入时转换 |
| 事件接线 | 推论，无分叉 |
| 列表 | 推论，无分叉 |

## 3. 依据

### 3.1 节点模型与重组粒度

Compose 的 `SnapshotStateMap` 是**一个**状态对象：改任何 key，所有读过这个 map 的作用域都重组。要做到"改 `color` 只重组读 `color` 的那一句"，得每个 prop 一个 `MutableState`。

| | A. 每节点一个 `SnapshotStateMap` | B. 每 prop 一个 `MutableState` |
|---|---|---|
| 改一个 prop | 该节点的 composable 整体重组 | 只重组读了这个 prop 的那一句 |
| 对象数 | 每节点 1 个状态对象 | 每节点 N 个（N = prop 数，通常 3～8） |
| 新增 key | 天然支持 | 要预建全部 key，或外层再包一个 map 状态 |

选 A：一个节点对应一个 composable（`Text`、`Row`），它本身就是 Compose 里最小的合理重组范围，改 `color` 顺带重算一次 `Text` 的参数是微秒级；B 把粒度做到句级，换来每节点多几个状态对象——ADR-001 已证明在意的是每行常驻对象数，同样的取舍在 Kotlin 侧没理由反过来。children 用 `SnapshotStateList<UiNode>`，插入 / 移动 / 删除只重组父节点的子列表布局，子节点各自 `key(id)` 包住不重组。

```kotlin
class UiNode(val id: Int, val type: String) {
    val props = mutableStateMapOf<String, Any?>()
    val children = mutableStateListOf<UiNode>()
}
```

### 3.2 解析与投递

| | A. JS 线程解析 → op 列表投主线程 → 主线程写 | B. JS 线程解析并直接写节点表 | C. 字符串投主线程，主线程解析 + 写 |
|---|---|---|---|
| 主线程做的事 | 遍历 op 写快照状态 + 重组 | **只有重组** | 解析 + 写 + 重组 |
| 中间对象 | 挂载时 1 万个 op 对象 | 无 | 无 |
| 线程切换 | 1 次 | 0 次（快照 apply 后 Compose 自行调度重组） | 1 次 |
| 209 KB 挂载对主线程 | 写 1 万条状态，估 1～3 ms | 0 | 解析 + 写，估 5 ms+，掉帧 |

C 把最重的活放在最稀缺的线程上，排除。A 与 B 的差别只有 apply 放哪个线程。选 B，依据是 Compose 快照系统的设计本身：`Snapshot.withMutableSnapshot` 可在任意线程调用，块内所有写入在 apply 时**原子地**对其他线程可见，Recomposer 观察到 apply 后在主线程调度重组——这是为跨线程写状态准备的机制。三个理由：主线程只剩重组（JS 线程此刻反正被 flush 占着，J1 是 K 入口返回前的最后一件事）；不需要 op 中间形态，流式解析器读到 `["p", 2, "text", "x"]` 直接写 `nodes[2].props["text"]`，零分配；顺序天然正确——节点表只有一个写者（JS 线程，单车道），主线程只读，事务原子性由 `withMutableSnapshot` 保证，与 ADR-002"完整一次 flush 或什么都没有"一致。

**纪律**（B 的全部风险所在）：
- 节点表**只允许 JS 线程写**；Kotlin 侧任何逻辑不得改 `props` / `children`，想改 UI 只能经 K 入口让 JS 发 patch。唯一例外是 unmount 清表，发生在页面作用域 cancel、引擎关闭之后
- 锁序：JS 线程持 `JsRuntime` Mutex 时短暂取快照全局锁；主线程从不在持快照锁时去拿 Mutex——K 入口是 `launch` 出去的挂起调用，不在 composable 或快照块内阻塞。禁止在 composable 里 `runBlocking` 进引擎
- E5 的"跳过并上报"在解析器里就地处理，坏 op 不进快照

此决策修订 ADR-002 决策表"线程模型"一行（原写"patch 经有序队列回主线程应用"）。

### 3.3 组件注册表

A（硬编码）排除的理由是产品而非技术：业务里一定有"这个卡片必须用原生已有实现"的情况，宿主不能扩展的框架落不了地。C 排除：iOS 无反射。B 无悬念，要定的是三个细节：

**组件形态**：一个组件 = 一个接收 `NodeScope` 的 composable。组件不直接碰 `props` map 和桥，只通过 `NodeScope`——类型约定、事件接线都只改 `NodeScope` 一处。

```kotlin
fun interface Component {
    @Composable fun Render(scope: NodeScope)
}

interface NodeScope {
    val node: UiNode
    operator fun <T> get(key: String): T             // schema 声明过的 key，已是类型化值
    fun has(event: String): Boolean                  // JS 是否注册了该事件的 handler
    fun dispatch(event: String, payload: String = "{}")
    fun modifier(): Modifier                         // 公共布局 prop 合成
    @Composable fun Children()                       // 容器组件调用；按 key(id) 遍历 children
}
```

**注册作用域：App 级、启动时定、之后不可变。** 页面之间组件集不同没有真实需求，却会让 JS 包与宿主的兼容关系变成二维。宿主 App 初始化时一次性 `register("pp.KycCard", schema) { ... }`，页面作用域只读。

**命名空间 + 清单下发。** 内置类型裸名（`Text`、`Column`），宿主扩展带前缀（`pp.KycCard`），避免内置新增撞名。`__mount` 时把注册表的类型清单（含各自的 prop / event 名）与 J2 / J3 能力名清单作为 props 的一部分交给 JS：让"JS 包比宿主新"从只能占位（E5）变成 JS 可主动降级（`host.has("pp.KycCard")`），与 ADR-002 E3"能力不存在给固定 code"同一思路的前置版。清单是几十个字符串，成本可忽略。

未知类型：渲染可配置的 `Placeholder` 组件（默认空 `Box`，dev 构建画红框 + 类型名），走 E5 上报。

### 3.4 prop 类型约定

桥上只有 String / Double / Boolean / null 四种值，composable 需要 `Dp` / `Color` / `TextUnit` / 枚举。

| | A. 存原始值，读时转换 | B. 组件声明 prop schema，写入时转换 |
|---|---|---|
| 组件取值 | `scope.prop<Color>("color", default)`，每次重组转一次 | schema 声明过的 key 直接是 `Color`，读取零成本 |
| 非法值在哪发现 | 读时，主线程重组期间 | **写时**，JS 线程解析期间，正是 E5 定义的位置 |
| 组件需要写 | 只写 composable | composable + schema 声明 |
| 额外收益 | 无 | schema 可导出：给 JS 侧生成 TS 类型定义，清单下发时带上 |

选 B：E5 落点对了（"跳过该 op、上报、宿主不崩"要求 apply 时就知道期望类型，A 只能等重组时发现，且上报里没有 op 原文）；主线程零转换，与 3.2 原则一致；schema 是 JS 侧类型安全的唯一来源——`<Text size="big">` 这种错能在构建期报，比 E5 上报强一个量级。

```kotlin
register("Text", props = {
    string("text", required = true)
    color("color", default = Color.Unspecified)
    sp("fontSize", default = 14.sp)
    enum<TextAlign>("align", default = TextAlign.Start)
}) { scope -> Text(scope["text"], color = scope["color"], ...) }
```

写入规则：解析器读到 `["p", id, key, value]` → 查该节点类型的 schema → 转换 → 写入类型化值；失败则跳过、上报（附 type / key / 原值）；schema 里没有的 key 同样跳过上报（防拼写错误静默）；`required` 只在 create 后的首个 flush 结束时校验一次。

**公共布局 prop**（`padding` / `width` / `height` / `background` / `margin` …）由框架定义一份公共 schema，所有节点自动带上，`NodeScope.modifier()` 合成 `Modifier` 交给组件。单位：数字一律 dp，字号类 key 由 schema 的 `sp()` 声明决定，不靠后缀。

代价：每个组件多一段声明，宿主扩展组件必须写 schema 才能注册——强制，否则清单和类型生成有洞。

### 3.5 事件接线

按已定推论：
- 事件也进 schema：`event("onClick")`、`event("onChange") { string("text") }`；TS 类型生成覆盖 handler 参数，清单让 JS 知道宿主组件支持哪些事件
- handler 标记决定是否挂手势：JS 侧 `h()` 遇到 `onXxx` 发 `["p", id, "onClick", true]`（ADR-001），Kotlin 存成节点的事件集合；composable 里 `if (scope.has("onClick")) Modifier.clickable { scope.dispatch("onClick") }`——没有 handler 的节点不挂 `clickable`，省手势检测与无障碍语义。JS 撤销 handler 发 `false`
- dispatch 路径：composable 的 lambda（主线程）→ `scope.dispatch(event, payload)` → 页面作用域 `launch { runtime.withEngine { callFunction("__dispatch", id, event, json) } }`，fire-and-forget（ADR-002 K2）。payload 由组件按 event schema 构造
- 节点已删但事件在途：用户点击的同一瞬间 JS 删了节点，`__dispatch` 在 handler 表里查不到——合法竞态，**静默忽略**（dev 构建打日志），不算 E 类错误
- 高频事件（滚动、拖拽、逐键输入）默认不过桥或只过"提交"版本，具体清单见 ADR-004

### 3.6 列表

`LazyColumn` 组件 = `items(scope.node.children, key = { it.id }) { Render(it) }`。JS 侧 `For` 建的全部行节点都存在于 Kotlin 节点表，虚拟化只发生在 composition 层（只组合可见行）。

## 4. 决策

| 子问题 | 结论 |
|---|---|
| 节点模型 | 节点即重组单元：`UiNode(id, type, props: SnapshotStateMap, children: SnapshotStateList)`；children 各自 `key(id)` |
| 解析与投递 | JS 线程流式解析、在 `withMutableSnapshot` 内直接写节点表，零中间对象；主线程只重组。节点表只允许 JS 线程写；禁止 composable 内阻塞进引擎 |
| 组件注册 | App 级不可变注册表；组件 = 接收 `NodeScope` 的 composable；内置裸名、宿主扩展带前缀；`__mount` 下发类型 + 能力清单；未知类型 `Placeholder` + E5 |
| prop 类型 | 组件声明 schema，写入时转换，失败跳过并上报，未声明 key 同样跳过上报；公共布局 prop 统一 schema 经 `modifier()` 合成；数字 dp、字号 sp 由 schema 决定 |
| 事件接线 | 事件进 schema；handler 标记决定是否挂手势；dispatch fire-and-forget；在途事件遇已删节点静默忽略 |
| 列表 | `LazyColumn` 直接 `items(children, key = id)`，虚拟化仅在 composition 层 |

## 5. 后果与遗留

接受的代价：
- 每个组件（含宿主扩展）必须写 prop / event schema，注册有仪式感
- Kotlin 侧永远不能自己改 UI 状态，所有 UI 变化都要绕 JS 一圈
- 改一个 prop 重组整个节点的 composable（而非句级）

待定 / 待验证：
- 真机上 JS 线程写快照与主线程重组的锁争用；若成问题，退回 3.2 的 A（op 列表投主线程）
- schema DSL 的具体形态；由 schema 生成 TS 类型定义的工具链
- 公共布局 prop 的清单与 `Modifier` 合成顺序
- 内置组件集的范围（首批：`Column` / `Row` / `Box` / `Text` / `Image` / `Button` / `TextField` / `LazyColumn` / `Spacer`）
- 万行级列表：JS 侧每行约 2.9 KB，一万行 29 MB，需窗口化 `For`，不在这版范围
- `Placeholder` 在 release 构建的表现（空 `Box` vs 隐藏）

派生的下游决策：
- **事件与输入状态归属**：见 ADR-004
