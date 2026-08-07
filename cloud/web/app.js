// Job Copilot 云端面板:Notion 式看板 + 详情抽屉。
// 数据来自 Render 上的 API;地址和口令存 localStorage,首次打开填一次。
"use strict";

const STATUS = { "new": "🆕 待定", "to-apply": "📮 待投", "applied": "✅ 已投", "interview": "🎤 面试中", "offer": "🎉 Offer", "rejected": "❌ 已拒", "skip": "🚫 不投" };
const ORDER = ["new", "to-apply", "applied", "interview", "offer", "rejected", "skip"];
const VERDICT = { strong_match: "强匹配", worth_applying: "值得投", stretch: "够得着", low_match: "低匹配", skip: "旧版低匹配" };
const ELIGIBILITY = { eligible: "可申请", "needs-verification": "待核实", ineligible: "明确不符合" };
const RECOMMENDATION = { main_target: "主投", mass_apply: "海投", stretch: "Stretch", verify: "先核实", skip: "跳过" };
const READINESS = { "not-generated": "未生成", draft: "待确认", "needs-review": "需复核", ready: "已就绪" };

let BASE = localStorage.getItem("jc_base") || "";
let TOKEN = localStorage.getItem("jc_token") || "";
let curTab = "report", curId = null, dragId = null, gQueue = "";
const blobCache = {}; // "id/name" -> objectURL

const $ = (id) => document.getElementById(id);
const esc = (s) => (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const safeHref = (url) => { try { const u = new URL(String(url)); return /^(https?):$/.test(u.protocol) ? esc(u.href) : ""; } catch { return ""; } };
function scoreView(s) {
  if (!s?.match) return { legacy: true, match: s || {}, hard_blockers: s?.hard_blockers || [], risks: [], eligibility: null, recommendation: null };
  return { legacy: false, match: s.match, hard_blockers: s.eligibility.hard_blockers, risks: s.eligibility.risks, eligibility: s.eligibility.verdict, recommendation: s.recommendation };
}

// —— API ——
function headers(json) {
  const h = { "Authorization": "Bearer " + TOKEN };
  if (json) h["Content-Type"] = "application/json";
  return h;
}
async function api(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { ...headers(opts.body != null), ...(opts.headers || {}) } });
  if (r.status === 401) { showLogin("口令不对或已更换,请重新填写"); throw new Error("未授权"); }
  return r.json();
}
async function apiBlob(path) {
  const r = await fetch(BASE + path, { headers: headers(false) });
  if (r.status === 401) { showLogin("口令不对或已更换,请重新填写"); throw new Error("未授权"); }
  if (!r.ok) return null;
  return r.blob();
}
async function fileText(id, name) {
  const r = await fetch(BASE + "/api/file?id=" + encodeURIComponent(id) + "&name=" + encodeURIComponent(name), { headers: headers(false) });
  if (!r.ok) return null;
  return r.text();
}
async function fileUrl(id, name) {
  const key = id + "/" + name;
  const b = await apiBlob("/api/file?id=" + encodeURIComponent(id) + "&name=" + encodeURIComponent(name));
  if (!b) return null;
  if (blobCache[key]) URL.revokeObjectURL(blobCache[key]);
  blobCache[key] = URL.createObjectURL(b);
  return blobCache[key];
}
async function downloadFile(id, name) {
  const url = await fileUrl(id, name);
  if (!url) { alert("文件不存在(可能还没导出)"); return; }
  const a = document.createElement("a");
  a.href = url; a.download = id + "-" + name;
  document.body.appendChild(a); a.click(); a.remove();
}

// —— 登录 ——
function showLogin(err) {
  $("login").hidden = false;
  $("inUrl").value = BASE;
  $("loginErr").textContent = err || "";
}
function logout() {
  localStorage.removeItem("jc_token");
  TOKEN = "";
  showLogin("");
}
async function doLogin() {
  let url = $("inUrl").value.trim().replace(/\/+$/, "");
  const token = $("inToken").value.trim();
  if (!url || !token) { $("loginErr").textContent = "两项都要填"; return; }
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  $("loginBtn").disabled = true; $("loginBtn").textContent = "连接中…(服务休眠时首次要等约 1 分钟)";
  try {
    const r = await fetch(url + "/api/state", { headers: { "Authorization": "Bearer " + token } });
    if (r.status === 401) { $("loginErr").textContent = "口令不对(APP_TOKEN)"; return; }
    if (!r.ok) { $("loginErr").textContent = "服务响应异常: " + r.status; return; }
    BASE = url; TOKEN = token;
    localStorage.setItem("jc_base", BASE);
    localStorage.setItem("jc_token", TOKEN);
    $("login").hidden = true;
    loadBoard();
  } catch (e) {
    $("loginErr").textContent = "连不上:" + e.message + "(检查地址;免费版服务冷启动约 1 分钟,可稍等重试)";
  } finally {
    $("loginBtn").disabled = false; $("loginBtn").textContent = "连接";
  }
}

// —— 看板 ——
function loadBoard() {
  api("/api/jobs").then((js) => {
    $("hint").textContent = js.length + " 个职位" + gQueue;
    const by = {}; ORDER.forEach((s) => { by[s] = []; });
    js.forEach((j) => { if (!by[j.status]) by[j.status] = []; by[j.status].push(j); });
    let h = "";
    ORDER.forEach((s) => {
      const col = by[s] || [];
      h += `<div class="col" data-s="${s}" ondragover="colOver(event)" ondragleave="colLeave(event)" ondrop="colDrop(event,'${s}')">`;
      h += `<div class="colhead">${STATUS[s]}<span class="cnt">${col.length}</span></div><div class="cards">`;
      col.forEach((j) => {
        const v = j.verdict || "";
        h += `<div class="card" draggable="true" ondragstart="cardDrag(event,'${j.id}')" ondragend="cardEnd(event)" onclick="openDetail('${j.id}')">`;
        h += `<div class="cco">${esc(j.company || j.id)}</div><div class="cti">${esc(j.title || "")}</div>`;
        h += `<div class="crow">${j.score != null ? `<span class="pill ${v}">${j.score} ${VERDICT[v] || v}</span>` : `<span class="empty">未打分</span>`}${j.readiness ? `<span class="pill">材料 ${READINESS[j.readiness] || j.readiness}</span>` : ""}${j.hasResume ? `<span title="已生成材料">📄</span>` : ""}</div>`;
        h += `</div>`;
      });
      if (!col.length) h += `<div class="empty">—</div>`;
      h += `</div></div>`;
    });
    $("board").innerHTML = h;
  }).catch(() => {});
}
function cardDrag(e, id) { dragId = id; e.currentTarget.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }
function cardEnd(e) { e.currentTarget.classList.remove("drag"); }
function colOver(e) { e.preventDefault(); e.currentTarget.classList.add("over"); }
function colLeave(e) { e.currentTarget.classList.remove("over"); }
function colDrop(e, status) {
  e.preventDefault(); e.currentTarget.classList.remove("over");
  const id = dragId || e.dataTransfer.getData("text/plain"); dragId = null;
  if (!id) return;
  api("/api/status", { method: "POST", body: JSON.stringify({ id, to: status }) })
    .then((res) => { if (res.error) { alert(res.error); return; } loadBoard(); if (curId === id) refreshDetail(); });
}

// —— 详情抽屉 ——
function openDetail(id) {
  curId = id; curTab = "report";
  $("scrim").hidden = false; $("drawer").hidden = false;
  $("drawer").scrollTop = 0;
  api("/api/job?id=" + encodeURIComponent(id)).then(renderDetail).catch(() => {});
}
function closeDetail() { $("drawer").hidden = true; $("scrim").hidden = true; curId = null; }
function refreshDetail() { if (curId) api("/api/job?id=" + encodeURIComponent(curId)).then(renderDetail).catch(() => {}); }

function statusOptions(cur) {
  return ORDER.map((k) => `<option value="${k}"${k === cur ? " selected" : ""}>${STATUS[k]}</option>`).join("");
}

function renderDetail(d) {
  if (d.error) { $("detail").innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  curId = d.id; const j = d.job, s = d.score;
  const meta = [j.location, j.visa_sponsorship && ("签证 " + j.visa_sponsorship), j.salary, j.remote_policy].filter(Boolean).join(" · ");
  let h = `<h2>${esc(j.company)} — ${esc(j.title)}</h2><div class="meta">${esc(meta)}</div>`;
  h += `<div class="bar"><label>投递状态 </label><select onchange="changeStatus(this.value)">${statusOptions(d.status)}</select>`;
  const jobHref = safeHref(j.url); if (jobHref) h += ` <a class="links" href="${jobHref}" target="_blank" rel="noopener noreferrer">原始职位 ↗</a>`;
  h += ` <button class="danger" onclick="delJob()">删除</button></div>`;
  const rd = d.readiness;
  h += `<div class="sec"><h3>材料就绪</h3>`;
  if (!rd) h += `<p class="meta">尚未初始化 readiness；不能标记为已投。</p>`;
  else {
    h += `<p><span class="pill">材料 ${READINESS[rd.state] || rd.state}</span></p>`;
    if (rd.assessment) h += `<p class="meta">简历核查 ${esc(rd.assessment.resume_fact_verdict)} · 求职信核查 ${esc(rd.assessment.cover_fact_verdict)} · 简历 ${esc(rd.assessment.resume_pages == null ? "页数未知" : rd.assessment.resume_pages + " 页")}</p>`;
    if (rd.confirmation) h += `<p class="meta">确认方式: ${esc(rd.confirmation.mode)}${rd.confirmation.reason ? " · " + esc(rd.confirmation.reason) : ""}</p>`;
    if (rd.state === "draft") h += `<button onclick="confirmReady()">确认材料 ready</button>`;
    if (rd.state === "draft" || rd.state === "needs-review") h += ` <button class="ghost" onclick="overrideReady()">人工 override…</button>`;
  }
  h += `</div>`;

  if (s) {
    const sv = scoreView(s);
    h += `<div class="sec"><h3>${sv.legacy ? "旧版评分" : `Eligibility ${ELIGIBILITY[sv.eligibility] || sv.eligibility} · ${RECOMMENDATION[sv.recommendation] || sv.recommendation}`}</h3>`;
    h += `<p><span class="pill">Match ${sv.match.score} / 100 · ${VERDICT[sv.match.verdict] || sv.match.verdict || "未知"}</span></p>`;
    if (sv.match.rationale?.length) h += `<ul class="tight">${sv.match.rationale.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
    if (sv.risks.length) h += `<div style="color:#b0730e;margin-top:6px">⚠️ 待核实：${sv.risks.map(esc).join("<br>⚠️ ")}</div>`;
    if (sv.hard_blockers.length) h += `<div style="color:#b4472f;margin-top:6px">⛔ ${sv.hard_blockers.map(esc).join("<br>⛔ ")}</div>`;
    h += `</div>`;
  } else {
    h += `<div class="sec"><h3>还没打分</h3><p class="meta">这个岗只解析了、还没打分。点下面补上。</p>`
      + `<button id="scorebtn" onclick="scoreJobBtn()">打分</button><div class="prog" id="sprog"></div></div>`;
    $("detail").innerHTML = h;
    return;
  }

  h += `<div class="sec"><h3>投递材料</h3>`;
  if (d.hasResume) {
    h += `<div class="tabs">`
      + `<button id="t_report" class="${curTab === "report" ? "on" : ""}" onclick="showTab('report')">匹配报告</button>`
      + `<button id="t_resume" class="${curTab === "resume" ? "on" : ""}" onclick="showTab('resume')">简历</button>`
      + `<button id="t_cover" class="${curTab === "cover" ? "on" : ""}" onclick="showTab('cover')">Cover letter</button>`
      + `</div><div id="view"></div>`;
  } else {
    const sv = scoreView(s);
    if (sv.eligibility === "ineligible") h += `<p class="meta">存在明确 eligibility hard block，不能生成材料。</p>`;
    else h += `<p class="meta">还没生成材料。${sv.recommendation === "stretch" ? "Stretch 岗位，需由你手动确认后生成。" : sv.recommendation === "verify" ? "请先核实风险；如仍决定投入，可手动生成。" : ""}</p>`
      + `<button id="genbtn" onclick="generate()">生成材料(简历 + Cover letter)</button><div class="prog" id="prog"></div>`;
  }
  h += `</div>`;

  // 外联 Reach out
  h += `<div class="sec"><h3>外联 Reach out</h3>`;
  if (d.outreach) {
    h += `<div style="font-weight:600;margin-bottom:3px">该联系谁</div><ul class="tight">`
      + (d.outreach.who || []).map((w) => `<li>${esc(w)}</li>`).join("") + `</ul>`;
    if (d.outreach.channel) h += `<div class="meta" style="margin:6px 0">渠道:${esc(d.outreach.channel)}</div>`;
    h += `<label class="olabel">LinkedIn 连接请求备注(免会员上限 200 字,可改)<span id="oCount" class="ocount"></span></label>`
      + `<textarea id="oNote" class="ota" rows="3" oninput="countNote()">${esc(d.outreach.note || "")}</textarea>`
      + `<div class="links"><a onclick="copyEl('oNote')">复制备注</a></div>`
      + `<label class="olabel">接受连接后的跟进私信 / 邮件(可改)</label>`
      + `<textarea id="oMsg" class="ota" rows="7">${esc(d.outreach.message || "")}</textarea>`
      + `<div class="links"><a onclick="copyEl('oMsg')">复制消息</a> <a onclick="saveOutreach()">保存编辑</a> <a onclick="genOutreach()">重新生成</a></div>`;
  } else {
    h += `<p class="meta">要主动联系时,生成「该找谁 + 短信草稿」(可编辑)。</p>`
      + `<button id="obtn" onclick="genOutreach()">生成外联建议</button><div class="prog" id="oprog"></div>`;
  }
  h += `</div>`;

  $("detail").innerHTML = h;
  if (d.hasResume) showTab(curTab);
  if (d.outreach) countNote();
}

function countNote() {
  const el = $("oNote"), c = $("oCount"); if (!el || !c) return;
  const n = el.value.length;
  c.textContent = " " + n + "/200"; c.style.color = n > 200 ? "#b4472f" : "#5c6675";
  el.style.borderColor = n > 200 ? "#b4472f" : "";
}
function copyEl(id) {
  const el = $(id); if (!el) return;
  navigator.clipboard.writeText(el.value).then(() => {
    el.style.outline = "2px solid #2e7d5b"; setTimeout(() => { el.style.outline = ""; }, 700);
  });
}

function changeStatus(to) {
  if (!curId) return;
  api("/api/status", { method: "POST", body: JSON.stringify({ id: curId, to }) })
    .then((res) => { if (res.error) { alert(res.error); refreshDetail(); return; } loadBoard(); refreshDetail(); });
}
function confirmReady() { if (!curId) return; api("/api/readiness/confirm", { method: "POST", body: JSON.stringify({ id: curId }) }).then((res) => { if (res.error) { alert(res.error); return; } loadBoard(); refreshDetail(); }); }
function overrideReady() { if (!curId) return; const reason = prompt("请填写 override 原因（会记录在岗位中）："); if (reason === null) return; api("/api/readiness/override", { method: "POST", body: JSON.stringify({ id: curId, reason }) }).then((res) => { if (res.error) { alert(res.error); return; } loadBoard(); refreshDetail(); }); }
function delJob() {
  if (!curId) return;
  if (!confirm("确认删除这个职位?材料一并删除,不可恢复。")) return;
  api("/api/delete", { method: "POST", body: JSON.stringify({ id: curId }) })
    .then(() => { closeDetail(); loadBoard(); });
}
function scoreJobBtn() {
  if (!curId) return; const id = curId;
  const btn = $("scorebtn"); if (btn) { btn.disabled = true; btn.textContent = "打分中(约 20 秒)…"; }
  api("/api/score", { method: "POST", body: JSON.stringify({ id }) })
    .then((res) => {
      if (res.error) { const p = $("sprog"); if (p) p.textContent = "出错: " + res.error; if (btn) { btn.disabled = false; btn.textContent = "重试打分"; } return; }
      loadBoard(); if (curId === id) refreshDetail();
    })
    .catch(() => { if (btn) { btn.disabled = false; btn.textContent = "重试打分"; } });
}
function genOutreach() {
  if (!curId) return; const id = curId;
  const btn = $("obtn"); if (btn) { btn.disabled = true; btn.textContent = "生成中(约 20 秒)…"; }
  api("/api/outreach", { method: "POST", body: JSON.stringify({ id }) })
    .then((res) => {
      if (res.error) { const p = $("oprog"); if (p) p.textContent = "出错: " + res.error; if (btn) { btn.disabled = false; btn.textContent = "重试"; } return; }
      if (curId === id) refreshDetail();
    })
    .catch(() => { if (btn) { btn.disabled = false; btn.textContent = "重试"; } });
}
function saveOutreach() {
  if (!curId) return;
  api("/api/outreach/save", { method: "POST", body: JSON.stringify({ id: curId, note: $("oNote").value, message: $("oMsg").value }) })
    .then((res) => { if (res.error) { alert(res.error); return; } refreshDetail(); });
}

// —— 生成材料:提交任务 + 轮询进度 ——
function pollTask(taskId, progEl, onDone, onError) {
  const timer = setInterval(async () => {
    try {
      const t = await api("/api/task?id=" + taskId);
      if (progEl && t.progress) progEl.textContent = t.progress.join("\n");
      if (t.state === "done") { clearInterval(timer); onDone && onDone(t); }
      if (t.state === "error") { clearInterval(timer); if (progEl) progEl.textContent += "\n出错: " + (t.error || ""); onError && onError(t); }
    } catch { /* 网络抖动,下轮再试 */ }
  }, 1500);
  return timer;
}
function generate() {
  if (!curId) return; const id = curId;
  const btn = $("genbtn"); if (btn) { btn.disabled = true; btn.textContent = "生成中(约 2-4 分钟)…"; }
  const prog = $("prog"); if (prog) prog.textContent = "已提交,排队中…";
  api("/api/gen", { method: "POST", body: JSON.stringify({ id }) })
    .then((res) => {
      if (res.error) { if (prog) prog.textContent = "出错: " + res.error; if (btn) { btn.disabled = false; btn.textContent = "重试生成"; } return; }
      pollTask(res.taskId, prog,
        () => { loadBoard(); if (curId === id) refreshDetail(); },
        () => { if (btn) { btn.disabled = false; btn.textContent = "重试生成"; } });
    })
    .catch(() => { if (btn) { btn.disabled = false; btn.textContent = "重试生成"; } });
}

// —— 材料预览:默认内嵌 PDF,可切文字版 / 在线编辑 ——
function showTab(tab) {
  if (!["report", "resume", "cover"].includes(tab)) tab = "report";
  curTab = tab; const id = curId;
  ["report", "resume", "cover"].forEach((t) => { const b = $("t_" + t); if (b) b.className = (t === tab ? "on" : ""); });
  const view = $("view"); if (!view) return;
  if (tab === "report") {
    fileText(id, "match-report.md").then((md) => { view.innerHTML = `<div class="viewer">${mdToHtml(md || "(还没有报告)")}</div>`; });
    return;
  }
  const pref = tab === "resume" ? "resume" : "cover-letter";
  view.innerHTML = `<div class="links">`
    + `<a onclick="matView('${pref}','pdf')">PDF 预览</a>`
    + `<a onclick="matView('${pref}','md')">文字版</a>`
    + `<a onclick="matView('${pref}','edit')">编辑</a>`
    + `<a onclick="downloadFile(curId,'${pref}.pdf')">下载 PDF</a>`
    + `<a onclick="downloadFile(curId,'${pref}.docx')">下载 .docx</a>`
    + `</div><div id="matbody"></div>`;
  matView(pref, "pdf");
}
async function matView(pref, mode) {
  const box = $("matbody"); if (!box) return;
  if (mode === "pdf") {
    box.innerHTML = `<div class="empty">加载 PDF…</div>`;
    const url = await fileUrl(curId, pref + ".pdf");
    box.innerHTML = url ? `<iframe class="pdf" src="${url}"></iframe>` : `<div class="empty">还没有 PDF(生成材料后自动导出)</div>`;
    return;
  }
  const md = await fileText(curId, pref + ".md");
  if (mode === "md") {
    box.innerHTML = `<div class="viewer">${mdToHtml(md || "")}</div>`;
    return;
  }
  // 在线编辑 markdown → 保存并重新导出 PDF/docx
  box.innerHTML = `<textarea id="mdEdit" class="ota mono" rows="24">${esc(md || "")}</textarea>`
    + `<div class="bar"><button id="mdSave" onclick="saveMd('${pref}')">保存并重新导出 PDF/docx</button><span class="prog" id="mdProg"></span></div>`;
}
function saveMd(pref) {
  const ta = $("mdEdit"), btn = $("mdSave"), prog = $("mdProg");
  if (!ta) return;
  btn.disabled = true; btn.textContent = "保存中…";
  api("/api/file", { method: "PUT", body: JSON.stringify({ id: curId, name: pref + ".md", content: ta.value }) })
    .then((res) => {
      if (res.error) { prog.textContent = "出错: " + res.error; btn.disabled = false; btn.textContent = "重试"; return; }
      btn.textContent = "重新导出中…";
      pollTask(res.taskId, prog,
        () => { btn.disabled = false; btn.textContent = "保存并重新导出 PDF/docx"; prog.textContent = "✅ 已保存并导出"; },
        () => { btn.disabled = false; btn.textContent = "重试"; });
    })
    .catch(() => { btn.disabled = false; btn.textContent = "重试"; });
}

// —— 档案(主简历 / 求职目标 / 风格偏好)——
const PROFILE_LABEL = { "resume-master": "主简历", "target": "求职目标", "preferences": "风格偏好" };
let profileDocs = [], profileTab = "resume-master";
function openProfile() {
  $("scrim").hidden = false; $("drawer").hidden = false; $("drawer").scrollTop = 0; curId = null;
  api("/api/profile").then((docs) => { profileDocs = docs; renderProfile(); });
}
function renderProfile() {
  const doc = profileDocs.find((d) => d.name === profileTab) || { content: "" };
  let h = `<h2>个人档案</h2><p class="meta">存在云端数据库,打分和生成都读这里。改完记得保存。</p>`;
  h += `<div class="tabs">` + Object.keys(PROFILE_LABEL).map((n) =>
    `<button class="${profileTab === n ? "on" : ""}" onclick="profileTab='${n}';renderProfile()">${PROFILE_LABEL[n]}</button>`).join("") + `</div>`;
  h += `<textarea id="pEdit" class="ota mono" rows="26">${esc(doc.content)}</textarea>`;
  h += `<div class="bar"><button id="pSave" onclick="saveProfileDoc()">保存${PROFILE_LABEL[profileTab]}</button><span class="prog" id="pProg"></span></div>`;
  $("detail").innerHTML = h;
}
function saveProfileDoc() {
  const btn = $("pSave"), prog = $("pProg");
  btn.disabled = true;
  api("/api/profile", { method: "PUT", body: JSON.stringify({ name: profileTab, content: $("pEdit").value }) })
    .then((res) => {
      btn.disabled = false;
      prog.textContent = res.error ? "出错: " + res.error : "✅ 已保存";
      const d = profileDocs.find((x) => x.name === profileTab); if (d) d.content = $("pEdit").value;
      setTimeout(() => { prog.textContent = ""; }, 1500);
    })
    .catch(() => { btn.disabled = false; });
}

// —— 极简 Markdown → HTML ——
function mdToHtml(md) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, label, url) => { const href = safeHref(url); return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label; });
  const lines = md.replace(/\r\n/g, "\n").split("\n"); const out = []; let i = 0, inList = false;
  const closeL = () => { if (inList) { out.push("</ul>"); inList = false; } };
  while (i < lines.length) {
    const ln = lines[i];
    const hm = ln.match(/^(#{1,6})\s+(.*)$/), bm = ln.match(/^\s*[-*]\s+(.*)$/), tbl = /^\s*\|.*\|\s*$/.test(ln);
    if (/^\s*---+\s*$/.test(ln)) { closeL(); i++; continue; }
    if (hm) { closeL(); const lv = hm[1].length; out.push(`<h${lv}>${inline(hm[2])}</h${lv}>`); i++; }
    else if (tbl) {
      closeL(); const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      out.push("<table>");
      rows.forEach((r, idx) => {
        if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(r) && r.indexOf("-") >= 0) return;
        const cells = r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const tag = idx === 0 ? "th" : "td";
        out.push("<tr>" + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("") + "</tr>");
      });
      out.push("</table>");
    }
    else if (bm) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(bm[1])}</li>`); i++; }
    else if (ln.trim() === "") { closeL(); i++; }
    else if (/^\s*>/.test(ln)) { closeL(); out.push(`<blockquote>${inline(ln.replace(/^\s*>\s?/, ""))}</blockquote>`); i++; }
    else { closeL(); out.push(`<p>${inline(ln)}</p>`); i++; }
  }
  closeL(); return out.join("\n");
}

// —— 启动 ——
window.cardDrag = cardDrag; window.cardEnd = cardEnd; window.colOver = colOver; window.colLeave = colLeave; window.colDrop = colDrop;
window.openDetail = openDetail; window.closeDetail = closeDetail; window.changeStatus = changeStatus; window.delJob = delJob;
window.confirmReady = confirmReady; window.overrideReady = overrideReady;
window.scoreJobBtn = scoreJobBtn; window.genOutreach = genOutreach; window.generate = generate; window.showTab = showTab;
window.matView = matView; window.saveMd = saveMd; window.copyEl = copyEl; window.countNote = countNote;
window.openProfile = openProfile; window.renderProfile = renderProfile; window.saveProfileDoc = saveProfileDoc;
window.loadBoard = loadBoard; window.doLogin = doLogin; window.logout = logout; window.downloadFile = downloadFile;

if (!BASE || !TOKEN) {
  showLogin("");
} else {
  loadBoard();
  const q0 = new URLSearchParams(location.search);
  if (q0.get("job")) openDetail(q0.get("job"));
}

// 抓取在后台排队时,自动刷新看板(空闲/拖动时不刷)
let wasBusy = false;
setInterval(() => {
  if (dragId || !TOKEN) return;
  api("/api/state").then((st) => {
    const busy = st.queue > 0 || st.processing;
    gQueue = busy ? ` · ⏳ 抓取处理中${st.queue ? " " + st.queue : ""}` : "";
    if (busy || wasBusy) loadBoard();
    wasBusy = busy;
  }).catch(() => {});
}, 4000);
