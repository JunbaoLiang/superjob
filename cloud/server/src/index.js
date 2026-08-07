// 求职助手云端服务(Render):HTTP API + 后台任务工人。
//   GET  /health          存活检查(无鉴权,可给 UptimeRobot 保活用)
//   POST /capture         扩展/书签抓取一个职位(排队解析+打分)
//   /api/...              面板 API(全部需要 Authorization: Bearer <APP_TOKEN>)
import http from "node:http";
import { config } from "./config.js";
import { authorizeHeader } from "./auth.js";
import { editFileColumn, readFilePolicy } from "./file-policy.js";
import { initDb } from "./db.js";
import { startWorker, enqueue, getTask, queueState } from "./tasks.js";
import { scoreJob, generateOutreach } from "./pipeline.js";
import { shouldAutoSkip } from "./score-policy.js";
import { resetUsage, usageSummary } from "./llm.js";
import {
  listJobs, getJob, resolveJobId, setStatus, deleteJob, saveFields, getFile, listFiles, STATUSES,
} from "./jobs.js";
import { writeMatchReport } from "./report.js";
import { getProfileAll, saveProfile } from "./prompts.js";
import { assessMaterialReadiness, confirmMaterialReadiness, overrideMaterialReadiness } from "./material-readiness.js";
import { applyOutreachEdit } from "./outreach-edit.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 4_000_000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > limit) { req.destroy(); reject(new Error("请求体过大")); } });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

const FILE_TYPES = {
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** 打分后仅按明确 ineligible 自动设状态(与任务工人里的逻辑一致) */
async function scoreAndStatus(jobId) {
  const score = await scoreJob(jobId);
  if (shouldAutoSkip(score)) await setStatus(jobId, "skip");
  await writeMatchReport(jobId);
  return score;
}

function currentReadinessAssessment(row) {
  const job = { status: row.status, record_policy: row.record_policy, material_readiness: row.material_readiness };
  return {
    job,
    assessment: assessMaterialReadiness({ job, hasResume: !!row.resume_md, hasCover: !!row.cover_md, factCheck: row.fact_check }),
  };
}

async function handle(req, res) {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  if (req.method === "GET" && p === "/health") { sendJSON(res, 200, { ok: true }); return; }

  // —— 以下全部需要口令 ——
  const auth = authorizeHeader(req.headers.authorization, config.token);
  if (!auth.ok) { sendJSON(res, auth.status, { error: auth.error }); return; }

  // 抓取:入队立刻返回,后台逐个处理
  if (req.method === "POST" && p === "/capture") {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!body.text || body.text.trim().length < 50) {
      sendJSON(res, 400, { error: "页面内容太短,可能不是招聘页" }); return;
    }
    const taskId = await enqueue("capture", null, {
      text: String(body.text).slice(0, 60000),
      url: body.url || "",
      title: body.title || "",
    });
    const st = await queueState();
    sendJSON(res, 200, { accepted: true, queued: st.queue + (st.processing ? 1 : 0), taskId });
    return;
  }

  if (req.method === "GET" && p === "/api/state") {
    sendJSON(res, 200, await queueState()); return;
  }

  if (req.method === "GET" && p === "/api/jobs") {
    sendJSON(res, 200, await listJobs()); return;
  }

  if (req.method === "GET" && p === "/api/job") {
    const id = await resolveJobId(u.searchParams.get("id") || "");
    const row = await getJob(id);
    sendJSON(res, 200, {
      id, status: row.status,
      job: row.job, score: row.score,
      factCheck: row.fact_check,
      readiness: row.material_readiness,
      hasResume: !!row.resume_md,
      hasCover: !!row.cover_md,
      outreach: row.outreach,
      files: await listFiles(id),
    });
    return;
  }

  if (req.method === "GET" && p === "/api/file") {
    const id = await resolveJobId(u.searchParams.get("id") || "");
    const name = u.searchParams.get("name") || "";
    const filePolicy = readFilePolicy(name);
    if (filePolicy?.kind === "markdown") {
      const row = await getJob(id);
      const text = row[filePolicy.column];
      if (!text) { sendJSON(res, 404, { error: "文件不存在" }); return; }
      res.writeHead(200, { ...CORS, "Content-Type": FILE_TYPES[".md"] });
      res.end(text);
      return;
    }
    if (filePolicy?.kind === "binary") {
      const buf = await getFile(id, name);
      if (!buf) { sendJSON(res, 404, { error: "文件不存在(可能还没导出)" }); return; }
      const ext = name.slice(name.lastIndexOf("."));
      res.writeHead(200, { ...CORS, "Content-Type": FILE_TYPES[ext] || "application/octet-stream" });
      res.end(buf);
      return;
    }
    sendJSON(res, 400, { error: "非法文件名" });
    return;
  }

  // 在线编辑 resume.md / cover-letter.md → 落库并重新导出
  if (req.method === "PUT" && p === "/api/file") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const id = await resolveJobId(body.id || "");
    const col = editFileColumn(body.name);
    if (!col) { sendJSON(res, 400, { error: "只能编辑 resume.md / cover-letter.md" }); return; }
    if (!body.content || !body.content.trim()) { sendJSON(res, 400, { error: "内容为空" }); return; }
    await saveFields(id, { [col]: body.content });
    const taskId = await enqueue("export", id);
    sendJSON(res, 200, { ok: true, taskId });
    return;
  }

  if (req.method === "POST" && p === "/api/score") {
    const { id } = JSON.parse((await readBody(req)) || "{}");
    const rid = await resolveJobId(id);
    resetUsage();
    const score = await scoreAndStatus(rid);
    sendJSON(res, 200, { id: rid, score, usage: usageSummary() });
    return;
  }

  if (req.method === "POST" && p === "/api/gen") {
    const { id } = JSON.parse((await readBody(req)) || "{}");
    const rid = await resolveJobId(id);
    const row = await getJob(rid);
    if (!row.score) { sendJSON(res, 400, { error: "该职位还没打分" }); return; }
    const taskId = await enqueue("gen", rid);
    sendJSON(res, 200, { taskId });
    return;
  }

  if (req.method === "GET" && p === "/api/task") {
    const t = await getTask(Number(u.searchParams.get("id")));
    if (!t) { sendJSON(res, 404, { error: "任务不存在" }); return; }
    sendJSON(res, 200, t);
    return;
  }

  if (req.method === "POST" && p === "/api/outreach") {
    const { id } = JSON.parse((await readBody(req)) || "{}");
    const rid = await resolveJobId(id);
    resetUsage();
    const outreach = await generateOutreach(rid);
    sendJSON(res, 200, { ...outreach, usage: usageSummary() });
    return;
  }

  if (req.method === "POST" && p === "/api/outreach/save") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const rid = await resolveJobId(body.id);
    const row = await getJob(rid);
    const outreach = applyOutreachEdit(row.outreach, body);
    await saveFields(rid, { outreach });
    sendJSON(res, 200, { id: rid, outreach });
    return;
  }

  if (req.method === "POST" && p === "/api/status") {
    const { id, to } = JSON.parse((await readBody(req)) || "{}");
    const rid = await resolveJobId(id);
    await setStatus(rid, to);
    await writeMatchReport(rid);
    sendJSON(res, 200, { id: rid, status: to, label: STATUSES[to] });
    return;
  }

  if (req.method === "POST" && p === "/api/readiness/confirm") {
    const { id } = JSON.parse((await readBody(req)) || "{}");
    const rid = await resolveJobId(id);
    const { job, assessment } = currentReadinessAssessment(await getJob(rid));
    const readiness = confirmMaterialReadiness(job, assessment);
    await saveFields(rid, { material_readiness: readiness });
    sendJSON(res, 200, { id: rid, readiness });
    return;
  }

  if (req.method === "POST" && p === "/api/readiness/override") {
    const { id, reason } = JSON.parse((await readBody(req)) || "{}");
    const rid = await resolveJobId(id);
    const { job, assessment } = currentReadinessAssessment(await getJob(rid));
    const readiness = overrideMaterialReadiness(job, assessment, reason || "");
    await saveFields(rid, { material_readiness: readiness });
    sendJSON(res, 200, { id: rid, readiness });
    return;
  }

  if (req.method === "POST" && p === "/api/delete") {
    const { id } = JSON.parse((await readBody(req)) || "{}");
    const rid = await resolveJobId(id);
    await deleteJob(rid);
    sendJSON(res, 200, { ok: true, id: rid });
    return;
  }

  if (req.method === "GET" && p === "/api/profile") {
    sendJSON(res, 200, await getProfileAll()); return;
  }
  if (req.method === "PUT" && p === "/api/profile") {
    const { name, content } = JSON.parse((await readBody(req)) || "{}");
    await saveProfile(name, content || "");
    sendJSON(res, 200, { ok: true });
    return;
  }

  sendJSON(res, 404, { error: "未知 API" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const msg = e?.message || String(e);
    const status = /找不到|不存在/.test(msg) ? 404 : 400;
    try { sendJSON(res, status, { error: msg }); } catch { /* headers already sent */ }
  });
});

await initDb();
startWorker();
server.listen(config.port, () => {
  console.log(`🟢 Job Copilot API 已启动,端口 ${config.port}`);
});
