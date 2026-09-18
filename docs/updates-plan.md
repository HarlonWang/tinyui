# 热下发实施计划

- 状态：已定（2026-09-19）；进度在此更新，不回改 ADR-006 / updates.md
- 来源：[ADR-006](./adr-006-hot-updates.md)、[updates.md](./updates.md)；roadmap 第 7 条的展开
- 范围：四个仓（tinyui、tinyui-updates-server、quickjs-kmp、各 App 的 JS 工程与宿主）七个里程碑；每个里程碑独立验收、独立合入

## 依赖关系

```
quickjs-kmp: qjsc-kmp npm 平台包 ──────────────────────────┐ 只挡 M7 的 CI，不挡其他任何一步
                                                           │
tinyui:  M1 CLI 产包与签名 ──▶ M2 core Bundle ──▶ M3 updates 模块 ──▶ M6 TrendingAI 接入 ──▶ M7 第二个 App
                    │                                                     ▲
                    └──▶ tinyui-updates-server: M4 服务 MVP ──▶ M5 CLI publish / 管理 ──┘
```

M1 之后 M2 → M3 与 M4 并行；M6 要等 M3 与 M5。

## M1 · CLI：产包与签名

仓：tinyui，`packages/cli` + `packages/core`。约 300 行 / 6 文件，PR。

| 交付 | 要点 |
|---|---|
| `manifest.json` 加 `version` / `createdAt` / `engine` / `protocol` / `hashes` | `engine` 从第一个 `.bin` 的文件头读（`QJKB` 起偏移 12 的 40 字节 hex）；`protocol` 读 `tinyui-core/protocol` 子路径导出，core 包加这个入口 |
| `tinyui keys generate` | Node `crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })`；输出私钥 PKCS#8 PEM 与 X9.63 裸点 base64 公钥（updates.md §7） |
| `tinyui bundle --runtime-version --signing-key [--rollout] [--out]` | 规范化 JSON → `crypto.sign("sha256", …, { dsaEncoding: "der" })` → `dist/ota/<rv>/manifest.json` + `<rv>/<version>/…` |
| 测试 | 夹具目录 → 字段齐全、`hashes` 对得上、签名可用公钥验回、改 `rollout` 不破坏签名、`bundle` 拒绝缺 `engine` 的旧 manifest |

验收：`sample/js` 跑 `tinyui build && tinyui bundle`，产出目录用 `openssl dgst -sha256 -verify` 验过签名。

## M2 · core 库 `Bundle`

仓：tinyui，`compose/`。约 150 行，小 PR 或直接提交。

- `BuildManifest` 加新字段解析，缺字段时为空 / 100（旧 manifest 兼容）
- 新增 `BundleFiles` / `Bundle` / `LoadedPage`（updates.md §3）
- `sample/shared` 改用 `Bundle.load(files).page(name)`；TrendingAI `TinyUIHost.page()` 同样改法留到 M6
- commonTest：内存 `BundleFiles` 夹具；运行时只读一次；map 缺失时 `SourceMaps.EMPTY`

验收：sample 双端行为不变。

## M3 · `updates/` 模块

仓：tinyui，新 Gradle 模块，artifact `wang.harlon:tinyui-updates`。约 600 行 / 15 文件，PR。

| 交付 | 要点 |
|---|---|
| 模块骨架 | 依赖 `compose` + okio；复用 `build-logic` convention；publish.yml 加 artifact，与 `tinyui` 同版本同 tag |
| `Updates` | updates.md §4.1 构造参数；§4.3 状态机；`state.json`；staging → installed 改名；§4.4 启动选择 |
| 验签 expect/actual | Android：裸点加 26 字节 SPKI 头 → `KeyFactory("EC")` → `Signature("SHA256withECDSA")`；iOS：`SecKeyCreateWithData`（`kSecAttrKeyTypeECSECPrimeRandom`）→ `SecKeyVerifySignature(kSecKeyAlgorithmECDSASignatureMessageX962SHA256)`，cinterop 用 `platform.Security` |
| `UpdatesPage` | `current.page(name)` → `TinyUIPage`；E2 / E6 且来自 installed → 拉黑 + 换 embedded 重挂（§4.5） |
| 测试 | 假 `fetch` 按协议喂：签名错、engine 不匹配、旧于内置、rollout 不中、sha256 错、全通过各一条；启动选择四种情况；Android host 与 iOS simulator 各跑一遍验签 |
| sample | 一个开关把 base URL 指向本机 `python3 -m http.server` 起的 `dist/ota/`，手动验"下次启动生效"与回退 |

验收：sample 在 Android 与 iOS 模拟器上从本机静态目录装上新包、重启生效；故意发坏包（改一个 `.bin` 字节、或页面顶层 `throw`）能回退并收到 `RolledBack`。

## M4 · `tinyui-updates-server` MVP

仓：新建 `HarlonWang/tinyui-updates-server`，MIT。约 800 行。

| 交付 | 要点 |
|---|---|
| 建仓 | pnpm + Hono + wrangler；vitest 用 `@cloudflare/vitest-pool-workers`；Cloudflare Git 集成 push 即 deploy；README 写私有化步骤：fork → 建 KV / R2 → 设 `ADMIN_TOKEN` → `wrangler deploy` → `tinyui apps create` |
| 投递端点 | `GET /:app/:channel/:rv/manifest.json`（KV，`no-store`）、`GET /:app/:channel/:rv/:version/*`（R2，`immutable`） |
| 发布端点 | PUT 文件（幂等，冲突 409）；PUT manifest（token 归属 → WebCrypto 验签，DER → r‖s 转换 → `<version>/` 齐全且 sha256 一致 → 记 release、切指针） |
| 管理端点 | `/apps`、`/apps/:id/publicKey`、`/apps/:id/tokens`（`ADMIN_TOKEN` secret；token 只存 sha256，签发只返回一次） |
| release 端点 | `GET …/releases`、`POST …/pointer` |
| `Storage` 接口 | CF 适配器（KV + R2）+ 内存适配器（测试） |
| 一致性测试 | 用 `tinyui-cli` 产的夹具包按 updates.md §6 顺序打：先指针后内容被拒、坏签名被拒、token 跨 app 被拒、回滚后指针变化、改 rollout 后签名仍有效 |
| 部署 | `updates.tinyui.app`（DNS 在 Cloudflare）、KV namespace、R2 桶、`ADMIN_TOKEN` |

验收：本机 `wrangler dev` 起服务，M3 的 sample 把 base URL 换成它，整条链跑通。

## M5 · CLI 发布与管理

仓：tinyui，`packages/cli`。约 200 行。

`tinyui publish` / `apps create` / `tokens create|revoke` / `releases list|rollback|rollout`，全是对 M4 端点的薄封装；`--url` 缺省 `https://updates.tinyui.app`。测试对着内存适配器起的本地服务跑。

## M6 · TrendingAI 接入

- `trendingai-tinyui`：`keys generate`，私钥进 GitHub secret；CI 加 `bundle` + `publish` 到 `trendingai/production`；`pnpm sync` 仍提交内置包（同一次 build）
- 服务端：`apps create trendingai`（登记公钥）、发 token
- TrendingAI App：`TinyUIHost` 改用 `Updates(embedded, runtimeVersion = "1", publicKey, dir, installId = 埋点已有的安装 id, fetch = ktor)`；订阅页改用 `UpdatesPage`；App 启动后调 `check()`；`onEvent` 接埋点

验收：真机装线上包 → 发一个改文案的包 `rollout 100` → 重启看到；发坏包 → 看到回退与事件；`releases rollback` → 重启回到上一版。

## M7 · 第二个 App

流程同 M6。前置：quickjs-kmp 仓发 `qjsc-kmp` npm 平台包（CI 在 macOS / Linux 编宿主二进制，esbuild 模式发 `qjsc-kmp-<os>-<arch>`；`tinyui-cli` 的 `optionalDependencies` 引用；CLI 查找顺序加"平台包"一级，排在 `--qjsc` 与 `TINYUI_QJSC` 之后、PATH 之前）。

## 进度

| 里程碑 | 状态 |
|---|---|
| M1 CLI 产包与签名 | 待开 |
| M2 core `Bundle` | 待开 |
| M3 `updates/` 模块 | 待开 |
| M4 服务 MVP | 待开 |
| M5 CLI 发布与管理 | 待开 |
| M6 TrendingAI 接入 | 待开 |
| M7 第二个 App | 待开；前置 `qjsc-kmp` 平台包待开 |
