# domain-whiz · 域名小能手

---

## 1.

```bash
# 1. 装依赖（.npmrc 设了 ignore-scripts，只装 JS 依赖，不跑原生编译）
npm install

# 2. 首次初始化：补两个原生二进制（不需要 C++ 编译器）
#    a) Electron 可执行文件
node node_modules/electron/install.js
#    b) sqlite3 的 N-API 预编译二进制（@cursor/sdk 依赖；跨 Node/Electron 通用）
#       Windows PowerShell：
cd node_modules/sqlite3 ; ../.bin/prebuild-install --runtime napi --target 6 ; cd ../..
#       macOS / Linux：
# (cd node_modules/sqlite3 && ../.bin/prebuild-install --runtime napi --target 6)

# 3. 启动开发模式（electron-vite + Electron 主窗口）
npm run dev

# 4. 编辑 desktop.config.json 填好 Cursor API Key + 飞书 appId/appSecret + approvals 字段映射；进入「部署」给至少一台服务器配 SSH 私钥
```

> **为什么要手动补二进制？** 仓库根 `.npmrc` 设了 `ignore-scripts=true`，让 `npm install` 跳过原生模块（如 `sqlite3`）的 `node-gyp` 编译——否则在没有 Visual Studio C++ 工具链的 Windows 机器上会安装失败。代价是 Electron 二进制下载和 sqlite3 预编译包也被跳过，需如上手动补一次（之后无需重复）。

> **没有「设置」页**——所有配置项都直接写 `desktop.config.json`（含 Cursor API Key 与飞书凭据）。
> 服务器管理在「部署」页里做；飞书审批通过在「建站」对话里输入关键字调起。

打开窗口后顶部 3 个 tab：

| Tab | 做什么 |
|---|---|
| **建站** | 三种交互融合在同一个对话窗里：① `AI 全量生成`（单域名，多轮对话从零生成 / 增量改站，**不参考模板**）；② `模板批量生成`（多域名按模板复制 + 关键字替换 + AI 只生成 Logo）；③ 输入「<域名…> 域名购买」/「<域名> 域名解析」会自动弹出飞书审批卡片，预填域名，点「确认提交到飞书审批」即调接口。 |
| **网站库** | 平铺展示 `sites/` 与 `templates/` 的所有站点；hover 出预览/部署按钮，支持批量部署。 |
| **部署** | 服务器管理（新增 / 编辑 / 导入私钥）+ 部署日志列表。 |

完整命令：

```bash
npm run dev                # 开发模式（仅 electron-vite）
npm run typecheck          # tsc --noEmit
npm run build              # 产出 apps/desktop/out/
npm run dist:win           # build + electron-builder 打 Windows 安装包（NSIS）
npm run dist:mac           # build + electron-builder 打 macOS 安装包（dmg + zip，需在 Mac 上跑）
npm run deploy:batch       # 命令行批量部署（见下方）
```

---

## 2. 仓库地图

```text
domain-whiz/
├─ apps/desktop/                    # Electron 应用（electron-vite 三分包）
│  ├─ electron.vite.config.ts
│  ├─ resources/icon.png
│  └─ src/
│     ├─ main/                      # 主进程（Node、文件系统、SSH、Cursor SDK）
│     │  ├─ index.ts                # app whenReady → 注册 IPC、开窗口
│     │  ├─ ipc.ts                  # 所有 ipcMain.handle 入口
│     │  ├─ chat.ts                 # AI 对话建站（chat:run，含两种模式）
│     │  ├─ siteBatch.ts            # 模板批量：复制 + __DOMAIN__/__BRAND__ 替换 + 策略挑模板
│     │  ├─ catalog.ts              # 列出 sites/templates + logo dataURL
│     │  ├─ deployService.ts        # 异步部署任务 + 进度广播 + 日志落盘
│     │  ├─ deployServers.ts        # 服务器解析 / 就绪状态检查
│     │  ├─ deployConstants.ts      # ⭐ 远端 web 根 / nginx 目录在这里写死
│     │  ├─ servers.ts              # 服务器 CRUD + 导入私钥
│     │  ├─ previewWindow.ts        # 预览用独立 BrowserWindow
│     │  ├─ config.ts               # desktop.config.json 读写 + 默认值
│     │  ├─ paths.ts                # 安装目录 / sites / templates 路径
│     │  └─ taskLifecycle.ts        # chat:run 的 AbortController 容器
│     ├─ preload/index.ts           # contextBridge 暴露 window.dw IPC 表面
│     └─ renderer/src/              # React 19 + antd 5
│        ├─ App.tsx                 # 顶部胶囊导航 + 路由（仅 建站 / 网站库 / 部署 三个 Tab）
│        ├─ BuildChat.tsx           # 「建站」对话 UI（含 AI 全量 / 模板批量 / 飞书审批意图识别 → 卡片）
│        ├─ ApprovalCard.tsx        # 对话内嵌的飞书审批卡片：PurchaseApprovalCard / ResolveApprovalCard
│        ├─ CatalogPanel.tsx        # 「网站库」卡片网格 + 部署 Modal
│        ├─ DeployPanel.tsx         # 「部署」服务器管理 + 日志查看
│        ├─ chatCommon.tsx          # ChatBubble / ChatMessage（已加 cardKind 字段）
│        ├─ store.ts                # zustand store（只持 config）
│        └─ global.d.ts             # window.dw 类型 + DTO
│
├─ packages/
│  ├─ generator/                    # @cursor/sdk 封装
│  │  ├─ src/index.ts               # runStaticSiteGenerate（整站 AI 从零生成，不参考模板）
│  │  ├─ src/logo.ts                # generateDomainLogoSvg（仅 logo 的 AI，批量模式专用）
│  │  └─ src/constraints.ts         # 程序化广告 / 全英文界面 + Logo 设计简报 + brand slug/stem 工具
│  ├─ deployer/                     # ssh2-sftp-client 封装
│  │  └─ src/index.ts               # deploySiteWithNginx（站点 + nginx + reload）
│  └─ feishu/                       # 飞书开放平台封装
│     ├─ src/client.ts              # FeishuClient（tenant_access_token 自动续期）
│     ├─ src/approval.ts            # 创建 / 查询 / 撤销审批实例
│     ├─ src/message.ts             # 发文本 / 发交互式卡片
│     └─ src/types.ts               # ApprovalKind / Status / Config 共享类型
│
├─ scripts/
│  ├─ deploy-batch.mjs              # 命令行批量部署（与 UI 共用 deployer）
│  ├─ deploy.list.example.txt
│  └─ deploy.list.txt               # ⛔ 不提交（.gitignore）
│
├─ templates/<源域名>/              # 16 个建站模板，每个目录名都是一个真实域名（用作品牌字替换源）
├─ sites/<域名>/                    # AI 生成 / 改写的站点（部署源）
│
├─ config/desktop.config.example.json   # 配置示例（无密钥，含 feishu 占位结构）
├─ desktop.config.json              # ⛔ 真实配置（含 API Key & 私钥 & 飞书 appSecret，本地）
├─ .deploy-logs/                    # ⛔ 部署日志（自动建，.gitignore）
├─ .approval-tracker.json           # ⛔ 审批跟踪表（自动建，.gitignore）
│
├─ docs/
│  ├─ 新人上手.md                   # ⭐ 新人架构与学习指南（推荐首读）
│  └─ README.md                     # 文档索引
├─ README.md                        # 本文（速查与命令）
└─ ARCHITECTURE.md                  # 模块 / IPC / 数据契约深入参考
```