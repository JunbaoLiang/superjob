const REMOTE_POLICIES = new Set(["onsite", "hybrid", "remote", "unspecified"]);
const VISA_SPONSORSHIP = new Set(["supported", "not_supported", "unspecified"]);
const SCORE_VERDICTS = new Set(["strong_match", "worth_applying", "stretch", "skip"]);
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
  if (!Number.isInteger(output.score) || output.score < 0 || output.score > 100) {
    throw new Error("score 必须是 0 到 100 的整数。");
  }
  enumValue(output.verdict, "verdict", SCORE_VERDICTS);
  stringArray(output.rationale, "rationale", { min: 1 });
  stringArray(output.hard_blockers, "hard_blockers");
  stringArray(output.gaps, "gaps");
  stringArray(output.strengths, "strengths");
  nonEmptyString(output.resume_angle, "resume_angle");
  if (output.hard_blockers.length && output.verdict !== "skip") {
    throw new Error("hard_blockers 非空时 verdict 必须是 skip。");
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
