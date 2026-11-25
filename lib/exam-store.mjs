import crypto from "node:crypto";
import { getDb } from "./db.mjs";
import { sanitizeId } from "./fs-utils.mjs";

const normText = (v) => String(v || "").trim().toLowerCase();

export const scoreQuestionAnswer = (q, userSelected, rules = {}) => {
  const expected = (q.answers || []).map(normText).filter(Boolean);
  const actual = (Array.isArray(userSelected) ? userSelected : [userSelected]).map(normText).filter(Boolean);
  if (!expected.length || !actual.length) return { correct: false, ratio: 0 };

  if ((q.type === "1" || q.type === "5") && rules.multiPartialScore) {
    const expSet = new Set(expected);
    if (actual.some((a) => !expSet.has(a))) return { correct: false, ratio: 0 };
    if (actual.length === expected.length) return { correct: true, ratio: 1 };
    return { correct: false, ratio: actual.length / expected.length };
  }

  if (q.type === "2") {
    const matched = expected.filter((ans, idx) => ans === actual[idx]).length;
    if (matched === expected.length) return { correct: true, ratio: 1 };
    if (rules.fillPartialScore && matched > 0) return { correct: false, ratio: matched / expected.length };
    return { correct: false, ratio: 0 };
  }

  const expSet = new Set(expected);
  const allMatch = actual.length === expected.length && actual.every((item) => expSet.has(item));
  return { correct: allMatch, ratio: allMatch ? 1 : 0 };
};

const rowToExam = (row) => (row ? {
  id: row.id,
  title: row.title,
  bankId: row.bank_id,
  bankName: row.bank_name,
  durationMinutes: Number(row.duration_minutes),
  passScore: Number(row.pass_score),
  accessCode: row.access_code,
  maxTabSwitches: Number(row.max_tab_switches),
  disableCopy: Boolean(row.disable_copy),
  multiPartialScore: Boolean(row.multi_partial_score),
  fillPartialScore: Boolean(row.fill_partial_score),
  questionIds: JSON.parse(row.question_ids_json || "[]"),
  questionsSnapshot: JSON.parse(row.questions_snapshot_json || "[]"),
  createdAt: row.created_at
} : null);

const rowToSubmission = (row) => ({
  id: row.id,
  studentName: row.student_name,
  studentNo: row.student_no,
  score: Number(row.score),
  passed: Boolean(row.passed),
  correctCount: Number(row.correct_count),
  totalCount: Number(row.total_count),
  tabSwitches: Number(row.tab_switches),
  usedSeconds: Number(row.used_seconds),
  submittedAt: row.submitted_at,
  details: JSON.parse(row.details_json || "[]")
});

export const createExamStore = (dataDir) => {
  const db = getDb(dataDir);

  const listExams = () =>
    db.prepare("SELECT * FROM exams ORDER BY created_at DESC").all().map(rowToExam);

  const getExam = (examId) =>
    rowToExam(db.prepare("SELECT * FROM exams WHERE id = ?").get(sanitizeId(examId)));

  const createExam = (payload, questionsPool) => {
    const title = String(payload.title || "").trim();
    if (!title) return { error: "考试名称不能为空" };
    const count = Math.min(questionsPool.length, Math.max(1, Number(payload.questionCount || 20)));
    const shuffled = [...questionsPool].sort(() => Math.random() - 0.5).slice(0, count);
    const id = `ex_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO exams (
        id, title, bank_id, bank_name, duration_minutes, pass_score, access_code,
        max_tab_switches, disable_copy, multi_partial_score, fill_partial_score,
        question_ids_json, questions_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      String(payload.bankId || ""),
      String(payload.bankName || ""),
      Math.max(1, Number(payload.durationMinutes || 30)),
      Math.max(1, Number(payload.passScore || 60)),
      String(payload.accessCode || "").trim(),
      Number(payload.maxTabSwitches ?? 3),
      payload.disableCopy ? 1 : 0,
      payload.multiPartialScore ? 1 : 0,
      payload.fillPartialScore ? 1 : 0,
      JSON.stringify(shuffled.map((q) => q.id)),
      JSON.stringify(shuffled),
      now
    );
    return { exam: getExam(id) };
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

  const submitExam = (examId, { studentName, studentNo = "", answers = {}, tabSwitches = 0, usedSeconds = 0 }) => {
    const exam = getExam(examId);
    if (!exam) return { error: "考试不存在" };
    const name = String(studentName || "").trim();
    if (!name) return { error: "请填写考生姓名" };

    const questions = exam.questionsSnapshot || [];
    const perScore = questions.length ? 100 / questions.length : 0;
    let totalScore = 0;
    let correctCount = 0;
    const details = questions.map((q) => {
      const selected = answers[q.id] || [];
      const res = scoreQuestionAnswer(q, selected, {
        multiPartialScore: exam.multiPartialScore,
        fillPartialScore: exam.fillPartialScore
      });
      if (res.correct) correctCount += 1;
      totalScore += perScore * res.ratio;
      return {
        questionId: q.id,
        title: q.title,
        images: q.images || [],
        selected,
        expected: q.answers,
        correct: res.correct,
        ratio: res.ratio
      };
    });

    const finalScore = Math.round(totalScore * 10) / 10;
    const submission = {
      id: `sub_${crypto.randomUUID().slice(0, 8)}`,
      studentName: name,
      studentNo: String(studentNo || "").trim(),
      score: finalScore,
      passed: finalScore >= exam.passScore,
      correctCount,
      totalCount: questions.length,
      tabSwitches: Number(tabSwitches || 0),
      usedSeconds: Number(usedSeconds || 0),
      submittedAt: new Date().toISOString(),
      details
    };

    db.prepare(`
      INSERT INTO exam_submissions (
        id, exam_id, student_name, student_no, score, passed, correct_count,
        total_count, tab_switches, used_seconds, submitted_at, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      submission.id,
      exam.id,
      submission.studentName,
      submission.studentNo,
      submission.score,
      submission.passed ? 1 : 0,
      submission.correctCount,
      submission.totalCount,
      submission.tabSwitches,
      submission.usedSeconds,
      submission.submittedAt,
      JSON.stringify(submission.details)
    );
    return { submission };
  };

  return {
    listExams,
    getExam,
    createExam,
    deleteExam,
    getSubmissions,
    submitExam
  };
};
