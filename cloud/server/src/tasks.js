// DB 队列 + 进程内单工人:抓取/生成/导出都排队逐个跑(避免并发撞 API 限流)。
// 本地版用 SSE 推进度;云端(Render 代理后)改为把进度行写进 tasks.progress,前端轮询。
import { q } from "./db.js";
import { extractJob, scoreJob, generateMaterials } from "./pipeline.js";
import { resetUsage, usageSummary } from "./claude.js";
import { setStatus, STATUSES } from "./jobs.js";
import { writeMatchReport } from "./report.js";
import { exportJob } from "./export.js";

export async function enqueue(kind, jobId = null, payload = null) {
  const { rows } = await q(
    `INSERT INTO tasks (kind, job_id, payload) VALUES ($1,$2,$3) RETURNING id`,
    [kind, jobId, payload ? JSON.stringify(payload) : null]
  );
  poke();
  return rows[0].id;
}

export async function getTask(id) {
  const { rows } = await q(
    `SELECT id, kind, job_id, state, progress, result, error, created_at FROM tasks WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function queueState() {
  const { rows } = await q(
    `SELECT count(*) FILTER (WHERE state='queued') AS queued,
            count(*) FILTER (WHERE state='running') AS running
     FROM tasks WHERE state IN ('queued','running')`
  );
  return { queue: Number(rows[0].queued), processing: Number(rows[0].running) > 0 };
}

async function appendProgress(id, line) {
  await q(`UPDATE tasks SET progress = progress || $2::jsonb, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify([line])]);
}

/** generateMaterials 的进度事件 → 给面板看的一行中文 */
function progressLine(step, detail) {
  switch (step) {
    case "resume-done": return "① 简历已生成,事实核查中…";
    case "fixing": return "   ⚠️ 简历发现 " + detail + " 处问题,修正中…";
    case "factcheck-done": {
      const n = detail.initial.issues.length;
      if (!n) return "   ✅ 简历核查通过";
      return detail.final.issues.length ? "   ⚠️ 修正后仍有 " + detail.final.issues.length + " 处存疑" : "   ✅ 已修正 " + n + " 处";
    }
    case "condensing": return "② 简历渲染为 " + detail + " 页,压缩到一页…";
    case "onepage-done": return "② 排版:" + (detail.pages === 1 ? "✅ 一页" : detail.pages ? "⚠️ " + detail.pages + " 页" : "(未探测页数)");
    case "cover-letter-done": return "③ Cover letter 已生成,核查中…";
    case "cover-fixing": return "   ⚠️ Cover letter " + detail + " 处,修正中…";
    case "cover-factcheck-done": return "   ✅ Cover letter 核查完成";
    case "export-done": return "④ 已导出 PDF / docx";
    default: return "";
  }
}

/** 打分并按 skip 自动设状态 */
async function scoreAndStatus(jobId) {
  const score = await scoreJob(jobId);
  if (score.verdict === "skip") await setStatus(jobId, "skip");
  await writeMatchReport(jobId);
  return score;
}

async function runTask(t) {
  resetUsage();
  const log = (line) => appendProgress(t.id, line);

  if (t.kind === "capture") {
    const { text, url, title } = t.payload || {};
    await log("解析 JD 中…");
    const result = await extractJob(text, { pageTitle: title || "", pageUrl: url || "" });
    if (result.error) {
      throw new Error(`未识别为职位: ${result.reason || result.error}`);
    }
    await log(`✔ ${result.job.company} — ${result.job.title},打分中…`);
    const score = await scoreAndStatus(result.jobId);
    const us = usageSummary();
    await log(`✅ ${score.score} 分 [${score.verdict}] · 本次约 $${us.estUSD.toFixed(3)}`);
    return { jobId: result.jobId, company: result.job.company, title: result.job.title, score };
  }

  if (t.kind === "gen") {
    await log("开始生成…");
    await generateMaterials(t.job_id, {
      onProgress: (step, detail) => {
        const l = progressLine(step, detail);
        if (l) log(l); // 不 await,进度写库慢一点没关系
      },
    });
    const us = usageSummary();
    await log(`✅ 完成 · 本次约 $${us.estUSD.toFixed(3)}`);
    return { jobId: t.job_id };
  }

  if (t.kind === "export") {
    await log("重新导出 PDF / docx…");
    const results = await exportJob(t.job_id);
    await writeMatchReport(t.job_id);
    await log("✅ 导出完成");
    return { jobId: t.job_id, results };
  }

  throw new Error(`未知任务类型: ${t.kind}`);
}

// —— 单工人循环 ——
let working = false;

async function drain() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const { rows } = await q(
        `UPDATE tasks SET state='running', updated_at=now()
         WHERE id = (SELECT id FROM tasks WHERE state='queued' ORDER BY id LIMIT 1)
         RETURNING *`
      );
      if (!rows.length) break;
      const t = rows[0];
      try {
        const result = await runTask(t);
        await q(`UPDATE tasks SET state='done', result=$2, updated_at=now() WHERE id=$1`,
          [t.id, JSON.stringify(result || null)]);
        console.log(`✔ task#${t.id} ${t.kind} ${t.job_id || ""} done`);
      } catch (e) {
        await q(`UPDATE tasks SET state='error', error=$2, updated_at=now() WHERE id=$1`,
          [t.id, e.message]);
        console.error(`✖ task#${t.id} ${t.kind} 出错: ${e.message}`);
      }
    }
  } finally {
    working = false;
  }
}

export function poke() {
  drain().catch((e) => console.error("任务循环出错:", e.message));
}

/** 启动兜底轮询:入队时会 poke,这里只是保险(比如崩溃恢复后的重排任务) */
export function startWorker() {
  poke();
  setInterval(poke, 15_000);
}
