# 内置组件：schema、布局 prop、首批清单

- 状态：已定（2026-09-16）；M2 的实现依据
- 来源：ADR-003 §3.3 / §3.4（注册表、schema、公共布局 prop）、ADR-004（事件三分、命令、文本框）；roadmap C 组
- 相关：[runtime-api.md](./runtime-api.md) §3（`h()` 怎么处理 prop）、[patch-protocol.md](./patch-protocol.md) §4（值类型）

## 1. schema 是唯一真值

组件的 prop / 事件 / 命令声明只写一处：顶层 `schema/` 目录，TS 写的声明式 DSL，一个组件一个文件，`schema/index.ts` 汇总。`pnpm schema`（即 `tinyui schema`）执行它，生成两份产物并提交进仓，CI 用 `pnpm schema:check` 保证没有手改：

| 产物 | 内容 | 谁用 |
|---|---|---|
| `packages/core/src/generated/components.ts` | `XxxProps`（JSX 属性类型）、`XxxYyyPayload`（事件 payload）、`XxxCommands`（命令参数表，配 `ref<XxxCommands>()`）、`IntrinsicElements`、组件名常量 | 业务的类型检查 |
| `compose/.../components/generated/BuiltinSchemas.kt` | 每个组件一个 `ComponentSchema`，prop 的类型 / 默认值 / `required` / `initial`，事件与命令的字段表 | Kotlin 注册表：写入时转换、E5 校验、清单下发 |

Kotlin 侧的 composable 仍手写，`register(BuiltinSchemas.Text) { scope -> … }`。宿主扩展组件（`pp.KycCard`）用同一套 DSL（`import … from "@tiny-ui/cli/schema"`）生成到宿主自己的包里，本仓不含。

DSL：

```ts
defineComponent("TextField", {
    props: {
        initialText: string({ initial: true, default: "" }),
        keyboard: enumOf(["text", "number", "email", "phone", "password"], { default: "text" }),
    },
    events: { onChange: { text: field.string() } },
    commands: { setText: { text: field.string() }, focus: {} },
    children: false,   // 是否接受 children
    layout: true,      // 是否接受公共布局 prop，默认 true
});
```

prop 类型：`string` / `number` / `boolean` / `dp` / `sp` / `color`（`#RRGGBB` / `#AARRGGBB`，或 §6 的主题 token 名）/ `enumOf([...])` / `size`（数字 dp，或 `"fill"` / `"wrap"`）。选项：`required`、`default`、`initial`（只认创建时的值，之后的写入按 E5 跳过并上报）、`doc`。事件 payload 与命令参数的字段只有 `field.string / number / boolean`，扁平。

## 2. 公共布局 prop 与 Modifier 顺序

`layout: true` 的组件都接受这些，运行时按下面的顺序合成 `Modifier`，从外到内：

| 顺序 | prop | 类型 | Modifier |
|---|---|---|---|
| 0 | `weight` | number | `weight(f)`，由父 `Row` / `Column` 施加（2026-09-17 加） |
| 1 | `width` / `height` | size | `width(dp)` / `fillMaxWidth()` / `wrapContentWidth()` |
| 2 | `cornerRadius` | dp | `clip(RoundedCornerShape)` |
| 3 | `background` | color | `background(color)` |
| 3.5 | `borderWidth` / `borderColor` | dp / color | `border(width, color, 同一个 shape)`；宽 0 即无边框（Compose 的 0.dp 是一像素 hairline，这里不沿用）；色缺省 `outline` token（2026-09-17 加） |
| 4 | （有 `onClick` handler 时） | | `clickable { dispatch("onClick") }` |
| 5 | `padding` | dp，四边同值 | `padding(dp)` |

顺序固定：以后加 prop 只能插进这个序列，不能重排（重排会改变已有页面的视觉）。`padding` 在最里面，所以它是内容内边距；背景、边框和点击区域包含它。

`weight` 需要父作用域：`Row` / `Column` 渲染 children 时按每个 child 的 `weight` 造 `Modifier.weight` 经 CompositionLocal 交给它，child 的 `modifier()` 把它放在最外层；其他容器把这个 local 重置为空，所以写在 `Box` / `LazyColumn` 的直接 child 上不生效、也不报错；`scroll` 开着的 `Column` / `Row` 主轴无界、没有剩余空间可分，其 child 的 `weight` 同样忽略（否则 Compose 会把它压成 0）。

不在首批的：`margin`（Compose 没有对应，用父容器的 `gap` / `padding`）、`alignSelf`（等需求）。

## 3. 首批八个组件

`onClick` 所有容器和 `Text` 都有。事件的 payload 字段、命令的参数字段见 `schema/components/*.ts`，这里只列名字。

| 组件 | prop | 事件 | 命令 | children |
|---|---|---|---|---|
| `Column` / `Row` | `gap`、`align`（交叉轴 start / center / end）、`justify`（主轴 start / center / end / spaceBetween）、`scroll`（沿主轴滚动；`padding` 在滚动内容之外，不随内容滚） | `onClick` | | 是 |
| `Box` | `align`（九宫格） | `onClick` | | 是 |
| `Text` | `text`（必填）、`style`（M3 文字样式名，§6）、`color`、`fontSize`、`fontWeight`（normal / medium / bold；设了就覆盖 `style` 的对应字段，不设则跟 `style`）、`maxLines`（0 = 不限，超出省略号）、`align` | `onClick` | | |
| `Button` | `text`（必填）、`enabled`、`variant`（filled / outlined / text） | `onClick` | | |
| `TextField` | `initialText`（initial）、`placeholder`、`singleLine`、`keyboard` | `onChange{text}`、`onCommit{text}`（IME Done 或失焦） | `setText{text}`、`focus`、`blur` | |
| `LazyColumn` | `gap` | `onReachEnd`、`onScrollEnd{index}` | `scrollTo{index}` | 是，通常是一个 `<For>` |
| `Spacer` | （只有布局 prop） | | | |

`TextField` 的文本与光标永远在 Kotlin 侧（ADR-004 §3.3）：`setText` 会同时触发 `onChange`。`LazyColumn` 的行就是它的 children，虚拟化只在组合层（ADR-003 §3.6）。

**`Image` 推迟**：牵出图片加载管线的选型（coil3 还是宿主提供 loader），M2 用不到，单独一次定。

## 4. 命令怎么消费

命令进节点的 `commands` 队列（不是 props），组件用 `scope.Commands { command -> … }` 在组合后按到达顺序消费，一次性。`LazyColumn` 的 `scrollTo` 与新增行同一 flush 到达时，行先进 children，命令随后执行，index 已经有效。

## 5. `Placeholder`

未注册的类型渲染 `Placeholder`，同时 E5 上报。debug 构建（Android `FLAG_DEBUGGABLE`、iOS debug binary）画红框加类型名与 id；release 渲染零尺寸的空 `Box`。

## 6. 主题 token

定于 2026-09-17。**主题色与文字样式只能以 token 名过桥，Kotlin 在组合期从 `MaterialTheme` 解析；JS 永远拿不到主题的具体值。** 深浅切换、宿主换主题色时页面不发任何 patch 就跟着变——主题是宿主的运行时状态，不是页面的数据（与 ADR-004"高频状态留 Kotlin"同一原理）。需要派生色（如 primary 变浅）时由宿主注册成新 token，不在页面里算。

- `color` 类型的 prop 同时接受字面量（`#RRGGBB` / `#AARRGGBB`）与 token 名；生成器出联合类型（`` `#${string}` | ColorToken ``），拼错的 token 编译期报，Kotlin 侧按首字符 `#` 分流。字面量留给品牌色、图表色这类本来就不属于主题的颜色
- token 词表就是 Material 3 的字段名：颜色为 `ColorScheme` 的全部字段，文字样式为 `Typography` 的十五个名字（cli `schema/tokens.ts` 是词表真值，`compose/.../schema/Theme.kt` 逐一解析，测试保证两边一致）
- 暂不做：宿主自定义 token（触发条件：某宿主出现 M3 之外的语义色要跨页复用，届时走清单下发 + 宿主类型包生成，与宿主组件同一条路）；间距 / 圆角 / 阴影的 token

