# 热下发：包、投递协议、发布协议与客户端

- 状态：已定（2026-09-18；2026-09-19 加发布协议、签名、服务端形态）；实现依据，实现待开
- 来源：[ADR-006](./adr-006-hot-updates.md)；[build-chain.md](./build-chain.md) §2（manifest）、§7（buildId 与 source map）
- 四侧：CLI 产出与发布包（`tinyui build` / `bundle` / `publish`）；服务端实现投递与发布两组端点（参考实现 `tinyui-updates-server`，托管实例 `updates.tinyui.app`）；Kotlin 的 `Bundle`（core 库）与 `Updates`（`wang.harlon:tinyui-updates`）
- 协议规范只在本文一处；服务端仓的一致性测试以本文为准，不复制。**字段与端点只增不改，未知字段透传**——这是两个仓能各自演进的前提

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
| `signature` | `tinyui bundle` | §7；覆盖除 `signature` 与 `rollout` 之外的全部字段 |
| `rollout` | `tinyui bundle`，服务端可改 | 0～100 的整数，缺省 100；投递策略，不在签名内 |

内置包的 manifest 没有 `runtimeVersion` / `signature` / `rollout`——宿主知道自己的 runtimeVersion，内置包不参与灰度、不验签。

### 1.2 `tinyui bundle`

```
tinyui bundle --runtime-version <rv> --signing-key <私钥 PEM> [--rollout <p>] [--out dist/ota]
```

读 `tinyui build` 的输出目录，写：

```
dist/ota/<rv>/manifest.json            build 的 manifest + runtimeVersion + signature + rollout
dist/ota/<rv>/<version>/runtime/*.bin
dist/ota/<rv>/<version>/pages/**/*.bin
```

这个目录是包的最终形态：交给 `tinyui publish` 上传，或者原样放到任何静态目录（§2.2）。`.js.map` 不进包，发布方归档 build 输出目录以便按 `buildId` 离线对映射（build-chain.md §7）。

## 2. 投递协议

客户端只会发两种 GET，路径相对宿主配置的 base URL：

| 路径 | 内容 | 缓存 |
|---|---|---|
| `<rv>/manifest.json` | 可变指针 | `Cache-Control: no-store` |
| `<rv>/<version>/<files[module]>.bin` | 不可变内容 | `Cache-Control: public, max-age=31536000, immutable` |

- 请求不带 query、不带自定义 header、不带任何设备信息；宿主的 `fetch` 实现可以自行加 header 或按路径分流到不同来源，库不知情
- 同一 `<version>` 目录下的文件永不改内容（改内容必换 version），CDN 因此不会陈旧
- 回滚 = 指针换回上一个好包的 manifest；灰度 = 改其中的 `rollout`
- 投递面没有鉴权：包在安装包里本来就能反出来；来源与完整性由签名（§7）保证

### 2.1 托管与私有化实例

`tinyui-updates-server`（独立仓，Cloudflare Workers 参考实现）实现本节与 §6。托管实例 `updates.tinyui.app`；私有化 = 部署同一份代码到自己的 Cloudflare 账号。租户与渠道折在 base URL 里：

```
base = https://updates.tinyui.app/<appId>/<channel>
```

`appId` 由实例管理员分配（§6.3），`channel` 由租户自定（`production` / `staging` / `dev`）。

### 2.2 静态目录

不需要服务端代码：把 §1.2 的 `dist/ota/` 放到任何能设缓存头的静态托管，base URL 指向它。没有发布协议、没有服务端验签，签名仍由客户端验。

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

`BuildManifest` 加 §1.1 各字段的解析，旧 manifest 缺字段时为空 / 100。内置包的 `BundleFiles` 由宿主用 `Res.readBytes` 实现；`Bundle` 不知道字节从哪来。

## 4. Kotlin：`Updates`（`tinyui-updates`）

主仓 Gradle 模块 `updates/`，与 `compose/` 同版本号同 tag 发 Maven。

### 4.1 宿主提供什么

```kotlin
class Updates(
    val embedded: Bundle,
    val runtimeVersion: String,
    publicKey: String,                           // §7，X9.63 裸点 base64；验签失败的包不装
    dir: Path,                                   // 宿主给的目录，如 Android filesDir/tinyui、iOS Application Support/tinyui
    installId: String,                           // 稳定的安装标识；库不生成、不持久化、不上传
    fetch: suspend (path: String) -> ByteArray,  // 宿主用自己的 HTTP 栈；path 是 §2 的相对路径，库已拼好 <rv>/ 前缀，宿主只拼 base
    onEvent: (UpdateEvent) -> Unit = {},
)
```

文件与 sha256 用 okio（`FileSystem` + `ByteString.sha256`），是本 artifact 独有的依赖，core 库不引入。ECDSA 验签走平台 API（§7）。

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
  ├─ signature 缺失或验签失败 ─────────────────────────────────▶ Failed(signature)   // 上报
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

签名先于一切：签名不对的 manifest 里任何字段都不可信，包括 `rollout`。掷骰以 `version` 为盐：每次发布独立抽样；已装上的用户不因 `rollout` 下调而回退。

### 4.4 启动选择

存储布局：

```
<dir>/state.json            { "installed": "<version>" | null, "failed": ["<version>", …] }   // failed 最多留 10 条
<dir>/staging/<version>/    下载中
<dir>/installed/<version>/  manifest.json + runtime/ + pages/
```

构造时：`installed` 存在、目录完整（manifest 里的每个文件都在）、`runtimeVersion` 等于宿主值、不在 `failed`、`createdAt` 新于 `embedded` → `current = installed`，否则 `current = embedded`。`createdAt` 不新于内置的 installed 当场删除（App 升级带来了更新的内置包）；残留的 `staging/` 删除。不重算 sha256、不重验签：落盘前已核对，之后的损坏由 §4.5 兜底。

### 4.5 失败回退

`UpdatesPage` 挂的页面来自 installed 且报 E2 / E6（`PageHost.failure`）时：`failed += version`，`state.installed = null`，`onEvent(RolledBack)`，随后用 `embedded.page(name)` 重挂同一页面（`TinyUIPage` 的 `remember` 键含 `page`，换 `PageModule` 即重建引擎）。E2 / E6 本身照常经 `PageSink.error` 上报，带 `buildId`。

页面来自 embedded 时的失败走宿主自己的 `error` 槽，与不用 `tinyui-updates` 时相同。

进程内已经挂在 installed 上的其他页面不动（各自独立 Runtime），下次启动统一回到 embedded。

## 5. 与既有契约的关系

- `PageHost` / `TinyUIPage` / patch 协议 / schema / `PageSink` 不变；`Updates` 全部搭在 `Bundle` 与 `TinyUIPage` 之上
- 引擎的 `JsEngineConfig.moduleLoader` 不接入：它服务页内 `import()`，不是页面级分发（ADR-006 §4.3）
- `PageError` 不加字段：`buildId` 已能定位到具体 build，`RolledBack` 事件带 `version`

## 6. 发布协议

服务端实现的第二组端点，`tinyui-cli` 是它的客户端。所有请求 `Authorization: Bearer <token>`；发布 token 按 app 发，只对该 app 的路径有效；管理端点用实例的 `ADMIN_TOKEN`。

### 6.1 发布

| 请求 | 语义 | 服务端校验 |
|---|---|---|
| `PUT /<appId>/<channel>/<rv>/<version>/<path>`，body 为文件字节 | 上传内容 | 幂等；同路径已有不同内容 → 409（version 不可变） |
| `PUT /<appId>/<channel>/<rv>/manifest.json`，body 为 manifest | 写指针，即发布 | 路径 `<rv>` == `runtimeVersion`；签名对该 app 登记的公钥有效（§7）；`files` 列出的每个文件已在 `<version>/` 下且 sha256 与 `hashes` 一致；通过后记录 release、切指针 |

顺序由 CLI 保证：内容先、指针后。指针请求在内容不齐时拒绝，所以乱序不会产生半个包。

`tinyui publish --url <实例> --app <appId> --channel <c> --token <t> [--dir dist/ota]`：读 §1.2 的目录，先 PUT 全部文件（已存在的跳过），再 PUT manifest。

### 6.2 管理 release

| 请求 | 语义 |
|---|---|
| `GET /<appId>/<channel>/<rv>/releases` | 已发布的 version 列表：`createdAt`、`rollout`、是否当前指针 |
| `POST /<appId>/<channel>/<rv>/pointer`，body `{ "version": …, "rollout"?: … }` | 指针指向某个已发布 version（回滚），或只改当前指针的 `rollout` |

服务端按 version 保存每份已发布的 manifest，指针切换不需要重新上传；改 `rollout` 只改指针副本，签名不受影响（§7）。CLI：`tinyui releases list` / `rollback <version>` / `rollout <p>`。

### 6.3 管理 app（`ADMIN_TOKEN`）

| 请求 | 语义 |
|---|---|
| `POST /apps`，body `{ "id", "name", "publicKey" }` | 建 app，登记验签公钥 |
| `PUT /apps/<id>/publicKey` | 换公钥（轮换后旧包不再能发布，已发布的不受影响） |
| `POST /apps/<id>/tokens` | 签发发布 token，只返回一次；服务端只存哈希 |
| `DELETE /apps/<id>/tokens/<tokenId>` | 吊销 |

CLI：`tinyui apps create` / `tinyui tokens create` / `tinyui tokens revoke`。没有控制台，这就是全部管理面。

## 7. 签名

- 算法 **ECDSA P-256 + SHA-256**，签名值 DER 编码后 base64 写入 `signature`（Java 与 iOS 原生都出 / 收 DER；WebCrypto 是 r‖s，服务端验签前转一次，约 20 行）。选它而非 ed25519：两端零依赖——Android `java.security.Signature("SHA256withECDSA")`，iOS `Security.framework` 的 `SecKeyVerifySignature`（C API，Kotlin/Native 可调；ed25519 在 iOS 只有 Swift-only 的 CryptoKit）
- 被签内容：manifest 去掉 `signature` 与 `rollout` 后的规范化 JSON——键按字典序、无空白、值只有字符串 / 整数 / 数组 / 对象（RFC 8785 的这个子集两端各自实现，约 30 行）。`rollout` 排除是为了服务端能改灰度比例而不碰私钥；篡改它最多改变谁拿到一个本就合法的包
- 公钥格式统一为 **X9.63 未压缩点（`04‖X‖Y`，65 字节）的 base64**：iOS `SecKeyCreateWithData` 直接收，WebCrypto `importKey("raw")` 直接收，Android 侧加固定 26 字节的 P-256 SPKI DER 头再交 `X509EncodedKeySpec`——三处都不用解析 PEM。`Updates(publicKey)`、`POST /apps` 的 `publicKey`、`keys generate` 的公钥输出都是它
- 密钥：`tinyui keys generate` 产私钥 PEM（PKCS#8）与上述格式的公钥。私钥只在发布方 CI（`tinyui bundle --signing-key`），公钥两处登记——宿主 App 的 `Updates(publicKey)`，服务端 app 记录（§6.3）。服务端永远接触不到私钥：token 被盗发不出客户端认的包，服务端被攻破发出的包客户端不认
- `channel` 不在被签内容里：staging 与 production 要隔离时用不同密钥对
- 公钥轮换 = App 发版换 `publicKey` + 服务端 `PUT /apps/<id>/publicKey`；旧 App 版本仍认旧公钥，所以轮换期间要用两把私钥各发一份，或者接受旧版本不再收到更新
