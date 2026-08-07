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
  eligibility: { verdict: "eligible", hard_blockers: [], risks: [], checks: ["未见明确限制。"] },
  match: {
    score: 72,
    verdict: "worth_applying",
    rationale: ["技能匹配。"],
    gaps: [],
    strengths: ["有相关建模经历。"],
    resume_angle: "突出科学机器学习。",
  },
  recommendation: "mass_apply",
};

const validOutreach = {
  who: ["联系招聘经理。"],
  channel: "使用 LinkedIn 连接请求。",
  note: "Hi [Name], I would value connecting.",
  message: "Hello, I am interested in this role and would welcome a brief conversation.",
};

test("cloud accepts only complete extract and split score outputs", () => {
  assert.equal(validateExtractOutput(validJob).title, "Applied Scientist");
  assert.throws(() => validateExtractOutput({ ...validJob, visa_sponsorship: "maybe" }), /visa_sponsorship/);
  assert.equal(validateScoreOutput(validScore).match.verdict, "worth_applying");
  assert.throws(() => validateScoreOutput({ ...validScore, match: { ...validScore.match, score: 101 } }), /score/);
  assert.throws(() => validateScoreOutput({ ...validScore, eligibility: { ...validScore.eligibility, hard_blockers: ["citizenship"] } }), /eligible.*hard_blockers/);
});

test("cloud fact-check failures become needs-review rather than clean", () => {
  assert.deepEqual(validateFactCheckOutput({ verdict: "clean", issues: [] }), { verdict: "clean", issues: [] });
  assert.throws(() => validateFactCheckOutput({ verdict: "unknown", issues: [] }), /verdict/);
  assert.deepEqual(factCheckNeedsReview(new Error("model output: PRIVATE")), {
    verdict: "needs-review",
    issues: [],
    error: "事实核查未完成或输出格式无效；需人工复核。",
  });
});

test("cloud outreach rejects malformed output before persistence", () => {
  assert.equal(validateOutreachOutput(validOutreach).message, validOutreach.message);
  assert.throws(() => validateOutreachOutput({ ...validOutreach, channel: "" }), /channel/);
  assert.throws(() => validateOutreachOutput({ ...validOutreach, who: ["ok", 3] }), /who/);
});
