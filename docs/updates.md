# 热下发：包、服务端布局与客户端

- 状态：已定（2026-09-18）；实现依据，实现待开
- 来源：[ADR-006](./adr-006-hot-updates.md)；[build-chain.md](./build-chain.md) §2（manifest）、§7（buildId 与 source map）
- 三侧：CLI 产出包（`tinyui build` / `tinyui bundle`）；服务端只是两条 GET；Kotlin 的 `Bundle`（core 库）与 `Updates`（`wang.harlon:tinyui-updates`）

## 1. 包

一个包 = 一次 `tinyui build` 的输出目录去掉 `.js` / `.js.map`：

```
manifest.json
runtime/core.bin  runtime/native.bin
pages/**/*.bin
```

### 1.1 `manifest.json`

在 build-chain.md §2 的四个字段上扩展：

| 字段 | 写入者 | 内容 |
|---|---|---|
| `runtime` / `pages` / `files` / `buildIds` | `tinyui build` | 不变 |
| `version` | `tinyui build` | 包标识，目录名，只求唯一：`<createdAt 紧凑形式>-<git 短 sha 或 nogit>`，如 `20260918T100212Z-3f2a1c`；`--version` 可覆盖 |
| `createdAt` | `tinyui build` | ISO 8601 UTC，新旧比较只看它 |
| `engine` | `tinyui build` | 字节码文件头里的引擎 commit（40 位 hex，所有 `.bin` 一致，取第一个） |
| `protocol` | `tinyui build` | 所含 `tinyui-core` 的 `PROTOCOL`，读自子路径导出 `tinyui-core/protocol`（只含常量，不在 Node 里执行运行时模块） |
| `hashes` | `tinyui build` | 模块名 → 该模块 `.bin` 的 sha256 hex，键与 `files` 一致 |
| `runtimeVersion` | `tinyui bundle` | 发布目标，等于宿主声明值 |
| `rollout` | `tinyui bundle` | 0～100 的整数，缺省 100 |

内置包的 manifest 没有 `runtimeVersion` / `rollout`——宿主知道自己的 runtimeVersion，内置包不参与灰度。

### 1.2 `tinyui bundle`

```
tinyui bundle --runtime-version <rv> [--rollout <p>] [--out dist/ota]
```

读 `tinyui build` 的输出目录，写：

```
dist/ota/<rv>/manifest.json            build 的 manifest + runtimeVersion + rollout
dist/ota/<rv>/<version>/runtime/*.bin
dist/ota/<rv>/<version>/pages/**/*.bin
```

上传顺序是内容先、指针后：`<version>/` 目录全部就位后再写 `manifest.json`，指针一写即对客户端生效。上传工具不能保证顺序时分两步传。`.js.map` 不进包，发布方归档 build 输出目录以便按 `buildId` 离线对映射（build-chain.md §7）。

## 2. 服务端

| 路径（相对 base URL） | 内容 | 缓存 |
|---|---|---|
| `<rv>/manifest.json` | 可变指针 | `Cache-Control: no-store` |
| `<rv>/<version>/<files[module]>.bin` | 不可变内容 | `Cache-Control: public, max-age=31536000, immutable` |

- 请求不带 query、不带自定义 header；服务端可以是静态目录，也可以是动态端点
- 渠道 = 不同 base URL；服务端不认识渠道
- 同一 `<version>` 目录下的文件永不改内容（改内容必换 version），CDN 因此不会陈旧
- 回滚 = 把 `<rv>/manifest.json` 换回上一个好包的 manifest；灰度 = 改其中的 `rollout`
- 没有鉴权：包在安装包里本来就能反出来

## 3. Kotlin：`Bundle`（core 库）

把宿主现在手写的"读 manifest → 读运行时一次 → 读页面与 map"收进库：

```kotlin
fun interface BundleFiles { suspend fun read(path: String): ByteArray? }   // path 如 pages/home.bin、manifest.json

class Bundle(val manifest: BuildManifest, files: BundleFiles) {
    suspend fun page(name: String): LoadedPage     // 运行时字节码读一次缓存；map 读得到就交给 SourceMaps
    companion object { suspend fun load(files: BundleFiles): Bundle }   // 读 manifest.json
}
class LoadedPage(val runtime: RuntimeBundle, val module: PageModule, val sourceMaps: SourceMaps, val bundle: Bundle)
```

`BuildManifest` 加 `version` / `createdAt` / `engine` / `protocol` / `hashes` / `runtimeVersion` / `rollout` 的解析，旧 manifest 缺字段时为空 / 100。内置包的 `BundleFiles` 由宿主用 `Res.readBytes` 实现；`Bundle` 不知道字节从哪来。

## 4. Kotlin：`Updates`（`tinyui-updates`）

### 4.1 宿主提供什么

```kotlin
class Updates(
    val embedded: Bundle,
    val runtimeVersion: String,
    dir: Path,                                   // 宿主给的目录，如 Android filesDir/tinyui、iOS Application Support/tinyui
    installId: String,                           // 稳定的安装标识；库不生成、不持久化、不上传
    fetch: suspend (path: String) -> ByteArray,  // 宿主用自己的 HTTP 栈；path 是 §2 的相对路径，库已拼好 <rv>/ 前缀，宿主只拼 base
    onEvent: (UpdateEvent) -> Unit = {},
)
```

文件与 sha256 用 okio（`FileSystem` + `ByteString.sha256`），是本 artifact 独有的依赖，core 库不引入。

### 4.2 API 面

| 成员 | 语义 |
|---|---|
| `val current: Bundle` | 构造时定死（§4.4），进程内不变 |
| `suspend fun check(): CheckResult` | §4.3；同一实例串行，重入直接返回进行中的结果 |
| `@Composable fun UpdatesPage(name, registry, sink, services, propsJson, modifier, error, onHost)` | 与 `TinyUIPage` 同参，内部 `current.page(name)` → `TinyUIPage`；`error` 前先走 §4.5 的回退 |

`CheckResult`：`UpToDate` / `Installed(version)` / `Skipped(reason)` / `Failed(stage, cause)`。`UpdateEvent` 是同一组事实加 `RolledBack(version, error)`，给宿主打日志与埋点。

### 4.3 `check()` 状态机

```
fetch <rv>/manifest.json ─解析失败─────────────────────────────▶ Failed(manifest)
  │
  ├─ runtimeVersion ≠ 宿主值 / engine ≠ QuickJs.upstreamCommit / protocol ≠ PROTOCOL ─▶ Skipped(incompatible)   // 发错目录，上报
  ├─ version == installed.version 或 version ∈ failed ────────────▶ UpToDate / Skipped(failed)
  ├─ createdAt ≤ embedded.createdAt ───────────────────────────────▶ Skipped(older-than-embedded)
  ├─ hash(installId + ":" + version) % 100 ≥ rollout ─────────────▶ Skipped(rollout)
  │
  ▼ 逐文件 fetch <rv>/<version>/<file>.bin → staging/<version>/，每个核对 sha256
  ├─ 任一失败 ─删 staging──────────────────────────────────────────▶ Failed(download | integrity)
  ▼ 写入 manifest.json，staging/<version> 改名 installed/<version>，state.installed = version，删其他 installed
  ▼ Installed(version)   // 下次启动生效
```

掷骰以 `version` 为盐：每次发布独立抽样；已装上的用户不因 `rollout` 下调而回退。

### 4.4 启动选择

存储布局：

```
<dir>/state.json            { "installed": "<version>" | null, "failed": ["<version>", …] }   // failed 最多留 10 条
<dir>/staging/<version>/    下载中
<dir>/installed/<version>/  manifest.json + runtime/ + pages/
```

构造时：`installed` 存在、目录完整（manifest 里的每个文件都在）、`runtimeVersion` 等于宿主值、不在 `failed`、`createdAt` 新于 `embedded` → `current = installed`，否则 `current = embedded`。`createdAt` 不新于内置的 installed 当场删除（App 升级带来了更新的内置包）；残留的 `staging/` 删除。不重算 sha256：落盘前已核对，之后的损坏由 §4.5 兜底。

### 4.5 失败回退

`UpdatesPage` 挂的页面来自 installed 且报 E2 / E6（`PageHost.failure`）时：`failed += version`，`state.installed = null`，`onEvent(RolledBack)`，随后用 `embedded.page(name)` 重挂同一页面（`TinyUIPage` 的 `remember` 键含 `page`，换 `PageModule` 即重建引擎）。E2 / E6 本身照常经 `PageSink.error` 上报，带 `buildId`。

页面来自 embedded 时的失败走宿主自己的 `error` 槽，与不用 `tinyui-updates` 时相同。

进程内已经挂在 installed 上的其他页面不动（各自独立 Runtime），下次启动统一回到 embedded。

## 5. 与既有契约的关系

- `PageHost` / `TinyUIPage` / patch 协议 / schema / `PageSink` 不变；`Updates` 全部搭在 `Bundle` 与 `TinyUIPage` 之上
- 引擎的 `JsEngineConfig.moduleLoader` 不接入：它服务页内 `import()`，不是页面级分发（ADR-006 §4.3）
- `PageError` 不加字段：`buildId` 已能定位到具体 build，`RolledBack` 事件带 `version`
