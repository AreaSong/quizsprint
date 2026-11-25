import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeTitle } from "../question-record.mjs";
import { readJsonSafe, sanitizeId } from "./fs-utils.mjs";

const dbCache = new Map();

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS banks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '默认分组',
  password TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  bank_id TEXT NOT NULL,
  no TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  norm_title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '0',
  options_json TEXT NOT NULL DEFAULT '[]',
  answers_json TEXT NOT NULL DEFAULT '[]',
  analysis TEXT NOT NULL DEFAULT '',
  chapter TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT '中等',
  images_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id);
CREATE INDEX IF NOT EXISTS idx_questions_norm ON questions(bank_id, norm_title);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id TEXT NOT NULL,
  bank_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, bank_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_daily_stats (
  user_id TEXT NOT NULL,
  stat_date TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, stat_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  bank_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  pass_score INTEGER NOT NULL,
  access_code TEXT NOT NULL DEFAULT '',
  max_tab_switches INTEGER NOT NULL DEFAULT 3,
  disable_copy INTEGER NOT NULL DEFAULT 0,
  multi_partial_score INTEGER NOT NULL DEFAULT 0,
  fill_partial_score INTEGER NOT NULL DEFAULT 0,
  question_ids_json TEXT NOT NULL,
  questions_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_submissions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_no TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL,
  passed INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  tab_switches INTEGER NOT NULL DEFAULT 0,
  used_seconds INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL,
  details_json TEXT NOT NULL,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subs_exam ON exam_submissions(exam_id);

CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;

export const withTx = (db, fn) => {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  }
};

const migrateLegacyJsonIfNeeded = (db, dataDir) => {
  const bankCount = db.prepare("SELECT COUNT(*) AS cnt FROM banks").get().cnt;
  if (bankCount > 0) return;

  const now = new Date().toISOString();
  const insertBank = db.prepare(`
    INSERT OR IGNORE INTO banks (id, name, description, folder, password, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertQuestion = db.prepare(`
    INSERT OR IGNORE INTO questions (id, bank_id, no, title, norm_title, type, options_json, answers_json, analysis, chapter, difficulty, images_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  withTx(db, () => {
    const banksIndexFile = path.join(dataDir, "banks.json");
    const legacyFile = path.join(dataDir, "questions.json");
    const banks = readJsonSafe(banksIndexFile, null);

    if (Array.isArray(banks) && banks.length > 0) {
      for (const b of banks) {
        insertBank.run(
          sanitizeId(b.id),
          String(b.name || "未命名题库"),
          String(b.description || ""),
          String(b.folder || "默认分组"),
          String(b.password || ""),
          String(b.createdAt || now),
          String(b.updatedAt || now)
        );
        const list = readJsonSafe(path.join(dataDir, "banks", `${sanitizeId(b.id)}.json`), []);
        for (const q of Array.isArray(list) ? list : []) {
          insertQuestion.run(
            String(q.id || crypto.randomUUID()),
            sanitizeId(b.id),
            String(q.no || ""),
            String(q.title || ""),
            normalizeTitle(q.title || ""),
            String(q.type ?? "0"),
            JSON.stringify(Array.isArray(q.options) ? q.options : []),
            JSON.stringify(Array.isArray(q.answers) ? q.answers : []),
            String(q.analysis || ""),
            String(q.chapter || ""),
            String(q.difficulty || "中等"),
            JSON.stringify(Array.isArray(q.images) ? q.images : []),
            String(q.updatedAt || now)
          );
        }
      }
    } else {
      const legacyList = readJsonSafe(legacyFile, []);
      insertBank.run("default", "默认题库", "自动从历史题库迁移的默认题库", "默认分组", "", now, now);
      for (const q of Array.isArray(legacyList) ? legacyList : []) {
        insertQuestion.run(
          String(q.id || crypto.randomUUID()),
          "default",
          String(q.no || ""),
          String(q.title || ""),
          normalizeTitle(q.title || ""),
          String(q.type ?? "0"),
          JSON.stringify(Array.isArray(q.options) ? q.options : []),
          JSON.stringify(Array.isArray(q.answers) ? q.answers : []),
          String(q.analysis || ""),
          String(q.chapter || ""),
          String(q.difficulty || "中等"),
          JSON.stringify(Array.isArray(q.images) ? q.images : []),
          String(q.updatedAt || now)
        );
      }
    }

    const users = readJsonSafe(path.join(dataDir, "users.json"), []);
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, username, nickname, salt, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertProg = db.prepare(`
      INSERT OR IGNORE INTO user_progress (user_id, bank_id, data_json, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    const insertDaily = db.prepare(`
      INSERT OR IGNORE INTO user_daily_stats (user_id, stat_date, answered, correct, seconds)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const u of Array.isArray(users) ? users : []) {
      insertUser.run(u.id, u.username, u.nickname || u.username, u.salt, u.passwordHash, u.createdAt || now);
      const prog = readJsonSafe(path.join(dataDir, "user-progress", `${sanitizeId(u.id)}.json`), {});
      for (const [bid, bdata] of Object.entries(prog.banks || {})) {
        insertProg.run(u.id, sanitizeId(bid), JSON.stringify(bdata), now);
      }
      for (const [date, st] of Object.entries(prog.dailyStats || {})) {
        insertDaily.run(u.id, date, Number(st.answered || 0), Number(st.correct || 0), Number(st.seconds || 0));
      }
    }

    const aiCfg = readJsonSafe(path.join(dataDir, "ai-config.json"), null);
    if (aiCfg) {
      db.prepare("INSERT OR IGNORE INTO kv_store (key, value_json) VALUES (?, ?)").run("ai_config", JSON.stringify(aiCfg));
    }

    const exams = readJsonSafe(path.join(dataDir, "exams.json"), []);
    const insertExam = db.prepare(`
      INSERT OR IGNORE INTO exams (id, title, bank_id, bank_name, duration_minutes, pass_score, access_code, max_tab_switches, disable_copy, multi_partial_score, fill_partial_score, question_ids_json, questions_snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSub = db.prepare(`
      INSERT OR IGNORE INTO exam_submissions (id, exam_id, student_name, student_no, score, passed, correct_count, total_count, tab_switches, used_seconds, submitted_at, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ex of Array.isArray(exams) ? exams : []) {
      insertExam.run(
        ex.id, ex.title, ex.bankId || "", ex.bankName || "",
        Number(ex.durationMinutes || 30), Number(ex.passScore || 60), ex.accessCode || "",
        Number(ex.maxTabSwitches ?? 3), ex.disableCopy ? 1 : 0, ex.multiPartialScore ? 1 : 0, ex.fillPartialScore ? 1 : 0,
        JSON.stringify(ex.questionIds || []), JSON.stringify(ex.questionsSnapshot || []), ex.createdAt || now
      );
      const subs = readJsonSafe(path.join(dataDir, "exam-submissions", `${sanitizeId(ex.id)}.json`), []);
      for (const s of Array.isArray(subs) ? subs : []) {
        insertSub.run(
          s.id, ex.id, s.studentName, s.studentNo || "",
          Number(s.score || 0), s.passed ? 1 : 0, Number(s.correctCount || 0), Number(s.totalCount || 0),
          Number(s.tabSwitches || 0), Number(s.usedSeconds || 0), s.submittedAt || now, JSON.stringify(s.details || [])
        );
      }
    }
  });
};

export const getDb = (dataDir) => {
  const resolved = path.resolve(dataDir);
  if (dbCache.has(resolved)) return dbCache.get(resolved);
  fs.mkdirSync(resolved, { recursive: true });
  const dbPath = path.join(resolved, "question-bank.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");
  try { db.exec("PRAGMA journal_mode = DELETE;"); } catch { /* 外部工具占用时跳过模式切换 */ }
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student';"); } catch { /* 列已存在 */ }
  migrateLegacyJsonIfNeeded(db, resolved);
  dbCache.set(resolved, db);
  return db;
};
