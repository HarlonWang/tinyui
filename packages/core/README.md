# tinyui-core

[TinyUI](https://github.com/HarlonWang/tinyui) 的 JS 运行时：signal / memo / effect / resource / observable、`h` / `For` / `Show`、内置组件的 TSX 类型。页面里 `import { signal, Column, Text } from "tinyui-core"`，经 `tinyui-cli` 编成 QuickJS 模块字节码后由 Compose Multiplatform 侧（Maven `wang.harlon:tinyui`）渲染。

API 见仓库 `docs/runtime-api.md`；三包与 Maven 库同版本号。
