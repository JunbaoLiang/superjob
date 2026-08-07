#!/usr/bin/env node
// 一次性迁移:本地 data/(职位目录 + 个人档案 + 成品 PDF/docx)→ Neon 云数据库。
// 在 Mac 上项目的 cloud/migrate/ 目录里运行:
//   npm install
//   DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" node migrate.js
// 重复运行安全:同 id 的职位会被更新,不会产生重复。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "..", "data");
const JOBS = path.join(DATA, "jobs");
const PROFILE = path.join(DATA, "profile");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('❌ 请带上 Neon 连接串运行:\n   DATABASE_URL="postgresql://..." node migrate.js');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });
const q = (t, p) => pool.query(t, p);

// —— 与服务端一致的建表(先跑迁移后部署服务也能用)——
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'new',
    company TEXT, title TEXT, job JSONB NOT NULL DEFAULT '{}', raw_text TEXT NOT NULL DEFAULT '',
    score JSONB, match_report TEXT, resume_md TEXT, cover_md TEXT, fact_check JSONB, outreach JSONB,
    record_policy JSONB, material_readiness JSONB,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS job_files (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, name TEXT NOT NULL,
    content BYTEA NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (job_id, name));
  CREATE TABLE IF NOT EXISTS profile (
    name TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS tasks (
    id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, job_id TEXT, payload JSONB,
    state TEXT NOT NULL DEFAULT 'queued', progress JSONB NOT NULL DEFAULT '[]', result JSONB, error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;

const STATUS_KEYS = ["new", "to-apply", "applied", "interview", "offer", "rejected", "skip"];
const STATUS_RE = new RegExp(`-(${STATUS_KEYS.join("|")})$`);

const readIf = (dir, name) => {
  const f = path.join(dir, name);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
};
const readBinIf = (dir, name) => {
  const f = path.join(dir, name);
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
};
const readJsonIf = (dir, name) => {
  const t = readIf(dir, name);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { console.warn(`   ⚠️ ${name} 不是合法 JSON,跳过`); return null; }
};

async function main() {
  console.log("📦 目标数据库:", url.replace(/:[^:@/]+@/, ":****@"));
  await q(SCHEMA);

  // 1) 个人档案
  console.log("\n—— 个人档案 ——");
  for (const name of ["resume-master", "target", "preferences"]) {
    const content = readIf(PROFILE, `${name}.md`);
    if (content == null) { console.log(`   ⚠️ ${name}.md 不存在,跳过`); continue; }
    await q(
      `INSERT INTO profile (name, content) VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [name, content]
    );
    console.log(`   ✅ ${name} (${content.length} 字符)`);
  }

  // 2) 职位
  console.log("\n—— 职位 ——");
  if (!fs.existsSync(JOBS)) { console.log("   (没有 data/jobs 目录)"); }
  const dirs = fs.existsSync(JOBS)
    ? fs.readdirSync(JOBS).filter((d) => { try { return fs.statSync(path.join(JOBS, d)).isDirectory(); } catch { return false; } })
    : [];
  let ok = 0, skip = 0;
  for (const dirName of dirs) {
    const dir = path.join(JOBS, dirName);
    const job = readJsonIf(dir, "job.json");
    if (!job) { console.log(`   ⚠️ ${dirName}: 缺 job.json,跳过`); skip++; continue; }

    // 目录名形如 公司-岗位-状态;云端 id 用去掉状态段的稳定 slug
    const status = job.status && STATUS_KEYS.includes(job.status)
      ? job.status
      : (dirName.match(STATUS_RE)?.[1] || "new");
    const id = job.slug || dirName.replace(STATUS_RE, "");

    const rawText = readIf(dir, "raw.txt") || "";
    const score = readJsonIf(dir, "score.json");
    const factCheck = readJsonIf(dir, "fact-check.json");
    const outreach = readJsonIf(dir, "outreach.json");
    const matchReport = readIf(dir, "match-report.md");
    const resumeMd = readIf(dir, "resume.md");
    const coverMd = readIf(dir, "cover-letter.md");
    const capturedAt = job.captured_at || null;

    await q(
      `INSERT INTO jobs (id, status, company, title, job, raw_text, score, match_report, resume_md, cover_md, fact_check, outreach, captured_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13::timestamptz, now()))
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, company=EXCLUDED.company, title=EXCLUDED.title, job=EXCLUDED.job,
         raw_text=EXCLUDED.raw_text, score=EXCLUDED.score, match_report=EXCLUDED.match_report,
         resume_md=EXCLUDED.resume_md, cover_md=EXCLUDED.cover_md, fact_check=EXCLUDED.fact_check,
         outreach=EXCLUDED.outreach, updated_at=now()`,
      [id, status, job.company || null, job.title || null, JSON.stringify(job), rawText,
       score ? JSON.stringify(score) : null, matchReport, resumeMd, coverMd,
       factCheck ? JSON.stringify(factCheck) : null, outreach ? JSON.stringify(outreach) : null, capturedAt]
    );

    // 成品文件
    const files = [];
    for (const f of ["resume.pdf", "resume.docx", "cover-letter.pdf", "cover-letter.docx"]) {
      const buf = readBinIf(dir, f);
      if (!buf) continue;
      await q(
        `INSERT INTO job_files (job_id, name, content) VALUES ($1,$2,$3)
         ON CONFLICT (job_id, name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
        [id, f, buf]
      );
      files.push(f);
    }
    console.log(`   ✅ ${id} [${status}]${score ? ` ${score.score}分` : ""}${files.length ? ` +${files.length} 个文件` : ""}`);
    ok++;
  }

  console.log(`\n🎉 迁移完成:${ok} 个职位${skip ? `,${skip} 个跳过` : ""}。打开面板即可看到。`);
  await pool.end();
}

main().catch((e) => { console.error("❌ 迁移失败:", e.message); process.exit(1); });
