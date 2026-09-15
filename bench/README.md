# bench

对比 UI 响应式更新模型的 CPU 与内存开销（[ADR-001](../docs/adr-001-reactivity-model.md) 的数据来源），并在 MicroQuickJS 与 QuickJS 之间对比引擎（[ADR-005](../docs/adr-005-engine.md)）。脚本为纯 ES5，两个引擎都能跑。

| 模型 | 文件 | 机制 |
|---|---|---|
| `signal` | `signal.js` | 运行时 Signal（Solid 风格）：effect 执行期自动收集依赖，属性级更新，所有权树清理 |
| `static-fine` | `static.js` | 编译期静态依赖（Svelte 3/4 风格）：ctx 槽位 + dirty 位图 + 每组件一个 `p()`，按行失效 |
| `static-coarse` | `coarse.js` + `static.js` | 同上，但任意条目变化失效整个列表、逐行重查（Svelte 4 对 `items[i].x = v` 的实际行为） |

三个模型跑同一被测应用（标题 Text + 1000 行列表，每行 3 个动态属性）；`run.py` 先以 verify 模式断言 patch 流逐 flush 一致，再计时。

场景：S1 挂载 1000 行；S2 单属性更新 + flush ×200000；S3 每轮改 100 行 ×2000 轮；S4 1000 行删除重建 ×30。指标：`performance.now()` 中位数（5 次）、`gc()` 后 `mqjs -d` 的 live heap、能跑完的最小 `--memory-limit`（64 KiB 粒度二分）。

## 运行

三个引擎构建，都编进本目录的 `.engine*/`（gitignored）：

| 名称 | 来源 | 构建 |
|---|---|---|
| `mqjs-Os` | mquickjs-kmp 仓的上游副本（默认 `~/KMPProjects/mquickjs-kmp`，`MQUICKJS_KMP_DIR` 覆盖），打 `engine.patch`（`performance.now` 亚毫秒精度） | `bench/build-engine.sh` → `.engine/` |
| `mqjs-O2` | 同上，`make CONFIG_SMALL=` | 手动：`cp -R .engine .engine-o2 && (cd .engine-o2 && make clean && make CONFIG_SMALL= mqjs)` |
| `qjs` | `git clone --depth 1 https://github.com/bellard/quickjs.git .engine-qjs && (cd .engine-qjs && make qjs)`，自带 `performance.now` 与 `--std` 下的 `std.gc()` | `.engine-qjs/` |

```sh
python3 bench/run.py                                   # 默认 ENGINES=mqjs-Os，MODELS 全部
ENGINES=mqjs-Os,mqjs-O2,qjs MODELS=signal,static-fine python3 bench/run.py
```

结果写到 `bench/results/<时间戳>.md`；verify 阶段会跨引擎、跨模型断言 patch 流一致。单跑一项：`bench/.engine-qjs/qjs --std -d -I bench/harness.js -I bench/signal.js bench/run.js S2`。

结果：[results/2026-09-14.md](./results/2026-09-14.md)（模型对比，MicroQuickJS）、[results/2026-09-15-engines.md](./results/2026-09-15-engines.md)（引擎对比）。
