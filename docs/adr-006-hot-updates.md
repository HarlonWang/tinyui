# ADR-006 · 热下发：整包原子、宿主 runtimeVersion 为兼容键、内置包是地板

- 状态：已定（2026-09-18；2026-09-19 修订：服务端定为开源可私有化的托管服务，签名进 MVP，客户端与服务端分仓）；实现待开
- 结论：**一次 `tinyui build` 的完整产物是一个包，整包原子生效、下次启动切换；兼容键是宿主声明的 `runtimeVersion`，引擎 commit 与 patch 协议号只做校验；内置包永远是地板，下发包失败即回退内置并拉黑；库（独立 artifact `tinyui-updates`）只做校验 / 落盘 / 选择 / 回退，不做网络、调度、UI；服务端协议是两次 GET——可变指针 + 不可变内容，指针背后是静态文件还是动态端点客户端不关心；灰度靠 manifest 里的百分比 + 客户端掷骰；回滚 = 指针换回上一个好包；完整性 = 逐文件 sha256 + manifest 签名（ECDSA P-256，发布方持私钥）；服务端参考实现 `tinyui-updates-server` 独立开源仓、Cloudflare 为主、可私有化，托管实例 `updates.tinyui.app`**
- 契约（manifest 字段、投递与发布协议、签名、客户端状态机、API 面）：[updates.md](./updates.md)
- 影响：docs/README.md 首段与 ADR-005 决策表的"热下发不在本期"改为指向本文；roadmap D 组该项转入实现；build-chain.md §2 的 manifest 字段扩展

## 1. 背景

ADR-005 把热下发划出当期，条件是"内核稳定后另立 ADR"。TrendingAI 订阅页合入 main（2026-09-18）后，运行时 API、patch 协议、schema 链、错误上报都经过了一个真实页面的检验，内核算稳定。

现有设计已经把热下发需要的支点铺好了，本文是在这些支点上补"包的边界、兼容键、失败语义、库与宿主的分工"四条铁律：

| 支点 | 在哪 | 对热下发的意义 |
|---|---|---|
| 页面 = 模块 = 字节码 = 分发单元，自包含无共享 chunk | build-chain.md §3 | 分发单元不用再设计 |
| 字节码与字长无关、只绑引擎 commit，文件头自带 commit，加载时自校验 | quickjs-kmp `docs/decisions.md` | Android / iOS 共用同一份包；引擎不匹配是确定性的 E6 |
| `PROTOCOL` 在 K0 核对 → E6；schema 不匹配走 E5 跳过 + `Placeholder`；`__mount` 清单让 JS `host.has()` 降级 | patch-protocol.md §6–7、ADR-003 | 硬兼容 / 软兼容的分界已画好，热下发只需把硬的两条提前到下载前 |
| `PageHost` 只收字节，库零 I/O，读资源在宿主 | `PageHost.kt`、TrendingAI `TinyUIHost.kt` | 热下发对库来说是"多一个字节来源 + 选哪个" |
| release 不带 map，靠 `buildId` 离线对映射 | build-chain.md §7 | 错误上报链路不变 |

产物尺寸：`core.bin` 20 KB、`native.bin` 3 KB、页面 1～4 KB；十几页的 App 整包不到 100 KB。

## 2. 候选与取舍

### 2.1 包的粒度

| | 整包（运行时 + 全部页面） | 按页独立发 |
|---|---|---|
| 业界 | Expo Updates、CodePush | Lynx / Kuikly 的模板包 |
| 运行时与页面的匹配 | 天然一致，问题不存在 | 版本矩阵：页面要声明需要哪个运行时，或运行时另走一条分发 |
| 跨页 params 契约 | 同一次 build，一致 | 可能漂 |
| 代价 | 多传几十 KB | 分发系统复杂一个量级 |

选整包。"页面是分发单元"（build-chain.md §3）说的是自包含，与"一次发全部单元"不冲突。

### 2.2 兼容键

| | 宿主声明 `runtimeVersion`（Expo 规则） | 多维匹配（引擎 commit × tinyui 版本 × 宿主 schema 哈希） | semver 范围 |
|---|---|---|---|
| 规则 | 宿主承诺"同 runtimeVersion 下任何包都能跑"，改了宿主组件 / 能力 / 升了 tinyui 就 bump | 服务端按多维求交 | 包声明 `>=1.2 <2` |
| 谁负责判断 | 人（发版时） | 服务端逻辑 | 客户端解析 |
| 静态托管可行 | 是（作路径） | 否 | 勉强 |

选 runtimeVersion，它同时是服务端目录名。`engine`（引擎 commit）与 `protocol` 写进 manifest 只做校验，防"发错目录"这种人为错误，不参与匹配逻辑。

### 2.3 生效时机

| | 下次启动（Expo 默认） | 下次进页面 | 无活页时立即切 |
|---|---|---|---|
| 一致性 | 一个进程一个包 | 同一会话里旧页 push 新页，params 契约可能漂 | 一个进程内切换，但要追踪活页 |
| 实现 | `current` 构造时定死 | 每次 `page()` 重选 | 计数活 PageHost |

选下次启动。"无活页即切"留触发条件（用户第二次打开才见到更新成为运营问题）。

### 2.4 库的边界

库做校验、落盘、选择、回退；不做网络（收宿主的 `fetch(path)`）、不做调度（宿主决定何时 `check()`）、不做 UI（没有"有更新"弹窗）。放独立 artifact `wang.harlon:tinyui-updates`：core 库保持零 I/O、零文件依赖；不需要热下发的宿主直接不依赖它。

### 2.5 服务端形态

| 路线 | 形态 | 评价 |
|---|---|---|
| 纯静态目录 | 对象存储 / CDN | 零代码，服务端不能做决策 |
| 专用更新服务 | `GET /updates?runtimeVersion&platform&appVersion&deviceId…`（Expo 协议、CodePush、Shorebird） | 能力全，但客户端协议绑死服务端实现，每个宿主得自建一套 |
| 托管 SaaS | EAS Update / App Center CodePush / Shorebird | 各绑各的客户端；CodePush 2025 已退役。排除 |
| **两次 GET，指针与内容分离** | 客户端只 `fetch(相对路径)`：一次拿 `manifest.json`（可变，`no-store`），N 次拿 `<version>/<file>`（不可变，`immutable`） | 静态目录是最小实现，动态端点是同协议下的服务端升级，客户端不改 |

选最后一种。库只定义"客户端会请求什么路径"，不定义"服务端怎么决定"——这是 §2.4 在服务端的投影。请求不带任何设备 / 版本信息；租户与渠道（staging / production）折在 base URL 里，库没有 appId / channel 概念；定向发布不做，"能不能跑"归 runtimeVersion，"想不想给"要做就 bump runtimeVersion 或宿主在自己的 `fetch` 里加 header 让服务端判，库不知情。

### 2.6 服务端实现放哪

投递协议定了之后，服务端代码的归属是另一个问题。首批租户有两个（TrendingAI 与第二个 App），而且从第一天就是两个不同后端栈的 App。

| | A 各宿主自己写路由 | B npm 包挂进宿主后端 | **C 独立服务，开源可私有化** |
|---|---|---|---|
| 两个租户 | 两份实现 | Java 后端挂不进 npm 包 | 各配一个 base URL |
| 发布面 | 无，靠上传脚本 | 包里定义 | 服务定义，CLI `tinyui publish` 直连 |
| 私有化 | — | 只能挂进 Node 后端 | 部署同一份代码到自己的 Cloudflare 账号 |
| 挡住什么 | CLI 直发；SaaS 期两份实现要保持一致 | 包必须运行时无关 | 投递 URL 形态一经发布不能变（旧 App 版本永远打它） |

选 C。独立仓 `tinyui-updates-server`，Hono（Fetch API 之上的薄路由，Workers 原生、Node / Bun / Deno 同一份代码可跑），存储只用 KV + R2——绑定越少，私有化越接近一条 `wrangler deploy`；存储收在 `Storage` 接口后，D1（触发：控制台需要跨维度查询）与文件系统 + SQLite 的 Node 适配器（触发：出现非 Cloudflare 的私有化需求）各带触发条件。管理面先不做控制台：`ADMIN_TOKEN` 作 Worker secret + CLI。静态目录自托管在协议上仍然合法，是不想跑服务的人的出口。

许可证：服务端仓与主仓一致用 MIT；托管实例对外提供前重评（AGPL 能挡"拿它开托管服务"，私有化部署不受影响；单作者可对新版本换许可证）。

### 2.7 仓边界：客户端在主仓，服务端独立

判据是"和谁一起变、和谁一起发、谁来克隆"：`tinyui-updates` 直接依赖 core 库的 `Bundle` / `BuildManifest`，与 core 同一次 PR 改、同版本号同 tag 发 Maven，属于主仓（Gradle 模块 `updates/`）；服务端只依赖协议、push 即部署没有版本号、私有化部署者要的是克隆一个 Worker 仓而不是带 Gradle 与 Xcode 的框架仓。Expo / CodePush / Capgo / Sentry 全部是 SDK 与服务分仓。代价是协议改动要跨仓协调，用"字段只增不改、未知字段透传、规范只在 updates.md 一处"压到可忽略。否掉"新开一个仓同放客户端与服务端"：客户端离开 core 后，`Bundle` 每动一次就是一轮跨仓发版。

### 2.8 灰度与回滚

灰度：manifest 带 `rollout` 百分比，客户端用宿主给的稳定 `installId` 哈希落桶（CodePush 做法）。静态托管也能灰度，是"全量推坏包"这一最大风险的止血阀，v1 就做。代价是库多收一个 `installId`（宿主给，库不生成不持久化、不上传）。

回滚：只有"把指针改回上一个好包"。启用规则是"≠ installed 且新于内置"而不是"新于 installed"，所以指针回退天然可行；服务端按 version 保存已发布的 manifest，回滚不重新上传。Expo 的 `rollBackToEmbedded` 指令不做：服务端不知道每个 App 版本内置的是哪个包，多 App 版本共存时该语义本来就含糊。

### 2.9 完整性与来源

逐文件 sha256 锁内容，manifest 签名锁来源。签名进 MVP 而不推迟：租户从托管实例拉可执行代码，实例对租户就是"不受自己控制的第三方"，HTTPS + sha256 过不了任何安全评审。私钥只在发布方 CI，服务端登记公钥并在发布时验签，客户端再验一次——token 被盗发不出客户端认的包，服务端被攻破发出的包客户端不认，服务永远只是搬运工。算法 ECDSA P-256 + SHA-256：Android `java.security`、iOS `Security.framework` C API 两端零依赖；ed25519 在 iOS 只有 Swift-only 的 CryptoKit，Kotlin/Native 调不到。

## 3. 决策

| 项 | 结论 |
|---|---|
| 包 | 一次 `tinyui build` 的完整产物（`runtime/*.bin` + `pages/**/*.bin` + `manifest.json`），整包原子生效；不做单页下发、不做 zip、不做 diff |
| 兼容键 | 宿主声明的 `runtimeVersion`，作服务端路径；`engine` / `protocol` 只校验 |
| 启用规则 | 下发包 `version ≠ installed` 且 `createdAt` 新于内置才装；App 升级带来更新的内置包时自动弃掉 installed；不能用下发把 App 降到比内置更老 |
| 生效时机 | 下次进程启动 |
| 失败语义 | 下发包的页面报 E2 / E6 → 当场用内置包重挂这一页，整包持久化拉黑并上报；E5 不算失败。一个 (runtime, page) 对永远来自同一个包；不同页面可以短暂来自不同包（各自独立 Runtime） |
| 库的边界 | `tinyui-updates` 独立 artifact；做校验 / 落盘 / 选择 / 回退；不做网络、调度、UI；宿主给 `fetch(path)`、`installId`、存储目录、`runtimeVersion` |
| 服务端协议 | 两次 GET；`<base>/<runtimeVersion>/manifest.json`（`no-store`）+ `<base>/<runtimeVersion>/<version>/…`（`immutable`）；请求不带参数；渠道靠 base URL |
| 灰度 | manifest `rollout` 百分比，客户端按 `installId` 掷骰 |
| 回滚 | 重发上一个好包；无 `rollBackToEmbedded` |
| 完整性 | 逐文件 sha256 + manifest 签名（ECDSA P-256）；发布方持私钥，服务端与客户端各验一次 |
| CLI | `tinyui build` 的 manifest 加 `version` / `createdAt` / `engine` / `protocol` / `hashes`；`tinyui bundle --runtime-version --signing-key` 产出签名后的上传目录；`tinyui publish` 走发布协议；`keys` / `apps` / `tokens` / `releases` 子命令是全部管理面 |
| 服务端 | 独立开源仓 `tinyui-updates-server`（MIT，托管前重评）：Hono，KV + R2，`Storage` 接口后置；托管实例 `updates.tinyui.app`，私有化 = 部署同一份代码；没有控制台 |
| 仓边界 | `tinyui-updates` 在主仓 `updates/` 模块，与 core 同版本发；服务端独立仓；协议只写在 updates.md，字段只增不改 |

## 4. 后果

### 4.1 应用商店政策

App Store Review Guidelines 2.5.2 只豁免由 WebKit / JavaScriptCore 执行的下载代码，QuickJS 不在名单里。React Native + Hermes 的 CodePush、字节的 Lynx 实践上未被拦，但这是"事实容忍"不是"规则允许"。F-Droid 收录政策对运行时下载并执行代码有限制（原文措辞待核对）。

### 4.2 首批租户

TrendingAI 与第二个 App 都作为 `updates.tinyui.app` 的租户接入，各自一个 `appId`、自己的密钥对、自己 bump 的 `runtimeVersion`；宿主后端不需要任何改动，只配 base URL。发布由各自 JS 工程的 CI 完成：`tinyui bundle --signing-key` → `tinyui publish`。内置包与下发包来自同一次 build，`version` 一致（TrendingAI：`pnpm sync` 提交进 App 的那份）。

### 4.3 推迟项（记 roadmap D 组）

| 项 | 触发条件 |
|---|---|
| 无活页时立即切换 | "第二次打开才见到更新"成为运营问题 |
| `rollBackToEmbedded` 指令 | 必须让所有用户立刻回内置、又没有可发的好包 |
| 服务端定向灰度（按用户属性） | 百分比灰度不够用 |
| 控制台 | CLI 管理面不够用（多人协作、非开发者操作回滚） |
| 遥测（客户端上报 `UpdateEvent`） | 控制台需要采用率与回退率。定了做法（2026-09-19）：服务端接 eventbase（`createIngest` / `createQuery` 挂进 tinyui-updates-server，租户各一个 appKey，`active` 即采用率分母，按 props 切片先走 `POST /sql`；投递日志用 `createTracker`），协议归 eventbase 仓 `docs/protocol.md`，本仓只引用；客户端 `tinyui-updates` 不依赖 eventbase-kt，提供按该协议格式化的 `EventbaseTelemetry(send)` 适配器（`install` = `sha256(installId + appId)`，无队列），已用 eventbase-kt 的宿主直接把 `onEvent` 桥到 `track`。前置：eventbase 加租户级取数（按 appKey 作用域的 token） |
| 服务端 D1 | 控制台需要跨维度查询；遥测立项时随 eventbase 的 migrations 到位 |
| 非 Cloudflare 的私有化适配器（文件系统 + SQLite，Docker 镜像） | 出现非 Cloudflare 的私有化需求 |
| 计费与计费身份（opt-in 的安装标识 header，宿主 `fetch` 加、库不知情） | 托管实例对外收费；业界参照见 §4.4 |
| 单页独立下发 | 两个团队要各自独立发页面 |
| 增量传输 | 整包超过 1 MB |
| 页内 `import()` 懒加载（接 `JsEngineConfig.moduleLoader`） | 出现单页字节码过大的页面 |

### 4.4 计费的业界参照：Expo EAS Update（2026-09-19 抄自 expo.dev/pricing）

| 档 | 月费 | 更新 MAU | 边缘带宽 | 存储 | 端到端代码签名 |
|---|---|---|---|---|---|
| Free | $0 | 1,000 | 100 GiB | 20 GiB | 无 |
| Starter | $19 + 超量 | 3,000 | 100 GiB，超量 $0.10/GiB | 20 GiB，超量 $0.05/GiB | 无 |
| Production | $199 + 超量 | 50,000 | 1 TiB | 1 TiB | 有 |
| Enterprise | 定制 | 1,000,000+ | 40 TiB | 10 TiB | 有 |

- 计费单位是 MAU（计费周期内至少下载过一次更新的用户；同一用户多次下载算 1 个；只检查不下载不算），更新次数不限。单位跟租户业务规模走、不惩罚频繁发版，也不需要客户端上传包大小之类的数据——与 §4.3"计费身份只是一个 opt-in header"的形态相容。
- 代码签名被当作 $199 档以上的付费分层点。tinyui 把签名放进 MVP（§2.9）且服务端开源，这是相对 EAS 的差异点，不能反过来拿签名做分层。
- Expo 同时保留免费出口：`expo-updates` 协议公开，`updates.url` 指自建服务器即可脱离 EAS（官方 `custom-expo-updates-server` 示例仓）。对应本文 §2.5 的静态目录自托管与 §2.6 的私有化部署。

### 4.5 不变的东西

ADR-001～005 不动；`PageHost` / `TinyUIPage` 签名不变；patch 协议、schema 生成链、错误上报不变；quickjs-kmp 引擎不改（`engine` 从字节码文件头读，`QuickJs.upstreamCommit` 已有）；`qjsc-kmp` 二进制分发是构建链事项，见 roadmap D 组。
