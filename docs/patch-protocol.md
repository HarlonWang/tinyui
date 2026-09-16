# patch 协议 v1

- 状态：草案（2026-09-16），待确认后定稿；定稿后 bench 的 verify 模式与 Kotlin 解析器都以此为准
- 来源：ADR-001（五种 op 草案）、ADR-002 §3.6（JSON 文本、数组形态、prop 摊平）、ADR-003 §3.4 / §3.5（写入时转换、E5、事件标记）、ADR-004 §3.2（`x` 命令 op）
- 两侧：JS 运行时的 `flush()` 产出；Kotlin `NodeTree.apply` 流式解析并写入

## 1. 消息

一次 flush = 一条消息 = 一个 JSON 数组，元素是 op；经 J1 `__host_apply(json)` 交出。没有 op 时不发消息。

```json
[["c",1,"Column"],["c",2,"Text"],["p",2,"text","Count: 0"],["c",3,"Button"],["p",3,"text","+1"],["p",3,"onClick",true],["i",1,2,0],["i",1,3,1],["i",0,1,0]]
```

## 2. 六种 op

| op | 形态 | 语义 |
|---|---|---|
| create | `["c", id, type]` | 新建节点，未挂载。`type` 为注册表里的类型名 |
| prop | `["p", id, key, value]` | 设置 prop。`value` 为 string / number / boolean / null；`null` 表示恢复 schema 默认值。`key` 匹配 `/^on[A-Z]/` 时是事件标记，`value` 只能是 boolean，true 表示 JS 侧有 handler |
| insert | `["i", parent, id, index]` | 把 `id` 插到 `parent` 的 children 的 `index` 位置（插入后的位置，即 `children.add(index, node)`）。`parent` 为 0 表示页面根容器 |
| move | `["m", parent, id, index]` | `id` 已是 `parent` 的 child；先从 children 移除，再插到 `index`（移除后列表里的位置） |
| remove | `["r", id]` | 从父节点 children 移除并连同子树删除。JS 只对子树根发一条，不逐个发后代 |
| command | `["x", id, name, args]` | 对节点发一次性命令，`args` 是内嵌的 JSON 对象，字段为 string / number / boolean / null（ADR-004 §3.2） |

## 3. id

- 正整数，JS 侧 `nextId++` 分配，页内唯一，**不回收不复用**；0 保留为根容器
- 根容器只能有一个 child（页面根节点），`mount` 时插入一次
- `r` 之后该 id 及其子树的 id 永远不再出现；再出现是 E5

## 4. 值

| 类型 | JSON | 约定 |
|---|---|---|
| 文本 | string | UTF-8 |
| 数字 | number | 尺寸一律 dp，字号由 schema 的 `sp()` 决定（ADR-003 §3.4），不靠后缀 |
| 布尔 | boolean | |
| 颜色 | string | `#RRGGBB` 或 `#AARRGGBB` |
| 枚举 | string | schema 声明的枚举名 |
| 空 | null | 恢复默认 |

prop 里不出现对象与数组（ADR-002 "prop 摊平"）；`x` 的 `args` 是唯一的对象形态，且只有一层。

## 5. 顺序与原子性

JS 侧承诺：

- 一个节点的 `c` 先于它的任何 `p` / `i` / `m` / `r` / `x`
- 节点的全部初始 `p` 紧跟在它的 `c` 之后、先于把它插入父节点的 `i`（Kotlin 拿到 `i` 时节点已完整）
- 子树自底向上：children 先 `c` + `p` + 插入到父，父再插入到祖父。挂载时整棵树最后一条是 `["i", 0, root, 0]`
- `m` / `r` 的对象一定是当前存在且已挂载的节点
- 同一事务里一个 prop 可能出现多次（同一 flush 内多次赋值不合并），按序应用即得终值
- 事务原子：flush 中途抛错（E2）则整条消息不发

Kotlin 侧承诺（ADR-003 §3.2）：

- 整条消息在一个 `withMutableSnapshot` 内按序应用，其他线程要么看到应用前、要么看到应用后
- 节点表只由 JS 线程写；`x` 进节点的命令队列而非 props，由组件在组合后消费
- `required` prop 只在 `c` 所在消息应用完毕时校验一次

## 6. 版本

消息本身不带版本号。运行时导出 `PROTOCOL = 1`，并作为 `__tinyui.protocol` 暴露；Kotlin 在 K0 之后核对，与自身实现的版本不等即 E6（字节码与宿主不匹配，页面失败）。改本文任何一条语义都要递增。

## 7. Kotlin 侧的 E5 处理

| 情况 | 处理 |
|---|---|
| `c` 的 `type` 未注册 | 建 `Placeholder` 节点占位，上报 |
| `p` / `i` / `m` / `r` / `x` 的 id 不存在 | 跳过，上报（附 op 原文） |
| `p` 的 `key` 不在该类型的 schema 里 | 跳过，上报 |
| `p` 的 `value` 转换失败（类型、枚举名、颜色格式） | 跳过，上报（附 type / key / 原值） |
| `p` 事件标记的 `value` 不是 boolean，或事件不在 schema | 跳过，上报 |
| `i` / `m` 的 `index` 越界 | 夹到 `[0, size]`，上报 |
| `i` 的 `id` 已有父节点 | 跳过，上报 |
| `x` 的 `name` 不在 schema，或 `args` 字段不符 | 跳过，上报 |
| 消息不是合法 JSON 数组 | 整条丢弃，上报；页面继续 |

宿主永不因坏消息崩溃；所有上报进 ADR-002 的同一个 sink，附页面实例 id。

## 8. 与 bench 草案的差异

- `__host.apply(json, count)` 的 `count` 参数去掉
- 新增 `x`
- `p` 的 `null` 语义（恢复默认）与事件标记 `false`（撤销 handler）是新定的；bench 里未出现
