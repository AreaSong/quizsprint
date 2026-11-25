import assert from "node:assert/strict";
import test from "node:test";
import { addQuestion, expandStoredAnswers } from "./question-record.mjs";

const OPTIONS = ["大西洋", "印度洋", "太平洋", "北冰洋"];

test("把单个字母答案转成选项正文", () => {
  assert.deepEqual(expandStoredAnswers(["C"], OPTIONS), ["太平洋"]);
  assert.deepEqual(expandStoredAnswers(["BC"], ["煤炭", "太阳能", "风能", "石油"]), ["太阳能", "风能"]);
  assert.deepEqual(expandStoredAnswers(["A", "C"], OPTIONS), ["大西洋", "太平洋"]);
});

test("已经是正文或填空内容时不改写", () => {
  assert.deepEqual(expandStoredAnswers(["太平洋"], OPTIONS), ["太平洋"]);
  assert.deepEqual(expandStoredAnswers(["北京"], []), ["北京"]);
});

test("判断题口语答案转成正确/错误", () => {
  assert.deepEqual(expandStoredAnswers(["对"], ["正确", "错误"]), ["正确"]);
  assert.deepEqual(expandStoredAnswers(["错"], []), ["错误"]);
});

test("skipIfExists 时完整题不被覆盖", () => {
  const questions = [{
    title: "地球上面积最大的大洋是",
    type: "0",
    options: OPTIONS,
    answers: ["太平洋"]
  }];
  const result = addQuestion(questions, {
    title: "地球上面积最大的大洋是",
    type: "0",
    options: OPTIONS,
    answers: ["A"],
    skipIfExists: true
  });
  assert.equal(result.created, false);
  assert.equal(result.skipped, true);
  assert.equal(result.wrote, false);
  assert.deepEqual(questions[0].answers, ["太平洋"]);
});

test("skipIfExists 时无答案的同题干会被补全，字母会转正文", () => {
  const questions = [{
    title: "地球上面积最大的大洋是",
    type: "0",
    options: OPTIONS,
    answers: []
  }];
  const result = addQuestion(questions, {
    title: "地球上面积最大的大洋是",
    type: "0",
    options: OPTIONS,
    answers: ["C"],
    skipIfExists: true
  });
  assert.equal(result.created, false);
  assert.equal(result.skipped, false);
  assert.equal(result.wrote, true);
  assert.deepEqual(questions[0].answers, ["太平洋"]);
});

test("没有 skipIfExists 时仍按题干覆盖", () => {
  const questions = [{
    title: "地球上面积最大的大洋是",
    type: "0",
    options: OPTIONS,
    answers: ["太平洋"]
  }];
  const result = addQuestion(questions, {
    title: "地球上面积最大的大洋是",
    answers: ["大西洋"]
  });
  assert.equal(result.created, false);
  assert.equal(result.skipped, false);
  assert.deepEqual(questions[0].answers, ["大西洋"]);
});

test("新题会新增", () => {
  const questions = [];
  const result = addQuestion(questions, {
    title: "一年中白昼最长的节气是",
    type: "0",
    options: ["春分", "夏至", "秋分", "冬至"],
    answers: ["B"]
  });
  assert.equal(result.created, true);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].answers, ["夏至"]);
});
