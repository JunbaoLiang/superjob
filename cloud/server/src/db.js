// Postgres(Neon)连接与建表。本地文件目录 data/jobs/ 的云端等价物。
import pg from "pg";
import { config } from "./config.js";

const useSSL = config.databaseUrl && !/localhost|127\.0\.0\.1/.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 5,
});

export const q = (text, params) => pool.query(text, params);

/** 建表(幂等);启动时调用 */
export async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,          -- 公司-岗位 slug(状态是列,不再改名)
      status       TEXT NOT NULL DEFAULT 'new',
      company      TEXT,
      title        TEXT,
      job          JSONB NOT NULL DEFAULT '{}',
      raw_text     TEXT NOT NULL DEFAULT '',
      score        JSONB,
      match_report TEXT,
      resume_md    TEXT,
      cover_md     TEXT,
      fact_check   JSONB,
      outreach     JSONB,
      captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS job_files (
      job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,               -- resume.pdf / resume.docx / cover-letter.pdf / cover-letter.docx
      content    BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (job_id, name)
    );
    CREATE TABLE IF NOT EXISTS profile (
      name       TEXT PRIMARY KEY,            -- resume-master / target / preferences
      content    TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id         BIGSERIAL PRIMARY KEY,
      kind       TEXT NOT NULL,               -- capture / gen / export
      job_id     TEXT,
      payload    JSONB,
      state      TEXT NOT NULL DEFAULT 'queued',  -- queued / running / done / error
      progress   JSONB NOT NULL DEFAULT '[]',
      result     JSONB,
      error      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // 崩溃恢复:上次进程死在 running 的任务重新排队(重跑一遍,结果幂等)
  await q(`UPDATE tasks SET state='queued', progress='[]', updated_at=now() WHERE state='running'`);
  // 清理 7 天前的已完成任务记录
  await q(`DELETE FROM tasks WHERE state IN ('done','error') AND created_at < now() - interval '7 days'`);
}
