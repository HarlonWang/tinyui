# TinyUI

JS 写声明式组件、Compose Multiplatform 渲染的动态化 UI 框架，引擎为 [mquickjs-kmp](https://github.com/HarlonWang/mquickjs-kmp)。Android / iOS 双端，页面可热下发。

> 设计阶段。关键选型已定，代码尚未开始；进度见 [docs/roadmap.md](./docs/roadmap.md)。

- 设计文档与决策记录：[docs/](./docs/README.md)
- 响应式模型 benchmark：[bench/](./bench/README.md)
- 站点：tinyui.app（未上线）

## 目录

```
docs/        设计文档、ADR、roadmap
packages/    npm 包：@tiny-ui/core · @tiny-ui/native · @tiny-ui/cli
compose/     KMP 库 wang.harlon:tinyui（Compose Multiplatform 侧）
schema/      内置组件 schema，两侧契约的唯一真值
sample/      示例 App
bench/       响应式模型 benchmark
build-logic/ Gradle convention plugins
```

目录与命名依据见 [docs/README.md](./docs/README.md)。

## License

[MIT](./LICENSE)
