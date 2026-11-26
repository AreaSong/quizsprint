import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, withTx } from "../lib/db.mjs";
import { createExamStore } from "../lib/exam-store.mjs";
import { createStore } from "../lib/store.mjs";
import { createUserStore } from "../lib/user-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const WINFORM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="270" viewBox="0 0 520 270">
  <rect width="520" height="270" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
  <rect width="520" height="34" rx="10" fill="#1e40af"/>
  <rect y="20" width="520" height="14" fill="#1e40af"/>
  <text x="16" y="22" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ffffff">FormLogin - 系统登录窗口</text>
  <text x="38" y="76" font-family="sans-serif" font-size="13" fill="#334155">用户名：</text>
  <rect x="115" y="54" width="230" height="32" rx="5" fill="#ffffff" stroke="#94a3b8"/>
  <text x="360" y="75" font-family="monospace" font-size="12" fill="#2563eb">Name: txtUser</text>
  <text x="38" y="124" font-family="sans-serif" font-size="13" fill="#334155">密  码：</text>
  <rect x="115" y="102" width="230" height="32" rx="5" fill="#ffffff" stroke="#94a3b8"/>
  <text x="360" y="123" font-family="monospace" font-size="12" fill="#2563eb">Name: txtPwd (PasswordChar=*)</text>
  <rect x="115" y="150" width="16" height="16" rx="3" fill="#ffffff" stroke="#64748b"/>
  <text x="140" y="163" font-family="sans-serif" font-size="12.5" fill="#334155">记住账号</text>
  <text x="220" y="163" font-family="monospace" font-size="12" fill="#2563eb">Name: chkRemember</text>
  <rect x="115" y="194" width="102" height="34" rx="6" fill="#2563eb"/>
  <text x="148" y="216" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ffffff">登 录</text>
  <text x="132" y="246" font-family="monospace" font-size="11.5" fill="#2563eb">btnLogin</text>
  <rect x="242" y="194" width="102" height="34" rx="6" fill="#e2e8f0" stroke="#94a3b8"/>
  <text x="275" y="216" font-family="sans-serif" font-size="13" fill="#1e293b">退 出</text>
  <text x="262" y="246" font-family="monospace" font-size="11.5" fill="#2563eb">btnExit</text>
</svg>`;

const SE_FLOW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="300" viewBox="0 0 560 300">
  <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#475569"/></marker></defs>
  <rect width="560" height="300" rx="10" fill="#ffffff" stroke="#e2e8f0"/>
  <rect x="210" y="16" width="140" height="34" rx="17" fill="#dbeafe" stroke="#2563eb"/>
  <text x="280" y="38" text-anchor="middle" font-family="sans-serif" font-size="12.5" font-weight="bold" fill="#1e3a8a">开始：提交订单</text>
  <line x1="280" y1="50" x2="280" y2="74" stroke="#475569" stroke-width="1.5" marker-end="url(#arr)"/>
  <polygon points="280,78 365,112 280,146 195,112" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>
  <text x="280" y="116" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#92400e">库存是否充足？</text>
  <line x1="195" y1="112" x2="115" y2="112" stroke="#475569" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="155" y="104" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#dc2626">否 (N)</text>
  <rect x="20" y="92" width="90" height="40" rx="6" fill="#fee2e2" stroke="#dc2626"/>
  <text x="65" y="116" text-anchor="middle" font-family="sans-serif" font-size="11.5" fill="#991b1b">提示库存不足</text>
  <line x1="280" y1="146" x2="280" y2="174" stroke="#475569" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="298" y="164" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#15803d">是 (Y)</text>
  <rect x="190" y="178" width="180" height="36" rx="6" fill="#dcfce7" stroke="#16a34a"/>
  <text x="280" y="200" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#14532d">扣减库存并生成支付单</text>
  <line x1="280" y1="214" x2="280" y2="240" stroke="#475569" stroke-width="1.5" marker-end="url(#arr)"/>
  <rect x="210" y="244" width="140" height="34" rx="17" fill="#e2e8f0" stroke="#475569"/>
  <text x="280" y="265" text-anchor="middle" font-family="sans-serif" font-size="12.5" font-weight="bold" fill="#0f172a">结束流程</text>
  <path d="M65,132 L65,261 L204,261" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#arr)"/>
</svg>`;

const futureDate = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const clearOldBusinessData = (db) => {
  withTx(db, () => {
    for (const tbl of ["exam_submissions", "exams", "question_wrong_stats", "user_daily_stats", "user_progress", "questions", "banks", "subjects"]) {
      db.prepare(`DELETE FROM ${tbl}`).run();
    }
  });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const name of fs.readdirSync(UPLOADS_DIR)) fs.unlinkSync(path.join(UPLOADS_DIR, name));
};

const seedAll = () => {
  const db = getDb(DATA_DIR);
  const store = createStore(DATA_DIR);
  const userStore = createUserStore(DATA_DIR);
  const examStore = createExamStore(DATA_DIR);

  clearOldBusinessData(db);
  fs.writeFileSync(path.join(UPLOADS_DIR, "demo-winform-login.svg"), WINFORM_SVG);
  fs.writeFileSync(path.join(UPLOADS_DIR, "demo-se-flowchart.svg"), SE_FLOW_SVG);

  const sub = store.createSubject({
    name: "全功能演示",
    term: "演示示例",
    examDate: futureDate(30),
    description: "覆盖全部 9 种题型、代码块、表格、配图与拖动交互的参考样例"
  }).subject;

  const bank = store.createBank({
    name: "全题型演示示例库",
    subjectId: sub.id,
    category: "comprehensive",
    description: "单选 / 多选 / 填空 / 判断 / 不定项 / 简答 / 实操 / 排序拖动 / 拖拽配对"
  }).bank;

  store.importQuestions(bank.id, [
    {
      id: "demo-0", type: "0", chapter: "理论基础",
      title: "【单选题】在分时操作系统中，进程从运行态转为就绪态的常见原因是（ ）",
      options: ["时间片用完", "等待 I/O 完成", "触发缺页中断", "进程正常退出"],
      answers: ["时间片用完"],
      analysis: "时间片耗尽后进程失去 CPU，直接回到就绪队列等待下次调度。"
    },
    {
      id: "demo-1", type: "1", chapter: "理论基础",
      title: "【多选题】产生死锁必须同时具备哪四个必要条件？",
      options: ["互斥条件", "请求和保持条件", "不可剥夺条件", "循环等待条件", "时间片轮转"],
      answers: ["互斥条件", "请求和保持条件", "不可剥夺条件", "循环等待条件"],
      analysis: "Coffman 四条件：互斥、请求与保持、不可剥夺、循环等待。"
    },
    {
      id: "demo-2", type: "2", chapter: "理论基础",
      title: "【填空题】在页式虚拟存储中，当访问的页面不在主存时会引发 ______ 中断。",
      answers: ["缺页"],
      analysis: "MMU 检测到页表有效位为 0 时触发缺页中断，由 OS 调入页面。"
    },
    {
      id: "demo-3", type: "3", chapter: "理论基础",
      title: "【判断题】线程是操作系统进行资源分配的基本单位，进程是独立调度的基本单位。",
      answers: ["错误"],
      analysis: "恰恰相反：进程是资源分配的基本单位，线程是独立调度和分派的基本单位。"
    },
    {
      id: "demo-5", type: "5", chapter: "理论基础",
      title: "【不定项选择】下列哪些页面置换算法不存在 Belady 异常？",
      options: ["LRU（最近最久未使用）", "FIFO（先进先出）", "OPT（最佳置换）", "随机置换"],
      answers: ["LRU（最近最久未使用）", "OPT（最佳置换）"],
      analysis: "LRU 和 OPT 属于栈式算法，增大物理块数不会导致缺页率上升。"
    },
    {
      id: "demo-4", type: "4", chapter: "简答回忆",
      title: "【简答题】简述分段存储管理与分页存储管理的核心区别（可按空格键翻看参考答案）。",
      answers: ["1. **分页**面向物理内存，页大小固定且由系统决定；**分段**面向用户逻辑程序，段长不固定。\n2. 分页地址空间是一维的，分段是二维的（段号 + 段内偏移）。\n3. 分段比分页更容易实现信息共享和保护。"],
      analysis: "背诵关键词：**物理 vs 逻辑、一维 vs 二维、共享保护**。"
    },
    {
      id: "demo-6a", type: "6", chapter: "OS 实操题", difficulty: "困难",
      title: "【实操 · PV 代码】写出单缓冲区生产者-消费者问题的信号量定义与 PV 同步伪代码。",
      answers: ["定义信号量：`semaphore mutex = 1, empty = N, full = 0;`\n\n```c\nvoid producer() {\n  while (1) {\n    produce_item();\n    P(empty);   // 先申请空缓冲区\n    P(mutex);   // 再申请互斥锁\n    put_item();\n    V(mutex);\n    V(full);\n  }\n}\n\nvoid consumer() {\n  while (1) {\n    P(full);    // 先申请满缓冲区\n    P(mutex);\n    take_item();\n    V(mutex);\n    V(empty);\n  }\n}\n```"],
      analysis: "**必须先执行同步 P(`empty`/`full`)，再执行互斥 P(`mutex`)**，顺序颠倒会导致死锁。"
    },
    {
      id: "demo-6b", type: "6", chapter: "OS 实操题", difficulty: "困难",
      title: "【实操 · 表格】某系统有资源 A(10)、B(5)、C(7)，T0 时刻状态如下表：\n\n| 进程 | Allocation (A B C) | Max (A B C) |\n| --- | --- | --- |\n| P0 | 0 1 0 | 7 5 3 |\n| P1 | 2 0 0 | 3 2 2 |\n| P2 | 3 0 2 | 9 0 2 |\n\n计算 Need 矩阵，并判断 P1 请求 (1, 0, 2) 时系统是否安全。",
      answers: ["1. **Need 矩阵与当前 Available = (3, 3, 2)**：\n\n| 进程 | Need (A B C) | 判断过程 |\n| --- | --- | --- |\n| P0 | 7 4 3 | 等待 |\n| P1 | 1 2 2 | 试分配 (1,0,2) 后可满足 |\n| P2 | 6 0 0 | 随后可释放 |\n\n2. 存在安全序列 **`P1 → P0 → P2`**，因此系统**安全，允许分配**。"],
      analysis: "银行家算法三步走：算 Available → 试分配减 Need/Available → 找全量安全序列。"
    },
    {
      id: "demo-6c", type: "6", chapter: "窗体程序题",
      title: "【实操 · 题干配图】结合下方 WinForms 登录窗体原型图，写出点击登录按钮 (`btnLogin`) 时的非空校验与密码核对 C# 代码。",
      images: ["/uploads/demo-winform-login.svg"],
      answers: ["```csharp\nprivate void btnLogin_Click(object sender, EventArgs e)\n{\n    string user = txtUser.Text.Trim();\n    string pwd = txtPwd.Text.Trim();\n    if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pwd))\n    {\n        MessageBox.Show(\"用户名和密码不能为空！\", \"提示\", MessageBoxButtons.OK, MessageBoxIcon.Warning);\n        txtUser.Focus();\n        return;\n    }\n    if (user == \"admin\" && pwd == \"123456\")\n        MessageBox.Show(\"登录成功！\", \"欢迎\");\n    else\n        MessageBox.Show(\"账号或密码错误！\", \"错误\");\n}\n```"],
      analysis: "高频得分点：**`Trim()` 去空格、`string.IsNullOrEmpty` 判空、`Focus()` 归位光标**。"
    },
    {
      id: "demo-6d", type: "6", chapter: "软件工程流程图",
      title: "【实操 · 答案配图防剧透】设计【电商提交订单】业务流程图逻辑，翻开参考答案后对照标准流程图。",
      answerImages: ["/uploads/demo-se-flowchart.svg"],
      answers: ["1. **起始**：用户提交订单（椭圆起止框）；\n2. **判断**：检查库存是否充足（菱形判断框）；\n3. **分支 N**：库存不足 → 提示库存不足（矩形处理框）→ 汇入结束流程；\n4. **分支 Y**：库存充足 → 扣减库存并生成支付单 → 进入结束流程。"],
      analysis: "画流程图必查：**圆角起止框、菱形判断框标明 Y/N、箭头单向无悬空节点**。"
    },
    {
      id: "demo-7", type: "7", chapter: "拖动交互",
      title: "【排序拖动题】请拖动卡片排列：运行态进程等待磁盘 I/O 并最终重新获得 CPU 的顺序。",
      answers: ["运行态发出 I/O 请求并执行阻塞原语", "进入阻塞（等待）队列等待磁盘中断", "磁盘 I/O 完成产生中断，OS 执行唤醒原语", "进入就绪队列等待调度程序选中", "被调度程序分派，恢复上下文重新进入运行态"],
      analysis: "口诀：运行 → 阻塞（主动请求）→ 就绪（I/O 完成唤醒）→ 运行（调度选中）。"
    },
    {
      id: "demo-8", type: "8", chapter: "拖动交互",
      title: "【拖拽配对题】将左侧软件工程 UML 图名称与右侧最适用的建模场景拖拽配对。",
      answers: ["用例图 (Use Case) => 梳理系统参与者与功能边界", "时序图 (Sequence) => 刻画对象间按时间先后传递的消息", "类图 (Class) => 表达静态结构、继承与关联关系", "状态图 (Statechart) => 描述单对象受事件驱动的生命周期流转"],
      analysis: "动态图（时序、状态）vs 静态图（类图、组件图）。"
    }
  ]);

  let demoUser = userStore.listUsers().find((u) => u.username === "demo");
  if (!demoUser) {
    demoUser = userStore.register({ username: "demo", password: "123456", nickname: "演示同学", role: "student" }).user;
  }

  userStore.saveBankProgress(demoUser.id, bank.id, {
    records: {
      "demo-0": { selected: ["时间片用完"], correct: true },
      "demo-1": { selected: ["互斥条件"], correct: false },
      "demo-2": { selected: ["缺页"], correct: true }
    },
    wrongIds: ["demo-1"],
    favoriteIds: ["demo-0", "demo-6c"],
    masteredIds: ["demo-0"],
    notes: {
      "demo-0": "时间片用完 -> 回就绪；等I/O -> 进阻塞。",
      "demo-6a": "口诀：先同步(empty/full)，后互斥(mutex)！"
    },
    lastIndex: 3
  });

  const dailyStmt = db.prepare(`
    INSERT INTO user_daily_stats (user_id, stat_date, answered, correct, seconds) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, stat_date) DO UPDATE SET answered = excluded.answered, correct = excluded.correct, seconds = excluded.seconds
  `);
  const demoDaily = [4, 7, 5, 9, 6, 11, 8];
  for (let i = 0; i < demoDaily.length; i += 1) {
    const dayStr = futureDate(i - (demoDaily.length - 1));
    const ans = demoDaily[i];
    dailyStmt.run(demoUser.id, dayStr, ans, Math.max(1, Math.round(ans * 0.8)), ans * 45);
  }

  const now = new Date().toISOString();
  const wrongStmt = db.prepare("INSERT INTO question_wrong_stats (bank_id, question_id, wrong_count, attempt_count, updated_at) VALUES (?, ?, ?, ?, ?)");
  wrongStmt.run(bank.id, "demo-1", 4, 7, now);
  wrongStmt.run(bank.id, "demo-6a", 3, 6, now);

  const pool = store.loadBankQuestions(bank.id);
  const picked = ["demo-0", "demo-3", "demo-7", "demo-6a"].map((id) => pool.find((q) => q.id === id)).filter(Boolean);
  const { exam } = examStore.createExam({
    title: "演示示例 · 综合随堂测验",
    bankId: bank.id,
    bankName: bank.name,
    durationMinutes: 20,
    passScore: 12,
    selectedQuestionIds: picked.map((q) => q.id),
    questionScores: { "demo-0": 4, "demo-3": 4, "demo-7": 6, "demo-6a": 6 }
  }, pool);

  examStore.submitExam(exam.id, {
    userId: demoUser.id,
    studentName: demoUser.nickname || "演示同学",
    studentNo: "2024001",
    answers: {
      "demo-0": ["时间片用完"],
      "demo-3": ["错误"],
      "demo-7": picked[2].answers,
      "demo-6a": ["P(empty); P(mutex); ... V(mutex); V(full);"]
    },
    tabSwitches: 0,
    usedSeconds: 300
  });

  console.log("精简演示样例初始化完成：1 个学期（演示示例） / 1 个科目（全功能演示） / 1 个题库（12 题全覆盖） / 1 场示例考试。");
};

seedAll();
