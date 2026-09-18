# tinyui-cli

[TinyUI](https://github.com/HarlonWang/tinyui) 的构建工具：`tinyui build` 把 `src/pages/**/*.tsx` 编成每页一个 ESM 模块字节码（含运行时模块与 `manifest.json`），`tinyui schema` 从组件 schema 生成 TS 类型与 Kotlin 侧代码。

字节码编译需要 quickjs-kmp 的宿主工具 `qjsc-kmp`（`--qjsc` 或 `TINYUI_QJSC`）。用法见仓库 `docs/build-chain.md`；与 `tinyui-core` 同版本号。
