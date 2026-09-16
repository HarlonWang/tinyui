# 构建链：TSX → ESM 模块字节码

- 状态：方案已定（2026-09-16），实施中
- 来源：[ADR-005](./adr-005-engine.md) §4 "语言目标 / 模块" 两行的展开；roadmap A 组"构建链打通"
- 范围：`@tiny-ui/cli` 的 `tinyui build`、`compose/` 的 K0 加载序列、sample 的接线与 CI。自动 thunk（roadmap C 组）、字节码行号回映射、`qjsc-kmp` 二进制分发、页面级配置文件不在本期

## 1. 目标与验收

`tinyui build` 把每个页面的 TSX 编成一个 ESM 模块字节码，`@tiny-ui/core` / `@tiny-ui/native` 各编成一个运行时模块字节码，App 内置这些字节码，每页一个 Runtime 按 ADR-002 K0 的顺序加载。

验收：sample 的 `src/pages/home.tsx` 经 CLI 产出 `pages/home.bin`，Android / iOS 上 App 启动后显示页面 `default` 导出的返回值，其中含 `import.meta.url` 的值 `tinyui:pages/home`——模块名、external、注册顺序三件事一次验完。CI 的 gradle 与 pnpm 两条 job 都经过这条链。

## 2. 管线

```
src/pages/home.tsx ──esbuild──▶ dist/pages/home.js + .map ──qjsc-kmp -m -n pages/home──▶ dist/pages/home.bin
@tiny-ui/core 包入口 ──esbuild──▶ dist/runtime/core.js     ──qjsc-kmp -m -n @tiny-ui/core──▶ dist/runtime/core.bin
@tiny-ui/native 同上（对它而言 @tiny-ui/core 是 external）
```

| 步骤 | 做什么 | 不做什么 |
|---|---|---|
| esbuild | TS 类型擦除；JSX → `h()`（`jsxFactory: "h"`，`jsxInject` 自动注入 import，页面不手写）；业务内部相对 import 合并进页面模块；`external: ["@tiny-ui/*"]` 保持裸说明符；`format: "esm"`，`target: "esnext"`；输出 source map | 任何语法降级；对 `@tiny-ui/*` 的解析 |
| qjsc-kmp | 源码模块 → 字节码，`-n` 给定模块名，`--strip-source` 保留行号去源码 | 校验模块图（引擎加载时查表） |

**页面名即模块名**：`src/pages/home.tsx` → `pages/home`，子目录保留路径，无后缀无前缀（ADR-005 §4）。运行时模块名固定 `@tiny-ui/core`、`@tiny-ui/native`。

## 3. 页面即构建单元

一个页面 = 一个路由单元 = 一个 Runtime（ADR-002）= 一份模块字节码 = 将来的一个分发单元。构建产物因此按页自包含：页面 import 的业务内部代码（工具函数、业务组件）全部合并进该页模块，两个页面共用的代码在两份字节码里各有一份。

这样定的理由：每页一个 Runtime 且模块缓存挂在 JSContext 上（quickjs-kmp `docs/decisions.md`"Runtime / Context"条），跨页共享代码在引擎层本来就不存在——即使拆出共享 chunk，每页仍要各注册、各编译一遍，运行时的时间与内存一分不省。重复只花安装包体积，而字节码模块的加载路径（注册 → import 命中表）对页面数是线性的，不需要 chunk 清单这层东西。

实现上"一页一次 build()"是对产物形态的描述，不是对 esbuild 调用次数的要求：所有页面作为 `entryPoints` 放进一次 `build()`、`splitting: false`，每个入口的输出仍各自自包含，且共享解析缓存。

扩展出口：业务共享代码大到安装包体积成问题时，把它编成 App 级共享模块（名字进 external 列表，与 `@tiny-ui/*` 一样注册进每个引擎的模块表），页面对它保持裸 import。这只是 external 列表与模块表多一项，管线形态不变；触发条件出现前不做。

## 4. 工具选型：esbuild

### 4.1 硬要求

1. TS 擦除，不做任何降级：顶层 `await`、`import.meta.url` 原样保留
2. JSX → `h()`，工厂名可指定
3. 打包：合并业务内部 import；`@tiny-ui/*` 不解析
4. ESM 单文件输出 + source map
5. 以库形式被 CLI 调用

### 4.2 候选

| 候选 | 擦 TS | JSX → `h()` | 打包 + external | 结论 |
|---|---|---|---|---|
| tsc 单独用 | 是 | 是 | 否，不合并模块图 | 仍需打包器 |
| Babel + Rollup | 插件 | 插件 | 是 | 三四个包加配置层，JS 实现，慢 |
| SWC / oxc 单独用 | 是 | 是 | 否，只是转译器 | 同 tsc |
| Vite | 内部 esbuild + Rollup / rolldown | 是 | 是 | 面向 dev server 与浏览器，对库式逐页调用多一层 |
| rolldown | 是（内置 oxc） | 是 | 是 | 能力对等，Rollup 同形 API；仍在向 1.0 收敛，插件生态迁移期 |
| Bun bundler | 是 | 是 | 是 | 绑定 Bun 运行时，CLI 是 Node 生态的 npm 包 |
| **esbuild** | 是 | 是 | 是，`external` 支持通配 | 单一依赖、Go 二进制、API 长期稳定 |

### 4.3 选 esbuild 的理由

- 需求全在内置能力里：`bundle` / `external` / `format` / `target` / `jsxFactory` / `sourcemap` 六个选项即全部配置，零插件
- 不降级是默认行为：它的定位就是擦除与打包，`esnext` 下不碰语法，与 ADR-005 "CLI 只做 TS 擦除与 JSX 变换"一致；以转换为核心的工具反而要花精力确认它没改写语法
- 一个依赖、一个二进制：CLI 是业务 App 要安装的包，依赖树越小越好
- 速度：单页毫秒级，watch 与几十页全量构建不需要额外优化

### 4.4 局限与出口

esbuild 的 JSX 变换是内置固定逻辑、不可编程。C 组的自动 thunk 要对 JSX 属性表达式判断后包成 getter，esbuild 做不到。出口：`onLoad` 插件拦截 `.tsx`，先跑自有 JSX 变换（TypeScript transformer API 或 oxc），把已是 `h()` 调用的 JS 交回 esbuild 合并——esbuild 退化为"擦除 + 合并"，变换逻辑在自己手里。

rolldown 是真正的备选（Rollup 同形 API、oxc 转译）。CLI 只包一次 `build()` 调用，切换成本在一个文件内，不需要现在锁定。

## 5. 字节码由 CLI 生成，宿主工具从 quickjs-kmp 来

字节码编译放 CLI 而不放 Gradle：业务 App 不会有本仓的 build-logic，`tinyui build` 必须自己出最终产物。`qjsc-kmp` 二进制查找顺序：`--qjsc` 参数 → `TINYUI_QJSC` 环境变量 → PATH。

字节码绑定引擎构建（文件头记上游 commit，quickjs-kmp `docs/native-build.md`"字节码与宿主工具"），CLI 用的 `qjsc-kmp` 必须与 App 链接的 quickjs-kmp 同一上游 commit。

| 场景 | 来源 |
|---|---|
| 本地 | `local.properties` 有 `quickjs-kmp.dir` 时，Gradle 把 `<dir>/library/build/native/host-tools/bin/qjsc-kmp` 传给 CLI，零配置 |
| CI（本期） | clone quickjs-kmp 的 catalog 对应 tag，`./gradlew :library:buildHostTools` 现编，多花一两分钟 |
| 长期 | quickjs-kmp 在 tag 发布时把 macOS / Linux 宿主二进制挂到 GitHub Release，CLI 按版本下载（esbuild 的平台包模式）；属 quickjs-kmp 仓改动，记 roadmap |

## 6. 各处职责

| 位置 | 改动 |
|---|---|
| `packages/cli` | `bin` 入口 `tinyui`，子命令 `build`，参数 `--root` / `--out` / `--qjsc`；依赖 esbuild。测试：夹具 TSX 打包后断言 `h(` 调用、裸说明符保留、相对 import 已合并、`.map` 存在；qjsc 步骤在 `TINYUI_QJSC` 缺失时跳过 |
| `packages/core` / `native` | 不动运行时 API，只保证入口能打成单模块，各导出 `VERSION` 供 sample 显示 |
| `compose/` | ADR-002 K0 最小版：注册 core → 注册 native → 运行页面模块 → 返回 namespace。命名待 M1 定，本期只保证序列在库里而不在 sample 里。commonTest 用 `JsBytecode.compile` 现场编字节码，不依赖宿主工具 |
| `sample/js` | 新 pnpm workspace 成员，`src/pages/home.tsx`。本期页面用纯 TS 只 import `VERSION`：`h` 的签名是 C 组的事，不在 core 放临时实现；JSX 变换的正确性由 CLI 单元测试覆盖 |
| `sample/shared` | Gradle Exec 任务调 CLI，产物挂成 Compose resources 自定义目录，`Res.readBytes` 读入后走 K0 |
| `settings.gradle.kts` | 有 `quickjs-kmp.dir` 时把 `qjsc-kmp` 路径传给 Exec 任务 |
| CI | gradle job 加 setup-node + pnpm，clone quickjs-kmp 编宿主工具；ios.yml 同样 |

source map 随 `.js` 输出到 `.map`；行列号回映射到 TSX 归 E1 / E2 错误上报那一期。
