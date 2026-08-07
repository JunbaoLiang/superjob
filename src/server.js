// M2 本地服务:浏览器里闭环完成 抓取→打分→生成→查看。只监听 127.0.0.1;API key 留在 .env。
//   /                面板(在 Chrome 里浏览职位、生成材料、内嵌看 报告/简历/PDF)
//   /bookmarklet     Safari/书签安装页
//   POST /capture    扩展/书签抓取一个职位(解析+打分+落盘)
//   /api/jobs        列表   /api/job?id=   详情   /api/file?id=&name=  取文件
//   /api/gen?id=     生成材料(SSE 进度流)   POST /api/status  改投递状态
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { extractJob, scoreJob, generateMaterials, generateOutreach } from "./pipeline.js";
import { scoreView, shouldAutoSkip } from "./score-policy.js";
import { usageSummary, resetUsage } from "./llm.js";
import {
  setStatus, STATUSES, jobStatus, listJobs, loadJobFile, saveJobFile, hasJobFile, jobDir, resolveJobId, deleteJob,
} from "./jobs.js";
import { writeMatchReport } from "./report.js";
import { dashboardHTML } from "./dashboard.js";
import { config } from "./config.js";
import { assessMaterialReadiness, confirmMaterialReadiness, overrideMaterialReadiness } from "./material-readiness.js";
import { BatchImportQueue, prepareBatchCapture } from "./batch-import.js";
import { collectJobMetrics } from "./metrics.js";
import { applyOutreachEdit } from "./outreach-edit.js";

function loadToken() {
  const file = path.join(config.root, ".capture-token");
  try { const t = fs.readFileSync(file, "utf8").trim(); if (t) return t; } catch { /* generate */ }
  const t = crypto.randomBytes(12).toString("hex");
  fs.writeFileSync(file, t + "\n", "utf8");
  return t;
}

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (origin) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

/** /capture 鉴权:扩展来源 或 token 正确 */
export function captureAllowed(origin, token, serverToken) {
  if (origin && origin.startsWith("chrome-extension://")) return true;
  if (token && token === serverToken) return true;
  return false;
}

/** /api/* 只给本机面板同源用:无 Origin(同源 GET)或 Origin 就是本地面板 */
export function localOrigin(origin, port) {
  return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function sendJSON(res, status, headers, obj) {
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function formatUsageCost(usage) {
  return Number.isFinite(usage.estUSD)
    ? `本次约 $${usage.estUSD.toFixed(3)}`
    : `成本待配置(${usage.provider}/${usage.model})`;
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > limit) { req.destroy(); reject(new Error("请求体过大")); } });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

/** 打分后仅按明确 ineligible 自动设状态,返回最终 jobId */
async function scoreAndStatus(jobId) {
  const score = await scoreJob(jobId);
  const finalId = shouldAutoSkip(score) ? setStatus(jobId, "skip") : jobId;
  writeMatchReport(finalId);
  return { finalId, score };
}

// —— 抓取队列:提交即走,后台逐个处理(一次只跑一个,避免并发撞 API 限流)——
const captureQueue = new BatchImportQueue(async ({ payload }) => {
  const { text, url, title } = payload;
  const result = await extractJob(text, { pageTitle: title || "", pageUrl: url || "" });
  if (result.error) throw new Error(`未识别为职位: ${result.reason || result.error}`);
  const { finalId, score } = await scoreAndStatus(result.jobId);
  const view = scoreView(score);
  console.log(`✔ ${result.job.company} — ${result.job.title} [${view.match.score} ${view.match.verdict} · ${view.eligibility || "legacy"}] ${STATUSES[jobStatus(finalId)]}`);
  return { jobId: finalId };
});

function captureQueueState() {
  const items = captureQueue.list();
  return {
    queue: items.filter((item) => item.state === "queued").length,
    processing: items.some((item) => item.state === "running"),
  };
}

function visibleCaptureQueue() {
  return captureQueue.list().map(({ id, state, attempts, error, result }) => ({ id, state, attempts, error, result }));
}

function enqueueCapture(body) {
  const [item] = captureQueue.enqueueMany([body]);
  void captureQueue.drain();
  return { id: item.id, queued: captureQueueState().queue };
}

/** 把 generateMaterials 的进度事件转成给面板看的一行中文 */
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
    case "onepage-done": return "② 排版:" + (detail.pages === 1 ? "✅ 一页" : "⚠️ " + detail.pages + " 页");
    case "cover-letter-done": return "③ Cover letter 已生成,核查中…";
    case "cover-fixing": return "   ⚠️ Cover letter " + detail + " 处,修正中…";
    case "cover-factcheck-done": return "   ✅ Cover letter 核查完成";
    case "export-done": return "④ 已导出 PDF / docx";
    default: return "";
  }
}

function currentReadinessAssessment(id, job = loadJobFile(id, "job.json")) {
  const factCheck = hasJobFile(id, "fact-check.json") ? loadJobFile(id, "fact-check.json") : null;
  return {
    job,
    assessment: assessMaterialReadiness({
      job,
      hasResume: hasJobFile(id, "resume.md"),
      hasCover: hasJobFile(id, "cover-letter.md"),
      factCheck,
    }),
  };
}

const FILE_TYPES = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function makeHandler(port, token) {
 return function handler(req, res) {
  const origin = req.headers.origin;
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }

  // —— 页面 ——
  if (req.method === "GET" && p === "/health") { sendJSON(res, 200, cors, { ok: true, port, ...captureQueueState() }); return; }
  if (req.method === "GET" && p === "/") {
    res.writeHead(200, { ...cors, "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHTML()); return;
  }
  if (req.method === "GET" && p === "/bookmarklet") {
    res.writeHead(200, { ...cors, "Content-Type": "text/html; charset=utf-8" });
    res.end(setupPage(port, token)); return;
  }

  // —— 抓取(扩展/书签,跨源,token 或扩展来源鉴权)——
  if (req.method === "POST" && p === "/capture") {
    (async () => {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!captureAllowed(origin, body.token, token)) { sendJSON(res, 403, cors, { error: "未授权" }); return; }
        if (!body.text || body.text.trim().length < 50) { sendJSON(res, 400, cors, { error: "页面内容太短,可能不是招聘页" }); return; }
        const queued = enqueueCapture(body);   // 入队,立刻返回,后台逐个处理
        sendJSON(res, 200, cors, { accepted: true, queued: queued.queued, taskId: queued.id });
      } catch (err) { console.error(`capture 出错: ${err.message}`); sendJSON(res, 500, cors, { error: err.message }); }
    })();
    return;
  }

  // —— 面板 API(仅本机同源)——
  if (p.startsWith("/api/")) {
    if (!localOrigin(origin, port)) { sendJSON(res, 403, cors, { error: "仅本机面板可用" }); return; }

    if (req.method === "GET" && p === "/api/jobs") {
      const jobs = listJobs().map((id) => {
        let job = {}; try { job = loadJobFile(id, "job.json"); } catch { /* skip */ }
        const score = hasJobFile(id, "score.json") ? loadJobFile(id, "score.json") : null;
        return { id, company: job.company, title: job.title, status: jobStatus(id),
          score: scoreView(score)?.match.score ?? null, verdict: scoreView(score)?.match.verdict ?? null,
          hasResume: hasJobFile(id, "resume.md"), readiness: job.material_readiness?.state || null };
      });
      sendJSON(res, 200, cors, jobs); return;
    }

    if (req.method === "GET" && p === "/api/metrics") {
      sendJSON(res, 200, cors, collectJobMetrics(config.jobsDir)); return;
    }

    if (req.method === "GET" && p === "/api/capture-queue") {
      sendJSON(res, 200, cors, { ...captureQueueState(), items: visibleCaptureQueue() }); return;
    }

    if (req.method === "POST" && p === "/api/import/batch") {
      (async () => {
        try {
          const body = JSON.parse((await readBody(req)) || "{}");
          const existing = listJobs().map((id) => {
            const job = loadJobFile(id, "job.json");
            return { id, url: job.url, company: job.company, title: job.title, location: job.location };
          });
          const prepared = prepareBatchCapture(body.items, existing);
          const items = prepared.items.map((entry) => {
            if (entry.kind !== "accepted") return entry;
            const queued = enqueueCapture(entry.payload);
            return { kind: "accepted", taskId: queued.id, possible_duplicate_ids: entry.possible_duplicate_ids || [] };
          });
          sendJSON(res, 200, cors, { summary: prepared.summary, items, queue: captureQueueState() });
        } catch (e) { sendJSON(res, 400, cors, { error: e.message }); }
      })();
      return;
    }

    if (req.method === "GET" && p === "/api/job") {
      try {
        const id = resolveJobId(u.searchParams.get("id") || "");
        sendJSON(res, 200, cors, {
          id, status: jobStatus(id),
          job: loadJobFile(id, "job.json"),
          score: hasJobFile(id, "score.json") ? loadJobFile(id, "score.json") : null,
          factCheck: hasJobFile(id, "fact-check.json") ? loadJobFile(id, "fact-check.json") : null,
          readiness: loadJobFile(id, "job.json").material_readiness || null,
          hasResume: hasJobFile(id, "resume.md"),
          hasCover: hasJobFile(id, "cover-letter.md"),
          outreach: hasJobFile(id, "outreach.json") ? loadJobFile(id, "outreach.json") : null,
        });
      } catch (e) { sendJSON(res, 404, cors, { error: e.message }); }
      return;
    }

    if (req.method === "GET" && p === "/api/file") {
      try {
        const id = resolveJobId(u.searchParams.get("id") || "");
        const name = u.searchParams.get("name") || "";
        if (!/^[\w.-]+$/.test(name)) { sendJSON(res, 400, cors, { error: "非法文件名" }); return; }
        const file = path.join(jobDir(id), name);
        if (!file.startsWith(jobDir(id)) || !fs.existsSync(file)) { sendJSON(res, 404, cors, { error: "文件不存在" }); return; }
        res.writeHead(200, { ...cors, "Content-Type": FILE_TYPES[path.extname(name)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
      } catch (e) { sendJSON(res, 404, cors, { error: e.message }); }
      return;
    }

    if (req.method === "POST" && p === "/api/score") {
      (async () => {
        try {
          const { id } = JSON.parse((await readBody(req)) || "{}");
          const rid = resolveJobId(id);
          resetUsage();
          const { finalId, score } = await scoreAndStatus(rid);
          sendJSON(res, 200, cors, { id: finalId, score, usage: usageSummary() });
        } catch (e) { sendJSON(res, 400, cors, { error: e.message }); }
      })();
      return;
    }

    if (req.method === "POST" && p === "/api/outreach") {
      (async () => {
        try {
          const { id } = JSON.parse((await readBody(req)) || "{}");
          const rid = resolveJobId(id);
          resetUsage();
          const outreach = await generateOutreach(rid);
          sendJSON(res, 200, cors, { ...outreach, usage: usageSummary() });
        } catch (e) { sendJSON(res, 400, cors, { error: e.message }); }
      })();
      return;
    }

    if (req.method === "POST" && p === "/api/outreach/save") {
      (async () => {
        try {
          const body = JSON.parse((await readBody(req)) || "{}");
          const id = resolveJobId(body.id);
          const outreach = applyOutreachEdit(loadJobFile(id, "outreach.json"), body);
          saveJobFile(id, "outreach.json", outreach);
          sendJSON(res, 200, cors, { id, outreach });
        } catch (e) { sendJSON(res, 400, cors, { error: e.message }); }
      })();
      return;
    }

    if (req.method === "POST" && p === "/api/delete") {
      (async () => {
        try {
          const { id } = JSON.parse((await readBody(req)) || "{}");
          const rid = resolveJobId(id);
          deleteJob(rid);
          sendJSON(res, 200, cors, { ok: true, id: rid });
        } catch (e) { sendJSON(res, 400, cors, { error: e.message }); }
      })();
      return;
    }

    if (req.method === "POST" && p === "/api/status") {
      (async () => {
        try {
          const { id, to } = JSON.parse((await readBody(req)) || "{}");
          const newId = setStatus(resolveJobId(id), to);
          writeMatchReport(newId);
          sendJSON(res, 200, cors, { id: newId, status: jobStatus(newId) });
        } catch (e) { sendJSON(res, 400, cors, { error: e.message }); }
      })();
      return;
    }

    if (req.method === "POST" && p === "/api/readiness/confirm") {
      (async () => {
        try {
          const { id } = JSON.parse((await readBody(req)) || "{}");
          const rid = resolveJobId(id);
          const { job, assessment } = currentReadinessAssessment(rid);
          const readiness = confirmMaterialReadiness(job, assessment);
          saveJobFile(rid, "job.json", job);
          sendJSON(res, 200, cors, { id: rid, readiness });
        } catch (e) { sendJSON(res, 400, cors, { error: e.message }); }
      })();
      return;
    }

    if (req.method === "POST" && p === "/api/readiness/override") {
      (async () => {
        try {
          const { id, reason } = JSON.parse((await readBody(req)) || "{}");
          const rid = resolveJobId(id);
          const { job, assessment } = currentReadinessAssessment(rid);
          const readiness = overrideMaterialReadiness(job, assessment, reason || "");
          saveJobFile(rid, "job.json", job);
          sendJSON(res, 200, cors, { id: rid, readiness });
        } catch (e) { sendJSON(res, 400, cors, { error: e.message }); }
      })();
      return;
    }

    if (req.method === "GET" && p === "/api/gen") {
      (async () => {
        res.writeHead(200, { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "Connection": "keep-alive" });
        // 客户端断开(关面板)时 write 会失败;吞掉错误,让生成在服务端跑完、材料照常落盘
        const sse = (o) => { try { res.write("data: " + JSON.stringify(o) + "\n\n"); } catch { /* client gone */ } };
        try {
          const id = resolveJobId(u.searchParams.get("id") || "");
          if (!hasJobFile(id, "score.json")) { sse({ error: "该职位还没打分" }); res.end(); return; }
          resetUsage();
          sse({ log: "开始生成…" });
          await generateMaterials(id, { onProgress: (step, detail) => { const l = progressLine(step, detail); if (l) sse({ log: l }); } });
          const us = usageSummary();
          sse({ log: "✅ 完成 · " + formatUsageCost(us) });
          sse({ done: true });
        } catch (e) { sse({ error: e.message }); }
        res.end();
      })();
      return;
    }

    sendJSON(res, 404, cors, { error: "未知 API" }); return;
  }

  res.writeHead(404, cors); res.end();
 };
}

// ————— 书签安装页(Safari/任意浏览器,零安装)—————
function bookmarkletJS(port, token) {
  return "(function(){" +
    "var sel=(window.getSelection&&window.getSelection().toString())||'';" +
    "var t=sel.trim().length>100?sel:((document.querySelector('main')||document.querySelector('article')||document.body).innerText||'');" +
    "var b=document.createElement('div');" +
    "b.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;max-width:340px;padding:12px 14px;background:#fff;color:#1b2027;font:13px/1.5 -apple-system,Arial,sans-serif;border:1px solid #ccc;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.28)';" +
    "b.textContent='Job Copilot:解析+打分中…';document.body.appendChild(b);" +
    "fetch('http://127.0.0.1:" + port + "/capture',{method:'POST',headers:{'Content-Type':'application/json'}," +
    "body:JSON.stringify({text:t.slice(0,40000),url:location.href,title:document.title,token:'" + token + "'})})" +
    ".then(function(r){return r.json()}).then(function(d){" +
    "if(d.error){b.textContent='\\u26a0\\ufe0f '+d.error;return;}" +
    "b.textContent='\\u2713 \\u5df2\\u63d0\\u4ea4\\uff08\\u961f\\u5217 '+(d.queued||1)+'\\uff09\\uff0c\\u53ef\\u7ee7\\u7eed\\u4e0b\\u4e00\\u4e2a\\uff1b\\u7ed3\\u679c\\u5728\\u9762\\u677f\\u770b';" +
    "}).catch(function(){b.textContent='\\u8fde\\u4e0d\\u4e0a\\u672c\\u5730\\u670d\\u52a1\\uff0c\\u6216 Safari \\u62e6\\u622a\\u4e86 http://localhost\\u3002\\u6539\\u7528\\u526a\\u8d34\\u677f\\u4e66\\u7b7e\\u3002';});" +
    "setTimeout(function(){b.style.opacity='.4'},9000);})();";
}
function clipboardBookmarkletJS() {
  return "(function(){var sel=(window.getSelection&&window.getSelection().toString())||'';" +
    "var t=sel.trim().length>100?sel:((document.querySelector('main')||document.querySelector('article')||document.body).innerText||'');" +
    "navigator.clipboard.writeText(t).then(function(){alert('\\u5df2\\u590d\\u5236\\u6b63\\u6587\\u3002\\u7ec8\\u7aef\\u8fd0\\u884c: pbpaste | job add -')})" +
    ".catch(function(){alert('\\u590d\\u5236\\u5931\\u8d25\\uff0c\\u6539\\u7528 Cmd+A / Cmd+C')})})();";
}
function setupPage(port, token) {
  const bm = "javascript:" + encodeURIComponent(bookmarkletJS(port, token));
  const clip = "javascript:" + encodeURIComponent(clipboardBookmarkletJS());
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><html lang=zh><head><meta charset=utf-8><title>Job Copilot 抓取书签</title>
<style>body{font:15px/1.6 -apple-system,Arial,sans-serif;color:#1b2027;max-width:640px;margin:40px auto;padding:0 20px}
h1{color:#22568f}.bm{display:inline-block;background:#22568f;color:#fff;text-decoration:none;padding:9px 16px;border-radius:9px;font-weight:600}
.bm.alt{background:#5c6675}code{background:#eef1f5;padding:2px 6px;border-radius:4px;font:13px "SF Mono",Menlo,monospace}
.step{margin:18px 0;padding-left:8px;border-left:3px solid #22568f}small{color:#5c6675}</style></head><body>
<h1>Job Copilot 抓取书签(Safari 用)</h1>
<p>Chrome 用户建议直接用扩展 + 面板(<a href="/">打开面板</a>),更完整。Safari 没有扩展就用书签:</p>
<div class="step"><p><a class="bm" href="${esc(bm)}">📋 抓取此职位</a> ← 拖到书签栏</p>
<small>在招聘页点它抓取+打分。若 Safari 拦截 http://localhost 无反应,用下面的剪贴板版。</small></div>
<div class="step"><p><a class="bm alt" href="${esc(clip)}">📋 复制正文(兜底)</a> ← 也拖到书签栏</p>
<small>复制正文后终端运行 <code>pbpaste | job add -</code>,不发网络,必定能用。</small></div>
</body></html>`;
}

export function startServer(port = config.port) {
  const token = loadToken();
  const server = http.createServer(makeHandler(port, token));
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") { console.error(`❌ 端口 ${port} 已被占用。换端口: SUPERJOB_PORT=8788 node src/cli.js serve`); process.exit(1); }
    throw e;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`🟢 Job Copilot 服务已启动`);
    console.log(`   📊 面板(Chrome 里干一切):  http://127.0.0.1:${port}/`);
    console.log(`   🧩 Chrome 扩展:在招聘页点图标抓取,再到面板生成/查看`);
    console.log(`   🔖 Safari 书签安装页:      http://127.0.0.1:${port}/bookmarklet`);
    console.log(`   停止: Ctrl+C`);
  });
  return server;
}
