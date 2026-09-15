# bench

在 MicroQuickJS 上对比 UI 响应式更新模型的 CPU 与内存开销，是 [ADR-001](../docs/adr-001-reactivity-model.md) 的数据来源。

| 模型 | 文件 | 机制 |
|---|---|---|
| `signal` | `signal.js` | 运行时 Signal（Solid 风格）：effect 执行期自动收集依赖，属性级更新，所有权树清理 |
| `static-fine` | `static.js` | 编译期静态依赖（Svelte 3/4 风格）：ctx 槽位 + dirty 位图 + 每组件一个 `p()`，按行失效 |
| `static-coarse` | `coarse.js` + `static.js` | 同上，但任意条目变化失效整个列表、逐行重查（Svelte 4 对 `items[i].x = v` 的实际行为） |

三个模型跑同一被测应用（标题 Text + 1000 行列表，每行 3 个动态属性）；`run.py` 先以 verify 模式断言 patch 流逐 flush 一致，再计时。

场景：S1 挂载 1000 行；S2 单属性更新 + flush ×200000；S3 每轮改 100 行 ×2000 轮；S4 1000 行删除重建 ×30。指标：`performance.now()` 中位数（5 次）、`gc()` 后 `mqjs -d` 的 live heap、能跑完的最小 `--memory-limit`（64 KiB 粒度二分）。

## 运行

引擎来自 mquickjs-kmp 仓的上游副本（默认 `~/KMPProjects/mquickjs-kmp`，可用 `MQUICKJS_KMP_DIR` 覆盖），编进本目录的 `.engine/`（gitignored），只打一个补丁 `engine.patch`（`performance.now` 亚毫秒精度）：

```sh
bench/build-engine.sh
python3 bench/run.py          # 结果写到 bench/results/<时间戳>.md
```

单跑一项：`bench/.engine/mqjs -d -I bench/harness.js -I bench/signal.js bench/run.js S2`。

结果：[results/2026-09-14.md](./results/2026-09-14.md)（macOS arm64）。
