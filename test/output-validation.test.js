import test from "node:test";
import assert from "node:assert/strict";
import {
  factCheckNeedsReview,
  validateExtractOutput,
  validateFactCheckOutput,
  validateOutreachOutput,
  validateScoreOutput,
} from "../src/output-validation.js";

const validJob = {
  error: null,
  company: "Example Labs",
  title: "Applied Scientist",
  location: "Remote",
  remote_policy: "remote",
  salary: null,
  required_skills: ["Python"],
  nice_to_have_skills: [],
  years_experience: null,
  visa_sponsorship: "unspecified",
  responsibilities_summary: "Build scientific machine-learning models.",
  notable: null,
};

const validScore = {
  eligibility: {
    verdict: "eligible",
    hard_blockers: [],
    risks: [],
    checks: ["岗位未列出与当前授权冲突的明确限制。"],
  },
  match: {
    score: 76,
    verdict: "worth_applying",
    rationale: ["技能匹配。"],
    gaps: ["缺少行业经验，可通过研究项目说明。"],
    strengths: ["有相关建模经历。"],
    resume_angle: "突出科学机器学习。",
  },
  recommendation: "main_target",
};

const validIssue = {
  type: "fabrication",
  quote: "Led a clinical trial.",
  problem: "主简历未记载该经历。",
  fix: "DELETE",
};

const validOutreach = {
  who: ["联系招聘经理。"],
  channel: "使用 LinkedIn 连接请求。",
  note: "Hi [Name], I would value connecting.",
  message: "Hello, I am interested in this role and would welcome a brief conversation.",
};

test("extract output accepts a no-job response or a complete job", () => {
  assert.deepEqual(validateExtractOutput({ error: "no_job_posting", reason: "Login page" }), {
    error: "no_job_posting",
    reason: "Login page",
  });
  assert.equal(validateExtractOutput(validJob).company, "Example Labs");
});

test("extract output rejects missing identifiers, invalid enums, and invalid arrays", () => {
  assert.throws(() => validateExtractOutput({ ...validJob, company: "" }), /company/);
  assert.throws(() => validateExtractOutput({ ...validJob, remote_policy: "flexible" }), /remote_policy/);
  assert.throws(() => validateExtractOutput({ ...validJob, required_skills: [1] }), /required_skills/);
});

test("score output separates eligibility from match and rejects conflicting decisions", () => {
  assert.equal(validateScoreOutput(validScore).match.score, 76);
  assert.throws(() => validateScoreOutput({ ...validScore, match: { ...validScore.match, score: 72.5 } }), /score/);
  assert.throws(() => validateScoreOutput({ ...validScore, eligibility: { ...validScore.eligibility, verdict: "maybe" } }), /eligibility.*verdict/);
  assert.throws(() => validateScoreOutput({ ...validScore, match: { ...validScore.match, rationale: "not an array" } }), /rationale/);
  assert.throws(
    () => validateScoreOutput({ ...validScore, eligibility: { ...validScore.eligibility, hard_blockers: ["公民身份要求"] } }),
    /eligible.*hard_blockers/,
  );
  assert.throws(
    () => validateScoreOutput({ ...validScore, eligibility: { verdict: "needs-verification", hard_blockers: [], risks: [], checks: ["签证未说明"] }, recommendation: "verify" }),
    /risks/,
  );
  assert.throws(
    () => validateScoreOutput({ ...validScore, eligibility: { verdict: "needs-verification", hard_blockers: [], risks: ["sponsorship 未说明"], checks: ["需核实"] }, recommendation: "skip" }),
    /recommendation.*verify/,
  );
});

test("fact-check output requires a consistent verdict and complete issue objects", () => {
  assert.deepEqual(validateFactCheckOutput({ verdict: "clean", issues: [] }), { verdict: "clean", issues: [] });
  assert.equal(validateFactCheckOutput({ verdict: "issues", issues: [validIssue] }).issues.length, 1);
  assert.throws(() => validateFactCheckOutput({ verdict: "clean", issues: [validIssue] }), /clean/);
  assert.throws(() => validateFactCheckOutput({ verdict: "issues", issues: [] }), /issues/);
  assert.throws(() => validateFactCheckOutput({ verdict: "issues", issues: [{ ...validIssue, type: "other" }] }), /type/);
});

test("a failed fact check is needs-review and never includes model source text", () => {
  const result = factCheckNeedsReview(new Error("JSON 解析失败，原文开头: PRIVATE RESUME TEXT"));
  assert.deepEqual(result, {
    verdict: "needs-review",
    issues: [],
    error: "事实核查未完成或输出格式无效；需人工复核。",
  });
  assert.doesNotMatch(result.error, /PRIVATE/);
});

test("outreach output requires usable strings before it can be saved", () => {
  assert.equal(validateOutreachOutput(validOutreach).note, validOutreach.note);
  assert.throws(() => validateOutreachOutput({ ...validOutreach, who: [] }), /who/);
  assert.throws(() => validateOutreachOutput({ ...validOutreach, note: "  " }), /note/);
  assert.throws(() => validateOutreachOutput({ ...validOutreach, message: null }), /message/);
});
