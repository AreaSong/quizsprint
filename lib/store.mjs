import crypto from "node:crypto";
import { expandStoredAnswers, hasCompleteAnswers, normalizeAnswers, normalizeTitle } from "../question-record.mjs";
import { getDb, withTx } from "./db.mjs";
import { sanitizeId } from "./fs-utils.mjs";

const rowToBank = (row) => (row ? {
  id: row.id,
  name: row.name,
  description: row.description,
  folder: row.folder,
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
  updatedAt: row.updated_at
});

export const createStore = (dataDir) => {
  const db = getDb(dataDir);

  const listBanks = () => {
    const rows = db.prepare(`
      SELECT b.*, (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count
      FROM banks b
      ORDER BY b.created_at DESC
    `).all();
    return rows.map(rowToBank);
  };

  const getBank = (bankId) => {
    const row = db.prepare(`
      SELECT b.*, (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count
      FROM banks b
      WHERE b.id = ?
    `).get(sanitizeId(bankId));
    return rowToBank(row);
  };

  const loadBankQuestions = (bankId) => {
    const rows = db.prepare("SELECT * FROM questions WHERE bank_id = ? ORDER BY rowid ASC").all(sanitizeId(bankId));
    return rows.map(rowToQuestion);
  };

  const createBank = ({ name, description = "", folder = "默认分组", password = "" }) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return { error: "题库名称不能为空" };
    const now = new Date().toISOString();
    const id = `b_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO banks (id, name, description, folder, password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, trimmed, String(description || "").trim(), String(folder || "默认分组").trim() || "默认分组", String(password || "").trim(), now, now);
    return { bank: getBank(id) };
  };

  const updateBank = (bankId, { name, description, folder, password }) => {
    const current = getBank(bankId);
    if (!current) return { error: "题库不存在" };
    const nextName = name !== undefined ? String(name).trim() : current.name;
    if (!nextName) return { error: "题库名称不能为空" };
    const nextDesc = description !== undefined ? String(description).trim() : current.description;
    const nextFolder = folder !== undefined ? (String(folder).trim() || "默认分组") : current.folder;
    const nextPwd = password !== undefined ? String(password).trim() : current.password;
    db.prepare(`
      UPDATE banks SET name = ?, description = ?, folder = ?, password = ?, updated_at = ? WHERE id = ?
    `).run(nextName, nextDesc, nextFolder, nextPwd, new Date().toISOString(), current.id);
    return { bank: getBank(current.id) };
  };

  const deleteBank = (bankId) => {
    const res = db.prepare("DELETE FROM banks WHERE id = ?").run(sanitizeId(bankId));
    if (!res.changes) return { error: "题库不存在" };
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

  const upsertOne = (bankId, body) => {
    const title = String(body.title || body.question || "").trim();
    const options = Array.isArray(body.options) ? body.options.map(String) : [];
    const answers = expandStoredAnswers(body.answers || body.answer, options);
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
        SET no = ?, title = ?, type = ?, options_json = ?, answers_json = ?, analysis = ?, chapter = ?, difficulty = ?, images_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        body.no == null ? existingObj.no : String(body.no).trim(),
        title,
        body.type == null ? existingObj.type : String(body.type),
        JSON.stringify(options),
        JSON.stringify(answers),
        String(body.analysis || "").trim() || existingObj.analysis || "",
        String(body.chapter || "").trim() || existingObj.chapter || "",
        String(body.difficulty || existingObj.difficulty || "中等").trim(),
        JSON.stringify(Array.isArray(body.images) ? body.images.map(String) : existingObj.images),
        now,
        existing.id
      );
      return { status: 200, wrote: true, created: false, skipped: false, answers };
    }

    const qId = body.id ? String(body.id) : crypto.randomUUID();
    db.prepare(`
      INSERT INTO questions (id, bank_id, no, title, norm_title, type, options_json, answers_json, analysis, chapter, difficulty, images_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      qId,
      bankId,
      body.no == null ? "" : String(body.no).trim(),
      title,
      norm,
      body.type == null ? "0" : String(body.type),
      JSON.stringify(options),
      JSON.stringify(answers),
      body.analysis == null ? "" : String(body.analysis).trim(),
      body.chapter == null ? "" : String(body.chapter).trim(),
      body.difficulty == null ? "中等" : String(body.difficulty).trim(),
      JSON.stringify(Array.isArray(body.images) ? body.images.map(String) : []),
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

  const mergeBanks = ({ sourceIds = [], targetName, folder = "默认分组" }) => {
    const cleanIds = [...new Set(sourceIds.map(sanitizeId))].filter((id) => getBank(id));
    if (cleanIds.length < 2) return { error: "请至少选择 2 个有效题库进行合并" };
    const created = createBank({ name: targetName || "合并题库", folder });
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
    const options = Array.isArray(body.options) ? body.options.map(String) : cur.options;
    const answers = expandStoredAnswers(body.answers || body.answer, options);
    if (!title || !answers.length) return { status: 400, msg: "题干和答案必填" };
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE questions
      SET no = ?, title = ?, norm_title = ?, type = ?, options_json = ?, answers_json = ?, analysis = ?, chapter = ?, difficulty = ?, images_json = ?, updated_at = ?
      WHERE id = ? AND bank_id = ?
    `).run(
      body.no == null ? cur.no : String(body.no).trim(),
      title,
      normalizeTitle(title),
      body.type == null ? cur.type : String(body.type),
      JSON.stringify(options),
      JSON.stringify(answers),
      body.analysis == null ? cur.analysis : String(body.analysis).trim(),
      body.chapter == null ? cur.chapter : String(body.chapter).trim(),
      body.difficulty == null ? cur.difficulty : String(body.difficulty).trim(),
      JSON.stringify(Array.isArray(body.images) ? body.images.map(String) : cur.images),
      now,
      questionId,
      bank.id
    );
    db.prepare("UPDATE banks SET updated_at = ? WHERE id = ?").run(now, bank.id);
    const updatedRow = db.prepare("SELECT * FROM questions WHERE id = ?").get(questionId);
    return { status: 200, question: rowToQuestion(updatedRow), total: countQuestions(bank.id) };
  };

  const batchUpdateOrDelete = (bankId, { ids, action, type, chapter }) => {
    const bank = getBank(bankId);
    if (!bank) return { status: 404, msg: "题库不存在" };
    const idList = Array.isArray(ids) ? ids.map(String) : [];
    if (!idList.length) return { status: 400, msg: "未选择试题" };
    const now = new Date().toISOString();
    let affected = 0;

    withTx(db, () => {
      if (action === "delete") {
        const stmt = db.prepare("DELETE FROM questions WHERE id = ? AND bank_id = ?");
        for (const qid of idList) affected += stmt.run(qid, bank.id).changes;
      } else if (action === "update") {
        for (const qid of idList) {
          const row = db.prepare("SELECT type, chapter FROM questions WHERE id = ? AND bank_id = ?").get(qid, bank.id);
          if (!row) continue;
          const nextType = type !== undefined && type !== "" ? String(type) : row.type;
          const nextChap = chapter !== undefined ? String(chapter).trim() : row.chapter;
          affected += db.prepare("UPDATE questions SET type = ?, chapter = ?, updated_at = ? WHERE id = ? AND bank_id = ?")
            .run(nextType, nextChap, now, qid, bank.id).changes;
        }
      }
      db.prepare("UPDATE banks SET updated_at = ? WHERE id = ?").run(now, bank.id);
    });

    if (action !== "delete" && action !== "update") return { status: 400, msg: "不支持的批量操作" };
    return { status: 200, affected, total: countQuestions(bank.id) };
  };

  const deleteQuestion = (bankId, questionId) =>
    batchUpdateOrDelete(bankId, { ids: [questionId], action: "delete" });

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
