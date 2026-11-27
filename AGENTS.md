# QuizSprint 项目协作与开发规范

## 技术栈与目录约定
- **运行环境**：Node.js `>= 22.5`（使用内置 `node:sqlite`，无构建工具链，前端为原生 ES Modules SPA）。
- **核心入口**：
  - 后端入口：[server.mjs](file:///Users/as/Ai-Project/project/TampermonkeyScript/server.mjs)、[lib/extra-routes.mjs](file:///Users/as/Ai-Project/project/TampermonkeyScript/lib/extra-routes.mjs)、[lib/site-routes.mjs](file:///Users/as/Ai-Project/project/TampermonkeyScript/lib/site-routes.mjs)
  - 前端入口：[public/index.html](file:///Users/as/Ai-Project/project/TampermonkeyScript/public/index.html)、[public/js/app.js](file:///Users/as/Ai-Project/project/TampermonkeyScript/public/js/app.js)、[public/js/api.js](file:///Users/as/Ai-Project/project/TampermonkeyScript/public/js/api.js)

## 质量门槛与结构上限
- 非打包源码文件（`server.mjs`、`question-record.mjs`、`lib/*.mjs`、`public/exam-parse.js`、`public/js/*.js`、`public/js/views/*.js`、`public/css/*.css`）单个文件**严禁超过 `500` 行**，超出时主动拆分为高内聚子模块。
- 单函数/方法尽量保持 **`≤ 50` 行**，嵌套不超过 `3` 层。
- 严禁使用原生 `alert` / `confirm` / `prompt`，统一使用 `dialog.js` 与 `showToast`。

## 强制更新日志规范（必做）
1. **代码变更同步更新日志**：后续每次对项目进行功能新增、问题修复、重要优化或版本发布时，**必须同步在 [CHANGELOG.md](./CHANGELOG.md) 顶部对应版本条目中记录改动说明**（如新增题目类型、交互改进、接口或运维变更），每条新增/重要变更需附精确到秒的时间戳 `[YYYY-MM-DD HH:MM:SS]`。
2. **版本号同步**：升级版本号时，必须同步更新 [package.json](./package.json)、[README.md](./README.md)、[CHANGELOG.md](./CHANGELOG.md) 以及 `lib/version.mjs`、`public/index.html`、`public/js/site-shell.js`、`public/js/views/system-view.js` 中的默认回退版本号。
3. **运行期题库/题目更新动态**：管理员通过接口创建题库、录题、批量导题或发布考试时，系统会自动调用 `appendContentUpdate` 写入 `content_updates`；人工整理或导入重要题库后也可在页脚版本号弹窗内的「题库与内容更新动态」补充说明。

## 改动后强制验证命令
每次提交或交付前必须运行并全部通过：
```bash
npm run check
wc -l server.mjs question-record.mjs lib/*.mjs public/exam-parse.js public/js/*.js public/js/views/*.js public/css/*.css | sort -n | tail -n 15
NODE_ENV=test npm test
```
