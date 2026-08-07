// 核心流水线:解析 JD → 打分 → 生成材料(事实核查 + 一页压缩)→ 外联建议。
// 与本地版逻辑一致,存储从文件目录换成 Postgres。
import { ask, askJSON } from "./llm.js";
import { loadPrompt, fill, loadProfile } from "./prompts.js";
import { makeJobId, insertJob, getJob, saveFields } from "./jobs.js";
import { writeMatchReport } from "./report.js";
import { exportJob, renderResumePdfPages } from "./export.js";
import { recordPolicyFor, refreshActiveMaterialReadiness } from "./material-readiness.js";
import { assertCanGenerateMaterials, scoreView, usesMassApplyAngle } from "./score-policy.js";
import {
  factCheckNeedsReview,
  validateExtractOutput,
  validateFactCheckOutput,
  validateOutreachOutput,
  validateScoreOutput,
} from "./output-validation.js";

/** skip 岗位海投模式使用的通用简历角度 */
const MASS_APPLY_ANGLE =
  "海投模式:该岗位与我的背景匹配度低,不追求完美贴合。" +
  "请突出可迁移能力(编程、数据分析、建模、解决复杂问题)和主简历中最扎实、最有说服力的真实经历," +
  "生成一份通用但可信的简历。切记:匹配度低更不能靠编造来凑,铁律照常生效。";

/** 功能一:解析 JD 原文 → 建职位记录。返回 { jobId, job } 或 { error } */
export async function extractJob(rawText, { pageTitle = "", pageUrl = "" } = {}) {
  const prompt = fill(loadPrompt("extract"), {
    PAGE_TITLE: pageTitle,
    PAGE_URL: pageUrl,
    RAW_TEXT: rawText,
  });
  const job = validateExtractOutput(await askJSON(prompt, { maxTokens: 3000 }));

  if (job.error) {
    return { error: job.error, reason: job.reason || "" };
  }

  const jobId = await makeJobId(job.company, job.title);
  job.url = pageUrl || null;
  job.captured_at = new Date().toISOString();
  await insertJob({
    id: jobId,
    status: "new",
    company: job.company,
    title: job.title,
    job,
    rawText,
    recordPolicy: recordPolicyFor("new", { materialProfile: "unknown" }),
  });
  return { jobId, job };
}

/** 功能二:匹配打分 → score 列 + match_report */
export async function scoreJob(jobId) {
  const row = await getJob(jobId);
  const prompt = fill(loadPrompt("score"), {
    JOB_JSON: JSON.stringify(row.job, null, 2),
    RAW_TEXT: row.raw_text,
    RESUME: await loadProfile("resume-master"),
    TARGET: await loadProfile("target"),
    PREFERENCES: await loadProfile("preferences"),
  });
  const score = validateScoreOutput(await askJSON(prompt, { maxTokens: 4000 }));
  await saveFields(jobId, { score });
  await writeMatchReport(jobId);
  return score;
}

/** 硬保证连接备注 ≤ limit 字符(LLM 数不准字符,代码兜底) */
async function ensureNoteLimit(note, limit = 200) {
  if (!note || note.length <= limit) return note;
  const prompt =
    `Shorten this LinkedIn connection-request note to AT MOST ${limit - 15} characters ` +
    `(counting spaces and punctuation). Keep natural English, keep exactly one concrete hook, ` +
    `keep the "[Name]" placeholder and a short connect ask. Output ONLY the shortened note — ` +
    `no quotes, no explanation.\n\nNote:\n"""${note}"""`;
  try {
    const short = (await ask(prompt, { maxTokens: 300 })).trim().replace(/^["']+|["']+$/g, "");
    if (short) note = short;
  } catch { /* 压缩失败就直接走硬截断 */ }
  if (note.length > limit) {
    let cut = note.slice(0, limit);
    const sp = cut.lastIndexOf(" ");
    if (sp > limit - 30) cut = cut.slice(0, sp);
    note = cut.replace(/[\s,;.—-]+$/, "");
  }
  return note;
}

/** 外联:该联系谁 + 短信草稿 → outreach 列;连接备注硬保证 ≤200 字符 */
export async function generateOutreach(jobId) {
  const row = await getJob(jobId);
  const prompt = fill(loadPrompt("outreach"), {
    RESUME: await loadProfile("resume-master"),
    TARGET: await loadProfile("target"),
    JOB_JSON: JSON.stringify(row.job, null, 2),
    RAW_TEXT_HEAD: row.raw_text.slice(0, 4000),
    PREFERENCES: await loadProfile("preferences"),
  });
  const outreach = validateOutreachOutput(await askJSON(prompt, { maxTokens: 2500 }));
  outreach.note = await ensureNoteLimit(outreach.note, 200);
  outreach.generated_at = new Date().toISOString();
  await saveFields(jobId, { outreach });
  return outreach;
}

/** 事实核查:对比主简历与定制简历。失败可保留草稿，但必须人工复核。 */
async function factCheckResume(tailoredResume) {
  const prompt = fill(loadPrompt("fact-check"), {
    MASTER_RESUME: await loadProfile("resume-master"),
    TAILORED_RESUME: tailoredResume,
  });
  try {
    return validateFactCheckOutput(await askJSON(prompt, { maxTokens: 6000 }));
  } catch {
    return factCheckNeedsReview();
  }
}

/** 事实核查:求职信里「关于我」的陈述 */
async function factCheckCover(coverLetter) {
  const prompt = fill(loadPrompt("fact-check-cover"), {
    MASTER_RESUME: await loadProfile("resume-master"),
    COVER_LETTER: coverLetter,
  });
  try {
    return validateFactCheckOutput(await askJSON(prompt, { maxTokens: 4000 }));
  } catch {
    return factCheckNeedsReview();
  }
}

/**
 * 功能三:生成定制简历 + 自动事实核查/修正 + 一页压缩 + cover letter + 导出。
 * onProgress(step, detail) 与本地版事件一致。
 */
export async function generateMaterials(jobId, { onProgress = () => {} } = {}) {
  const row = await getJob(jobId);
  if (row.record_policy?.record_type !== "active" || row.record_policy?.frozen !== false) {
    throw new Error("冻结或未初始化 record policy 的岗位不能生成材料。");
  }
  if (!row.score) throw new Error("该职位还没打分");
  const score = row.score;
  assertCanGenerateMaterials(score);
  const view = scoreView(score);
  const preferences = await loadProfile("preferences");
  const jobJson = JSON.stringify(row.job, null, 2);
  const massApply = usesMassApplyAngle(score);

  // 1. 定制简历
  const resumePrompt = fill(loadPrompt("resume"), {
    RESUME: await loadProfile("resume-master"),
    JOB_JSON: jobJson,
    RESUME_ANGLE: massApply
      ? MASS_APPLY_ANGLE
      : view.match.resume_angle || "突出与该职位最相关的经历",
    PREFERENCES: preferences,
  });
  let resume = await ask(resumePrompt, { maxTokens: 8000 });
  onProgress("resume-done");

  // 2. 事实核查;发现问题则修正并复查,最多两轮
  const initial = await factCheckResume(resume);
  const factCheck = { checked_at: new Date().toISOString(), initial, final: initial, fix_rounds: 0 };
  let current = initial;
  while (current.issues.length && factCheck.fix_rounds < 2) {
    onProgress("fixing", current.issues.length);
    const fixPrompt = fill(loadPrompt("resume-fix"), {
      ISSUES_JSON: JSON.stringify(current.issues, null, 2),
      TAILORED_RESUME: resume,
    });
    resume = await ask(fixPrompt, { maxTokens: 8000 });
    factCheck.fix_rounds++;
    current = await factCheckResume(resume);
    factCheck.final = current;
  }
  await saveFields(jobId, { resume_md: resume, fact_check: factCheck });
  onProgress("factcheck-done", factCheck);

  // 3. 一页闭环:渲染探测页数,超一页就压缩重排,最多两轮
  const onePage = { rounds: 0, pages: renderResumePdfPages(resume) };
  while (onePage.pages && onePage.pages > 1 && onePage.rounds < 2) {
    onProgress("condensing", onePage.pages);
    const condensePrompt = fill(loadPrompt("resume-condense"), {
      TAILORED_RESUME: resume,
      OVERFLOW_HINT: `当前渲染为 ${onePage.pages} 页,需压缩到 1 页。`,
    });
    resume = await ask(condensePrompt, { maxTokens: 8000 });
    onePage.rounds++;
    onePage.pages = renderResumePdfPages(resume);
  }
  factCheck.pages = onePage.pages;
  factCheck.condense_rounds = onePage.rounds;
  await saveFields(jobId, { resume_md: resume, fact_check: factCheck });
  onProgress("onepage-done", onePage);

  // 4. Cover letter(基于核查+压缩后的简历)
  const clPrompt = fill(loadPrompt("cover-letter"), {
    TAILORED_RESUME: resume,
    JOB_JSON: jobJson,
    RAW_TEXT_HEAD: row.raw_text.slice(0, 4000),
    PREFERENCES: preferences,
  });
  let coverLetter = await ask(clPrompt, { maxTokens: 4000 });
  onProgress("cover-letter-done");

  // 4b. 求职信也做事实核查;有问题就修正一次
  const clInitial = await factCheckCover(coverLetter);
  const coverCheck = { initial: clInitial, final: clInitial, fixed: false };
  if (clInitial.issues.length) {
    onProgress("cover-fixing", clInitial.issues.length);
    const fixPrompt = fill(loadPrompt("resume-fix"), {
      ISSUES_JSON: JSON.stringify(clInitial.issues, null, 2),
      TAILORED_RESUME: coverLetter,
    });
    coverLetter = await ask(fixPrompt, { maxTokens: 4000 });
    coverCheck.final = await factCheckCover(coverLetter);
    coverCheck.fixed = true;
  }
  factCheck.cover_letter = coverCheck;
  await saveFields(jobId, { cover_md: coverLetter, fact_check: factCheck });
  onProgress("cover-factcheck-done", coverCheck);

  const readinessJob = { status: row.status, record_policy: row.record_policy };
  refreshActiveMaterialReadiness(readinessJob, { hasResume: true, hasCover: true, factCheck });
  await saveFields(jobId, {
    record_policy: readinessJob.record_policy,
    material_readiness: readinessJob.material_readiness,
  });

  // 5. 导出可提交文件(PDF/docx)→ job_files
  const exports = await exportJob(jobId);
  onProgress("export-done", exports);

  await writeMatchReport(jobId);
  return { resume, coverLetter, factCheck, massApply, exports, onePage };
}
