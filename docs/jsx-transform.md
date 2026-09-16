# JSX 变换：CLI 把 TSX 编成 `h()` 调用的规则

- 状态：草案（2026-09-16），待确认后定稿
- 来源：ADR-001 修订"thunk 写法改由编译器生成"、ADR-005 §4"CLI 只做 TS 擦除与 JSX → `h()`，source map"；运行时侧的接收形态见 [runtime-api.md](./runtime-api.md) §3
- 位置：`@tiny-ui/cli` 在 esbuild 的 `onLoad` 里对每个 `.tsx` 先跑本文的 pass，再交给 esbuild 做 JSX → `h()`、TS 擦除与合并（[build-chain.md](./build-chain.md) §4.4 预留的出口）

## 1. 目标形态

业务写的是普通值，运行时收到的是可识别的动态包装：

```tsx
<Text text={"Count: " + count()} color={theme.primary} onClick={() => inc()} />
```

```js
h(Text, { text: thunk(() => "Count: " + count()), color: thunk(() => theme.primary), onClick: () => inc() })
```

`thunk` 与 `h` / `Fragment` 一样由 CLI 注入 import（`@tiny-ui/core`），业务文件里不出现。类型层面 `thunk<T>(fn: () => T): T`，所以 `.d.ts` 里 prop 类型按值声明（`text: string`），业务与组件作者都看不到包装。

## 2. 属性表达式的包裹规则

对 JSX 属性 `name={expr}` 逐个判定。先看属性名，再看表达式。

**按属性名，永不包裹**：`ref`、`key`、`children`、匹配 `/^on[A-Z]/` 的事件 handler。

**按表达式**（不进入函数体；对象 / 数组 / 模板字面量 / 条件 / 逻辑 / 二元表达式向内递归）：

| 表达式含有 | 结果 |
|---|---|
| 调用 `f()`、属性访问 `a.b` / `a[b]`、`new`、标签模板、可选链 | **包裹** |
| 只有字面量、标识符、运算符、箭头 / 函数表达式、JSX 元素 | 不包裹 |

判据同 Solid 的 `isDynamic`：signal 读取一定是调用或属性访问，纯标识符不可能是响应式的。误包（`Math.max(a, b)`）只多一个跑一次的 effect。

**字符串属性** `text="hi"` 与 `{...}` 里的字面量都是静态值。

## 3. 编译期报错

以下写法在 `tinyui build` 时报错并指出位置，不产出：

| 写法 | 原因 | 改法 |
|---|---|---|
| `{...props}` 展开属性 | 展开会立刻求值 getter，丢失响应式 | 显式列出属性 |
| children 里的表达式：`{cond && <A/>}`、`{cond ? <A/> : <B/>}`、`{list.map(...)}`、`{value}` | children 创建后不可变（runtime-api.md §3.1） | `<Show>` / `<For>`；文本走 `text` prop |
| 非空白的 JSXText：`<Text>hi</Text>` | 同上 | `<Text text="hi" />` |
| `async` 组件函数上的 JSX（`export default async function`） | 组件必须同步 | `createResource` |

例外：children 里恰好一个箭头 / 函数表达式（`For` / `Show` 的渲染函数）合法，原样传为 `children`。

## 4. 元素类型

- 小写标签 `<text>` 不支持（不是 DOM），首字母大写视为标识符：`<Text>` 变成 `h(Text, …)`，`Text` 由 `@tiny-ui/core` 导出，是值为 `"Text"` 的字符串常量（TS 允许字符串字面量类型的标识符做元素名，prop 类型从 `JSX.IntrinsicElements["Text"]` 查，由 schema 生成，roadmap C 组第 4 项）；宿主扩展 `<pp.KycCard>` 变成 `h(pp.KycCard, …)`，`pp` 由宿主 App 自己的类型包导出
- `<>…</>` 变成 `h(Fragment, null, …)`
- 组件 `<Row title={x()} />` 与内置元素规则相同：属性照 §2 包裹，运行时把 thunk 转成 getter 交给组件

## 5. source map

本 pass 用字符串局部替换生成 map，以内联 `sourceMappingURL` 交给 esbuild；esbuild 与自己的 JSX / 合并 map 组合后输出 `pages/<name>.js.map`，`sources` 指向原 `.tsx`。字节码保留行号（`--strip-source`），E1 / E2 的栈里是 `.js` 的行列，经 `.js.map` 回到 `.tsx`，这一步在错误上报那一期做。

## 6. 实现（非契约）

倾向 `oxc-parser`（含 TSX 的 ESTree AST，napi 二进制）+ `magic-string`（局部替换 + map），只改属性表达式与做 §3 检查，不做整文件代码生成；JSX → `h()` 仍交给 esbuild。备选 `@babel/parser`（纯 JS）。切换只影响 CLI 内一个文件。
