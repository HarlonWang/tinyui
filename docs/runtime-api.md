# JS 运行时 API：`@tiny-ui/core` v1

- 状态：已定（2026-09-16）；M1 的实现依据。系统说明见 [js-runtime.html](./js-runtime.html)，本文只放定义
- 来源：ADR-001（Signal、所有权）、ADR-002（桥入口、事务、错误）、ADR-004（ref + cmd、事件 payload）、ADR-005（组件函数必须同步、`createResource`、原生 Promise）
- 范围：业务可见的 API、它们的精确语义、页面模块契约、以及运行时与 Kotlin 之间的桥入口（内部契约）。JSX 写法如何变成对这些 API 的调用见 [jsx-transform.md](./jsx-transform.md)；产出的 patch 形态见 [patch-protocol.md](./patch-protocol.md)

## 1. 一览

| 类别 | 导出 | 一句话 |
|---|---|---|
| 响应式 | `signal(init)` → `[get, set]` | 状态单元，`===` 判等，整体替换 |
| | `memo(fn)` → `get` | 派生值，读取时按需重算 |
| | `effect(fn)` | 副作用，依赖变化后在 flush 时重跑 |
| | `onCleanup(fn)` | 登记清理，随最近的 effect 或结构作用域执行 |
| | `untrack(fn)` | 读取但不订阅 |
| 节点 | `h(type, props, ...children)` → `Node` | 建节点 / 调组件，JSX 的目标 |
| | `Fragment` | 多个兄弟节点 |
| | `thunk(fn)` | 编译器包动态 prop 用；业务一般不手写 |
| 结构 | `For` | keyed 列表 |
| | `Show` | 条件分支 |
| 命令 | `ref()` → `Ref`，`ref.cmd(name, args?)` | 对节点发一次性动作 |
| 异步 | `createResource(fetcher)` | 同步期建 signal，异步期写 |
| | `setTimeout` / `clearTimeout` | 全局，经宿主定时器实现 |
| 页面 | `pageVisible()` | 页面是否可见（K1 `visible`） |
| 版本 | `VERSION`、`PROTOCOL` | 包版本；patch 协议版本号 |

不在 v1：`createStore`（v1.1）、`createContext`、`ErrorBoundary`、`Suspense`、`Switch/Match`、`Index`、`Portal`、`lazy`、`setInterval`。页内跨组件共享状态直接用模块顶层的 `signal`（每页一个引擎，模块作用域就是页面作用域）。

## 2. 响应式原语

### 2.1 `signal`

```ts
function signal<T>(init: T): [get: () => T, set: (next: T | ((prev: T) => T)) => void]
```

- `get()` 在 effect / memo 执行期间被调用即建立订阅；在 handler、回调、`untrack` 里调用只取值
- `set(next)`：`next === 当前值` 时什么都不做；否则写入并把订阅者标记为待重算。**写入立即可见**（紧接着 `get()` 返回新值），但订阅者不立即重跑
- `set(fn)`：`fn(prev)` 的返回值作为新值。signal 的值本身不能是函数
- 数组 / 对象按引用判等：`set([...list(), x])` 触发，`list().push(x)` 不触发

### 2.2 `memo`

```ts
function memo<T>(fn: () => T): () => T
```

- 惰性：创建时不算；第一次读取时算并缓存；依赖变化后标记为脏，下一次读取时重算。同一事务里 `setCount(1)` 之后立刻读 `double()` 得到 2
- 重算结果 `===` 缓存值时不通知下游
- 订阅 memo 的 effect 在 memo 的依赖变化时被调度，与直接订阅 signal 无差别

### 2.3 `effect`

```ts
function effect(fn: () => void): void
```

- 创建时**立即同步跑一次**（收集依赖）；此后每当任一依赖变化，在本事务的 flush 阶段重跑
- 重跑前先解绑全部旧依赖、执行本 effect 登记的 `onCleanup`，再重新收集。条件分支切换后不残留过期订阅
- 调度：待重跑的 effect 进 FIFO 队列，flush 按入队顺序跑；跑的过程中新入队的在同一次 flush 内继续跑；已被 dispose 的跳过。同一个 effect 在一次 flush 里被重跑超过 100 次视为更新环，抛 E2
- **必须在同步渲染期内创建**：即在 `mount`、`For` 建行、`Show` 切分支、或另一个 effect 的执行期间。此外（异步回调、handler、`.then`）调用直接抛错（ADR-001 §3.7）
- 归属：创建时登记到当前 owner（根 / 行 / 分支）；在另一个 effect 执行期间创建的 effect 归属同一个 owner，不归属外层 effect（effect 不拥有 effect）

### 2.4 `onCleanup`

```ts
function onCleanup(fn: () => void): void
```

- 在 effect 执行期间调用：登记到该 effect，于它下次重跑前和 dispose 时执行
- 其余同步渲染期内调用：登记到当前 owner，于 owner dispose 时执行。写在页面组件函数体里就是"页面卸载"钩子，写在行组件里就是"行被删"钩子
- 渲染期外调用抛错

### 2.5 `untrack`

```ts
function untrack<T>(fn: () => T): T
```

执行 `fn` 期间不建立任何订阅。用于 effect 里"读一下但不想因它重跑"。

## 3. 节点与组件

### 3.1 `h`

```ts
type Node = /* 不透明句柄 */
function h(type: string | Component, props: Props | null, ...children: Child[]): Node
type Child = Node | Node[] | null | undefined | false
```

`type` 为字符串时是内置 / 宿主组件（`"Text"`、`"pp.KycCard"`），为函数时是业务组件。

**内置节点**（`type` 为字符串）：分配 id，发 `c`；逐个 prop：

| prop | 处理 |
|---|---|
| `ref` | 把节点 id 填进 `Ref`，不过桥 |
| `on[A-Z]…` | 值必须是函数；存进 handler 表，发 `["p", id, name, true]` |
| `thunk(fn)` 包过的 | 建 effect 绑定：跑 `fn`，结果与上次 `!==` 时发 `p`（第一次总发）；结果是函数 / 对象 / 数组抛 E2 |
| 其余 | 静态值，发一次 `p`。允许 string / number / boolean / null / undefined（后两者都发 `null`，恢复默认）；函数、对象、数组抛 E2（prop 摊平，ADR-002），典型是 `text={fmt}` 忘了调用 |

内置 / 宿主节点的 prop 类型集是封闭的，因为它们全部要变成 patch、函数不过桥；这个限制**只在这里**。

children 展平（数组、`Fragment`、`null` / `false` 忽略）后按顺序发 `i`。**children 在创建后不可变**：结构变化只经 `For` / `Show`。

**业务组件**（`type` 为函数）：把 props 里 `thunk` 包过的项转成 getter 属性、其余原样复制（**任何值都合法，含函数、对象、数组**：render prop、格式化函数都是普通用法，它们不过桥）、children 放进 `props.children`，调用一次 `type(props)`，返回值原样作为本节点。组件函数：

- 只跑一次，函数体就是挂载逻辑；没有 `useEffect`，需要副作用用 `effect`
- 读 `props.title` 拿到的是实时值（getter），在 effect 里读会订阅；组件不该把它解构成常量再用
- 必须同步返回一个 `Node`。返回 Promise（`async` 组件）、数组、`null` 抛 E2；多根用 `Fragment` 时只能作为 children，不能作为组件 / 行 / 分支的根
- 不开作用域：组件本身在运行时不留任何东西

### 3.2 事件

handler 签名 `(payload: P) => void`，`P` 是该事件 schema 声明的扁平对象（ADR-004 §3.4），没有字段时为 `{}`。K2 到达时查 `handlers[nodeId + ":" + event]`，查不到静默忽略（节点已删的合法竞态）。handler 抛错走 E1：上报、不回滚、照常 flush。

一个节点同一事件只能有一个 handler；`h()` 之后不能增删（事件标记是创建期决定的）。

### 3.3 `Fragment`

`h(Fragment, null, ...children)` 返回 `Node[]`，只允许出现在 children 位置。

## 4. 结构原语

### 4.1 `For`

```tsx
<For each={items()} key={(it) => it.id}>
    {(item, index) => <Row title={item().title} />}
</For>
```

```ts
interface ForProps<T> {
    each: T[]                                     // 编译器包成 thunk
    key: (item: T, index: number) => string | number
    children: (item: () => T, index: () => number) => Node
}
```

- `For` 自己不是节点，没有 Kotlin 侧对应：它是父节点 children 里的一个**可变长槽位**，行节点直接插进父节点。运行时给每个内置节点维护槽位表（静态 child 长度 1，`For` 长度 = 行数，`Show` 长度 0 / 1），`i` / `m` 的 index = 前面槽位长度之和 + 槽内位置，所以 `For` / `Show` 可以和普通兄弟节点混排、一个父节点可以有多个
- 因此 `For` / `Show` **只能直接写在内置节点的 children 里**：不能作为组件的返回值、行根、分支根或页面根（这些位置要求恰好一个节点）。需要时外面包一层 `Box` / `Column`；违反时 `h()` 抛 E2
- 在一个 effect 里读 `each`，对新旧 key 序列做 keyed reconcile，只产出 `i` / `m` / `r`（算法与 bench `reconcileKeys` 一致）
- 建行：新建行 owner，在其中调 `children(item, index)`，返回值必须是一个 `Node`，插到对应 index。行 owner 由 `For` 持有，不挂在 `For` 的 effect 之下
- 删行：dispose 行 owner（解绑该行全部 effect、跑 cleanups、删 handler），发一条 `["r", 行id]`
- `item()` 是行内的 accessor：同一 key 的元素引用变了（`!==`）就更新，读它的绑定随之重算，行不重建。`index()` 同理。这是 v1 没有 `createStore` 时"整体替换数组"仍能做到行级更新的机制
- key 重复抛 E2

### 4.2 `Show`

```tsx
<Show when={user()} fallback={() => <Text text="loading" />}>
    {() => <Text text={user()!.name} />}
</Show>
```

```ts
interface ShowProps<T> {
    when: T                                       // 编译器包成 thunk
    children: () => Node
    fallback?: () => Node
}
```

- 同 `For`，`Show` 是父节点 children 里长度为 0 / 1 的槽位，分支根节点直接插进父节点
- 只在 `when` 的**真值性**变化时切分支：`user()` 从一个对象换成另一个对象不重建；从对象变 `null` 才切到 fallback
- 切换 = dispose 旧分支 owner + 发 `r`，再在新分支 owner 里调分支函数 + 发 `i`。再显示是全新的一套节点与 effect，不复用
- 没有 fallback 且条件为假时该位置为空

## 5. `ref` + `cmd`

```ts
function ref(): Ref
interface Ref { cmd(name: string, args?: Record<string, string | number | boolean | null>): void }
```

`<LazyColumn ref={list} />` 后 `list.cmd("scrollTo", { index: 0 })` 往本事务的 patch 推 `["x", id, "scrollTo", {"index":0}]`。语义见 ADR-004 §3.2：一次性、晚于组合、无回执。未绑定节点时调用抛错。

## 6. `createResource`

```ts
function createResource<T>(fetcher: () => Promise<T>): [
    data: () => T | undefined,
    { loading: () => boolean; error: () => unknown; refetch: () => void },
]
```

- 创建时（同步渲染期）建三个 signal 并**立即**调一次 `fetcher`；`loading` 为 true
- Promise 落定时写 `data` / `error`、`loading` 置 false。落定发生在 K3 之后的微任务排空期，所以写入与随后的 flush 在同一事务
- 所属 owner 已 dispose 后落定的结果丢弃
- rejection 写进 `error()`，不抛、不进 E7
- `refetch()` 再跑一次 `fetcher`；旧请求的结果若后到，按到达顺序覆盖（v1 不做竞态取消）

数据获取一律走它，不写 `async` 组件（§3.1）。

## 7. 定时器

`setTimeout(fn, ms)` / `clearTimeout(id)` 为全局函数，由运行时经 J3 `timer.schedule` 实现，id 与 J3 的 cbId 同一空间。回调在 K3 到达的那次事务里执行；回调里创建 effect 抛错（§2.3）。页面卸载即引擎关闭，未触发的定时器随之消失。

## 8. 页面模块

```ts
// pages/home.tsx
export default function Home(props: HomeProps): Node { … }
```

- `default` 导出是一个组件函数，K1 `mount` 时在根 owner 里调用一次；返回的节点作为页面根挂到 Kotlin 侧的根容器（id 0）
- `props` 是 `navigation.push` 传来的 JSON 对象，静态，不响应式
- 顶层 `await` 只允许等同步就绪的东西（ADR-005），模块求值时仍 pending 由 K0 拒绝
- `pageVisible()` 是一个 accessor，K1 `visible(bool)` 更新它，可在 effect 里订阅
- 卸载：根 owner dispose（跑业务的 `onCleanup`），不产出 patch，随后引擎关闭

## 9. 桥入口（运行时 ↔ Kotlin 的内部契约）

业务不可见，是 `@tiny-ui/core` 与 `compose/` 之间的接口；改动两侧同一 PR。

**Kotlin → JS**：运行时模块求值时挂 `globalThis.__tinyui`，Kotlin 在 K0 之后取它一次并持有。

| 入口 | 签名 | 说明 |
|---|---|---|
| K1 | `mount(page: Function, propsJson: string, hostJson: string)` | `page` 是页面模块的 `default` 导出（Kotlin 以 `JsRef` 传入）；`hostJson` 为 ADR-003 的类型 / 能力清单 `{ components: { [type]: { props: string[], events: string[], commands: string[] } }, capabilities: string[] }` |
| K1 | `unmount()` / `visible(v: boolean)` | |
| K2 | `dispatch(nodeId: number, event: string, payloadJson: string)` | |
| K3 | `resolve(cbId: number, resultJson: string)` / `reject(cbId: number, errorJson: string)` | `errorJson` 为 `{ code: string, message: string }` |
| K5 | `emit(topic: string, payloadJson: string)` | |
| — | `protocol: number` | patch 协议版本，与 `PROTOCOL` 相同；Kotlin 在 K0 核对，不等则 E6 |

每个 K 入口在 Kotlin 侧是同一次 `withEngine` 里的**两次调用**：先调入口函数，再调 `flush()`（理由见 [js-runtime.html](./js-runtime.html) §2）。

| 入口 | 签名 | 说明 |
|---|---|---|
| — | `flush()` | 每个 K 入口之后调一次；`mount` 之后也要调（首帧 patch 在这里发出） |

**JS → Kotlin**：Kotlin 在 K0 之前用 `registerFunction` 注册全局函数（quickjs-kmp 只注册平坦的全局名）。

| 入口 | 全局名 | 签名 | 说明 |
|---|---|---|---|
| J1 | `__host_apply` | `(patchJson: string) => void` | 每次 flush 至多一次；patch 为空时不调 |
| J2 | `__host_query` | `(name: string, argsJson: string) => string \| number \| boolean \| null` | 白名单同步查询；对象结果为 JSON 文本 |
| J3 | `__host_call` | `(name: string, cbId: number, argsJson: string) => void` | 结果经 K3 |
| J4 | `__host_send` | `(name: string, argsJson: string) => void` | 即发即忘 |
| J5 | `__host_report` | `(kind: "E1", detailJson: string) => void` | 运行时捕获但不中断事务的业务错误 `{ entry, message, stack }`；`console.*` 走引擎 logger |

`@tiny-ui/native` 是这五个全局的类型化封装（`http.get` = `__host_call("http.get", …)` 包成 Promise），业务不直接碰 `__host_*`。

错误分类的运行时侧行为（ADR-002 §3.5）：

| | 运行时做什么 |
|---|---|
| E1 handler / 回调抛错 | `dispatch` / `resolve` / `reject` / `emit` 内 catch → `__host_report("E1")` → 入口正常返回，Kotlin 照常调 `flush()` |
| E2 渲染期抛错 | `mount()` 或 `flush()` **直接抛出**（`JsException` 带 JS 栈），运行时先清空 patch 缓冲；Kotlin 不再调 `flush()`，判页面失败 |
| E3 `reject` 到达 | 对应 Promise reject；无人 catch 走 E7（引擎的 unhandled rejection 回调，Kotlin 侧接） |
| E4 `__host_query` 抛错 | 在 JS 里是普通异常，落入 E1 |

## 10. 与 ADR 的差异说明

- ADR-001 §5 写"动态 prop 写成 `() => …` thunk"，本文改为编译器生成 `thunk(fn)` 包装、组件侧以 getter 读取；运行时接口仍是"函数型动态 prop"，只是多了一层可识别的包装（区分动态 prop 与 `For` / `Show` 的 children 函数）
- ADR-002 J 入口写成 `__host.apply` 等方法，本文改为平坦全局名，原因是 quickjs-kmp 的 `registerFunction` 只注册全局函数
- ADR-004 的 `argsJson` 在 patch 里是内嵌 JSON 对象，不是字符串（整条消息本来就是 JSON）
