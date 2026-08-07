const REMOTE_POLICIES = new Set(["onsite", "hybrid", "remote", "unspecified"]);
const VISA_SPONSORSHIP = new Set(["supported", "not_supported", "unspecified"]);
const MATCH_VERDICTS = new Set(["strong_match", "worth_applying", "stretch", "low_match"]);
const ELIGIBILITY_VERDICTS = new Set(["eligible", "needs-verification", "ineligible"]);
const RECOMMENDATIONS = new Set(["main_target", "mass_apply", "stretch", "verify", "skip"]);
const FACT_CHECK_VERDICTS = new Set(["clean", "issues"]);
const ISSUE_TYPES = new Set(["fabrication", "exaggeration"]);

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} 必须是 JSON 对象。`);
  }
  return value;
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 必须是非空字符串。`);
  return value;
}

function nullableString(value, name) {
  if (value !== null && typeof value !== "string") throw new Error(`${name} 必须是字符串或 null。`);
  return value;
}

function stringArray(value, name, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} 必须是${min ? "非空" : ""}字符串数组。`);
  }
  return value;
}

function enumValue(value, name, allowed) {
  if (!allowed.has(value)) throw new Error(`${name} 必须为以下值之一: ${[...allowed].join(", ")}。`);
  return value;
}

/** 校验职位提取 Prompt 的两种明确分支：无职位，或完整职位对象。 */
export function validateExtractOutput(value) {
  const output = object(value, "职位提取输出");
  if (output.error !== null && output.error !== undefined) {
    nonEmptyString(output.error, "error");
    if (output.reason !== undefined) nonEmptyString(output.reason, "reason");
    return { error: output.error, ...(output.reason ? { reason: output.reason } : {}) };
  }

  nonEmptyString(output.company, "company");
  nonEmptyString(output.title, "title");
  nonEmptyString(output.location, "location");
  enumValue(output.remote_policy, "remote_policy", REMOTE_POLICIES);
  nullableString(output.salary, "salary");
  stringArray(output.required_skills, "required_skills");
  stringArray(output.nice_to_have_skills, "nice_to_have_skills");
  nullableString(output.years_experience, "years_experience");
  enumValue(output.visa_sponsorship, "visa_sponsorship", VISA_SPONSORSHIP);
  nonEmptyString(output.responsibilities_summary, "responsibilities_summary");
  nullableString(output.notable, "notable");
  return output;
}

/** 校验评分 Prompt 的数值、枚举和 blocker 一致性。 */
export function validateScoreOutput(value) {
  const output = object(value, "评分输出");
  const eligibility = object(output.eligibility, "eligibility");
  const match = object(output.match, "match");
  enumValue(eligibility.verdict, "eligibility.verdict", ELIGIBILITY_VERDICTS);
  stringArray(eligibility.hard_blockers, "eligibility.hard_blockers");
  stringArray(eligibility.risks, "eligibility.risks");
  stringArray(eligibility.checks, "eligibility.checks", { min: 1 });
  if (!Number.isInteger(match.score) || match.score < 0 || match.score > 100) {
    throw new Error("score 必须是 0 到 100 的整数。");
  }
  enumValue(match.verdict, "match.verdict", MATCH_VERDICTS);
  stringArray(match.rationale, "match.rationale", { min: 1 });
  stringArray(match.gaps, "match.gaps");
  stringArray(match.strengths, "match.strengths");
  nonEmptyString(match.resume_angle, "match.resume_angle");
  enumValue(output.recommendation, "recommendation", RECOMMENDATIONS);
  const bands = {
    strong_match: match.score >= 85,
    worth_applying: match.score >= 65 && match.score <= 84,
    stretch: match.score >= 40 && match.score <= 64,
    low_match: match.score <= 39,
  };
  if (!bands[match.verdict]) throw new Error("match.verdict 与 score 分数段不一致。");
  if (eligibility.verdict === "ineligible") {
    if (!eligibility.hard_blockers.length) throw new Error("eligibility.ineligible 必须包含 hard_blockers。");
    if (output.recommendation !== "skip") throw new Error("eligibility.ineligible 的 recommendation 必须是 skip。");
  } else if (eligibility.verdict === "needs-verification") {
    if (eligibility.hard_blockers.length) throw new Error("needs-verification 不得包含 hard_blockers。");
    if (!eligibility.risks.length) throw new Error("needs-verification 必须包含 risks。");
    if (output.recommendation !== "verify") throw new Error("needs-verification 的 recommendation 必须是 verify。");
  } else {
    if (eligibility.hard_blockers.length || eligibility.risks.length) throw new Error("eligible 不得包含 hard_blockers 或 risks。");
    const expected = match.score >= 75 ? "main_target" : match.score >= 60 ? "mass_apply" : match.verdict === "stretch" ? "stretch" : "skip";
    if (output.recommendation !== expected) throw new Error(`eligible 的 recommendation 必须是 ${expected}。`);
  }
  return output;
}

/** 校验简历/求职信事实核查的明确、可修正问题。 */
export function validateFactCheckOutput(value) {
  const output = object(value, "事实核查输出");
  enumValue(output.verdict, "verdict", FACT_CHECK_VERDICTS);
  if (!Array.isArray(output.issues)) throw new Error("issues 必须是数组。");
  if (output.verdict === "clean" && output.issues.length) {
    throw new Error("verdict 为 clean 时 issues 必须为空数组。");
  }
  if (output.verdict === "issues" && !output.issues.length) {
    throw new Error("verdict 为 issues 时 issues 必须包含至少一项。");
  }
  output.issues.forEach((issue, index) => {
    object(issue, `issues[${index}]`);
    enumValue(issue.type, `issues[${index}].type`, ISSUE_TYPES);
    nonEmptyString(issue.quote, `issues[${index}].quote`);
    nonEmptyString(issue.problem, `issues[${index}].problem`);
    nonEmptyString(issue.fix, `issues[${index}].fix`);
  });
  return output;
}

/** 校验外联内容，确保 note 压缩与持久化只处理完整结果。 */
export function validateOutreachOutput(value) {
  const output = object(value, "外联输出");
  stringArray(output.who, "who", { min: 1 });
  nonEmptyString(output.channel, "channel");
  nonEmptyString(output.note, "note");
  nonEmptyString(output.message, "message");
  return output;
}

/** 解析或 schema 失败时的保守事实核查结果；绝不附带模型原文。 */
export function factCheckNeedsReview() {
  return {
    verdict: "needs-review",
    issues: [],
    error: "事实核查未完成或输出格式无效；需人工复核。",
  };
}
