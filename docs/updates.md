# 热下发：包、投递协议、发布协议与客户端

- 状态：已定（2026-09-18；2026-09-19 加发布协议、签名、服务端形态；2026-09-19 改为多包模型——App 由 N≥1 个包组成，包名进模块名与 URL，公钥进 manifest，`Updates` 以一组包为单位）；实现依据，实现待开
- 来源：[ADR-006](./adr-006-hot-updates.md)；[build-chain.md](./build-chain.md) §2（manifest、模块名、`tinyui.config.json`）、§7（buildId 与 source map）
- 四侧：CLI 产出与发布包（`tinyui build` / `bundle` / `publish`）；服务端实现投递与发布两组端点（参考实现 `tinyui-updates-server`，托管实例 `updates.tinyui.app`）；Kotlin 的 `Bundle`（core 库）与 `Updates`（`wang.harlon:tinyui-updates`）
- 协议规范只在本文一处；服务端仓的一致性测试以本文为准，不复制。**发布后字段与端点只增不改，未知字段透传**——这是两个仓能各自演进的前提

## 0. 模型

**App 由 N≥1 个包组成。包 = 所有权单元 = 分发单元 = 一次 `tinyui build` 的完整产物。** 单包 App 是 N=1，没有任何特殊路径。

- 包名 `[a-z0-9-]+`，来自 JS 工程的 `tinyui.config.json`，同时是模块名前缀、URL 路径段、服务端的密钥与 token 粒度；按业务域命名（`subscription`），不按团队命名
- 包之间没有共享代码、没有共享运行时、没有直接通道；跨包只走 Kotlin 中转的 JSON（[app-model.md](./app-model.md) §3、§7）
- 每个包独立校验、独立落盘、独立掷骰、独立回退；一个包坏了不影响其他包

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
| `runtime` / `pages` / `files` / `buildIds` | `tinyui build` | 不变；`pages` 与 `files` 的键是含包名的模块名（`subscription/home`） |
| `name` | `tinyui build` | 包名，读自 `tinyui.config.json` |
| `publicKey` | `tinyui build` | 验签公钥（§7 格式），读自 `tinyui.config.json`；**信任来源只有内置包里的这份**，下载的 manifest 里的只用于诊断 |
| `version` | `tinyui build` | 包标识，目录名，只求唯一：`<createdAt 紧凑形式>-<git 短 sha 或 nogit>`，如 `20260918T100212Z-3f2a1c`；`--version` 可覆盖 |
| `createdAt` | `tinyui build` | ISO 8601 UTC，新旧比较只看它 |
| `engine` | `tinyui build` | 字节码文件头里的引擎 commit（40 位 hex，所有 `.bin` 一致，取第一个） |
| `protocol` | `tinyui build` | 所含 `tinyui-core` 的 `PROTOCOL`，读自子路径导出 `tinyui-core/protocol`（只含常量，不在 Node 里执行运行时模块） |
| `hashes` | `tinyui build` | 模块名 → 该模块 `.bin` 的 sha256 hex，键与 `files` 一致 |
| `runtimeVersion` | `tinyui bundle` | 发布目标，等于宿主声明值 |
| `signature` | `tinyui bundle` | §7；覆盖除 `signature` 与 `rollout` 之外的全部字段（含 `name`、`publicKey`、`runtimeVersion`） |
| `rollout` | `tinyui bundle`，服务端可改 | 0～100 的整数，缺省 100；投递策略，不在签名内 |

内置包的 manifest 没有 `runtimeVersion` / `signature` / `rollout`——宿主知道自己的 runtimeVersion，内置包不参与灰度、不验签。

### 1.2 `tinyui bundle`

```
tinyui bundle --runtime-version <rv> --signing-key <私钥 PEM> [--rollout <p>] [--out dist/ota]
```

读 `tinyui build` 的输出目录，写：

```
dist/ota/<pkg>/<rv>/manifest.json            build 的 manifest + runtimeVersion + signature + rollout
dist/ota/<pkg>/<rv>/<version>/runtime/*.bin
dist/ota/<pkg>/<rv>/<version>/pages/**/*.bin
```

这个目录是包的最终形态：交给 `tinyui publish` 上传，或者原样放到任何静态目录（§2.2）——它的布局就是 §2 客户端要请求的路径。`.js.map` 不进包，发布方归档 build 输出目录以便按 `buildId` 离线对映射（build-chain.md §7）。

## 2. 投递协议

客户端只会发两种 GET，路径相对宿主配置的 base URL：

| 路径 | 内容 | 缓存 |
|---|---|---|
| `<pkg>/<rv>/manifest.json` | 可变指针 | `Cache-Control: no-store` |
| `<pkg>/<rv>/<version>/<files[module]>.bin` | 不可变内容 | `Cache-Control: public, max-age=31536000, immutable` |

- `pkg` 库从内置 manifest 读，`rv` 宿主给；宿主只拼 base，一个 App 不管几个包都是一个 base URL、一个 `fetch`
- 请求不带 query、不带自定义 header、不带任何设备信息；宿主的 `fetch` 实现可以自行加 header 或按路径分流到不同来源，库不知情
- 同一 `<version>` 目录下的文件永不改内容（改内容必换 version），CDN 因此不会陈旧
- 回滚 = 指针换回上一个好包的 manifest；灰度 = 改其中的 `rollout`
- 投递面没有鉴权：包在安装包里本来就能反出来；来源与完整性由签名（§7）保证

### 2.1 托管与私有化实例

`tinyui-updates-server`（独立仓，Cloudflare Workers 参考实现）实现本节与 §6。托管实例 `updates.tinyui.app`；私有化 = 部署同一份代码到自己的 Cloudflare 账号。

```
base = https://updates.tinyui.app/<app>/<channel>
完整路径 = /<app>/<channel>/<pkg>/<rv>/manifest.json
```

进 URL 的只有永久不变的身份：`app` 由实例管理员分配、全局唯一（§6.3）；`channel` 由宿主构建变体决定（`production` / `staging` / `dev`），是 App 级的部署环境而不是包级的；`pkg`、`rv` 见上。**组织 / 租户（计费主体）不进 URL**——它会改名、转让、拆合，只是 app 记录上的一个可改字段。

### 2.2 静态目录

不需要服务端代码：把 §1.2 的 `dist/ota/` 放到任何能设缓存头的静态托管，base URL 指向它。没有发布协议、没有服务端验签，签名仍由客户端验。

## 3. Kotlin：`Bundle`（core 库）

把宿主现在手写的"读 manifest → 读运行时一次 → 读页面与 map"收进库：

```kotlin
fun interface BundleFiles { suspend fun read(path: String): ByteArray? }   // path 如 pages/home.bin、manifest.json

class Bundle(val manifest: BuildManifest, files: BundleFiles) {
    val name: String get() = manifest.name
    suspend fun page(name: String): LoadedPage     // name 是含包名的模块名；运行时字节码读一次缓存；map 读得到就交给 SourceMaps
    companion object { suspend fun load(files: BundleFiles): Bundle }   // 读 manifest.json
}
class LoadedPage(val runtime: RuntimeBundle, val module: PageModule, val sourceMaps: SourceMaps, val bundle: Bundle)
```

`BuildManifest` 解析 §1.1 全部字段，`name` / `publicKey` 缺失即解析失败。内置包的 `BundleFiles` 由宿主用 `Res.readBytes` 实现（每包一个资源子目录，如 `files/tinyui/<pkg>/`）；`Bundle` 不知道字节从哪来。

## 4. Kotlin：`Updates`（`tinyui-updates`）

主仓 Gradle 模块 `updates/`，与 `compose/` 同版本号同 tag 发 Maven。

### 4.1 宿主提供什么

```kotlin
class Updates(
    packages: List<Bundle>,                      // 内置包，各自 manifest.name 即包名；重名、engine 与宿主引擎不符 → 构造抛错
    val runtimeVersion: String,
    dir: Path,                                   // 宿主给的目录，如 Android filesDir/tinyui、iOS Application Support/tinyui；库内按 <dir>/<pkg>/ 分
    installId: String,                           // 稳定的安装标识；库不生成、不持久化、不上传
    fetch: suspend (path: String) -> ByteArray,  // 宿主用自己的 HTTP 栈；path 是 §2 的相对路径，库已拼好 <pkg>/<rv>/ 前缀，宿主只拼 base
    onEvent: (UpdateEvent) -> Unit = {},
)
```

验签公钥不由宿主传：每个包的信任锚是它内置 manifest 里的 `publicKey`（§1.1、§7）。单包宿主写 `Updates(listOf(embedded), …)`。

文件与 sha256 用 okio（`FileSystem` + `ByteString.sha256`），是本 artifact 独有的依赖，core 库不引入。ECDSA 验签走平台 API（§7）。

### 4.2 API 面

| 成员 | 语义 |
|---|---|
| `fun current(pkg: String): Bundle` | 构造时按包定死（§4.4），进程内不变 |
| `suspend fun check(): Map<String, CheckResult>` | 全部包各跑一遍 §4.3，彼此独立并行，一包失败不影响其他；同一实例串行，重入直接返回进行中的结果 |
| `suspend fun check(pkg: String): CheckResult` | 只查一个包 |
| `@Composable fun UpdatesPage(name, registry, sink, services, propsJson, modifier, error, onHost)` | 与 `TinyUIPage` 同参；`name` 是含包名的模块名，第一个 `/` 之前即包，`current(pkg).page(name)` → `TinyUIPage`；`error` 前先走 §4.5 的回退 |

`CheckResult`：`UpToDate` / `Installed(version)` / `Skipped(reason)` / `Failed(stage, cause)`。`UpdateEvent` 是同一组事实加 `Running` 与 `RolledBack`，给宿主打日志与埋点；**所有事件都带 `pkg`**。宿主的分析口径会依赖它，所以发布后字段同样只增不改：

| 事件 | 何时 | 字段（均含 `pkg`） |
|---|---|---|
| `Running` | 构造时每包一次 | `version`（内置或 installed 的 manifest `version`）、`source`：`EMBEDDED` / `INSTALLED` |
| `UpToDate` | `check()` | `version` |
| `Skipped` | `check()` | `version`、`reason`：`INCOMPATIBLE` / `FAILED_BEFORE` / `OLDER_THAN_EMBEDDED` / `ROLLOUT`；`INCOMPATIBLE` 附 `mismatch`：`NAME` / `ENGINE` / `PROTOCOL` / `RUNTIME_VERSION` 的集合 |
| `Installed` | `check()` | `version` |
| `Failed` | `check()` | `version`（manifest 解析失败时为空）、`stage`：`MANIFEST` / `SIGNATURE` / `DOWNLOAD` / `INTEGRITY` / `STORAGE`、`message`（`SIGNATURE` 时注明下载 manifest 的 `publicKey` 是否等于内置——区分被篡改与公钥已轮换） |
| `RolledBack` | §4.5 | `version`、`page`（模块名）、`kind`（`E2` / `E6`）、`buildId`、`message` |

这些字段由下面的遥测产品功能倒推而来；事件在库里定形，上报到哪里（宿主埋点、更新服务的控制台）是宿主的事。控制台的一切视图都按 (app, pkg) 切，采用率的分母 `install` 按 app 去重（ADR-006 §4.3）。

**遥测产品功能**（控制台按发布者的工作流排；"投递日志"指服务端对两种 GET 的计数）：

| 阶段 | 功能 | 看什么 | 数据 | 分期 |
|---|---|---|---|---|
| 发布后观察 | 采用曲线 | 每个 release 跑它的活跃设备占比随时间变化，多条叠看新版吃掉旧版 | `Running` 按 (pkg, version, day) 去重计数 | MVP |
| | 版本分布 | 此刻活跃设备各跑哪个 version、多少还在内置包 | `Running` 快照 | MVP |
| | 安装漏斗 | check → 中签 → 下载 → 校验 → 安装 → 生效，每级掉多少 | `Skipped(ROLLOUT)`、`Failed(DOWNLOAD / INTEGRITY)`、`Installed`、`Running` | MVP |
| | 下载量对照 | 服务端数到的 `<version>/` 下载次数 vs 客户端上报的 `Installed`，对不上即上报链路或 CDN 有问题 | 投递日志 + `Installed` | 二期 |
| 灰度决策 | 灰度命中率 | 中签比例是否贴近 `rollout`，偏离即宿主 `installId` 有问题 | `Skipped(ROLLOUT)` vs `Installed` | MVP |
| | 灰度期健康对比 | 灰度人群与内置包人群的回退率、失败率对比，决定推 100% 还是回滚 | `RolledBack`、`Failed` 按 version 分组 | MVP |
| | 拨杆就地操作 | 曲线旁直接改 `rollout` 或回滚指针（§6.2 的 UI 版） | 发布协议 | MVP |
| 止血 | 回退率告警 | `RolledBack / Installed` 超阈值即通知（webhook / 邮件） | `RolledBack`、`Installed` | 二期 |
| | 自动止血 | 超阈值自动把 rollout 拨 0 或指针退回上一个好版本，按包开关与阈值 | 同上 + 发布协议 | 二期 |
| | 失败原因分布 | `Failed` 按 stage、`Skipped` 按 reason 分布——发错目录、公钥没换、CDN 缓存坏各有各的形状 | `Failed.stage`、`Skipped.reason` | MVP |
| 排障 | 回退关联的页面错误 | `RolledBack` 的 kind / page / buildId 聚合，可对回 source map | `RolledBack` | 二期 |
| | 兼容性错配 | 各不匹配项各多少台；App 新版发出后旧 rv 还剩多少活跃设备，决定何时停发旧 rv | `Skipped.mismatch` | 二期 |
| | 按租户标识查询 | 租户在上报里自带用户 / 设备标识时，查该标识最近跑什么版本、有没有回退 | 上报里的 opaque 字段，服务端只存不解释 | 按需 |
| 健康巡检 | runtimeVersion 存量 | 每个 rv 还有多少活跃设备，哪些 rv 可停止维护 | `Running` 按 rv | 按需 |
| | 内置包占比 | 长期跑内置包的比例，高了说明 `check()` 没被调用或更新服务被网络策略挡了 | `Running.source` | 按需 |
| | 上报健康 | 遥测事件量与投递日志的比值 | 两者 | 按需 |

不在遥测范围内：页面级性能与业务埋点（宿主埋点的事，遥测只关心包的生命周期）；逐设备实时状态与远程操作（与"投递请求不带设备信息、客户端掷骰"相冲）。

### 4.3 `check(pkg)` 状态机

```
fetch <pkg>/<rv>/manifest.json ─解析失败──────────────────────────────▶ Failed(manifest)
  │
  ├─ signature 缺失或用内置 publicKey 验签失败 ────────────────────────▶ Failed(signature)   // 上报
  ├─ name ≠ pkg / runtimeVersion ≠ 宿主值 / engine ≠ QuickJs.upstreamCommit / protocol ≠ PROTOCOL
  │                                                                  ▶ Skipped(incompatible)   // 发错目录，上报
  ├─ version == installed.version 或 version ∈ failed ────────────────▶ UpToDate / Skipped(failed)
  ├─ createdAt ≤ embedded.createdAt ───────────────────────────────────▶ Skipped(older-than-embedded)
  ├─ hash(installId + ":" + pkg + ":" + version) % 100 ≥ rollout ─────▶ Skipped(rollout)
  │
  ▼ 逐文件 fetch <pkg>/<rv>/<version>/<file>.bin → <pkg>/staging/<version>/，每个核对 sha256
  ├─ 任一失败 ─删 staging──────────────────────────────────────────────▶ Failed(download | integrity)
  ▼ 写入 manifest.json，staging/<version> 改名 installed/<version>，state.installed = version，删其他 installed
  ▼ Installed(version)   // 下次启动生效
```

签名先于一切：签名不对的 manifest 里任何字段都不可信，包括 `rollout`。验签用的公钥永远是内置 manifest 的，下载 manifest 的 `publicKey` 不参与验签。掷骰以 `pkg` 与 `version` 为盐：每个包每次发布独立抽样（monorepo 里同一次 CI 产出的多个包 `version` 可能相同，不加 `pkg` 会让它们的灰度人群重合）；已装上的用户不因 `rollout` 下调而回退。

### 4.4 启动选择

存储布局，每包一份：

```
<dir>/<pkg>/state.json            { "installed": "<version>" | null, "failed": ["<version>", …] }   // failed 最多留 10 条
<dir>/<pkg>/staging/<version>/    下载中
<dir>/<pkg>/installed/<version>/  manifest.json + runtime/ + pages/
```

构造时对每个包：`installed` 存在、目录完整（manifest 里的每个文件都在）、`name` 等于包名、`runtimeVersion` 等于宿主值、不在 `failed`、`createdAt` 新于 `embedded` → `current(pkg) = installed`，否则 `= embedded`。`createdAt` 不新于内置的 installed 当场删除（App 升级带来了更新的内置包）；残留的 `staging/` 删除；`<dir>` 下不属于任何内置包的子目录删除（App 升级去掉了某个包）。不重算 sha256、不重验签：落盘前已核对，之后的损坏由 §4.5 兜底。

### 4.5 失败回退

`UpdatesPage` 挂的页面来自某包的 installed 且报 E2 / E6（`PageHost.failure`）时：该包 `failed += version`，`state.installed = null`，`onEvent(RolledBack)`，随后用该包的 `embedded.page(name)` 重挂同一页面（`TinyUIPage` 的 `remember` 键含 `page`，换 `PageModule` 即重建引擎）。E2 / E6 本身照常经 `PageSink.error` 上报，带 `buildId`。其他包不受影响。

页面来自 embedded 时的失败走宿主自己的 `error` 槽，与不用 `tinyui-updates` 时相同。

进程内已经挂在该包 installed 上的其他页面不动（各自独立 Runtime），下次启动统一回到 embedded。

## 5. 与既有契约的关系

- `PageHost` / `TinyUIPage` / patch 协议 / schema / `PageSink` 不变；`Updates` 全部搭在 `Bundle` 与 `TinyUIPage` 之上
- 引擎的 `JsEngineConfig.moduleLoader` 不接入：它服务页内 `import()`，不是页面级分发（ADR-006 §4.3）
- `PageError` 不加字段：`buildId` 已能定位到具体 build，`RolledBack` 事件带 `pkg` 与 `version`
- 跨包的 params / store / events 约定在 app-model.md §7，热下发只保证每个包内部一致

## 6. 发布协议

服务端实现的第二组端点，`tinyui-cli` 是它的客户端。所有请求 `Authorization: Bearer <token>`；发布 token 按 (app, pkg) 签发并限定可写的 channel 集合，只对该 app 该包的路径有效；管理端点用实例的 `ADMIN_TOKEN`。

服务端把内容按 (app, pkg, rv, version) 存一份，channel 只是指针：同一个 version 发到 staging 验证后，把 production 的指针指过去即是发布，不重传、不重签。内容 GET 路径里的 `<channel>` 段因此不参与寻址。

### 6.1 发布

| 请求 | 语义 | 服务端校验 |
|---|---|---|
| `PUT /<app>/<pkg>/<rv>/<version>/<path>`，body 为文件字节 | 上传内容 | 幂等；同路径已有不同内容 → 409（version 不可变） |
| `PUT /<app>/<channel>/<pkg>/<rv>/manifest.json`，body 为 manifest | 写指针，即发布 | token 覆盖该 channel；路径 `<pkg>` == `name`、`<rv>` == `runtimeVersion`；`publicKey` == 该包登记的公钥且签名有效（§7）；`files` 列出的每个文件已在 `<version>/` 下且 sha256 与 `hashes` 一致；通过后记录 release、切指针 |

顺序由 CLI 保证：内容先、指针后。指针请求在内容不齐时拒绝，所以乱序不会产生半个包。

`tinyui publish --url <实例> --app <app> --channel <c> --token <t> [--dir dist/ota]`：读 §1.2 的目录（包名从 manifest 来），先 PUT 全部文件（已存在的跳过），再 PUT manifest。

### 6.2 管理 release

| 请求 | 语义 |
|---|---|
| `GET /<app>/<pkg>/<rv>/releases` | 已发布的 version 列表：`createdAt`、各 channel 的指针与 `rollout` |
| `POST /<app>/<channel>/<pkg>/<rv>/pointer`，body `{ "version": …, "rollout"?: … }` | 指针指向 (app, pkg, rv) 下任一已发布 version——回滚与跨 channel 晋级是同一个操作；或只改当前指针的 `rollout` |

服务端按 version 保存每份已发布的 manifest，指针切换不需要重新上传；改 `rollout` 只改指针副本，签名不受影响（§7）。CLI：`tinyui releases list` / `rollback <version>` / `rollout <p>` / `promote <version> --to <channel>`。

### 6.3 管理 app 与包（`ADMIN_TOKEN`）

| 请求 | 语义 |
|---|---|
| `POST /apps`，body `{ "id", "name", "org"? }` | 建 app；`org` 是计费 / 归属用的可改字段，不进任何路径 |
| `POST /apps/<app>/packages`，body `{ "name", "publicKey" }` | 建包，登记验签公钥 |
| `PUT /apps/<app>/packages/<pkg>/publicKey` | 换公钥（轮换后旧包不再能发布，已发布的不受影响） |
| `POST /apps/<app>/packages/<pkg>/tokens`，body `{ "channels": [...] }` | 签发发布 token，只返回一次；服务端只存哈希 |
| `DELETE /apps/<app>/packages/<pkg>/tokens/<tokenId>` | 吊销 |

CLI：`tinyui apps create` / `tinyui packages create` / `tinyui tokens create` / `tinyui tokens revoke`。没有控制台，这就是全部管理面。

## 7. 签名

- 算法 **ECDSA P-256 + SHA-256**，签名值 DER 编码后 base64 写入 `signature`（Java 与 iOS 原生都出 / 收 DER；WebCrypto 是 r‖s，服务端验签前转一次，约 20 行）。选它而非 ed25519：两端零依赖——Android `java.security.Signature("SHA256withECDSA")`，iOS `Security.framework` 的 `SecKeyVerifySignature`（C API，Kotlin/Native 可调；ed25519 在 iOS 只有 Swift-only 的 CryptoKit）
- 被签内容：manifest 去掉 `signature` 与 `rollout` 后的规范化 JSON——键按字典序、无空白、值只有字符串 / 整数 / 数组 / 对象（RFC 8785 的这个子集两端各自实现，约 30 行）。`rollout` 排除是为了服务端能改灰度比例而不碰私钥；篡改它最多改变谁拿到一个本就合法的包。`name` 与 `runtimeVersion` 在签名内，所以一个包的产物不可能被发成另一个包或另一个 rv
- 公钥格式统一为 **X9.63 未压缩点（`04‖X‖Y`，65 字节）的 base64**：iOS `SecKeyCreateWithData` 直接收，WebCrypto `importKey("raw")` 直接收，Android 侧加固定 26 字节的 P-256 SPKI DER 头再交 `X509EncodedKeySpec`——三处都不用解析 PEM。`tinyui.config.json` 的 `publicKey`、manifest 的 `publicKey`、`POST /apps/<app>/packages` 的 `publicKey`、`keys generate` 的公钥输出都是它
- 密钥按 (app, pkg) 一对：`tinyui keys generate` 产私钥 PEM（PKCS#8）与上述格式的公钥。私钥只在该包发布方的 CI（`tinyui bundle --signing-key`）；公钥两处登记——包的 `tinyui.config.json`（随 build 进 manifest，随内置包进 App，是客户端的信任锚），服务端包记录（§6.3）。服务端永远接触不到私钥：token 被盗发不出客户端认的包，服务端被攻破发出的包客户端不认。一个团队持有的私钥只能签自己的包
- **下载的 manifest 里的 `publicKey` 永远不是信任来源**，客户端只拿它与内置的比对以给出诊断信息
- `channel` 不在被签内容里：同一份签名产物从 staging 晋级到 production 不重签；staging 与 production 的隔离靠 token 的 channel 范围（§6）
- 公钥轮换 = 改 `tinyui.config.json` → 新内置包随 App 发版 + 服务端 `PUT /apps/<app>/packages/<pkg>/publicKey`；旧 App 版本仍认旧公钥，所以轮换期间要用两把私钥各发一份，或者接受旧版本不再收到更新
