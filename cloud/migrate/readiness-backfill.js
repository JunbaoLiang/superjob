#!/usr/bin/env node
// Neon readiness backfill. Default is dry-run; --apply is explicit and only updates active rows.
import pg from "pg";
import { assessMaterialReadiness, recordPolicyFor } from "../server/src/material-readiness.js";

const url = process.env.DATABASE_URL;
const apply = process.argv.includes("--apply");
if (!url) { console.error("❌ DATABASE_URL 未设置。"); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

async function main() {
  const client = await pool.connect();
  const summary = { add: 0, unchanged: 0, preserved: 0, errors: 0, states: { "not-generated": 0, draft: 0, "needs-review": 0, ready: 0 } };
  try {
    if (apply) await client.query("BEGIN");
    const { rows } = await client.query(`SELECT id,status,record_policy,material_readiness,(resume_md IS NOT NULL) AS has_resume,(cover_md IS NOT NULL) AS has_cover,fact_check FROM jobs ORDER BY id`);
    for (const row of rows) {
      if (!["new", "to-apply"].includes(row.status)) { summary.preserved++; continue; }
      if (row.material_readiness) { summary.unchanged++; continue; }
      try {
        const recordPolicy = row.record_policy || recordPolicyFor(row.status, { materialProfile: "unknown" });
        const job = { status: row.status, record_policy: recordPolicy };
        const readiness = assessMaterialReadiness({ job, hasResume: row.has_resume, hasCover: row.has_cover, factCheck: row.fact_check });
        if (apply) await client.query(`UPDATE jobs SET record_policy=$2, material_readiness=$3, updated_at=now() WHERE id=$1`, [row.id, JSON.stringify(recordPolicy), JSON.stringify({ state: readiness.state, assessment: { ...readiness.assessment, checked_at: new Date().toISOString() }, confirmation: null })]);
        summary.add++; summary.states[readiness.state]++;
      } catch { summary.errors++; }
    }
    if (summary.errors && apply) throw new Error(`发现 ${summary.errors} 个异常，拒绝写入`);
    if (apply) await client.query("COMMIT");
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...summary }));
  } catch (error) {
    if (apply) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(`❌ readiness backfill 失败: ${error.message}`); process.exit(1); });
