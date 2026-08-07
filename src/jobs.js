import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
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

/** 投递状态(申请流水线);键是目录里用的短名,值是展示标签。顺序即典型流程顺序 */
export const STATUSES = {
  new: "🆕 待定",
  "to-apply": "📮 待投",
  applied: "✅ 已投",
  interview: "🎤 面试中",
  offer: "🎉 Offer",
  rejected: "❌ 已拒",
  skip: "🚫 不投",
};

const STATUS_KEYS = Object.keys(STATUSES);
const STATUS_RE = new RegExp(`-(${STATUS_KEYS.join("|")})$`);

function assertSafeJobId(id) {
  if (typeof id !== "string" || !id || path.basename(id) !== id) {
    throw new Error(`非法 job-id: ${id}`);
  }
  const base = path.resolve(config.jobsDir);
  const resolved = path.resolve(base, id);
  if (!resolved.startsWith(base + path.sep)) throw new Error(`非法 job-id: ${id}`);
  return resolved;
}

function assertSafeFilename(filename) {
  if (typeof filename !== "string" || !filename || path.basename(filename) !== filename) {
    throw new Error(`非法文件名: ${filename}`);
  }
  return filename;
}

/** 稳定的「公司-岗位」slug(不含状态,不含日期) */
export function jobSlug(company, title) {
  return `${slugify(company)}-${slugify(title)}`;
}

/** 从目录名切出稳定 slug(去掉结尾的状态段) */
export function slugFromId(id) {
  return id.replace(STATUS_RE, "");
}

/**
 * 生成 job 目录名:公司-岗位-状态。
 * 去重看「稳定 slug」而非完整目录名:若已存在同一岗位(哪怕状态不同),
 * 就把序号加进 slug(公司-岗位-2-状态),避免同一岗位以不同状态并存、看起来像两个职位。
 */
export function makeJobId(company, title, status = "new") {
  const base = jobSlug(company, title);
  const dirs = fs.existsSync(config.jobsDir)
    ? fs.readdirSync(config.jobsDir).filter((d) => {
        try { return fs.statSync(path.join(config.jobsDir, d)).isDirectory(); } catch { return false; }
      })
    : [];
  const slugs = new Set(dirs.map(slugFromId));
  if (!slugs.has(base)) return `${base}-${status}`;
  let n = 2;
  while (slugs.has(`${base}-${n}`)) n++;
  return `${base}-${n}-${status}`;
}

export function jobDir(id) {
  return assertSafeJobId(id);
}

export function saveJobFile(id, filename, content) {
  const dir = jobDir(id);
  assertSafeFilename(filename);
  fs.mkdirSync(dir, { recursive: true });
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(path.join(dir, filename), text, "utf8");
}

/** 删除整个职位目录(安全:必须落在 jobsDir 内且确实存在) */
export function deleteJob(id) {
  const resolved = path.resolve(jobDir(id));
  const base = path.resolve(config.jobsDir);
  if (!resolved.startsWith(base + path.sep) || !fs.existsSync(resolved)) {
    throw new Error(`无法删除职位: ${id}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

export function loadJobFile(id, filename) {
  const file = path.join(jobDir(id), assertSafeFilename(filename));
  if (!fs.existsSync(file)) {
    throw new Error(`文件不存在: ${file}`);
  }
  const text = fs.readFileSync(file, "utf8");
  return filename.endsWith(".json") ? JSON.parse(text) : text;
}

export function hasJobFile(id, filename) {
  return fs.existsSync(path.join(jobDir(id), assertSafeFilename(filename)));
}

/** 读取某职位的当前状态(优先读 job.json.status,退化到从目录名解析) */
export function jobStatus(id) {
  try {
    const s = loadJobFile(id, "job.json").status;
    if (s && STATUSES[s]) return s;
  } catch { /* 无 job.json 时退化 */ }
  const m = id.match(STATUS_RE);
  return m ? m[1] : "new";
}

/**
 * 改变投递状态:重命名目录为「公司-岗位-新状态」并更新 job.json。
 * 返回(可能变化后的)新 job-id。
 */
export function setStatus(id, newStatus) {
  if (!STATUSES[newStatus]) {
    throw new Error(`未知状态「${newStatus}」。可用: ${STATUS_KEYS.join(", ")}`);
  }
  const job = loadJobFile(id, "job.json");
  if (newStatus === "applied") assertCanMarkApplied(job);
  const slug = job.slug || slugFromId(id);
  let newId = `${slug}-${newStatus}`;
  if (newId !== id && fs.existsSync(jobDir(newId))) {
    let n = 2;
    while (fs.existsSync(jobDir(`${slug}-${n}-${newStatus}`))) n++;
    newId = `${slug}-${n}-${newStatus}`;
  }
  if (newId !== id) fs.renameSync(jobDir(id), jobDir(newId));
  job.slug = slug;
  job.status = newStatus;
  saveJobFile(newId, "job.json", job);
  return newId;
}

/** 列出所有职位,按 captured_at 倒序(最新在前);读不到时间的排后面 */
export function listJobs() {
  if (!fs.existsSync(config.jobsDir)) return [];
  const dirs = fs.readdirSync(config.jobsDir).filter((d) => {
    try {
      return fs.statSync(path.join(config.jobsDir, d)).isDirectory();
    } catch {
      return false;
    }
  });
  const keyed = dirs.map((d) => {
    let t = "";
    try {
      t = JSON.parse(fs.readFileSync(path.join(config.jobsDir, d, "job.json"), "utf8")).captured_at || "";
    } catch { /* 没有 job.json 时用空时间,排到最后 */ }
    return { d, t };
  });
  keyed.sort((a, b) => b.t.localeCompare(a.t) || b.d.localeCompare(a.d));
  return keyed.map((k) => k.d);
}

/**
 * 模糊匹配 job-id,方便少打字。
 * 按精确度分层:完全相等 → 唯一前缀 → 唯一子串。
 * 更具体的一层命中就直接返回(例如某个前缀只对上一个,即便同一子串对上多个也不算歧义)。
 */
export function resolveJobId(partial) {
  if (!partial) throw new Error("需要指定 job-id(用 node src/cli.js list 查看)");
  const all = listJobs();
  if (all.includes(partial)) return partial;               // 完全相等
  const prefix = all.filter((id) => id.startsWith(partial));
  if (prefix.length === 1) return prefix[0];               // 唯一前缀
  const substr = all.filter((id) => id.includes(partial));
  if (substr.length === 1) return substr[0];               // 唯一子串
  const candidates = prefix.length ? prefix : substr;
  if (candidates.length === 0) throw new Error(`找不到职位: ${partial}\n用 node src/cli.js list 查看所有职位`);
  throw new Error(`"${partial}" 匹配到多个职位,请写得更具体:\n  ${candidates.join("\n  ")}`);
}
