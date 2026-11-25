# 知题库 · QuizHub

轻量、自托管的在线刷题、背题与防作弊组卷考试学习平台（支持个人自用、同学共享刷题，并原生兼容本地油猴脚本搜题归档）。

## 核心特性

- **清晰的三级角色权限**
  - **未登录访客**：可浏览公开题库、查看试题详情、使用搜题中心与查看刷题排行榜（只读）。
  - **注册学员**：支持顺序/随机/题型练习、背题模式、错题本、收藏夹、斩题、做题笔记、个人模拟考、正式在线考场、导出试卷（PDF/Excel/JSON）及 30 天云端打卡同步。
  - **管理员**：支持新建/合并/加密/删除题库、批量导题（纯文本/Word/Excel/JSON/AI）、单题图文录入与批量管理、发布防作弊在线考试及导出成绩单。
- **全题型深度刷题体验**：完整覆盖单选、多选、不定项选择、判断、填空与简答（支持主观题核对答案后一键自评），内置桌面键盘快捷键（`A-F` / `1-6` 选答案、`Enter` 确认、`←` / `→` 切题）、沉浸模式与护眼模式。
- **AI 助教（零服务端泄露风险）**：每位用户在浏览器本地填写自己的 OpenAI 兼容 API Key（仅存当前浏览器 `localStorage`），即可使用 AI 深度解析、1v1 题目追问、AI 搜题、AI 智能整理文本与 AI 主题出题。
- **单文件 SQLite 持久化**：基于 Node.js 内置 `node:sqlite` 自动维护 `data/question-bank.db`，零外部数据库依赖，自动迁移历史 JSON 数据。
- **油猴脚本无缝联动**：配套油猴脚本位于 `userscript/AreaSong.user.js`，后端原生保留 `POST /search`（模糊相似度搜题）、`POST /probe` 与 `POST /questions`（远程命中自动归档至 `default` 默认题库）。

## 目录结构

```text
.
├── server.mjs               # HTTP 入口与核心 REST 路由
├── question-record.mjs      # 题干清洗与答案标准化核心
├── lib/                     # 认证、SQLite、考试、文档导入、AI 与油猴兼容路由
├── public/                  # 前端 SPA（无构建依赖，原生 ES Modules）
├── data/                    # SQLite 数据库与上传图片目录（运行期文件已忽略）
├── userscript/              # 配套浏览器油猴脚本 AreaSong.user.js
├── Dockerfile               # 生产容器镜像定义
└── docker-compose.yml       # Docker Compose 一键部署配置
```

## 快速启动

环境要求：**Node.js >= 22.5**（推荐使用 Node.js 24 LTS）。

```bash
npm install
ADMIN_PASSWORD=your-admin-password npm start
# 浏览器访问 http://127.0.0.1:8787
```

运行自动化测试：

```bash
npm test
```

## 公网 Docker 部署（与同学共享刷题）

1. 修改 `docker-compose.yml` 中的 `ADMIN_PASSWORD` 与 `AUTH_SECRET`：
   ```bash
   docker compose up -d --build
   ```
2. 建议前置 Nginx / Caddy 配置域名与 HTTPS 反向代理至 `127.0.0.1:8787`（服务会根据 `X-Forwarded-Proto: https` 自动为会话 Cookie 启用 `Secure` 属性）。

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

## 仓库目录与 GitHub 远端改名参考（可选）

若后续希望将本地外层目录与 GitHub 仓库名也同步改为 `QuizHub`：

```bash
# 1. 重命名 GitHub 远端仓库（需已登录 gh CLI）
gh repo rename QuizHub --yes

# 2. 关闭 IDE 后重命名本地文件夹
mv /Users/as/Ai-Project/project/TampermonkeyScript /Users/as/Ai-Project/project/QuizHub
```
