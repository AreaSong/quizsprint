import crypto from "node:crypto";
import { gradeInteractiveLab, parseLabSpec } from "../public/js/labs/lab-grader.js";
import { getDb } from "./db.mjs";
import { sanitizeId } from "./fs-utils.mjs";

const normText = (v) => String(v || "").trim().toLowerCase();
const toFiniteNum = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const round1 = (n) => Math.round(toFiniteNum(n, 0) * 10) / 10;

export const scoreQuestionAnswer = (q, userSelected, rules = {}) => {
  if (String(q.type) === "9") {
    const spec = parseLabSpec(q);
    if (!spec) return { correct: false, ratio: 0 };
    const g = gradeInteractiveLab(spec, userSelected);
    return { correct: Boolean(g.correct), ratio: Number(g.ratio || 0) };
  }
  const expected = (q.answers || []).map(normText).filter(Boolean);
  const actual = (Array.isArray(userSelected) ? userSelected : [userSelected]).map(normText).filter(Boolean);
  if (!expected.length || !actual.length) return { correct: false, ratio: 0 };

  if (q.type === "2" || q.type === "7") {
    const matched = expected.filter((ans, idx) => ans === actual[idx]).length;
    if (matched === expected.length && actual.length === expected.length) return { correct: true, ratio: 1 };
    if ((q.type === "7" || rules.fillPartialScore) && matched > 0) return { correct: false, ratio: matched / expected.length };
    return { correct: false, ratio: 0 };
  }

  const expSet = new Set(expected);
  const uniq = [...new Set(actual)];
  if ((q.type === "1" || q.type === "5") && rules.multiPartialScore) {
    if (uniq.some((a) => !expSet.has(a))) return { correct: false, ratio: 0 };
    if (uniq.length === expSet.size) return { correct: true, ratio: 1 };
    return { correct: false, ratio: uniq.length / expSet.size };
  }

  if (q.type === "8") {
    const matched = uniq.filter((item) => expSet.has(item)).length;
    if (matched === expSet.size && uniq.length === expSet.size) return { correct: true, ratio: 1 };
    return { correct: false, ratio: matched > 0 ? matched / expSet.size : 0 };
  }

  const allMatch = uniq.length === expSet.size && uniq.every((item) => expSet.has(item));
  return { correct: allMatch, ratio: allMatch ? 1 : 0 };
};

const rowToExam = (row) => (row ? {
  id: row.id,
  title: row.title,
  bankId: row.bank_id,
  bankName: row.bank_name,
  durationMinutes: Number(row.duration_minutes),
  passScore: Number(row.pass_score),
  totalScore: Number(row.total_score || 100),
  accessCode: row.access_code,
  maxTabSwitches: Number(row.max_tab_switches),
  disableCopy: Boolean(row.disable_copy),
  multiPartialScore: Boolean(row.multi_partial_score),
  fillPartialScore: Boolean(row.fill_partial_score),
  startTime: row.start_time || "",
  endTime: row.end_time || "",
  maxAttempts: Number(row.max_attempts || 0),
  showAnswerAfterSubmit: row.show_answer_after_submit === undefined ? true : Boolean(row.show_answer_after_submit),
  questionScores: JSON.parse(row.question_scores_json || "{}"),
  questionIds: JSON.parse(row.question_ids_json || "[]"),
  questionsSnapshot: JSON.parse(row.questions_snapshot_json || "[]"),
  createdAt: row.created_at
} : null);

const rowToSubmission = (row) => ({
  id: row.id,
  userId: row.user_id || "",
  studentName: row.student_name,
  studentNo: row.student_no,
  score: Number(row.score),
  passed: Boolean(row.passed),
  correctCount: Number(row.correct_count),
  totalCount: Number(row.total_count),
  tabSwitches: Number(row.tab_switches),
  usedSeconds: Number(row.used_seconds),
  manualGraded: row.manual_graded === undefined ? true : Boolean(row.manual_graded),
  submittedAt: row.submitted_at,
  details: JSON.parse(row.details_json || "[]")
});

const pickQuestionsAndScores = (payload, pool) => {
  const scores = {};
  if (Array.isArray(payload.selectedQuestionIds) && payload.selectedQuestionIds.length) {
    const idSet = new Set(payload.selectedQuestionIds.map(String));
    const chosen = pool.filter((q) => idSet.has(q.id));
    const fallbackScore = chosen.length ? round1(100 / chosen.length) : 0;
    for (const q of chosen) {
      const custom = Number(payload.questionScores?.[q.id] ?? payload.typeScores?.[q.type]);
      scores[q.id] = custom > 0 ? custom : fallbackScore;
    }
    return { chosen, scores };
  }

  const typeCfg = payload.typeConfig && typeof payload.typeConfig === "object" ? payload.typeConfig : null;
  const hasTypeRules = typeCfg && Object.values(typeCfg).some((c) => Number(c?.count || 0) > 0);
  if (hasTypeRules) {
    const chosen = [];
    for (const [typeCode, cfg] of Object.entries(typeCfg)) {
      const need = Math.max(0, Number(cfg?.count || 0));
      if (!need) continue;
      const picked = pool.filter((q) => String(q.type) === String(typeCode))
        .sort(() => Math.random() - 0.5)
        .slice(0, need);
      const itemScore = Math.max(0.5, Number(cfg?.score || 2));
      for (const q of picked) {
        chosen.push(q);
        scores[q.id] = itemScore;
      }
    }
    return { chosen, scores };
  }

  const count = Math.min(pool.length, Math.max(1, Number(payload.questionCount || 20)));
  const chosen = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
  const per = round1(100 / chosen.length);
  for (const q of chosen) scores[q.id] = per;
  return { chosen, scores };
};

export const createExamStore = (dataDir) => {
  const db = getDb(dataDir);

  const listExams = () =>
    db.prepare("SELECT * FROM exams ORDER BY created_at DESC").all().map(rowToExam);

  const getExam = (examId) =>
    rowToExam(db.prepare("SELECT * FROM exams WHERE id = ?").get(sanitizeId(examId)));

  const createExam = (payload, questionsPool) => {
    const title = String(payload.title || "").trim();
    if (!title) return { error: "考试名称不能为空" };
    const { chosen, scores } = pickQuestionsAndScores(payload, questionsPool);
    if (!chosen.length) return { error: "未抽中任何有效试题，请检查抽题配置" };

    const sumScore = round1(chosen.reduce((s, q) => s + Number(scores[q.id] || 0), 0));
    const totalScore = sumScore > 0 ? sumScore : 100;
    const defaultPass = Math.round(totalScore * 0.6);
    const id = `ex_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO exams (
        id, title, bank_id, bank_name, duration_minutes, pass_score, total_score, access_code,
        max_tab_switches, disable_copy, multi_partial_score, fill_partial_score,
        start_time, end_time, max_attempts, show_answer_after_submit,
        question_scores_json, question_ids_json, questions_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, title, String(payload.bankId || ""), String(payload.bankName || ""),
      Math.max(1, toFiniteNum(payload.durationMinutes, 30)),
      Math.max(1, toFiniteNum(payload.passScore, defaultPass)),
      totalScore, String(payload.accessCode || "").trim(),
      Math.max(0, toFiniteNum(payload.maxTabSwitches, 3)), payload.disableCopy ? 1 : 0,
      payload.multiPartialScore ? 1 : 0, payload.fillPartialScore ? 1 : 0,
      String(payload.startTime || "").trim(), String(payload.endTime || "").trim(),
      Math.max(0, toFiniteNum(payload.maxAttempts, 0)),
      payload.showAnswerAfterSubmit === false ? 0 : 1,
      JSON.stringify(scores), JSON.stringify(chosen.map((q) => q.id)),
      JSON.stringify(chosen), now
    );
    return { exam: getExam(id) };
  };

  const updateExam = (examId, payload = {}) => {
    const existing = getExam(examId);
    if (!existing) return { error: "考试不存在", notFound: true };
    const title = String(payload.title ?? existing.title).trim();
    if (!title) return { error: "考试名称不能为空" };
    const durationMinutes = Math.max(1, toFiniteNum(payload.durationMinutes, existing.durationMinutes));
    const passScore = Math.max(1, toFiniteNum(payload.passScore, existing.passScore));
    const maxTabSwitches = Math.max(0, toFiniteNum(payload.maxTabSwitches, existing.maxTabSwitches));
    const disableCopy = payload.disableCopy !== undefined ? Boolean(payload.disableCopy) : existing.disableCopy;
    const multiPartialScore = payload.multiPartialScore !== undefined ? Boolean(payload.multiPartialScore) : existing.multiPartialScore;
    const fillPartialScore = payload.fillPartialScore !== undefined ? Boolean(payload.fillPartialScore) : existing.fillPartialScore;
    const startTime = payload.startTime !== undefined ? String(payload.startTime || "").trim() : existing.startTime;
    const endTime = payload.endTime !== undefined ? String(payload.endTime || "").trim() : existing.endTime;
    const maxAttempts = Math.max(0, toFiniteNum(payload.maxAttempts, existing.maxAttempts));
    const showAnswerAfterSubmit = payload.showAnswerAfterSubmit !== undefined
      ? Boolean(payload.showAnswerAfterSubmit)
      : existing.showAnswerAfterSubmit;
    const accessCode = payload.accessCode !== undefined ? String(payload.accessCode || "").trim() : existing.accessCode;

    db.prepare(`
      UPDATE exams SET
        title = ?, duration_minutes = ?, pass_score = ?, access_code = ?,
        max_tab_switches = ?, disable_copy = ?, multi_partial_score = ?, fill_partial_score = ?,
        start_time = ?, end_time = ?, max_attempts = ?, show_answer_after_submit = ?
      WHERE id = ?
    `).run(
      title, durationMinutes, passScore, accessCode,
      maxTabSwitches, disableCopy ? 1 : 0, multiPartialScore ? 1 : 0, fillPartialScore ? 1 : 0,
      startTime, endTime, maxAttempts, showAnswerAfterSubmit ? 1 : 0,
      existing.id
    );
    return { exam: getExam(existing.id) };
  };

  const deleteExam = (examId) => {
    const res = db.prepare("DELETE FROM exams WHERE id = ?").run(sanitizeId(examId));
    if (!res.changes) return { error: "考试不存在" };
    return { ok: true };
  };

  const getSubmissions = (examId) =>
    db.prepare("SELECT * FROM exam_submissions WHERE exam_id = ? ORDER BY submitted_at DESC")
      .all(sanitizeId(examId))
      .map(rowToSubmission);

  const getUserSubmissions = (userId) => {
    if (!userId) return [];
    const rows = db.prepare(`
      SELECT s.*, e.title AS exam_title, e.total_score, e.pass_score, e.show_answer_after_submit
      FROM exam_submissions s
      JOIN exams e ON e.id = s.exam_id
      WHERE s.user_id = ?
      ORDER BY s.submitted_at DESC
    `).all(String(userId));
    return rows.map((r) => {
      const sub = rowToSubmission(r);
      const showAns = Boolean(r.show_answer_after_submit);
      const masked = showAns ? sub : maskSubmissionIfHidden({ showAnswerAfterSubmit: false }, sub);
      return {
        ...masked,
        examId: r.exam_id,
        examTitle: r.exam_title,
        totalScore: Number(r.total_score || 100),
        passScore: Number(r.pass_score || 60),
        showAnswerAfterSubmit: showAns
      };
    });
  };

  const checkExamEligibility = (exam, userId = "", studentName = "") => {
    const nowMs = Date.now();
    if (exam.startTime && Number.isFinite(Date.parse(exam.startTime)) && nowMs < Date.parse(exam.startTime)) {
      return { error: `考试尚未开始（开考时间：${exam.startTime.replace("T", " ")}）` };
    }
    if (exam.endTime && Number.isFinite(Date.parse(exam.endTime)) && nowMs > Date.parse(exam.endTime)) {
      return { error: `考试已截止（截止时间：${exam.endTime.replace("T", " ")}）` };
    }
    if (exam.maxAttempts > 0) {
      let used = 0;
      if (userId) {
        used = db.prepare("SELECT COUNT(*) AS cnt FROM exam_submissions WHERE exam_id = ? AND user_id = ?")
          .get(exam.id, String(userId)).cnt;
      } else if (studentName) {
        used = db.prepare("SELECT COUNT(*) AS cnt FROM exam_submissions WHERE exam_id = ? AND student_name = ?")
          .get(exam.id, String(studentName)).cnt;
      }
      if (used >= exam.maxAttempts) {
        return { error: `本场考试最多允许参加 ${exam.maxAttempts} 次，你已用完次数` };
      }
    }
    return { ok: true };
  };

  const maskSubmissionIfHidden = (exam, submission) => {
    if (exam.showAnswerAfterSubmit) return submission;
    return {
      ...submission,
      details: submission.details.map((d) => ({ ...d, expected: [], answerHidden: true }))
    };
  };

  const submitExam = (examId, { userId = "", studentName, studentNo = "", answers = {}, tabSwitches = 0, usedSeconds = 0 }) => {
    const exam = getExam(examId);
    if (!exam) return { error: "考试不存在" };
    const name = String(studentName || "").trim();
    if (!name) return { error: "请填写考生姓名" };
    const elig = checkExamEligibility(exam, userId, name);
    if (elig.error) return elig;

    const questions = exam.questionsSnapshot || [];
    const fallbackPer = questions.length ? exam.totalScore / questions.length : 0;
    let totalEarned = 0;
    let correctCount = 0;
    let hasManual = false;

    const details = questions.map((q) => {
      const selected = answers[q.id] || [];
      const res = scoreQuestionAnswer(q, selected, {
        multiPartialScore: exam.multiPartialScore,
        fillPartialScore: exam.fillPartialScore
      });
      const maxScore = round1(Number(exam.questionScores?.[q.id]) || fallbackPer);
      const earnedScore = round1(maxScore * res.ratio);
      if (res.correct) correctCount += 1;
      const isSubjective = q.type === "4" || q.type === "6";
      if (isSubjective) hasManual = true;
      totalEarned += earnedScore;
      return {
        questionId: q.id,
        title: q.title,
        type: q.type,
        images: q.images || [],
        selected,
        expected: q.answers,
        correct: res.correct,
        ratio: res.ratio,
        maxScore,
        earnedScore,
        needManual: isSubjective
      };
    });

    const finalScore = round1(totalEarned);
    const submission = {
      id: `sub_${crypto.randomUUID().slice(0, 8)}`,
      userId: String(userId || ""),
      studentName: name,
      studentNo: String(studentNo || "").trim(),
      score: finalScore,
      passed: finalScore >= exam.passScore,
      correctCount,
      totalCount: questions.length,
      tabSwitches: Math.max(0, toFiniteNum(tabSwitches, 0)),
      usedSeconds: Math.max(0, toFiniteNum(usedSeconds, 0)),
      manualGraded: !hasManual,
      submittedAt: new Date().toISOString(),
      details
    };

    db.prepare(`
      INSERT INTO exam_submissions (
        id, exam_id, user_id, student_name, student_no, score, passed, correct_count,
        total_count, tab_switches, used_seconds, manual_graded, submitted_at, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      submission.id, exam.id, submission.userId, submission.studentName, submission.studentNo,
      submission.score, submission.passed ? 1 : 0, submission.correctCount, submission.totalCount,
      submission.tabSwitches, submission.usedSeconds, submission.manualGraded ? 1 : 0,
      submission.submittedAt, JSON.stringify(submission.details)
    );
    return { submission: maskSubmissionIfHidden(exam, submission) };
  };

  const gradeSubmission = (examId, submissionId, itemScores = {}) => {
    const exam = getExam(examId);
    if (!exam) return { error: "考试不存在" };
    const row = db.prepare("SELECT * FROM exam_submissions WHERE id = ? AND exam_id = ?")
      .get(sanitizeId(submissionId), exam.id);
    if (!row) return { error: "交卷记录不存在" };

    const sub = rowToSubmission(row);
    let nextTotal = 0;
    let nextCorrect = 0;
    const nextDetails = sub.details.map((d) => {
      const hasOverride = Object.prototype.hasOwnProperty.call(itemScores, d.questionId);
      const maxScore = Number(d.maxScore || 0);
      const earned = hasOverride
        ? Math.min(maxScore, Math.max(0, round1(itemScores[d.questionId])))
        : Number(d.earnedScore || 0);
      const correct = maxScore > 0 ? earned >= maxScore : Boolean(d.correct);
      if (correct) nextCorrect += 1;
      nextTotal += earned;
      return { ...d, earnedScore: earned, correct, needManual: false };
    });

    const finalScore = round1(nextTotal);
    const passed = finalScore >= exam.passScore;
    db.prepare(`
      UPDATE exam_submissions
      SET score = ?, passed = ?, correct_count = ?, manual_graded = 1, details_json = ?
      WHERE id = ? AND exam_id = ?
    `).run(finalScore, passed ? 1 : 0, nextCorrect, JSON.stringify(nextDetails), sub.id, exam.id);

    const updated = rowToSubmission(db.prepare("SELECT * FROM exam_submissions WHERE id = ?").get(sub.id));
    return { submission: updated };
  };

  const deleteSubmission = (examId, submissionId) => {
    const res = db.prepare("DELETE FROM exam_submissions WHERE id = ? AND exam_id = ?")
      .run(sanitizeId(submissionId), sanitizeId(examId));
    if (!res.changes) return { error: "交卷记录不存在" };
    return { ok: true };
  };

  const clearSubmissions = (examId) => {
    const exam = getExam(examId);
    if (!exam) return { error: "考试不存在" };
    const res = db.prepare("DELETE FROM exam_submissions WHERE exam_id = ?").run(exam.id);
    return { ok: true, removed: Number(res.changes || 0) };
  };

  const duplicateExam = (examId) => {
    const row = db.prepare("SELECT * FROM exams WHERE id = ?").get(sanitizeId(examId));
    if (!row) return { error: "考试不存在" };
    const nextId = `ex_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO exams (
        id, title, bank_id, bank_name, duration_minutes, pass_score, total_score, access_code,
        max_tab_switches, disable_copy, multi_partial_score, fill_partial_score,
        start_time, end_time, max_attempts, show_answer_after_submit,
        question_scores_json, question_ids_json, questions_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextId, `${row.title}（副本）`, row.bank_id, row.bank_name, row.duration_minutes,
      row.pass_score, row.total_score, row.access_code, row.max_tab_switches, row.disable_copy,
      row.multi_partial_score, row.fill_partial_score, row.start_time, row.end_time,
      row.max_attempts, row.show_answer_after_submit, row.question_scores_json,
      row.question_ids_json, row.questions_snapshot_json, now
    );
    return { exam: getExam(nextId) };
  };

  const countSubmissionsMap = () => {
    const out = {};
    for (const r of db.prepare("SELECT exam_id, COUNT(*) AS cnt FROM exam_submissions GROUP BY exam_id").all()) {
      out[r.exam_id] = Number(r.cnt || 0);
    }
    return out;
  };

  const shuffleDistinct = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    if (copy.length >= 2 && copy.every((v, idx) => v === arr[idx])) [copy[0], copy[1]] = [copy[1], copy[0]];
    return copy;
  };

  const sanitizeQuestionsForExam = (questions = []) => questions.map(({ answers, analysis, ...q }) => {
    if (String(q.type) === "7") {
      return { ...q, orderItems: shuffleDistinct((answers || []).map(String).filter(Boolean)) };
    }
    if (String(q.type) === "8") {
      const pairs = (answers || []).map((line) => {
        const s = String(line || "");
        const idx = s.includes("=>") ? s.indexOf("=>") : (s.includes("->") ? s.indexOf("->") : -1);
        if (idx < 0) return null;
        return { left: s.slice(0, idx).trim(), right: s.slice(idx + 2).trim() };
      }).filter((p) => p?.left && p?.right);
      return { ...q, matchLefts: pairs.map((p) => p.left), matchRights: shuffleDistinct(pairs.map((p) => p.right)) };
    }
    return q;
  });

  return {
    listExams,
    getExam,
    createExam,
    updateExam,
    duplicateExam,
    deleteExam,
    countSubmissionsMap,
    sanitizeQuestionsForExam,
    getSubmissions,
    getUserSubmissions,
    checkExamEligibility,
    submitExam,
    gradeSubmission,
    deleteSubmission,
    clearSubmissions
  };
};
