# 热下发实施计划

- 状态：已定（2026-09-19；同日按多包模型修订）；进度在此更新，不回改 ADR-006 / updates.md
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

仓：tinyui，`packages/cli` + `packages/core` + `sample/js`。约 400 行 / 8 文件，PR。

| 交付 | 要点 |
|---|---|
| `tinyui.config.json` | 工程根，`name`（`[a-z0-9-]+`，必填）/ `publicKey`（必填）/ `pages`（缺省 `src/pages`）；`build` 无配置文件即报错 |
| 模块名改 `<pkg>/<相对路径>` | esbuild 入口 → `-n <pkg>/home`，`import.meta.url = tinyui:<pkg>/home`；manifest 的 `pages` / `files` / `buildIds` / `hashes` 键随之改；sample 包名 `sample`，`sample/shared` 与 CLI 测试里的 `pages/…` 全部改 |
| `manifest.json` 加 `name` / `publicKey` / `version` / `createdAt` / `engine` / `protocol` / `hashes` | `name` / `publicKey` 抄配置；`engine` 从第一个 `.bin` 的文件头读（`QJKB` 起偏移 12 的 40 字节 hex）；`protocol` 读 `tinyui-core/protocol` 子路径导出，core 包加这个入口 |
| `tinyui keys generate` | Node `crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })`；输出私钥 PKCS#8 PEM 与 X9.63 裸点 base64 公钥（updates.md §7） |
| `tinyui bundle --runtime-version --signing-key [--rollout] [--out]` | 规范化 JSON → `crypto.sign("sha256", …, { dsaEncoding: "der" })` → `dist/ota/<pkg>/<rv>/manifest.json` + `<pkg>/<rv>/<version>/…`；签名私钥的公钥必须等于 manifest 的 `publicKey`，否则拒绝 |
| 测试 | 夹具目录 → 字段齐全、模块名带包名、`hashes` 对得上、签名可用公钥验回、改 `rollout` 不破坏签名、私钥与 `publicKey` 不配对被拒、缺配置文件被拒 |

验收：`sample/js` 跑 `tinyui build && tinyui bundle`，双端显示 `tinyui:sample/home`，产出目录用 `openssl dgst -sha256 -verify` 验过签名。

## M2 · core 库 `Bundle`

仓：tinyui，`compose/`。约 150 行，小 PR 或直接提交。

- `BuildManifest` 加新字段解析，`name` / `publicKey` 缺失即解析失败，`rollout` 缺省 100
- 新增 `BundleFiles` / `Bundle` / `LoadedPage`（updates.md §3），`Bundle.name`
- `sample/shared` 改用 `Bundle.load(files).page(name)`，资源目录改为 `files/tinyui/<pkg>/`；TrendingAI `TinyUIHost.page()` 同样改法留到 M6
- commonTest：内存 `BundleFiles` 夹具；运行时只读一次；map 缺失时 `SourceMaps.EMPTY`

验收：sample 双端行为不变。

## M3 · `updates/` 模块

仓：tinyui，新 Gradle 模块，artifact `wang.harlon:tinyui-updates`。约 600 行 / 15 文件，PR。

| 交付 | 要点 |
|---|---|
| 模块骨架 | 依赖 `compose` + okio；复用 `build-logic` convention；publish.yml 加 artifact，与 `tinyui` 同版本同 tag |
| `Updates` | updates.md §4.1 构造参数（`packages: List<Bundle>`，重名 / engine 不符构造抛错）；§4.3 状态机按包各跑，`check()` 并行；`<dir>/<pkg>/state.json`；staging → installed 改名；§4.4 启动选择，含清理不属于任何内置包的目录 |
| 验签 expect/actual | Android：裸点加 26 字节 SPKI 头 → `KeyFactory("EC")` → `Signature("SHA256withECDSA")`；iOS：`SecKeyCreateWithData`（`kSecAttrKeyTypeECSECPrimeRandom`）→ `SecKeyVerifySignature(kSecKeyAlgorithmECDSASignatureMessageX962SHA256)`，cinterop 用 `platform.Security` |
| `UpdatesPage` | `name` 取第一个 `/` 前为包 → `current(pkg).page(name)` → `TinyUIPage`；E2 / E6 且来自该包 installed → 拉黑 + 换该包 embedded 重挂（§4.5） |
| 测试 | 假 `fetch` 按协议喂：签名错（含公钥轮换的诊断信息）、`name` 不匹配、engine 不匹配、旧于内置、rollout 不中、sha256 错、全通过各一条；两个包一坏一好互不影响；启动选择四种情况 + 清理被去掉的包；Android host 与 iOS simulator 各跑一遍验签 |
| sample | 第二个包 `sample-extra`（一页即可）验多包；一个开关把 base URL 指向本机 `python3 -m http.server` 起的 `dist/ota/`，手动验"下次启动生效"与回退 |

验收：sample 在 Android 与 iOS 模拟器上从本机静态目录装上新包、重启生效；故意给一个包发坏包（改一个 `.bin` 字节、或页面顶层 `throw`）能回退并收到带 `pkg` 的 `RolledBack`，另一个包不受影响。

## M4 · `tinyui-updates-server` MVP

仓：新建 `HarlonWang/tinyui-updates-server`，MIT。约 800 行。

| 交付 | 要点 |
|---|---|
| 建仓 | pnpm + Hono + wrangler；vitest 用 `@cloudflare/vitest-pool-workers`；Cloudflare Git 集成 push 即 deploy；README 写私有化步骤：fork → 建 KV / R2 → 设 `ADMIN_TOKEN` → `wrangler deploy` → `tinyui apps create` → `tinyui packages create` |
| 投递端点 | `GET /:app/:channel/:pkg/:rv/manifest.json`（KV，`no-store`）、`GET /:app/:channel/:pkg/:rv/:version/*`（R2，键为 (app, pkg, rv, version, path)，`channel` 不参与寻址，`immutable`） |
| 发布端点 | `PUT /:app/:pkg/:rv/:version/*`（幂等，冲突 409）；`PUT /:app/:channel/:pkg/:rv/manifest.json`（token 归属与 channel 范围 → `name` == `:pkg`、`runtimeVersion` == `:rv`、`publicKey` == 登记值 → WebCrypto 验签，DER → r‖s 转换 → `<version>/` 齐全且 sha256 一致 → 记 release、切指针） |
| 管理端点 | `/apps`（含可改 `org` 字段）、`/apps/:app/packages`、`/apps/:app/packages/:pkg/publicKey`、`/apps/:app/packages/:pkg/tokens`（带 `channels`；`ADMIN_TOKEN` secret；token 只存 sha256，签发只返回一次） |
| release 端点 | `GET /:app/:pkg/:rv/releases`、`POST /:app/:channel/:pkg/:rv/pointer`（回滚与跨 channel 晋级同一操作） |
| `Storage` 接口 | CF 适配器（KV + R2）+ 内存适配器（测试） |
| 一致性测试 | 用 `tinyui-cli` 产的夹具包按 updates.md §6 顺序打：先指针后内容被拒、坏签名被拒、`name` 与路径不符被拒、token 跨包 / 跨 channel 被拒、staging 发布后 production 指针晋级不重传、回滚后指针变化、改 rollout 后签名仍有效 |
| 部署 | `updates.tinyui.app`（DNS 在 Cloudflare）、KV namespace、R2 桶、`ADMIN_TOKEN` |

验收：本机 `wrangler dev` 起服务，M3 的 sample 把 base URL 换成它，整条链跑通。

## M5 · CLI 发布与管理

仓：tinyui，`packages/cli`。约 200 行。

`tinyui publish` / `apps create` / `packages create` / `tokens create|revoke` / `releases list|rollback|rollout|promote`，全是对 M4 端点的薄封装；`--url` 缺省 `https://updates.tinyui.app`。测试对着内存适配器起的本地服务跑。

## M6 · TrendingAI 接入

- `trendingai-tinyui`：加 `tinyui.config.json`（`name: "subscription"`，公钥），页面模块名从 `pages/…` 改为 `subscription/…`；`keys generate`，私钥进 GitHub secret；CI 加 `bundle` + `publish` 到 `trendingai/production`；`pnpm sync` 仍提交内置包（同一次 build）
- 服务端：`apps create trendingai`、`packages create --app trendingai subscription`（登记公钥）、发限 `production` 的 token
- TrendingAI App：`TinyUIHost` 改用 `Updates(listOf(embedded), runtimeVersion = "1", dir, installId = 埋点已有的安装 id, fetch = ktor)`；路由表与 `navigation.push` 目标改用新模块名；订阅页改用 `UpdatesPage`；App 启动后调 `check()`；`onEvent` 接埋点

验收：真机装线上包 → 发一个改文案的包 `rollout 100` → 重启看到；发坏包 → 看到回退与事件；`releases rollback` → 重启回到上一版。

## M7 · 第二个 App

流程同 M6，按业务线分包，每包一个 JS 工程、一对密钥、一个 token；宿主一个 `Updates` 装全部内置包。前置：quickjs-kmp 仓发 `qjsc-kmp` npm 平台包（CI 在 macOS / Linux 编宿主二进制，esbuild 模式发 `qjsc-kmp-<os>-<arch>`；`tinyui-cli` 的 `optionalDependencies` 引用；CLI 查找顺序加"平台包"一级，排在 `--qjsc` 与 `TINYUI_QJSC` 之后、PATH 之前）。

## 进度

| 里程碑 | 状态 |
|---|---|
| M1 CLI 产包与签名（含配置文件与模块名改名） | 待开 |
| M2 core `Bundle` | 待开 |
| M3 `updates/` 模块 | 待开 |
| M4 服务 MVP | 待开 |
| M5 CLI 发布与管理 | 待开 |
| M6 TrendingAI 接入 | 待开 |
| M7 第二个 App | 待开；前置 `qjsc-kmp` 平台包待开 |
