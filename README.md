# TinyUI

JS 写声明式组件、Compose Multiplatform 渲染的 UI 框架，引擎为 QuickJS（经 quickjs-kmp 接入）。Android / iOS 双端。

> 早期阶段。关键选型已定，M1 Counter 已在双端跑通（TSX → 模块字节码 → 引擎 → patch → Compose）；进度见 [docs/roadmap.md](./docs/roadmap.md)。

- 设计文档与决策记录：[docs/](./docs/README.md)
- 响应式模型与引擎 benchmark：[bench/](./bench/README.md)
- 站点：tinyui.app（未上线）

## 目录

```
docs/        设计文档、ADR、roadmap
packages/    npm 包：@tiny-ui/core · @tiny-ui/native · @tiny-ui/cli
compose/     KMP 库 wang.harlon:tinyui（Compose Multiplatform 侧）
schema/      内置组件 schema，两侧契约的唯一真值
sample/      示例 App（sample/js 是页面源码，Gradle 构建时经 CLI 编成字节码打进资源）
bench/       响应式模型与引擎 benchmark
build-logic/ Gradle convention plugins
```

目录与命名依据见 [docs/README.md](./docs/README.md)。

## 构建

```sh
pnpm install                     # Node 22+，pnpm 10
./gradlew build                  # compose 库 + 测试（Android host / iOS simulator）+ sample APK + iOS framework；需要 JDK 25、Android SDK、Xcode
pnpm build && pnpm test          # 三个 npm 包
```

sample 的 Gradle 构建会调 `tinyui build` 把 `sample/js` 编成字节码，需要 quickjs-kmp 的宿主工具 `qjsc-kmp`，Android host 测试还需要宿主 JNI 库。两种来源：

- 本地联调：`local.properties` 加 `quickjs-kmp.dir=<quickjs-kmp 仓路径>`，SDK 从源码构建（composite build），两样宿主产物由该仓的任务自动编出，零配置
- 否则：`TINYUI_QJSC` 指向 `qjsc-kmp`，`TINYUI_QUICKJS_HOST_JNI` 指向含 `libquickjs_kmp` 的目录（CI 的做法见 `.github/workflows/build.yml`）

## License

[MIT](./LICENSE)
