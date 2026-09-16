# quickjs-kmp 验收 — 2026-09-16

同一份 `harness.js` + `signal.js`（ES5 模型，见 [2026-09-15-engines.md](./2026-09-15-engines.md)）经 quickjs-kmp（main `e7cc956`，内置 bellard/quickjs `04be246`）以 TinyUI 的桥形状跑：一次 Kotlin 入口 = 一个事务（JS 里做更新 + flush），patch 流经宿主函数以 JSON 文本跨到 Kotlin。跑法：quickjs-kmp 的 `TINYUI_BENCH_DIR=<本目录> ./gradlew :library:tinyUIBench`（macOS arm64 release 测试二进制，Apple M4，REPS=5 取中位数，`memoryLimit` 64 MiB，单线程、无 dispatcher 切换）。

**语义**：S1～S4 的 verify 模式 patch 流，无论由 harness 自己驱动还是由 Kotlin 逐事务驱动，都与 `qjs` 二进制的输出逐字节一致。

**耗时**（ms）：`js-only` 是 harness 自己计时、`__host.apply` 为 JS 桩，即引擎内的纯模型开销；`+ crossing` 是 Kotlin 驱动、宿主函数只接收 JSON 字符串（含 `JsRef.call` 入、WTF-8 解码出）；`+ JSON parse` 再把每次 flush 的 JSON 用 kotlinx `parseToJsonElement` 建树。

| scenario | js-only | + crossing | + JSON parse | 事务数 | patches | bytes | memory KiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| S1 挂载 1000 行 | 10.9 | 12.1 | 15.3 | 1 | 10006 | 209376 | 7662 |
| S2 单属性更新 ×200k | 247.4 | 374.0 | 454.8 | 200000 | 210006 | 5825071 | 7694 |
| S3 100 行/轮 ×2000 | 158.6 | 183.6 | 224.9 | 2000 | 160529 | 3986973 | 7694 |
| S4 删除重建 ×30 | 274.2 | 315.0 | 410.7 | 30 | 340066 | 7309504 | 7658 |

**折算到每笔事务的桥开销**（`+ crossing` 减 `js-only`，以及解析增量）：

| 事务形状 | 过桥 | 解析 | 合计 |
|---|---:|---:|---:|
| S2：2 个数字入、29 B JSON 出 | 0.63 µs | 0.40 µs | 1.0 µs |
| S3：2 个数字入、约 2 KB JSON 出 | 12.5 µs | 20.7 µs | 33 µs |
| S4：无参入、约 120 KB JSON 出 | 1.4 ms | 3.2 ms | 4.6 ms |
| S1：一个 ref 入、209 KB JSON 出 | 1.2 ms | 3.2 ms | 4.4 ms |

**结论**

- ADR-002 §3.3「1000 行挂载 209 KB 一次过桥没问题」成立：过桥 1.2 ms，加解析 4.4 ms，与 JS 侧 11 ms 同量级。
- ADR-004 §1「过桥一次约百微秒量级」偏保守：小事务的桥本身约 1 µs，本表不含 `JsRuntime` 的两次线程切换，那是剩下的大头，量级另测。
- 解析成本与 JSON 体积线性（约 15～20 µs/KB），比过桥本身贵 1.5～2.5 倍；ADR-003 的流式解析器直接写节点表可以省掉建树这一层。
- 内存：引擎常驻约 7.6 MiB（含 harness、1000 行状态、`memoryLimit` 64 MiB 下的 GC 松弛），与 [2026-09-15-engines.md](./2026-09-15-engines.md) 里 qjs 的最小可运行堆 8 MiB 一致。

**注意**：K/N debug 测试二进制（Gradle 默认的 `macosArm64Test`）下 Kotlin 侧慢 5～10 倍，会把 S2 的桥开销测成 11 µs、S1 测成 44 ms，不作数；quickjs-kmp 的 `tinyUIBench` 任务固定用 release 二进制。模型仍是 ES5 写法（数组 `indexOf` 订阅集、对象字典），ADR-001 修订后运行时改用 ES2025 特性时数字会变。
