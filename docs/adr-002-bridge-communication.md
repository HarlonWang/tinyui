# ADR-002 · JS 与 Kotlin 通信机制

- 状态：已定（2026-09-15）
- 结论：**双向入口固定为 6 + 5 个；JS 跑专用线程、K 侧入口不等待；一次 K 入口 = 一个事务 = 一次 patch flush；每页一个引擎；错误分六类汇到一个 sink；载荷统一 JSON 文本**
- 序列化是本决策的一部分（第 3.6 节），不单独成文

## 1. 背景

ADR-001 定了 JS 侧"状态变化 → 攒 patch → 过桥"的模型，但没有回答桥本身怎么工作：谁在什么时候以什么方式调谁、跑在哪个线程、一次调用的边界在哪、两边靠什么 id 对上号、出错了怎么办、载荷长什么样。序列化只是最后一问，前面几问不定，它定不了。

事实基础（mquickjs-kmp 的 shim 与 `JsRuntime`，2026-09-15 核对）：

- 跨界值 `kmpjs_value` 只有 undefined / null / bool / number / string / object（自动转 JSON 文本）/ exception（message + JS 栈）/ ref 八种 tag，**没有字节数组**
- JS → Kotlin 走单一 trampoline 宿主函数（`registerFunction`），C 层同步；宿主函数返回非零在 JS 侧变成 `Error` 抛出
- Kotlin → JS 走 `callFunction` / `evaluate`，全部 `suspend`，`JsRuntime` 用 Mutex 互斥、工作跑在构造时传入的 dispatcher（默认 `Dispatchers.Default.limitedParallelism(1)`），协程取消 / 超时映射为引擎 interrupt
- 引擎单线程、不可重入；每引擎只能加载一个字节码程序，且须先于任何调用；堆是创建时给定的固定缓冲区
- mquickjs 没有事件循环：JS 眼里的"异步"永远是"宿主稍后再调我一次"

## 2. 候选方案

按六个子问题分别列（各自的判断放第 3 节）：

| 子问题 | 候选 |
|---|---|
| 调用模型：JS 是否允许同步等宿主 | 保留同步查询类入口（白名单） / 一律异步（连 `i18n.t` 都回调） |
| 线程模型 | A. JS 跑主线程 / B. JS 专用线程、K 入口不等待 / C. JS 专用线程、K 入口阻塞等待 |
| 事务边界 | 一次 K 入口一个事务、不跨事务合并 / 主线程侧按帧合并密集事务 |
| 引擎与页面 | 每页一个引擎 / 多页共享一个引擎 |
| 业务异常后的状态 | React 式：不回滚 signal、照常 flush / 丢弃整个事务含 pending 队列 |
| patch 编码 | A. JSON 文本 + 数组形态 op / B. JSON 对象形态 / C. 自定义文本 / D. 二进制 Typed Array（需扩 shim ABI）/ E. 每条 op 一次跨界调用 / F. 不序列化，Kotlin 经 `JsRef` 逐字段读 JS 对象 |

## 3. 依据

### 3.1 调用模型

定义：**同步 = 调用方在这次调用返回时拿到结果；异步 = 这次调用只是发出去，结果经反方向的另一次调用送达。**

JS → Kotlin（底层全是同步 trampoline，"异步"指业务语义上结果后到）：

| # | 入口 | 同步 / 异步 | 说明 |
|---|---|---|---|
| J1 | `__host.apply(patchJson)` | 同步，无返回值 | 每次 K 入口返回前恰好一次；**唯一**的 UI 写通道 |
| J2 | 同步查询类宿主能力：`device.info()`、`i18n.t(key)`、`config.get()` 等 | 同步，有返回值 | 调用期间 JS 阻塞在宿主里；**白名单制**，只允许内存中立即可得的东西 |
| J3 | 异步完成类宿主能力：`http.request`、重 IO、`dialog`、`picker`、**定时器** | 异步 | `__host.call(name, cbId, argsJson)`，立即返回；结果经 K3 |
| J4 | 即发即忘命令：`toast`、`haptic`、`navigation.push`、埋点 | 同步，无返回值 | JS 不关心结果 |
| J5 | `console.log` / 未捕获异常上报 | 同步，无返回值 | 走 shim 的 `kmpjs_log_fn`，不占 trampoline |

Kotlin → JS（底层全是 `callFunction`；**每个入口都以 J1 收尾**，Kotlin 在这次调用内部重入地收到一次 `__host.apply`）：

| # | 入口 | 说明 |
|---|---|---|
| K0 | 加载页面程序（`loadBytecode`） | 每页一次；须先于任何调用 |
| K1 | 生命周期：`__mount(propsJson)`、`__unmount()`、`__visible(bool)` | `__mount` 返回前产出整棵树的 patch；`__unmount` 触发根 owner dispose |
| K2 | UI 事件：`__dispatch(nodeId, event, payloadJson)` | 来自 Compose |
| K3 | 异步完成回送：`__resolve(cbId, resultJson)` / `__reject(cbId, errorJson)` | J3 的另一半；定时器到点也走这里 |
| K5 | 宿主主动推送：`__emit(topic, payloadJson)` | 网络状态、主题、push、登录态；JS 侧订阅制 |

（编号跳过 K4：讨论初期定时器单列为 J5 / K4，后并入 J3 / K3，见 3.4。）

底图上直接能看出的三件事：**只有 J2 是"JS 等 Kotlin"**，其余等待都反过来；K 侧入口形态完全一致（串行、以 flush 收尾），事务边界只需在 `callFunction` 外包一层；J3 / K3 是靠 id 对上号的分体入口，id 生命周期与 owner 有关。

四个代表性场景（线程按 3.2 的 B）：

1. **打开列表页先拉数据**：K0 → K1 `__mount` → JS 跑组件函数，遇 `http.get` 发 J3 拿到 cbId 立即返回，渲染 Loading，J1 首帧 → Kotlin IO 完成 → K3 `__resolve(cbId, list)` → 回调里 `setItems` + `setLoading(false)` → flush：`Show` 切分支、`For` 建 N 行 → J1。JS 从头到尾没等过任何东西，两次进入 JS 各是一个完整事务
2. **handler 里同步查 i18n**：K2 → handler 遇 `i18n.t(key)` 发 J2，宿主查内存字典几微秒返回 → `setTitle` → J1。J2 让业务写法自然，安全前提只有一个：宿主实现在当前线程立刻返回、不做 IO、不等别的线程
3. **J2 不守规矩**：业务注册"同步"的 `user.profile()`，Kotlin 实现里 `runBlocking` 读 DataStore——JS 线程阻塞；若实现还需要主线程，而主线程正等 JS → 死锁。**一个 J2 实现里的一次 IO 会把整个 K 侧入口链一起冻住**，这是白名单制的理由；J3 形态不存在此问题
4. **卸载时请求未回**：`__unmount` 后 300 ms K3 才到。不处理则回调白跑，回调里若有 J4 会出现"页面已关 toast 才弹"的幽灵行为。处理：每页一引擎让 unmount = 关引擎，pending 表随之消失；Kotlin 侧同时 cancel 该页协程作用域，inflight 请求不再回送

### 3.2 线程模型

| | A. JS 跑主线程 | B. JS 专用线程，K 入口不等待 | C. JS 专用线程，K 入口阻塞等待 |
|---|---|---|---|
| 一次点击 | 主线程直接跑 JS、直接 apply | 主线程 post → JS 线程 → post 回主线程 apply | 同 B 但主线程干等 |
| 事件延迟 | 零切换 | 两次切换，约 0.1～0.5 ms | 同 B |
| JS 慢时 | **直接掉帧**，业务一个大循环就冻屏 | 主线程照常，UI 更新晚到 | 主线程被拖住 |
| J2 死锁风险 | 无 | 有，靠白名单堵 | 有 |
| 看门狗 | 中断 JS 救不了已卡的主线程 | interrupt 有效，UI 不受影响 | 同 A |
| 与 `JsRuntime` 默认 | 要显式传 `Dispatchers.Main` | 就是默认形态 | 默认 + 外层 runBlocking，反模式 |

C 两头缺点相加，排除。A 在 bench 数字下够用，但选 B 的理由是三条不可控因素：业务 JS 耗时不受框架控制（无 JIT，比 V8 慢一到两个数量级，热下发代码里一次几千条数据的 `filter().map().sort()` 在 A 里就是冻屏）；A 把 J2 安全性寄托在同线程上，掩盖问题；看门狗只在 B 里有意义。

B 的代价：**K 侧拿不到 JS 的同步答复**——"返回键要不要拦截""手势是否消费"这类场景做不到，一律改成 JS 挂载时把意图作为 prop 预先声明，Kotlin 据此决定。顺序保证不是问题：单车道 dispatcher + 公平 Mutex 保证 K 入口按提交顺序执行，patch 回主线程走有序队列。

### 3.3 事务边界与批处理

B 定了之后此块是推论：**一次 K 入口 = 一个事务 = 恰好一次 J1，不做跨事务合并。**

- 同一事务内的状态变化在 flush 时合并（ADR-001 已定）
- 多个 K 入口密集到达（一帧内三个网络回调）→ 三个事务、三条 patch 消息，按序回主线程各自 `withMutableSnapshot` 应用。不在 JS 侧或队列里合并：Compose 本身按帧合并重组，三次快照写入同一帧只触发一次重组，合并已经免费拿到
- 事务是原子的：flush 没跑完的事务一条 patch 都不发，Kotlin 不会拿到半棵树
- 大事务（挂载 1000 行、209 KB）不拆：拆了用户会看到半渲染列表，且 bench 表明这个量级一次过桥没问题

### 3.4 跨界标识

根是**引擎与页面的对应关系**：

| | 每页一个引擎 | 多页共享一个引擎 |
|---|---|---|
| 程序加载 | 页面字节码 = 框架运行时 + 页面代码打成一个包，各自加载 | 所有页面预先打进同一程序，或后续页面走源码 `evaluate`（放弃字节码预编译） |
| 内存 | 每页一块固定堆（bench：1000 行列表最小 4.3 MB，实际给 8 MB 量级）；返回栈 5 页 = 40 MB | 一块堆共享，总量小，但一页的垃圾影响所有页的 GC |
| 页面卸载 | **关闭引擎**：节点、handler、pending 回调、定时器全部随之作废，零回收逻辑 | 逐类清理，漏一种就跨页泄漏 |
| 隔离 | 全局变量、异常、死循环 interrupt 只影响本页 | 一页的 `var` 污染全局；一页被 interrupt 后引擎状态是否可信要看情况 |
| 跨页共享状态 | 走 Kotlin（K5 推送） | JS 全局，正是隔离问题的来源 |
| 创建开销 | 每次进页 `kmpjs_create` + `loadBytecode`，预计毫秒级，待测 | 一次 |

选每页一引擎：决定性理由是"卸载 = 关闭引擎"把回收问题消灭大半，与 ADR-001 所有权同一思路——生命周期靠结构边界一刀切。代价是内存叠加，记为遗留。

在此之下四种 id：

| id | 谁分配 | 怎么用 | 回收 |
|---|---|---|---|
| 节点 id | JS，`nextId++`，页内唯一 | patch 主键；K2 事件带回 | 不回收不复用（32 位按页用不完）；`["r", id]` 时 Kotlin 递归删子树 |
| handler | 不过桥 | Kotlin 只发 `(nodeId, eventName)`，JS 查 `handlers[id + ":" + event]` | 随 owner 的 `onCleanup`（ADR-001） |
| callback id（J3 / K3） | **JS 分配**，随 J3 调用传给宿主，宿主原样带回 | J3 不需要返回值 | resolve / reject 时从 `pending` 表删；页面卸载 = 引擎关闭 + cancel 该页协程作用域 |
| timer id | 同 callback id | 定时器就是一种异步宿主能力：`timer.schedule(cbId, ms)` → `__resolve(cbId)` | 同上 |

两个推论：J5 / K4 从底图消失并入 J3 / K3，JS 侧只有一张 `pending` 表、一个 id 空间，Promise polyfill 只对接这一对；callback id 由 JS 分配而非 Kotlin 返回，因为 J3 不用等返回值、宿主实现可以直接扔进协程就走，且 id 的持有方与分配方在同一侧，没有"Kotlin 分配了但 JS 还没登记就回调了"的时序窗口。

Kotlin 侧对应一个**每页作用域**：持有引擎、`CoroutineScope`、patch 队列、`NodeTree`；unmount 时 cancel scope → 关引擎 → 清 NodeTree，一处收口。

### 3.5 错误传播

| # | 来源 | 谁先发现 | 怎么传 | 页面后果 |
|---|---|---|---|---|
| E1 | 业务逻辑抛异常：handler、回调（flush 之前） | JS 运行时在入口处 catch | 上报（含 JS 栈）；**不回滚已写入的 signal**，照常 flush | 页面继续 |
| E2 | 渲染期抛异常：thunk、`For` 的 renderRow、`Show` 分支函数（flush 之中） | JS 运行时在 flush 里 catch | 丢弃本事务全部 patch，上报 | **页面失败**：错误页 / 重试；dev 构建叠加 JS 栈 |
| E3 | 异步宿主能力失败（http 错误、权限拒绝、能力不存在） | Kotlin | `__reject(cbId, {code, message})` → 业务 `.catch`；无人 catch 仅上报 | 页面继续；能力不存在给固定 code 供降级 |
| E4 | 同步宿主能力失败（J2） | Kotlin | shim 转成 JS `Error` 抛出，落入 E1 | 页面继续；白名单实现应"查不到返回 null"而非抛 |
| E5 | patch 应用失败：节点不存在、组件未注册、prop 类型不对 | Kotlin `NodeTree.apply` | 跳过该 op，上报（页 id + op 原文）；未知组件渲染占位 | 页面继续；**宿主永不因坏 patch 崩溃**（多半是 JS 包比宿主新的版本问题） |
| E6 | 引擎级：OOM、看门狗超时、字节码与引擎 commit 不匹配 | Kotlin | 上报 | **页面失败**：关引擎、错误页，重试时重建引擎 |

E1 / E2 的分界是 flush：之前是业务逻辑，之中是框架替业务算 UI；前者出错 UI 仍自洽，后者出错框架已无法产出一致的树。

E1 选 React 式（不回滚 signal、照常 flush）而非丢弃整个事务：signal 已写、effect 没跑，UI 与状态就此分叉，后续每次更新都建立在错的基线上，比"这次操作做了一半"更糟；React / Solid 同样不回滚。

三条统一规则：所有错误汇到 Kotlin 侧一个 sink（页 id、入口名、JS 栈或 op 原文），上报与 dev 叠层接在后面，JS 侧不吞；patch 消息的原子性只保证"完整一次 flush 或什么都没有"，不承诺状态回滚；页面失败是页面级的，只关这一页的引擎，错误页由 Kotlin 渲染不依赖 JS。

### 3.6 序列化

调用模型定了之后此块是推论。bench 量级：1000 行挂载 10006 条 patch、209 KB JSON，JS 侧含构造 + 序列化 5.8 ms；单条更新 + flush 约 1 µs。`JSON.stringify` 在 mquickjs 里是 C 实现，是 JS 侧能产出的最便宜的东西。

| 方案 | JS 侧 | 过桥 | Kotlin 侧 | 判断 |
|---|---|---|---|---|
| **A. JSON 文本，op 数组形态** `["p",2,"text","x"]` | `JSON.stringify`（C） | 现有字符串通道 | 解析 JSON | 基线 |
| B. JSON 对象形态 | 同上，字节多 40～60% | 同上 | 键名匹配、多分配 | 纯代价 |
| C. 自定义文本 | JS 拼字符串，**解释执行** | 同上 | 略简单 | JS 侧变慢换 Kotlin 侧一点点 |
| D. 二进制 Typed Array | 逐元素写，解释执行；字符串仍单独传 | **shim 无 bytes tag，要扩 ABI**、两套 actual 跟改 | 零解析 | 为尚未证明的瓶颈付两头代价 |
| E. 每 op 一次跨界 | 无 | 挂载 10006 次跨界 | 无解析 | 最差 |
| F. `JsRef` 引用，不序列化 | 无 | 1 次拿数组 ref，之后每条 op、每个字段各 1 次跨界 | 在 JS 线程持锁期间逐字段读出并物化 | 见下文，比 A 贵数倍 |

**F 的评估**（2026-09-15 补，用户提出"走 JS 对象引用省掉序列化"）。可行性没问题：mquickjs-kmp 的 `KMPJS_FLAG_REF_OBJECTS` 让对象以 `JsRef` 句柄而非 JSON 交出，`JsRef` 有 `get(name)` / `get(index)` / `toJson`，引用计数槽位表，transient 引用回调返回即失效、`retain()` 可跨调用持有。问题在性能与影响：

- **没有消除序列化成本，只是换成更贵的东西。** 1000 行挂载 10006 条 op，Kotlin 要 `get(index)` 拿每条 op 的 ref、再 `get(0..3)` 读字段，约 4～5 万次跨界（JNI / cinterop → shim 查句柄表 → 引擎取属性 → 包成 `kmpjs_value`），单次按 0.3～1 µs 算光调用开销就是 15～50 ms，是 A 路径全程的数倍到十倍；每个字符串值仍要从引擎堆拷成 Kotlin `String`，**字符串拷贝一个没省**，省掉的只是引号和逗号。单条更新也是 6 次跨界对 1 次
- **绕不过"解析"。** `JsRef` 只能在 `withEngine` 里（JS 线程持锁期间）使用，而 patch 要到主线程应用，Kotlin 仍须在 JS 线程上把每条 op 物化成 Kotlin 对象再投递——和"解析 JSON 成 op"是同一件事，只是每个字段多一次跨界
- **占用 JS 线程更久**：JS 被阻塞的时间从"一次 C 侧 stringify"变成"Kotlin 遍历完整棵 patch 数组"，直接抵消线程模型 B 的收益
- **堆压力与复杂度**：patch 数组本是 flush 完即弃的临时垃圾，走引用要 retain 到 Kotlin 读完，压缩 GC 下被钉住；引用计数跨两侧管理，Kotlin 忘 close 就漏 JS 堆。A 是无状态的
- handler 用函数引用（`KMPJS_REF_FUNCTION`）让 Kotlin 直接 `call` 是同类想法：省不了什么（现在只是 `(nodeId, event)` 两个标量过桥），却要在节点移除时跨界 release，漏一个就钉住一个闭包

mquickjs-kmp 自身把 `ObjectTransport.JSON` 设为默认、ref 作为可选 flag，也是同一判断：引用适合"大对象只读一小部分"或"需要回调 JS 函数"的场景，不适合"整批数据全部读走"的场景，patch 流恰是后者。未做微基准，用户决定不跑。

选 A：JS 侧已是最优；不动 shim ABI；Kotlin 侧成本可在不改格式的前提下压掉——op 只有五种、字段位置固定，手写流式解析器逐 token 直接调 `NodeTree.apply`，不建 `JsonElement` 树；可读可抓包，bench 的 verify 模式就靠它；D 可作为后加的独立编码路径，不影响 JS 侧设计。

## 4. 决策

| 子问题 | 结论 |
|---|---|
| 调用模型 | JS → K 五类（J1 patch / J2 同步查询白名单 / J3 异步能力含定时器 / J4 即发即忘 / J5 日志）；K → JS 五类（K0 加载 / K1 生命周期 / K2 事件 / K3 回送 / K5 推送）；J2 **保留 + 白名单**，业务模块不得注册同步宿主函数 |
| 线程模型 | **B**：JS 跑 `JsRuntime` 默认单车道 dispatcher；K 入口 fire-and-forget；patch 由 JS 线程在 `withMutableSnapshot` 内直接写入节点表、主线程只重组（2026-09-15 由 ADR-003 修订，原为"经有序队列回主线程应用"，理由见 ADR-003 §3.2）；每次 K 入口带超时，超时走 interrupt；"UI 同步问 JS"一律改为 prop 预先声明 |
| 事务边界 | 一次 K 入口 = 一个事务 = 一次 J1；不跨事务合并；大事务不拆 |
| 引擎与页面 | **每页一个引擎**；Kotlin 侧每页一个作用域（引擎 + CoroutineScope + patch 队列 + NodeTree），unmount 一处收口 |
| 跨界标识 | 节点 id JS 分配不回收；handler 不过桥；callback id JS 分配、定时器并入同一 id 空间 |
| 错误传播 | 六类（E1～E6）；E1 React 式不回滚；E2 / E6 页面失败；E5 宿主永不崩；一个 sink |
| 序列化 | JSON 文本 + 数组形态 op；J3 为 `__host.call(name, cbId, argsJson)`；K 侧统一"标量定位 + 一个 JSON 载荷"；跨桥值只允许原始类型、字符串、可 JSON 化对象，函数永不过桥，prop 摊平；Kotlin 侧流式解析不建树；**不走 `JsRef` 引用**（跨界次数与线程占用都更差） |

## 5. 后果与遗留

接受的代价：
- K 侧拿不到 JS 的同步答复；需要 UI 立刻知道 yes/no 的场景只能预先声明
- 每页一块固定堆，返回栈深时内存叠加
- 业务 handler 抛异常后状态不回滚，"操作做了一半"由业务自己兜（与 React 一致）

待定 / 待验证：
- J2 白名单的具体清单与注册方式（框架内置，业务不可扩展）
- 返回栈深页的引擎回收策略（栈深超过 N 销毁引擎、返回时重挂载，状态丢失如何处理）
- 引擎创建 + 字节码加载的真机耗时
- `ErrorBoundary` 原语：E2 目前整页失败，是否需要分支级兜底
- 二进制编码路径：仅当真机 profiling 证明 Kotlin 解析占主导时再开
- K 入口超时阈值；E3 的错误 code 表

派生的下游决策：
- **Kotlin 侧节点表与组件注册**：见 ADR-003
- **事件与输入状态归属**：见 ADR-004
