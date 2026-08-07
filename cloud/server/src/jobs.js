// 职位数据访问层:本地版按目录存,这里按 Postgres 行存。
// 与本地版最大的不同:status 是一列,不再把状态拼进目录名/id,id 永远稳定。
import { q } from "./db.js";
import { assertCanMarkApplied } from "./material-readiness.js";

function slugify(s) {
  return (s || "unknown")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40)
    .replace(/^-|-$/g, "") || "unknown";
}

/** 投递状态;键存库,值是展示标签。顺序即典型流程顺序 */
export const STATUSES = {
  new: "🆕 待定",
  "to-apply": "📮 待投",
  applied: "✅ 已投",
  interview: "🎤 面试中",
  offer: "🎉 Offer",
  rejected: "❌ 已拒",
  skip: "🚫 不投",
};

export function assertStatusTransition(job, newStatus) {
  if (!STATUSES[newStatus]) throw new Error(`未知状态「${newStatus}」。可用: ${Object.keys(STATUSES).join(", ")}`);
  if (newStatus === "applied") assertCanMarkApplied(job);
}

export function jobSlug(company, title) {
  return `${slugify(company)}-${slugify(title)}`;
}

/** 生成不冲突的 job id(同岗重复抓取时加序号) */
export async function makeJobId(company, title) {
  const base = jobSlug(company, title);
  const { rows } = await q(`SELECT id FROM jobs WHERE id = $1 OR id LIKE $2`, [base, `${base}-%`]);
  const ids = new Set(rows.map((r) => r.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export async function insertJob({ id, status, company, title, job, rawText, recordPolicy = null }) {
  await q(
    `INSERT INTO jobs (id, status, company, title, job, raw_text, record_policy) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, status, company, title, job, rawText, recordPolicy ? JSON.stringify(recordPolicy) : null]
  );
}

/** 读整行;不存在则抛错 */
export async function getJob(id) {
  const { rows } = await q(`SELECT * FROM jobs WHERE id = $1`, [id]);
  if (!rows.length) throw new Error(`找不到职位: ${id}`);
  return rows[0];
}

/** 更新若干列(白名单内),自动带 updated_at */
const FIELD_WHITELIST = new Set([
  "status", "score", "match_report", "resume_md", "cover_md", "fact_check", "outreach", "job", "record_policy", "material_readiness",
]);
export async function saveFields(id, fields) {
  const keys = Object.keys(fields).filter((k) => FIELD_WHITELIST.has(k));
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const vals = keys.map((k) => {
    const v = fields[k];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  await q(`UPDATE jobs SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...vals]);
}

export async function setStatus(id, newStatus) {
  const job = await getJob(id);
  assertStatusTransition(job, newStatus);
  await saveFields(id, { status: newStatus });
  return id; // id 稳定,不再改名
}

export async function deleteJob(id) {
  const r = await q(`DELETE FROM jobs WHERE id = $1`, [id]);
  if (!r.rowCount) throw new Error(`找不到职位: ${id}`);
}

/** 列表(摘要),按抓取时间倒序 */
export async function listJobs() {
  const { rows } = await q(`
    SELECT id, status, company, title,
           COALESCE(score->'match'->>'score', score->>'score') AS score,
           COALESCE(score->'match'->>'verdict', score->>'verdict') AS verdict,
           (resume_md IS NOT NULL) AS has_resume,
           material_readiness->>'state' AS readiness,
           captured_at
    FROM jobs ORDER BY captured_at DESC, id DESC`);
  return rows.map((r) => ({
    id: r.id, status: r.status, company: r.company, title: r.title,
    score: r.score != null ? Number(r.score) : null,
    verdict: r.verdict, hasResume: r.has_resume, readiness: r.readiness,
    capturedAt: r.captured_at,
  }));
}

/** 模糊匹配 job-id:完全相等 → 唯一前缀 → 唯一子串 */
export async function resolveJobId(partial) {
  if (!partial) throw new Error("需要指定 job-id");
  const { rows } = await q(`SELECT id FROM jobs ORDER BY captured_at DESC`);
  const all = rows.map((r) => r.id);
  if (all.includes(partial)) return partial;
  const prefix = all.filter((id) => id.startsWith(partial));
  if (prefix.length === 1) return prefix[0];
  const substr = all.filter((id) => id.includes(partial));
  if (substr.length === 1) return substr[0];
  const candidates = prefix.length ? prefix : substr;
  if (!candidates.length) throw new Error(`找不到职位: ${partial}`);
  throw new Error(`"${partial}" 匹配到多个职位:\n  ${candidates.join("\n  ")}`);
}

// —— 导出的成品文件(PDF/docx)存 bytea ——
export async function putFile(jobId, name, buf) {
  await q(
    `INSERT INTO job_files (job_id, name, content) VALUES ($1,$2,$3)
     ON CONFLICT (job_id, name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [jobId, name, buf]
  );
}
export async function getFile(jobId, name) {
  const { rows } = await q(`SELECT content FROM job_files WHERE job_id=$1 AND name=$2`, [jobId, name]);
  return rows.length ? rows[0].content : null;
}
export async function listFiles(jobId) {
  const { rows } = await q(`SELECT name FROM job_files WHERE job_id=$1`, [jobId]);
  return rows.map((r) => r.name);
}
