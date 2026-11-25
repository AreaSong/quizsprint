# QuizSprint

轻量、自托管的在线刷题、背题与防作弊组卷考试学习平台（支持个人自用、同学共享刷题，并原生兼容本地油猴脚本搜题归档）。

## 核心特性

- **清晰的三级角色权限**
  - **未登录访客**：可浏览公开题库、查看试题详情、使用搜题中心与查看统计排行榜（只读）。
  - **注册学员**：支持顺序/章节/随机/题型练习、背题模式、错题巩固（连续答对 1~3 次移出）、收藏夹、斩题、做题笔记、个人模拟考、正式在线考场、导出试卷（PDF/Excel/JSON）及 30 天云端打卡同步。
  - **管理员**：支持新建/合并/加密/删除题库、批量导题（纯文本/Word/Excel/JSON/AI）、单题图文录入与批量管理、精细化发考与简答题人工阅卷、**网页内一键 Git 检查更新与重启**。
- **全题型深度刷题与考试体验**
  - 完整覆盖单选、多选、不定项选择、判断、填空与简答（刷题自评 + 考场人工阅卷），内置桌面键盘快捷键（`A-F` / `1-6` 选答案、`Enter` 确认、`←` / `→` 切题）、沉浸模式与护眼模式。
  - 正式发考支持按题型抽题配分、手动勾选组固定卷、开考/截止时间窗口、限考次数、交卷隐藏答案与防切屏禁复制。
  - 学习统计页内置**全班高频易错题 Top 20**，支持一键直达刷题。
- **AI 助教（零服务端泄露风险）**：每位用户在浏览器本地填写自己的 OpenAI 兼容 API Key（仅存当前浏览器 `localStorage`），即可使用 AI 深度解析、1v1 题目追问、AI 搜题、AI 智能整理文本与 AI 主题出题。
- **单文件 SQLite 持久化**：基于 Node.js 内置 `node:sqlite` 自动维护 `data/question-bank.db`，零外部数据库依赖，自动迁移历史 JSON 数据。
- **油猴脚本无缝联动**：配套油猴脚本位于 `userscript/AreaSong.user.js`，后端原生保留 `POST /search`（模糊相似度搜题）、`POST /probe` 与 `POST /questions`（远程命中自动归档至 `default` 默认题库）。

## 目录结构

```text
.
├── server.mjs               # HTTP 入口与核心 REST 路由
├── question-record.mjs      # 题干清洗与答案标准化核心
├── lib/                     # 认证、SQLite、考试、文档导入、AI、Git 更新与油猴兼容路由
├── public/                  # 前端 SPA（无构建依赖，原生 ES Modules）
├── deploy/                  # PM2 (ecosystem.config.cjs) 与 systemd 托管模板
├── data/                    # SQLite 数据库与上传图片目录（运行期文件已忽略）
├── userscript/              # 配套浏览器油猴脚本 AreaSong.user.js
├── Dockerfile               # 生产容器镜像定义
└── docker-compose.yml       # Docker Compose 一键部署配置
```

## 快速启动

环境要求：**Node.js >= 22.5**（推荐使用 Node.js 24 LTS）。

```bash
npm install
npm start
# 浏览器访问 http://127.0.0.1:8787
```

运行自动化测试：

```bash
npm test
```

## 生产服务器部署（推荐：`git clone` + PM2/systemd，支持网页内一键更新）

在云服务器直接 `git clone` 部署并配合进程守护后，管理员可点击顶栏「**系统更新**」一键检测补丁、`git pull --ff-only` 拉取代码并优雅重启：

```bash
git clone <你的仓库地址> quizsprint && cd quizsprint
npm install --omit=dev

# 方式 A：使用 PM2 托管（推荐）
npm install -g pm2
pm2 start deploy/ecosystem.config.cjs
pm2 save && pm2 startup

# 方式 B：使用 Docker Compose 部署
# 修改 docker-compose.yml 中的 AUTH_SECRET / ADMIN_PASSWORD 后执行：
docker compose up -d --build
```

> 建议前置 Nginx / Caddy 配置域名与 HTTPS 反向代理至 `127.0.0.1:8787`（服务会根据 `X-Forwarded-Proto: https` 自动为会话 Cookie 启用 `Secure` 属性）。

## 外部 CRUD API 与油猴联动

管理员登录后点击右上角「**API 密钥**」可查看或重置 `X-API-Key`（也可通过环境变量 `API_KEY` 固定指定）。

### 平台 REST API
- `GET /api/banks` / `POST /api/banks` / `PUT /api/banks/:bankId` / `DELETE /api/banks/:bankId`
- `POST /api/banks/merge` — 多题库合并
- `GET /api/banks/:bankId/questions` / `POST /api/banks/:bankId/questions`
- `GET|PUT|PATCH|DELETE /api/banks/:bankId/questions/:qid`
- `POST /api/banks/:bankId/import` / `POST /api/banks/:bankId/questions/batch`
- `GET /api/banks/:bankId/export` (JSON) / `GET /api/banks/:bankId/export.xlsx` (Excel)
- `GET /api/search?q=&bankId=&type=` — 跨公开题库搜题

### 油猴兼容接口（默认端口 `8787`）
- `POST /search` — 模糊相似度搜题（跨全部未加密题库）
- `POST /probe` — 批量探测题目命中状态
- `POST /questions` — 自动归档题目至 `default` 默认题库（本机 `127.0.0.1` 免密直写；公网环境需配置 `QUESTION_BANK_KEY` 或携带 `X-API-Key`）

## 免责声明与使用规范

1. **使用定位**：本项目（QuizSprint）及配套脚本**仅供创作者本人学习、技术研究与同学间日常复习交流使用**。
2. **严禁用途**：严禁将本项目用于任何商业盈利、付费售卖、公开盗版传播，严禁用于任何正式考试作弊或违反法律法规与校纪校规的行为。
3. **内容免责**：系统本身不内置也不提供任何第三方受版权保护的真题或商业题库；所有试题均由部署者/使用者自行导入与维护，因题库内容版权或不当使用产生的一切法律与合规责任由使用者自行承担。
4. **隐私与自托管**：AI 大模型 API Key 仅保存于用户当前浏览器本地（`localStorage`），服务端不持久化保存；自托管部署者请自行妥善配置访问密码与数据库备份。
