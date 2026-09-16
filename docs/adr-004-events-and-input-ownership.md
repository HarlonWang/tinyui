# ADR-004 · 事件与输入状态归属

- 状态：已定（2026-09-15）
- 结论：**事件按时间形态分离散 / 流式输入 / 连续三类，凡需在 60 fps 下保持一致的状态留 Kotlin；JS 对节点的动作走新增的 `x` 命令 op（ref + cmd），文本框用 `initialText` prop + `setText` 命令 + `onChange` / `onCommit` 事件，不做受控回写**

## 1. 背景

ADR-002 定了原则：高频交互状态默认留 Kotlin 侧自治，JS 只收通知，需要时才显式覆盖。本文把原则落成清单和机制，回答三件事：

1. 哪些事件过桥、以什么频率——过桥一次 = 一个事务（K2 → JS → J1），成本是两次线程切换 + 一次 JSON + JS 解释执行，约百微秒量级（2026-09-16 经 quickjs-kmp 实测，桥本身远低于此：小事务入出合计约 1 µs，2 KB patch 约 33 µs，见 [bench/results/2026-09-16-quickjs-kmp.md](../bench/results/2026-09-16-quickjs-kmp.md)；线程切换未测，仍按百微秒量级预留）；离散点击无所谓，逐帧滚动偏移就是每秒 60 个事务
2. 哪些状态归 Kotlin、哪些归 JS——RN 的经典教训：`TextInput` 受控（每次键入 → JS → setState → 回写 value）在桥延迟下丢字、光标跳；本框架的桥比 RN 更慢（解释器无 JIT），受控输入不可行
3. JS 需要"命令"Kotlin 侧状态时怎么办——清空输入框、滚到顶部、聚焦。这些是动作不是状态，prop 是幂等的，`scrollTo=0` 设过一次后用户滚走了再设 0 不会触发变化

## 2. 候选方案

| 子问题 | 候选 |
|---|---|
| 事件分类与归属 | 按时间形态三分（离散 / 流式输入 / 连续），归属随类别定 / 逐组件个案决定 |
| 文本 `onChange` 频率 | 每次键入过桥 / 仅提交时过桥 / 两者都提供、按 handler 注册决定 |
| 命令机制 | A. prop + 递增令牌 / B. patch 流新增 `x` op / C. 走宿主能力调用 `__host.call("node.cmd", …)` |
| 文本框值的归属 | 受控（`value` prop 回写）/ 非受控 + 命令覆盖 |

## 3. 依据

### 3.1 分类规则与归属

| 类别 | 例子 | 过桥 | 状态归属 |
|---|---|---|---|
| **离散** | `onClick`、`onLongPress`、`onSelect`（下拉选中）、`onToggle`（开关）、`onSubmit` | 每次都过，一动作一事务 | 无持续状态，或状态本身就是 JS 的（开关 `checked` 由 JS prop 决定——低频，可受控） |
| **流式输入** | 文本 `onChange` | 每次变化都过，但**值不回写**：Kotlin 的 `TextField` 自己持有文本与光标，JS 只是收到最新文本写进 signal 供别处用 | 文本与光标归 Kotlin；JS 侧 signal 是副本 |
| **连续** | 滚动偏移、拖拽位置、缩放比例、视频进度 | **逐帧不过桥**，只过端点或阈值：`onScrollEnd(offset)`、`onReachEnd`（分页）、`onDragEnd(x, y)`、`onProgress` 按秒节流 | 归 Kotlin，且要在重组间存活（`rememberLazyListState` 之类） |

判据：**凡是需要在 60 fps 下保持一致的状态留在 Kotlin，JS 只拿到它的快照或结果。** 开关的 checked 可以受控，是因为一次点击到 UI 反馈之间容忍一个事务的延迟；文本光标不容忍。

文本 `onChange`：每次键入过桥约每秒 5～10 次，可接受，业务需要实时搜索 / 校验；同时提供 `onCommit`（失焦 / IME 完成）。ADR-003 的 handler 标记机制保证没注册的事件不发，所以两个都提供、不需要框架层节流。

### 3.2 命令机制

| | A. prop + 递增令牌 `scrollToken=3, scrollTarget=0` | B. patch 流新增 op `["x", id, name, argsJson]` | C. `__host.call("node.cmd", …)` |
|---|---|---|---|
| 语义 | 把动作伪装成状态，靠令牌变化触发 `LaunchedEffect` | 一次性动作，不进节点状态 | 同 B |
| 与同一 flush 内 patch 的顺序 | 有 | **有**（同一条 JSON 按序） | **无**——命令可能先于"建列表"的 patch 到达 |
| 污染 | 节点状态多一堆令牌 prop，schema 也要声明 | 无 | 无 |
| 违反"J1 是唯一 UI 写通道" | 否 | 否 | 是 |

C 排除：顺序问题致命（"建 1000 行然后滚到第 500 行"必须保证列表先存在）。A 能用但别扭。选 B，patch op 集从 `c / p / i / m / r` 扩为六种。

**JS 侧**：React 式 ref。

```tsx
const list = ref()
<LazyColumn ref={list}>…</LazyColumn>
<Button onClick={() => list.cmd("scrollTo", { index: 0 })} />
```

`ref()` 返回一个对象，`h()` 遇到 `ref` prop 时把节点 id 填进去（不过桥）；`cmd()` 往 `patches` 推 `["x", id, "scrollTo", {"index":0}]`，随本事务 flush。

**Kotlin 侧**：命令进 schema（`command("scrollTo") { int("index") }`，未声明 → E5 跳过上报）；解析器把它放进节点的 `commands` 队列（不是 props，不进快照语义，但能触发主线程消费）；组件在 `LaunchedEffect` 里消费队列，拿到 `LazyListState` 之类的状态对象执行。

三条语义：
- **一次性**：执行后即丢，不持久；节点被删时未执行的命令一起丢
- **晚于组合**：命令与 create 同一 flush 到达时，等节点首次组合完再执行（队列天然做到）
- **无回执**：fire-and-forget，JS 不知道成没成功；需要结果的场景这版不支持

### 3.3 文本框：initial prop + 命令 + 事件

有了命令，`TextField` 不需要受控 / 非受控之争：

- prop `initialText`：只在创建时生效，之后 JS 改它不影响（schema 标 `initial`，解析器对已创建节点的 initial prop 变更直接忽略 + dev 警告）
- 命令 `setText`：清空、回填、格式化后的覆盖，都是显式动作
- 事件 `onChange(text)` / `onCommit(text)`

Kotlin 永远是文本与光标的唯一持有者，JS 想改就发命令，两边不会打架。同类：`Switch` 保持受控（`checked` prop），因为它是离散的；`Video` 用 `play` / `pause` / `seekTo` 命令 + `onProgress` 节流事件。

### 3.4 payload 约定

- 一个事件一个扁平 JSON 对象，字段由 event schema 声明（ADR-003），无嵌套、无数组；没有字段时为 `{}`
- 字段名 camelCase；坐标与尺寸单位 dp（与 prop 一致）；列表相关用 `index`（int）与 `key`（string，即 JS 侧 `For` 的 key，便于业务直接定位数据）
- 不带时间戳、不带节点类型等可从 JS 侧推出的信息；不带 Kotlin 侧内部对象
- 连续类端点事件的 payload 只含终值（`offset`、`x` / `y`、`position`），不含轨迹

## 4. 决策

| 子问题 | 结论 |
|---|---|
| 事件分类与归属 | 离散每次过桥；流式输入每次过桥但值不回写；连续逐帧不过桥、只过端点或节流阈值。60 fps 一致性状态留 Kotlin |
| 文本 `onChange` | `onChange` 与 `onCommit` 都提供，按 handler 注册决定是否发送，框架不节流 |
| 命令机制 | patch 流新增 `["x", id, name, argsJson]`；JS 用 `ref()` + `cmd()`；命令进 schema；一次性、晚于组合、无回执 |
| 文本框 | `initialText`（initial prop）+ `setText` 命令 + `onChange` / `onCommit`；不做受控回写。`Switch` 等离散控件保持受控 |
| payload | 扁平 JSON、schema 声明、camelCase、dp、`index` + `key`，只含终值 |

## 5. 后果与遗留

接受的代价：
- 业务拿不到逐帧的滚动 / 拖拽数据；需要跟手动画的效果只能在 Kotlin 组件内实现
- 命令无回执，`focus` 失败之类 JS 不知情
- initial prop 语义要靠 schema 标注和文档，写 `<TextField initialText={() => x()}>` 这种动态绑定会被静默忽略（dev 警告）

待定 / 待验证：
- 连续类事件的节流阈值（`onProgress` 秒级、`onScrollEnd` 的静止判定）
- 命令回执：是否复用 J3 / K3 的 cbId 机制让 `cmd()` 返回 Promise
- 首批内置组件各自的事件 / 命令清单（随 ADR-003 内置组件集一起定）
- 手势组合（长按拖拽、滑动删除）是否作为内置组件提供，还是留给宿主扩展

派生的下游决策：无。四份 ADR 覆盖了框架的关键选型，后续进入实现阶段的设计（schema DSL、TS 生成、内置组件集）另立文档。
