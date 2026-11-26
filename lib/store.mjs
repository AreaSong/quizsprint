import crypto from "node:crypto";
import { expandStoredAnswers, hasCompleteAnswers, normalizeAnswers, normalizeTitle } from "../question-record.mjs";
import { getDb, withTx } from "./db.mjs";
import { sanitizeId } from "./fs-utils.mjs";

const VALID_CATEGORIES = new Set(["theory", "practice", "comprehensive", "exam"]);
const normalizeCategory = (cat) => (VALID_CATEGORIES.has(cat) ? cat : "theory");

const rowToSubject = (row) => (row ? {
  id: row.id,
  name: row.name,
  term: row.term || "",
  examDate: row.exam_date || "",
  description: row.description || "",
  sortOrder: Number(row.sort_order || 0),
  bankCount: Number(row.bank_count || 0),
  questionCount: Number(row.question_count || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at
} : null);

const rowToBank = (row) => (row ? {
  id: row.id,
  name: row.name,
  description: row.description,
  folder: row.folder,
  subjectId: row.subject_id || "",
  category: normalizeCategory(row.category),
  subjectName: row.subject_name || "",
  term: row.subject_term || "",
  examDate: row.subject_exam_date || "",
  password: row.password,
  questionCount: Number(row.question_count || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at
} : null);

const rowToQuestion = (row) => ({
  id: row.id,
  no: row.no,
  title: row.title,
  type: row.type,
  options: JSON.parse(row.options_json || "[]"),
  answers: JSON.parse(row.answers_json || "[]"),
  analysis: row.analysis || "",
  chapter: row.chapter || "",
  difficulty: row.difficulty || "中等",
  images: JSON.parse(row.images_json || "[]"),
  answerImages: JSON.parse(row.answer_images_json || "[]"),
  updatedAt: row.updated_at
});

export const createStore = (dataDir) => {
  const db = getDb(dataDir);

  const listSubjects = () => {
    const rows = db.prepare(`
      SELECT s.*,
             (SELECT COUNT(*) FROM banks b WHERE b.subject_id = s.id) AS bank_count,
             (SELECT COUNT(*) FROM questions q JOIN banks b ON b.id = q.bank_id WHERE b.subject_id = s.id) AS question_count
      FROM subjects s
      ORDER BY s.term DESC, s.sort_order ASC, s.created_at DESC
    `).all();
    return rows.map(rowToSubject);
  };

  const getSubject = (subjectId) => {
    const row = db.prepare(`
      SELECT s.*,
             (SELECT COUNT(*) FROM banks b WHERE b.subject_id = s.id) AS bank_count,
             (SELECT COUNT(*) FROM questions q JOIN banks b ON b.id = q.bank_id WHERE b.subject_id = s.id) AS question_count
      FROM subjects s
      WHERE s.id = ?
    `).get(sanitizeId(subjectId));
    return rowToSubject(row);
  };

  const createSubject = ({ name, term = "", examDate = "", description = "" }) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return { error: "科目名称不能为空" };
    const now = new Date().toISOString();
    const id = `sub_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO subjects (id, name, term, exam_date, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, trimmed, String(term || "").trim(), String(examDate || "").trim(), String(description || "").trim(), now, now);
    return { subject: getSubject(id) };
  };

  const updateSubject = (subjectId, { name, term, examDate, description }) => {
    const current = getSubject(subjectId);
    if (!current) return { error: "科目不存在" };
    const nextName = name !== undefined ? String(name).trim() : current.name;
    if (!nextName) return { error: "科目名称不能为空" };
    const nextTerm = term !== undefined ? String(term).trim() : current.term;
    const nextDate = examDate !== undefined ? String(examDate).trim() : current.examDate;
    const nextDesc = description !== undefined ? String(description).trim() : current.description;
    const now = new Date().toISOString();
    withTx(db, () => {
      db.prepare(`
        UPDATE subjects SET name = ?, term = ?, exam_date = ?, description = ?, updated_at = ? WHERE id = ?
      `).run(nextName, nextTerm, nextDate, nextDesc, now, current.id);
      if (nextName !== current.name) {
        db.prepare("UPDATE banks SET folder = ? WHERE subject_id = ?").run(nextName, current.id);
      }
    });
    return { subject: getSubject(current.id) };
  };

  const deleteSubject = (subjectId) => {
    const safeId = sanitizeId(subjectId);
    let changes = 0;
    withTx(db, () => {
      db.prepare("UPDATE banks SET subject_id = '', folder = '默认分组' WHERE subject_id = ?").run(safeId);
      changes = db.prepare("DELETE FROM subjects WHERE id = ?").run(safeId).changes;
    });
    if (!changes) return { error: "科目不存在" };
    return { ok: true };
  };

  const listBanks = () => {
    const rows = db.prepare(`
      SELECT b.*, s.name AS subject_name, s.term AS subject_term, s.exam_date AS subject_exam_date,
             (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count
      FROM banks b
      LEFT JOIN subjects s ON s.id = b.subject_id
      ORDER BY b.created_at DESC
    `).all();
    return rows.map(rowToBank);
  };

  const getBank = (bankId) => {
    const row = db.prepare(`
      SELECT b.*, s.name AS subject_name, s.term AS subject_term, s.exam_date AS subject_exam_date,
             (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count
      FROM banks b
      LEFT JOIN subjects s ON s.id = b.subject_id
      WHERE b.id = ?
    `).get(sanitizeId(bankId));
    return rowToBank(row);
  };

  const loadBankQuestions = (bankId) => {
    const rows = db.prepare("SELECT * FROM questions WHERE bank_id = ? ORDER BY rowid ASC").all(sanitizeId(bankId));
    return rows.map(rowToQuestion);
  };

  const resolveSubjectBinding = (subjectId, fallbackFolder) => {
    const cleanId = subjectId ? sanitizeId(subjectId) : "";
    const sub = cleanId ? getSubject(cleanId) : null;
    return {
      subjectId: sub ? sub.id : "",
      folder: sub ? sub.name : (String(fallbackFolder || "默认分组").trim() || "默认分组")
    };
  };

  const createBank = ({ name, description = "", folder = "默认分组", password = "", subjectId = "", category = "theory" }) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return { error: "题库名称不能为空" };
    const now = new Date().toISOString();
    const id = `b_${crypto.randomUUID().slice(0, 8)}`;
    const binding = resolveSubjectBinding(subjectId, folder);
    db.prepare(`
      INSERT INTO banks (id, name, description, folder, password, subject_id, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, trimmed, String(description || "").trim(), binding.folder, String(password || "").trim(), binding.subjectId, normalizeCategory(category), now, now);
    return { bank: getBank(id) };
  };

  const updateBank = (bankId, { name, description, folder, password, subjectId, category }) => {
    const current = getBank(bankId);
    if (!current) return { error: "题库不存在" };
    const nextName = name !== undefined ? String(name).trim() : current.name;
    if (!nextName) return { error: "题库名称不能为空" };
    const nextDesc = description !== undefined ? String(description).trim() : current.description;
    const nextPwd = password !== undefined ? String(password).trim() : current.password;
    const nextCat = category !== undefined ? normalizeCategory(category) : current.category;
    let nextSubjectId = current.subjectId;
    let nextFolder = folder !== undefined ? (String(folder).trim() || "默认分组") : current.folder;
    if (subjectId !== undefined) {
      const binding = resolveSubjectBinding(subjectId, folder !== undefined ? folder : "默认分组");
      nextSubjectId = binding.subjectId;
      if (binding.subjectId) nextFolder = binding.folder;
      else if (current.subjectId && folder === undefined) nextFolder = "默认分组";
    }
    db.prepare(`
      UPDATE banks SET name = ?, description = ?, folder = ?, password = ?, subject_id = ?, category = ?, updated_at = ? WHERE id = ?
    `).run(nextName, nextDesc, nextFolder, nextPwd, nextSubjectId, nextCat, new Date().toISOString(), current.id);
    return { bank: getBank(current.id) };
  };

  const deleteBank = (bankId) => {
    const safeId = sanitizeId(bankId);
    let changes = 0;
    withTx(db, () => {
      changes = db.prepare("DELETE FROM banks WHERE id = ?").run(safeId).changes;
      if (changes) {
        db.prepare("DELETE FROM user_progress WHERE bank_id = ?").run(safeId);
        db.prepare("DELETE FROM question_wrong_stats WHERE bank_id = ?").run(safeId);
      }
    });
    if (!changes) return { error: "题库不存在" };
    return { ok: true };
  };

  const ensureDefaultBank = () => {
    const existing = getBank("default");
    if (existing) return existing;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO banks (id, name, description, folder, password, created_at, updated_at)
      VALUES ('default', '默认题库', '本地与油猴脚本自动归档题库', '默认分组', '', ?, ?)
    `).run(now, now);
    return getBank("default");
  };

  const CHOICE_TYPES = new Set(["0", "1", "3", "5"]);
  const RAW_ANSWER_TYPES = new Set(["4", "6", "7", "8"]);
  const resolveAnswers = (raw, options, typeCode) => (
    RAW_ANSWER_TYPES.has(String(typeCode || "")) ? normalizeAnswers(raw) : expandStoredAnswers(raw, options)
  );

  const upsertOne = (bankId, body) => {
    const title = String(body.title || body.question || "").trim();
    const qType = body.type == null || body.type === "" ? "0" : String(body.type);
    const rawOptions = Array.isArray(body.options) ? body.options.map(String) : [];
    const options = CHOICE_TYPES.has(qType) ? rawOptions : [];
    const answers = resolveAnswers(body.answers || body.answer, options, qType);
    if (!title || !answers.length) return { status: 400, wrote: false, created: false, skipped: false, msg: "title 和 answers 必填" };

    const norm = normalizeTitle(title);
    const existing = db.prepare("SELECT * FROM questions WHERE bank_id = ? AND norm_title = ? LIMIT 1").get(bankId, norm);
    const skipIfExists = Boolean(body.skipIfExists);
    const now = new Date().toISOString();

    if (existing) {
      const existingObj = rowToQuestion(existing);
      if (skipIfExists && hasCompleteAnswers(existingObj)) {
        return { status: 200, wrote: false, created: false, skipped: true, answers: normalizeAnswers(existingObj.answers) };
      }
      db.prepare(`
        UPDATE questions
        SET no = ?, title = ?, type = ?, options_json = ?, answers_json = ?, analysis = ?, chapter = ?, difficulty = ?, images_json = ?, answer_images_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        body.no == null ? existingObj.no : String(body.no).trim(),
        title,
        body.type == null ? existingObj.type : qType,
        JSON.stringify(options),
        JSON.stringify(answers),
        String(body.analysis || "").trim() || existingObj.analysis || "",
        String(body.chapter || "").trim() || existingObj.chapter || "",
        String(body.difficulty || existingObj.difficulty || "中等").trim(),
        JSON.stringify(Array.isArray(body.images) ? body.images.map(String) : existingObj.images),
        JSON.stringify(Array.isArray(body.answerImages) ? body.answerImages.map(String) : existingObj.answerImages),
        now,
        existing.id
      );
      return { status: 200, wrote: true, created: false, skipped: false, answers };
    }

    let qId = body.id ? String(body.id) : crypto.randomUUID();
    if (body.id && db.prepare("SELECT 1 FROM questions WHERE id = ?").get(qId)) qId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO questions (id, bank_id, no, title, norm_title, type, options_json, answers_json, analysis, chapter, difficulty, images_json, answer_images_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      qId,
      bankId,
      body.no == null ? "" : String(body.no).trim(),
      title,
      norm,
      qType,
      JSON.stringify(options),
      JSON.stringify(answers),
      body.analysis == null ? "" : String(body.analysis).trim(),
      body.chapter == null ? "" : String(body.chapter).trim(),
      body.difficulty == null ? "中等" : String(body.difficulty).trim(),
      JSON.stringify(Array.isArray(body.images) ? body.images.map(String) : []),
      JSON.stringify(Array.isArray(body.answerImages) ? body.answerImages.map(String) : []),
      now
    );
    return { status: 200, wrote: true, created: true, skipped: false, answers };
  };

  const countQuestions = (bankId) =>
    Number(db.prepare("SELECT COUNT(*) AS cnt FROM questions WHERE bank_id = ?").get(bankId).cnt);

  const upsertQuestion = (bankId, body) => {
    const bank = getBank(bankId);
    if (!bank) return { status: 404, msg: "题库不存在" };
    const result = upsertOne(bank.id, body);
    if (result.wrote) {
      db.prepare("UPDATE banks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), bank.id);
    }
    return { ...result, total: countQuestions(bank.id) };
  };

  const importQuestions = (bankId, items, skipIfExists = false) => {
    const bank = getBank(bankId);
    if (!bank) return { status: 404, msg: "题库不存在" };
    let created = 0;
    let updated = 0;
    let skipped = 0;
    withTx(db, () => {
      for (const item of items) {
        if (!item || typeof item !== "object") {
          skipped += 1;
          continue;
        }
        const res = upsertOne(bank.id, { ...item, skipIfExists: item.skipIfExists ?? skipIfExists });
        if (res.status !== 200 || res.skipped) skipped += 1;
        else if (res.created) created += 1;
        else updated += 1;
      }
      if (created > 0 || updated > 0) {
        db.prepare("UPDATE banks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), bank.id);
      }
    });
    return { status: 200, created, updated, skipped, total: countQuestions(bank.id) };
  };

  const mergeBanks = ({ sourceIds = [], targetName, folder = "默认分组", subjectId = "", category = "theory" }) => {
    const cleanIds = [...new Set(sourceIds.map(sanitizeId))].filter((id) => getBank(id));
    if (cleanIds.length < 2) return { error: "请至少选择 2 个有效题库进行合并" };
    const created = createBank({ name: targetName || "合并题库", folder, subjectId, category });
    if (created.error) return created;
    const allItems = cleanIds.flatMap((id) => loadBankQuestions(id).map(({ id: _qid, ...rest }) => rest));
    const imp = importQuestions(created.bank.id, allItems, true);
    return { bank: getBank(created.bank.id), ...imp };
  };

  const updateQuestion = (bankId, questionId, body) => {
    const bank = getBank(bankId);
    if (!bank) return { status: 404, msg: "题库不存在" };
    const existing = db.prepare("SELECT * FROM questions WHERE id = ? AND bank_id = ?").get(questionId, bank.id);
    if (!existing) return { status: 404, msg: "试题不存在" };
    const cur = rowToQuestion(existing);
    const title = String(body.title || body.question || "").trim();
    const nextType = body.type == null || body.type === "" ? cur.type : String(body.type);
    const rawOptions = Array.isArray(body.options) ? body.options.map(String) : cur.options;
    const options = CHOICE_TYPES.has(nextType) ? rawOptions : [];
    const answers = resolveAnswers(body.answers || body.answer, options, nextType);
    if (!title || !answers.length) return { status: 400, msg: "题干和答案必填" };
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE questions
      SET no = ?, title = ?, norm_title = ?, type = ?, options_json = ?, answers_json = ?, analysis = ?, chapter = ?, difficulty = ?, images_json = ?, answer_images_json = ?, updated_at = ?
      WHERE id = ? AND bank_id = ?
    `).run(
      body.no == null ? cur.no : String(body.no).trim(),
      title,
      normalizeTitle(title),
      nextType,
      JSON.stringify(options),
      JSON.stringify(answers),
      body.analysis == null ? cur.analysis : String(body.analysis).trim(),
      body.chapter == null ? cur.chapter : String(body.chapter).trim(),
      body.difficulty == null ? cur.difficulty : String(body.difficulty).trim(),
      JSON.stringify(Array.isArray(body.images) ? body.images.map(String) : cur.images),
      JSON.stringify(Array.isArray(body.answerImages) ? body.answerImages.map(String) : cur.answerImages),
      now,
      questionId,
      bank.id
    );
    db.prepare("UPDATE banks SET updated_at = ? WHERE id = ?").run(now, bank.id);
    const updatedRow = db.prepare("SELECT * FROM questions WHERE id = ?").get(questionId);
    return { status: 200, question: rowToQuestion(updatedRow), total: countQuestions(bank.id) };
  };

  const batchUpdateOrDelete = (bankId, { ids, action, type, chapter, difficulty }) => {
    const bank = getBank(bankId);
    if (!bank) return { status: 404, msg: "题库不存在" };
    if (action !== "delete" && action !== "update") return { status: 400, msg: "不支持的批量操作" };
    const idList = Array.isArray(ids) ? ids.map(String) : [];
    if (!idList.length) return { status: 400, msg: "未选择试题" };
    const now = new Date().toISOString();
    let affected = 0;

    withTx(db, () => {
      if (action === "delete") {
        const stmt = db.prepare("DELETE FROM questions WHERE id = ? AND bank_id = ?");
        const wrongStmt = db.prepare("DELETE FROM question_wrong_stats WHERE bank_id = ? AND question_id = ?");
        for (const qid of idList) {
          const ch = stmt.run(qid, bank.id).changes;
          if (ch) {
            affected += ch;
            wrongStmt.run(bank.id, qid);
          }
        }
      } else {
        for (const qid of idList) {
          const row = db.prepare("SELECT type, options_json, chapter, difficulty FROM questions WHERE id = ? AND bank_id = ?").get(qid, bank.id);
          if (!row) continue;
          const nextType = type !== undefined && type !== "" ? String(type) : row.type;
          const nextOpts = CHOICE_TYPES.has(nextType) ? row.options_json : "[]";
          const nextChap = chapter !== undefined ? String(chapter).trim() : row.chapter;
          const nextDiff = difficulty !== undefined && difficulty !== "" ? String(difficulty).trim() : row.difficulty;
          affected += db.prepare("UPDATE questions SET type = ?, options_json = ?, chapter = ?, difficulty = ?, updated_at = ? WHERE id = ? AND bank_id = ?")
            .run(nextType, nextOpts, nextChap, nextDiff, now, qid, bank.id).changes;
        }
      }
      db.prepare("UPDATE banks SET updated_at = ? WHERE id = ?").run(now, bank.id);
    });

    return { status: 200, affected, total: countQuestions(bank.id) };
  };

  const deleteQuestion = (bankId, questionId) => {
    const res = batchUpdateOrDelete(bankId, { ids: [questionId], action: "delete" });
    if (res.status === 200 && res.affected === 0) return { status: 404, msg: "试题不存在" };
    return res;
  };

  const searchQuestions = ({ query = "", bankId = "", type = "" }) => {
    const keyword = String(query || "").trim().toLowerCase();
    const normKeyword = normalizeTitle(query);
    const clauses = ["b.password = ''"];
    const params = [];
    if (bankId) {
      clauses.push("q.bank_id = ?");
      params.push(sanitizeId(bankId));
    }
    if (type !== "") {
      clauses.push("q.type = ?");
      params.push(String(type));
    }
    if (keyword) {
      clauses.push("(LOWER(q.title || ' ' || q.options_json || ' ' || q.answers_json || ' ' || q.analysis) LIKE ? OR q.norm_title LIKE ?)");
      params.push(`%${keyword}%`, `%${normKeyword || keyword}%`);
    }
    const sql = `
      SELECT q.*, b.name AS bank_name
      FROM questions q
      JOIN banks b ON b.id = q.bank_id
      WHERE ${clauses.join(" AND ")}
      LIMIT 200
    `;
    return db.prepare(sql).all(...params).map((row) => ({
      ...rowToQuestion(row),
      bankId: row.bank_id,
      bankName: row.bank_name
    }));
  };

  return {
    listSubjects,
    getSubject,
    createSubject,
    updateSubject,
    deleteSubject,
    listBanks,
    getBank,
    ensureDefaultBank,
    createBank,
    updateBank,
    deleteBank,
    mergeBanks,
    loadBankQuestions,
    upsertQuestion,
    importQuestions,
    updateQuestion,
    deleteQuestion,
    batchUpdateOrDelete,
    searchQuestions
  };
};
