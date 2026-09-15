# ADR-001 · 状态管理与更新模型

- 状态：已定（2026-09-14）
- 结论：**运行时 Signal，细粒度属性绑定；不做 vdom diff，不走编译期静态依赖**
- 数据：[bench/results/2026-09-14.md](../bench/results/2026-09-14.md)

## 1. 背景

> **2026-09-15 修订（ADR-005）**：本文写作时引擎为 MicroQuickJS（ES5 子集、无 Proxy、固定堆）。引擎已切换为 QuickJS（ES2025），下文所有"无 Proxy / ES5 / 固定堆"的论证均为历史背景。核心决策（运行时 Signal、所有权 / 清理、For / Show）不受影响，bench 在 QuickJS 上的复跑见 ADR-005 §3.1。受影响的具体点：Promise polyfill 与"已 settled 同步续行"作废（微任务原生）；`async/await` 原生；"Proxy store"进入待定；§3.7 中"固定堆上必漏"的措辞在 QuickJS 下改为"内存慢涨"，所有权机制本身不变。


业务侧写声明式组件已定（见 [README](./README.md)），要定的是两件事：**状态变了之后 JS 侧怎么知道该更新什么**，以及**"vdom diff"放不放、放在哪**。这两件事决定桥的粒度、JS 侧的内存形态、以及要不要写编译器。

约束来自 mquickjs：无 Proxy → 淘汰 Vue 式响应式；纯解释 + 固定小堆 → 常驻对象数与每次更新的函数调用数都是成本；ES5 → 运行时只能靠闭包。

## 2. 候选方案

| | React 式（useState + 重跑 render） | 运行时 Signal（Solid 式） | 编译期静态依赖（Svelte 3/4 式） |
|---|---|---|---|
| 状态变化时 | 重跑组件函数，重建子树 vdom | 只重算订阅了该 signal 的绑定 | 置 dirty 位，flush 时跑组件的 `p()` 逐绑定检查 |
| 需要 diff | 是（新旧 vdom 全量比） | 否；结构变化仅在 `For` / `Show` 做 keyed reconcile | 否；同左 |
| JS 常驻内存 | 两份 vdom + 组件实例 | 每状态一个闭包对 + subs；每动态属性一个 effect + deps | 每组件一个 ctx 数组 + 一个 dirty 整数 |
| 引擎依赖 | 无 | 无（getter 函数即可，不用 Proxy） | 无 |
| 需要编译器 | 否 | 否（JSX 转 `h()` 即可） | **是**，且要能把状态变更精确归属到组件 |
| 业务写法 | 熟悉 | `count()` 读、动态 prop 写成 thunk、组件函数只跑一次 | 普通变量赋值 |

React 式在解释器上重跑 render 全是解释开销、还要常驻两份 vdom，直接淘汰；真正的比较在后两者之间。

编译期静态又分两种真实形态：
- **fine**：编译器能把"改了第 i 行的某个字段"归属到第 i 行组件，只置该行 dirty
- **coarse**：`items[i].x = v` 只能归属到根标识符 `items`，整个列表失效、逐行重查（Svelte 4 的实际行为）

### 所有权 / 清理的候选

选了 Signal 之后必须一并回答"节点移除时它名下的 effect 怎么解绑"，三组二选一：

| 问题 | 选项 A | 选项 B |
|---|---|---|
| 作用域粒度 | 每个组件函数调用一个作用域：清理时机与 B 完全相同，每行多 3～5 个 owner 对象，运行时要认识组件 | 只在结构边界（根 / `For` 每行 / `Show` 每分支）开作用域：每行固定一个 owner，组件仍是普通函数 |
| effect 是否拥有 effect | 拥有（Solid 完整模型）：effect 重跑先递归清子计算，`dispose` 要沿树递归 | 不拥有：行 owner 由 `For` 显式持有，effect 重跑只解绑自己的订阅，`dispose` 是平循环 |
| 同步渲染期外创建 effect | 警告（Solid dev 模式）：effect 无 owner 收留，永不清理 | 抛错（Angular NG0203）：开发期直接暴露 |

## 3. 依据

### 3.1 Signal 机制（决策对象本身）

抛开语言，这是**电子表格的重算模型**：单元格存值并维护"依赖我的公式"名单；公式执行时引用了谁就自动登记到谁的名单；改单元格只重算名单上的公式。依赖不是声明出来的，是**执行过程中被观察到的**。Compose 的 `mutableStateOf` + 重组是同一原理，JS 侧只是自己写了一个极简版。

最小实现（ES5，运行时真实代码的骨架）：

```js
var currentEffect = null;                     // "此刻是谁在读"的隐式参数

function signal(value) {
    var subs = [];                            // 依赖我的 effect 名单
    function read() {
        if (currentEffect) subs.push(currentEffect);   // 谁在读我，谁就订阅我
        return value;
    }
    function write(next) {
        value = next;
        subs.forEach(function (e) { e(); });           // 通知名单上的每个 effect 重跑
    }
    return [read, write];
}

function effect(fn) {
    currentEffect = fn;                       // 签到：接下来的读取都算在 fn 头上
    fn();
    currentEffect = null;                     // 签退
}
```

三个概念：
- **signal**：一次 `signal(0)` 调用造出一个闭包——私有的 `value` + 挂在旁边的 `subs`，外界只能通过 `read` / `write` 两个入口碰它
- **effect**：一段可反复执行的计算；框架为每个动态属性生成一个（`bindProp` 里的包装函数），它知道自己归属哪个节点哪个属性，重跑产出的新值就是一条 `setProp` patch
- **currentEffect**：`read()` 拿不到自己的调用者，所以由 `effect()` 在调用前把 effect "放在桌上"，`read()` 自己去取。同一句 `count()`，在 effect 里读会建立绑定，在事件 handler 里读只是取值——区别仅在调用发生时桌上有没有东西

完整运行时在此之上补两件事：`write` 只把 effect 放进 `pending` 队列，flush 时统一重跑（一个 handler 改三个 signal 只重算一次）；重跑前先解绑旧依赖再重新收集（条件分支变化后不残留过期订阅）。

### 3.2 一次点击的完整链路（Counter）

```tsx
function Counter() {
    const [count, setCount] = signal(0)
    return (
        <Column>
            <Text text={() => "Count: " + count()} />
            <Button text="+1" onClick={() => setCount(count() + 1)} />
        </Column>
    )
}
```

挂载：`Counter()` 跑一次。`signal(0)` 建闭包（`subs = []`）；`h("Text", {text: thunk})` 遇到函数型 prop → `bindProp` 建 effect 并立刻跑一次 → thunk 里 `count()` 被调用时 `currentEffect` 有值 → `subs = [textEffect]`，绑定诞生 → 产出 `["p", 2, "text", "Count: 0"]`。`Button` 的 `text: "+1"` 是静态值直接下发，`onClick` 存进 handler 表（函数没被执行，不订阅任何东西）。flush 一次过桥。此后 `Counter()` 再也不会被调用，JS 侧只剩 signal 闭包、effect 闭包、handler 表三样东西。

点击：宿主 `__dispatch(3, "onClick")` → handler 里 `count()` 此时 `currentEffect === null`，只取值 → `setCount(1)` 把 `textEffect` 放进 `pending` → flush 重跑它 → thunk 算出 `"Count: 1"` ≠ 上次 → `["p", 2, "text", "Count: 1"]` → 一条 patch 过桥。Column 和 Button 全程不在链路上——不是"比对后发现没变"，是根本没被碰。

### 3.3 "diff" 在 Signal 模型下退化成两件事

1. 属性级更新没有 diff：effect 直接知道哪个节点哪个属性变了
2. 结构级更新只在 `For(list, keyFn, renderRow)` 和 `Show(cond, ...)` 里：`For` 对新旧 key 序列做 keyed reconcile，只针对一个父节点的子列表，产出 insert / move / remove

diff 放 JS 侧而非 Kotlin 侧：桥的成本是序列化 + 跨界调用，JS 算完只传 patch 最省；整树扔给 Kotlin 比对则流量随页面规模线性涨，且 Kotlin 不知道 key 语义。

### 3.4 Benchmark

工程：[bench/](../bench/README.md)（README 有场景与指标定义、复现命令）。三个模型跑同一被测应用（标题 Text + 1000 行列表，每行 3 个动态属性），先以 verify 模式断言三者 patch 流逐 flush 一致，再计时。引擎为上游 mquickjs 源码副本（`-Os`），仅 `performance.now()` 改为亚毫秒精度。macOS arm64，5 次取中位数。

| 场景 | signal | static-fine | static-coarse | fine 领先 |
|---|---:|---:|---:|---:|
| S1 挂载 1000 行 | 5.8 ms | 2.7 ms | — | 2.2× |
| S2 单属性更新 + flush ×200k | 223 ms | 204 ms | **75.8 s** | 1.09× |
| S3 每轮改 100 行 ×2000 轮 | 131 ms | 128 ms | 838 ms | 1.03× |
| S4 1000 行删除重建 ×30 | 218 ms | 99 ms | — | 2.2× |
| 常驻堆（1000 行，gc 后） | 2926 KiB | 1018 KiB | 1018 KiB | 2.9× |
| 最小可运行堆 | 4288 KiB | 2432 KiB | — | 1.8× |

三条结论：

1. **更新路径两者几乎无差别。** 每次"改一个属性 + flush"两边都约 1 µs，差值 90 ns——成本被 patch 数组构造和 `JSON.stringify` 吃掉，响应式机制本身在解释器里的开销可忽略。"运行时依赖追踪在解释器上会很痛"的事前推理在更新路径上**不成立**
2. **差距在建 / 拆和内存。** 挂载与卸载 static 快 2.2×，常驻内存 2.9×（每行约 2.9 KB vs 1.0 KB）——每个动态属性一个 effect 对象 + deps 数组、每个状态一个闭包对 + subs 数组，这些在 static 里不存在
3. **static 的前提代价很高。** coarse 变体 S2 慢 370×、S3 慢 6.5×。要拿到 fine 的数字，编译器必须能把"改了第 i 行的某字段"归属到第 i 行——这不是表达式依赖分析能做到的，而是要在语言层面规定"行状态归行组件所有"，等于同时约束业务写法。Svelte 4 自己都没做到

### 3.5 参照：Svelte 两代机制

Svelte 3/4 是编译期静态依赖 + 组件级 dirty 位图，运行时极轻但跨组件只能靠 props / store 显式传、深层对象要 `obj = obj` 手动触发；Svelte 5 转向运行时 Signal（runes，源码里的 `active_reaction` 就是 `currentEffect`），编译器把 `count` 的读写改写成 `$.get / $.set`，`$state` 用 Proxy 做深层响应式。对本框架：Proxy 深层响应式做不了，只能走 `$state.raw` 式的整体替换；"编译器抹掉 `count()` 与 thunk 写法"这条可选，见第 5 节。

### 3.6 参照：主流框架的 Counter 写法对比

同一个 Counter，各框架只保留状态声明、读、写、绑定四件事：

```tsx
// React：count 是普通值，setCount 触发整个组件函数重跑 + vdom diff
const [count, setCount] = useState(0)
<button onClick={() => setCount(count + 1)}>Count: {count}</button>

// Vue 3：ref 返回带 .value 的响应式对象（模板自动解包），Proxy 追踪依赖，组件级 render 重跑 + vdom diff
const count = ref(0)
<button @click="count++">Count: {{ count }}</button>

// Svelte 5（runes）：编译器把 count 的读写改写成 $.get / $.set，底层 signal，细粒度直接改文本节点
let count = $state(0)
<button onclick={() => count++}>Count: {count}</button>

// Svelte 4：赋值编译成 $$invalidate 置 dirty 位，p() 里 if (dirty & 1) set_data(t, count)——即 bench 的 static-fine
let count = 0
<button on:click={() => count += 1}>Count: {count}</button>

// Solid：组件只跑一次，count() 读取时建立订阅，{count()} 编译成对具体 DOM 文本节点的绑定
const [count, setCount] = createSignal(0)
<button onClick={() => setCount(count() + 1)}>Count: {count()}</button>

// Angular（v17+ Signals）：signal() 返回可调用 getter，.set / .update 写，模板按依赖局部变更检测
count = signal(0)
<button (click)="count.set(count() + 1)">Count: {{ count() }}</button>

// 我们：与 Solid 同形；没有 DOM，动态 prop 显式写成 thunk，更新产出 ["p", id, "text", "Count: 1"] 过桥
const [count, setCount] = signal(0)
<Text text={() => "Count: " + count()} />
<Button text="+1" onClick={() => setCount(count() + 1)} />
```

| | 状态声明 | 读 | 写 | 组件函数 | 更新粒度 | 依赖怎么知道 |
|---|---|---|---|---|---|---|
| React | `useState(0)` | `count` | `setCount(v)` | 每次重跑 | 组件子树 vdom diff | 不追踪，全量重渲染 |
| Vue 3 | `ref(0)` | `count.value` | `count.value = v` | `setup` 一次，render 重跑 | 组件级 render + vdom diff | 运行时 Proxy 追踪 |
| Svelte 5 | `$state(0)` | `count` | `count = v` | 跑一次 | 细粒度（节点） | 运行时 signal，编译器改写读写 |
| Svelte 4 | `let count = 0` | `count` | `count = v` | 跑一次 | 组件级 dirty 位检查 | **编译期静态分析** |
| Solid | `createSignal(0)` | `count()` | `setCount(v)` | 跑一次 | 细粒度（节点） | 运行时 signal，执行期登记 |
| Angular | `signal(0)` | `count()` | `count.set(v)` | 类实例 | 模板局部 | 运行时 signal |
| 我们 | `signal(0)` | `count()` | `setCount(v)` | 跑一次 | 细粒度（prop → patch） | 运行时 signal，执行期登记 |

分野：**React 是"重跑 + diff"，其余全部是"跑一次 + 订阅"**；订阅关系的来源分两派——Svelte 4 靠编译器静态算，其他靠运行时执行期登记（Vue 用 Proxy，Solid / Angular / Svelte 5 / 我们用 getter 函数）。我们落在 Solid 那一格，写法上比 Svelte 5 / Vue 多了 `()` 和 thunk，原因是 mquickjs 没有 Proxy、且暂未引入编译器改写。

"signal" 一词来自 FRP（Elm 2012 的 `Signal`、更早的 behavior），前端里 Knockout / MobX 的 `observable` 是同一概念；Solid 在 S.js 基础上于 2018 年后定名 `createSignal`，此后 Preact / Angular / Qwik / Svelte 5 跟进，2024 年进入 TC39 Signals 提案（Stage 1）。本文用 "signal" 是沿用行业通用词；真正沿用 Solid 的是 API 形状——`[read, write]` 元组、`count()` 读取，选它是因为 getter 本身就是无参函数，可直接当 thunk 塞进 prop。TC39 形状为 `new Signal.State(0)` + `.get()` / `.set()`，若将来要贴近标准，只影响写法不影响机制，与"编译器抹掉 thunk 语法"一并定。

### 3.7 所有权与清理

**问题。** "绑定"是一根双向的活引用：signal 的 `subs` 持有 effect，effect 的 `deps` 持有它读过的 signal 的 subs。节点被移除（`For` 删行、`Show` 切分支、页面卸载）时，Kotlin 侧的节点没了，但 JS 侧这根引用还在——后果两层：**泄漏**（effect、它闭包里的节点 id 与 `last`、handler 表里的 onClick 全部常驻；固定堆上不是变慢，是跑着跑着 out of memory）和**幽灵更新**（signal 一变，死 effect 照样重跑，往不存在的节点发 `setProp`）。Kotlin 侧节点表与 JS 侧生命周期脱钩，JS 忘了清，Kotlin 不会替它兜。bench 的 S4 已经踩到一次：只是 handler 没清，30 轮删建多占 3 MB。

**最简场景。** `<Show when={visible}><Text text={() => "Hi " + name()} /></Show>`。挂载后 `name.subs = [textEffect]`。`setVisible(false)` 时 `Show` 只知道分支根节点 id，不知道分支里创建过哪些 effect——没有 owner 的话 textEffect 留在 `name.subs` 里，之后 `setName("B")` 会往已删的节点发 patch，且每显示 / 隐藏一次多漏一套。有 owner 的做法：`Show` 跑分支函数之前建 `owner = { effects: [] }` 并设为"当前 owner"，`bindProp` 创建的 effect 自动登记进去；隐藏时 `dispose(owner)` 按名单把 effect 从各 signal 的 subs 里摘掉，再发 `["r", id]`。再显示是新建一套（新 id、新 effect），不是复用。

**Feed 场景（`Show` → `Feed` → `For` → `PostRow`）的四个要点。**
- owner 树里只有结构节点：根 owner → 分支 owner → 行 owner。`Feed` / `PostRow` / `Avatar` 组件函数跑完就没了，不在树里；`Avatar` 的 `url` 是静态 prop，整个组件在运行时留下的东西是零——组件粒度的作用域会为它白挂一个 owner
- 删一行：`dispose(行 owner)` 解绑该行的 `color` effect、删 handler 条目、发 remove；行内的 `liked` signal 因引用链全断被 GC
- 切分支：`dispose(分支 owner)` 解绑 `For` 的 effect，再跑 cleanups——`For` 在创建时登记了一条"把我的行全 dispose"，嵌套靠这条递归，owner 不维护子 owner 列表
- effect 不能拥有 effect：若行 owner 挂在 `For` effect 之下，`For` 重跑（哪怕只是删一行）会先清掉全部子 owner，三行全删全建，reconcile 白做。行由 `For` 显式持有，effect 重跑只解绑自己的订阅

**"当前 owner"的传递。** 它和 `currentEffect` 一样是全局变量做的隐式参数，但覆盖范围不同：`currentEffect` 只覆盖一个 effect 函数体，`currentOwner` 要覆盖一个分支 / 一行的整棵组件树构建期，期间会调组件函数、`h()`、`bindProp`，也会遇到嵌套的 `Show` / `For`。三个必须答对的问题：
1. 嵌套恢复——内层设置后必须还原外层，否则外层后续创建的 effect 错登记到某一行上，该行被删时把外层 effect 一起杀掉。做法：进入保存、退出还原（当栈用）
2. effect 重跑时 owner 是谁——`For` 的 effect 后来由 `flush()` 重跑，那时 `currentOwner` 为 null，重跑中新增的行 owner 必须仍挂在原分支下。做法：effect 记住创建时的 owner，重跑前恢复
3. 异步回调里创建 effect——`setTimeout` / 网络回调由宿主直接调入，`currentOwner` 为 null，创建的 effect 永远无人清理。做法：抛错

**业界对应。** 没有一处是独创：

| 本文设计点 | 业界实现 |
|---|---|
| owner 树、创建时登记、销毁递归清理 | Solid `Owner` / `createRoot` / `onCleanup`；Svelte 5 effect tree；Vue 3 `effectScope` / `onScopeDispose`；Angular `DestroyRef` |
| 全局变量传"当前 owner"，进入保存退出还原 | Solid 全局 `Owner`、Vue `activeEffectScope`（`currentEffect` 对应 Solid `Listener`、Vue `activeEffect`、Svelte 5 `active_reaction`） |
| effect 记住 owner，重跑时恢复 | Solid `runComputation` 里 `Owner = node` |
| 行 owner 由 `For` 显式持有 | Solid `mapArray`：每行 `createRoot` 独立根，存数组，删行显式 `dispose()` |
| 异步期创建 effect 抛错 | Angular `NG0203: effect() can only be used within an injection context`（Solid 是 dev 警告） |

"只在结构边界开作用域 + effect 不拥有 effect"是 Solid 模型的子集而非新机制——Solid 的 `mapArray` 实际上就是按这个子集在用它。去掉的能力换来 `dispose` 平循环、每行少一层对象。

## 4. 决策

**选运行时 Signal。**

事先定的判据是"static 在 S2/S3 耗时**或** S1 常驻内存领先 ≥ 2× → 静态"。耗时未到（1.09×），内存到了（2.9×），按判据应判 static。**有意偏离**，理由：

- 实测差距全部集中在"每行多约 2 KB、建拆慢 2×"，绝对值上 1000 行页面挂载 6 ms、多占 2 MB，在手机上不构成问题
- static 的收益要靠一个比预想复杂得多的编译器（行级变更归属）+ 对业务写法的额外约束来兑换；做不到 fine 就是 coarse，而 coarse 是灾难级的。风险不对称
- Signal 的内存有明确的优化空间（见第 5 节），static 的编译器难度没有

**所有权 / 清理机制**（2026-09-15 定）：

| 点 | 结论 |
|---|---|
| 作用域粒度 | 只开在结构边界：根、`For` 每一行、`Show` 每个分支；组件函数不开作用域 |
| owner 结构 | `{ effects, cleanups }`，`dispose` 平循环；嵌套靠 `onCleanup` 递归，owner 不维护子 owner 列表 |
| effect 不拥有 effect | 行 owner 由 `For` 显式持有；effect 重跑只解绑自己的订阅，不碰任何 owner |
| "当前 owner"传递 | 全局变量 + 进入保存 / 退出还原；effect 记住创建时的 owner，重跑前恢复 |
| 同步渲染期外创建 effect | **抛错**——固定堆上"没有 owner 的 effect"就是必漏，宁可开发期炸出来 |
| 顺带清理 | handler 表条目通过 `onCleanup` 登记，随 owner 一起清 |

## 5. 后果与遗留

接受的代价：
- 每行约 2.9 KB 常驻、建拆比 static 慢 2.2×
- 业务写法：`count()` 读、动态 prop 写成 `() => ...` thunk、组件函数只跑一次（没有 `useEffect`，挂载逻辑直接写在函数体）、数组 / 对象整体替换（signal 按引用判等）
- 没有"组件卸载"钩子：业务用 `onCleanup(fn)`，登记到最近的结构作用域；组件寿命等于该作用域寿命，语义等价，只是不叫组件卸载
- effect 只能在同步渲染期间创建；异步回调里触发会创建 effect 的渲染逻辑直接抛错

待验证：
- 内存优化——"一行一个 effect"而非"一个属性一个 effect"（对象数减半），未测
- 真机比值——Android / iOS 上解释器绝对值不同，比值预期保持，未验证
- 是否用编译器改写读写点以抹掉 `count()` 与 thunk 语法（Svelte 5 路线），只影响写法不影响机制，待定
- `onCleanup` 的 API 形态；`Show` / `For` 之外是否还需要其他结构原语（每多一个就多一处开作用域的地方）

派生的下游决策：
- **patch 协议定稿**：现有 `c / p / i / m / r` 五种 op 的 JSON 数组形态只是 bench 用的草案；序列化格式与桥的调用形态见 ADR-002
- **Kotlin 侧节点表与组件注册**、**事件与输入状态归属**：见 README 索引
