# 应用模型：页面是 JS 的世界，应用是 Kotlin 的世界

- 状态：已对齐（2026-09-16）；API 面（`tinyui-native` 的 `navigation` / `store` / `events`）归 roadmap C 组与 J2 白名单一起定
- 来源：ADR-002 "跨页共享状态走 Kotlin（K5 推送）"、"多页共享引擎被否：JS 全局正是隔离问题的来源"、`navigation.push` 为 J4；ADR-003 "组件注册表 App 级、不可变"

## 1. 前提

JS 侧不存在长生命周期的"应用对象"：没有 `app.tsx`、没有 `onLaunch`、没有 `globalData`。每个页面模块是一个孤岛，出口只有 `tinyui-native` 的宿主能力，入口只有 K1 生命周期、K2 事件、K3 回送、K5 推送。页面对另一个页面的存在一无所知。

## 2. 四类应用级事务的归属

| 事务 | 归属 | 机制 |
|---|---|---|
| 路由 | Kotlin 导航栈 | 页面名 = 模块名 = 路由键（`pages/detail`）。JS `navigation.push(name, params)` 经 J4 → Kotlin 建页面作用域 → K0 加载 → K1 `__mount(props)`，params 即 props。返回 = pop = `__unmount` = 关引擎。深链由宿主解析成页面名 + 参数走同一条 push |
| 应用生命周期 | 宿主事件 | 前后台、内存警告、主题、语言、登录态经 K5 `__emit(topic)` 投给每个订阅了的活页面；栈顶页额外收 K1 `__visible`。页面只有挂载、卸载、可见性三个钩子 |
| 跨页状态 | Kotlin 内存 store | 见第 3 节 |
| 应用级 JS 逻辑 | Kotlin，或无状态工具代码打进各页模块 | 常驻 JS 的出口是"应用级服务 Runtime"：一个不挂 UI、随 App 生命周期的引擎，页面经 Kotlin 以 JSON 与它通信，形态同 J3 / K3。v1 不做，触发条件见 roadmap D 组 |

**TinyUI 页从宿主看只是一个 Composable**，导航栈里可以混放原生页与 TinyUI 页。v1 不内置路由器：库提供页面 Composable 与 `Navigator` 接口，宿主用自己的导航框架实现，JS 的 `navigation.*` 委托给它；sample 给最简实现。

## 3. 页面之间怎么通信

页面之间没有直接通道，全部经 Kotlin 中转，载荷只有 JSON。两个引擎本来就不能共享对象，这是设计而不是限制。

| 场景 | JS 侧 | 过桥 | 到达形态 |
|---|---|---|---|
| 向前传参 | `navigation.push("pages/detail", {id})` | J4 | 新页 K1 `__mount(props)` |
| 向后回传 | `navigation.pop(result)` | J4 | 上一页收 K5 固定 topic（如 `navigation.result`） |
| 共享状态 | `store.get(key)` / `store.set(key, v)` | J2 读，J4 写 | 真值在 Kotlin，变更经 K5 推给订阅了该 key 的页面 |
| 事件广播 | `events.emit(topic, payload)` / `events.on(topic, fn)` | J4 | 所有订阅了该 topic 的活页面各收一次 K5 |
| 直接调用另一页 | 无 | 无 | 不支持；需要它说明那个状态该进 store |

- **向前传参**：props 是 JSON，函数不过桥。"完成后回调我"只能靠回传或事件
- **向后回传**：原语是 K5 topic，结果投给"处在那个栈位置的页面"而不是某个闭包，页面被回收重建后照样收到。`push` 返回 Promise 的写法（J3 + cbId）与栈深回收冲突——被回收页的闭包已不存在；可之后作为糖加在 `tinyui-native`，文档写明回收语义
- **共享状态**：真值在 Kotlin，原生页与 TinyUI 页共用同一份；内存 key-value 所以 J2 同步读合法；JS 侧包成 signal，K5 到达时更新 signal，绑定了它的 prop 自动重算，与页内响应式同一套。持久化由宿主决定
- **事件广播**：与宿主事件同一条总线，网络状态、主题是 Kotlin 往总线发，业务事件是 JS 往总线发，消费方不区分来源。订阅登记到 Kotlin，只推给感兴趣的页面（每次 K5 = 一次线程切换 + 一个事务）；订阅随引擎关闭消失

## 4. 投递语义

- **状态会留下，事件会错过**：store 是状态，页面回收重建时从 store 重读；事件是瞬时的，页面不在时发生的事件不补发。业务判断"错过了要不要紧"，要紧就写进 store
- **顺序只在单页内保证**：每个引擎串行，同一页收到的 K5 严格有序；跨页无顺序承诺
- **同名页面多实例**：detail 跳 detail 是两个引擎，Kotlin 以页面实例 id 寻址而不是页面名；回传目标、订阅登记都挂在实例上

## 5. 返回栈回收

ADR-002 遗留的"栈深页引擎回收策略"归 Kotlin 侧路由器：栈深超过 N 关引擎，返回时用保存的 props 重新 `__mount`。推论是页面必须能从 props + store 重建，页内临时状态丢失由业务经 store 自救。N 等 roadmap B 组真机内存数据出来后定。

## 6. 对构建链的影响

每页一份字节码正好是路由键到产物的一一映射，`tinyui build` 输出页面清单（`manifest.json`），Kotlin 侧路由表以它为来源，不两边手写。见 [build-chain.md](./build-chain.md)。
