# `@tiny-ui/native` 与宿主服务

- 状态：已定（2026-09-16）；M2 的实现依据
- 来源：ADR-002 §3.1（J2 白名单、J3 / J4）、[app-model.md](./app-model.md)（路由、store、事件）、ADR-004 §3.1（连续事件阈值）
- 两侧：JS 的 `@tiny-ui/native` 是 `__host_*` 的类型化封装；Kotlin 的 `HostServices` 是宿主 App 实现的接口组，交给 `TinyUIPage`

## 1. J2 白名单

四个，框架固定，业务不能加；同步返回 JSON 文本，没有就是 `null`：

| 名字 | 宿主实现 | 返回 |
|---|---|---|
| `device.info` | 框架自带（`os`、`osVersion`、`model`）+ `HostServices.deviceInfo` 追加 | 对象 |
| `i18n.t` | `HostServices.i18n`（`I18n.translate(key, argsJson)`） | 字符串 |
| `config.get` | `HostServices.config`（`Config.get(key)`，JSON 文本） | 任意 |
| `store.get` | `HostServices.store` | 任意 |

实现必须在调用线程立即返回、不做 IO（ADR-002 §3.1 场景 3）。

## 2. `navigation`

```ts
navigation.push("pages/detail", { id: 42 });   // J4 → Navigator.push(page, paramsJson)
navigation.pop({ saved: true });                // J4 → Navigator.pop(resultJson)
navigation.onResult((result, from) => …);       // 渲染期调用；K5 topic navigation.result
```

宿主实现 `Navigator` 接口；把结果送回上一页时，宿主持有该页的 `PageHost`（`TinyUIPage` 的 `onHost` 回调拿到），调 `host.emit("navigation.result", json)`，`json` 形如 `{ "result": …, "from": "pages/detail" }`。v1 不提供 `push` 返回 Promise 的糖。

## 3. `store`

```ts
store.get<T>(key)             // J2，快照
store.set(key, value)         // J4，value 会被 JSON.stringify
const cart = store.watch(key) // 渲染期调用，返回 accessor；K5 topic store:<key> 到达时更新
```

真值在 Kotlin `Store`（`get` / `set` / `observe`），默认 `InMemoryStore`；持久化由宿主实现决定。`watch` 会经 J4 `store.subscribe` 登记，只有登记过的页面收到该 key 的变更。

## 4. `events`

```ts
events.emit("order.paid", { id })   // J4 → EventBus.emit
events.on("network", (p) => …)      // 渲染期调用；J4 events.subscribe + K5
```

`HostServices.events` 是 App 级 `EventBus`，宿主原生代码用同一个实例 `emit` 网络状态、主题等。订阅随页面 owner 结束，页面关闭时 Kotlin 侧的监听一并注销。

## 5. `http`

```ts
const { status, body } = await http.get<Todo[]>("/todos", { timeout: 5000 });
await http.post("/todos", { title }, { headers: { "X-Trace": id } });
```

J3 `http.request`，参数 `{ method, url, headers?, body?, timeout? }`；宿主实现 `HttpClient.request(HttpRequest): HttpResponse`（suspend，`bodyJson` 为 JSON 文本）。响应 `{ status, body }`，`body` 是解析后的 JSON。宿主抛 `HostException(code, message)` 走 E3，其他异常按 `E_NET`。

`setTimeout` / `clearTimeout` 是 core 提供的全局，经 J3 `timer.schedule` / J4 `timer.cancel`，宿主侧由 `PageHost` 实现，随页面关闭取消。

## 6. E3 错误码与阈值

| code | 含义 |
|---|---|
| `E_UNSUPPORTED` | 能力不存在（宿主没实现，或 J3 名字未知） |
| `E_INVALID` | 参数不合法 |
| `E_NET` | 网络层失败，或宿主实现抛了非 `HostException` 的异常 |
| `E_HTTP` | 非 2xx，宿主在 message 里给 status |
| `E_TIMEOUT` | 超时 |
| `E_DENIED` | 权限拒绝 |
| `E_CANCELLED` | 页面关闭或宿主取消 |
| `E_BAD_JSON` | 载荷不是合法 JSON（JS 侧生成） |

阈值（可调，写在代码常量里）：

| 项 | 值 | 位置 |
|---|---|---|
| K 入口超时 | 5 s，超时 interrupt 判 E6 页面失败 | `PageHost.entryTimeoutMs` |
| `onReachEnd` | 最后一行进入可见区时触发一次；列表长度变化后再武装 | `LazyColumnComponent` |
| `onScrollEnd` | 滚动停止时触发，带首个可见行 index | 同上 |
| `onProgress` 类节流 | 1 s | 首批组件没有，写在这里备查 |

## 7. 宿主自定义能力：`host.call`

定于 2026-09-17（TrendingAI 订阅页触发：下单、登录、埋点都是 App 自己的动作，不该进框架）。

```ts
const { url } = await host.call<{ url: string }>("checkout.start", { plan: "annual" });
```

J3，一个名字一个能力，Kotlin 侧 `HostServices(capabilities = mapOf("checkout.start" to HostCapability { argsJson -> … }))`：suspend，收 JS 传的对象（JSON 文本），返回 JSON 文本（`null` 即 `undefined`）；抛 `HostException` 走 E3 码，其他异常按 `E_NET`。没注册的名字拒绝 `E_UNSUPPORTED`。名字不强制前缀，但不能与框架自己的十个名字（§1–§5）重合，重合在构造 `HostServices` 时就报错。挂载清单的 `capabilities` 列出框架名 + 宿主名，页面可据此判断宿主是否提供某能力。

不做 J4（火后不理）变体：不等 Promise 就是火后不理，省不下什么。能力的类型声明由宿主 JS 工程自己写一层封装（`ta.checkout.start(plan)`），框架不生成。

