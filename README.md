# QuizSprint `v1.2.0`

轻量、自托管的在线刷题、背题与防作弊组卷考试学习平台（支持个人自用、班级共享刷题、桌面与移动端手势交互，并原生兼容本地与公网油猴脚本搜题归档）。

## 核心特性

- **清晰的三级角色权限**
  - **未登录访客**：可浏览公开题库、查看试题详情、使用搜题中心与查看统计排行榜（只读，可在后台切换关闭访客浏览）。
  - **注册学员**：支持顺序/章节/随机/题型练习、背题模式、错题巩固（连续答对 1~3 次移出）、收藏夹、斩题、做题笔记、个人模拟考、正式在线考场、导出试卷（PDF/Excel/JSON）及 30 天云端打卡同步。
  - **管理员**：支持新建/合并/加密/删除题库、批量导题（纯文本/Word/Excel/JSON/AI）、单题图文录入与批量管理、**学号区间批量建号（支持首次登录强制改密与 CSV 导出）**、精细化发考与简答题人工阅卷、配置考试日程信息与自动备份策略、**网页内一键 Git 更新与自动重启**。
- **全题型深度刷题与移动端体验**
  - 完整覆盖单选、多选、不定项选择、判断、填空、简答、实操、排序拖动与拖拽配对（题型 `0-8`），支持刷题图片灯箱放大、桌面键盘快捷键（`A-F` / `1-6` 选答案、`Enter` 确认、`←` / `→` 切题）、沉浸模式与 6 套阅读底色/8 种主题色。
  - **移动端专项适配**：保持标准阅读字号不变，随窄屏等比收紧控件尺寸；题库模式与统计筛选项支持单行横向滑动轨道，刷题页支持跟手左右滑动切题与长题平滑上下滚动。
  - 正式发考支持按题型抽题配分、手动勾选组固定卷、开考/截止时间窗口、限考次数、交卷隐藏答案与防切屏禁复制；首页支持单行流式「考试安排」信息条与自动倒计时。
- **AI 助教与智能模型拉取（零服务端泄露风险）**：每位用户在浏览器本地填写自己的 OpenAI 兼容 API Key（仅存当前浏览器 `localStorage`），支持一键拉取并下拉选择可用模型，解锁 AI 深度解析、1v1 追问、AI 搜题与 AI 一键出题。
- **单文件 SQLite 持久化、定时灾备与更新动态**：
  - 基于 Node.js 内置 `node:sqlite`（`PRAGMA user_version = 3`），支持一键下载/恢复 **`.qsbak` 全量备份包（含 SQLite 与上传图片）**，并在后台自定义定时自动备份周期、保留份数、快照格式与服务器存储路径；
  - 新建题库、录题、批量导题与发布考试会自动写入**「题库与内容更新动态」**，点击页脚版本号（`v1.2.0`）即可实时查看内容更新明细与完整版本日志；内置后台定时更新探测并在导航栏显示待更新提醒。
- **公网生产防护**：登录/注册/改密滑动窗口限流、基础安全响应头、高危操作审计日志、登录 IP/设备轨迹追踪、账号冻结即时踢下线、优雅关机 WAL 刷盘；提供 `.env.example`、`deploy/nginx.conf` 与 GitHub Actions CI。
- **油猴脚本无缝联动**：配套油猴脚本位于 `userscript/AreaSong.user.js`，面板可直接填写公网自托管域名与 `X-API-Key`，原生支持 `POST /search`、`POST /probe` 与 `POST /questions`。

## 目录结构

```text
.
├── server.mjs               # HTTP 入口与核心 REST 路由（含题库/内容更新日志记录）
├── question-record.mjs      # 题干清洗与答案标准化核心
├── lib/                     # 认证、SQLite、用户批建、考试、文档导入、AI、定时备份与更新探测
├── public/                  # 前端 SPA（无构建依赖，原生 ES Modules + SWR 内存缓存）
├── scripts/                 # 演示样例初始化脚本 (npm run seed:demo)
├── deploy/                  # PM2 (ecosystem.config.cjs) 与 systemd (quizsprint.service) 托管模板
├── data/                    # SQLite 数据库、自动备份与上传图片目录（运行期文件已忽略）
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

运行语法检查与自动化测试：

```bash
npm run check
npm test
```

## 生产服务器部署（推荐：`git clone` + PM2/systemd，支持网页内一键更新重启）

在云服务器直接 `git clone` 部署并配合进程守护（PM2 或 `systemd` `Restart=always`）后，管理员可在管理后台「**系统与维护**」自动探测远端补丁，并点击「**更新并重启**」一键拉取代码并重启服务：

```bash
git clone <你的仓库地址> quizsprint && cd quizsprint
npm install --omit=dev

# 方式 A：使用 PM2 托管
npm install -g pm2
pm2 start deploy/ecosystem.config.cjs
pm2 save && pm2 startup

# 方式 B：使用 Docker Compose 部署
docker compose up -d --build
```

> 建议复制 `.env.example` 配置环境变量，并前置 Nginx（参考 `deploy/nginx.conf`，已配置 `client_max_body_size 25m` 及静态资源 `no-store` 防缓存头）或 Cloudflare Tunnel / Caddy 启用 HTTPS 反向代理至 `127.0.0.1:8787`。服务会根据 `X-Forwarded-Proto: https` 自动为会话 Cookie 启用 `Secure` 属性。

## 版本与变更日志

完整版本记录见 [CHANGELOG.md](./CHANGELOG.md)，协作与更新日志维护规范见 [AGENTS.md](./AGENTS.md)，开源协议见 [LICENSE](./LICENSE)（MIT）。

## 外部 CRUD API 与油猴联动

管理员登录后可在「**系统与维护**」查看或重置 `X-API-Key`（也可通过环境变量 `API_KEY` 固定指定）。

### 平台 REST API
- `GET /api/site/info` / `PUT /api/admin/site` — 站点配置、考试安排通知、版本更新日志与内容更新动态
- `POST /api/admin/content-updates` / `DELETE /api/admin/content-updates/:id` — 发布或移除更新动态
- `POST /api/admin/users` / `POST /api/admin/users/batch` — 单个建号与连续编号/学号批量建号
- `GET|POST /api/subjects` / `PUT|DELETE /api/subjects/:id` — 科目与学期管理
- `GET|POST /api/banks` / `PUT|DELETE /api/banks/:bankId` / `POST /api/banks/merge` — 题库与合并
- `GET|POST /api/banks/:bankId/questions` / `GET|PUT|PATCH|DELETE /api/banks/:bankId/questions/:qid`
- `POST /api/banks/:bankId/import` / `POST /api/banks/:bankId/questions/batch`
- `GET /api/banks/:bankId/export` (JSON) / `GET /api/banks/:bankId/export.xlsx` (Excel)
- `GET|POST /api/exams` / `PUT|DELETE /api/exams/:id` / `POST /api/exams/:id/duplicate` — 在线考试与成绩单
- `GET|PUT /api/admin/backups` / `POST /api/admin/backups/run` / `GET /api/admin/backup/full` / `POST /api/admin/db/restore` — 定时备份策略、`.qsbak` 全量灾备与热恢复
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
