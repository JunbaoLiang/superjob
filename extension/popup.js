// 端口需与本地服务一致(node src/cli.js serve,默认 8787)。
// 若你用 SUPERJOB_PORT 换了端口,这里和 manifest.json 的 host_permissions 一起改。
const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;

const $ = (id) => document.getElementById(id);
let lastJobId = null;

$("panel").addEventListener("click", () => {
  const url = lastJobId ? `${BASE}/?job=${encodeURIComponent(lastJobId)}` : `${BASE}/`;
  chrome.tabs.create({ url });
});
const VERDICT_CN = {
  strong_match: "强匹配 · 优先投",
  worth_applying: "值得投",
  stretch: "够得着但吃力",
  skip: "匹配度低",
};

function setStatus(msg) { $("status").textContent = msg || ""; }

function setHealth(online) {
  const dot = $("health");
  dot.className = "dot " + (online ? "on" : "off");
  dot.title = online ? "本地服务在线" : "本地服务未启动";
  $("hint").textContent = online
    ? "抓取会在本地解析+打分并落盘到 data/jobs/。"
    : "后台服务未运行。双击项目里的「安装.command」修复(装好后开机自启)。";
}

async function checkHealth() {
  try {
    const r = await fetch(`${BASE}/health`, { method: "GET" });
    setHealth(r.ok);
  } catch {
    setHealth(false);
  }
}

async function grabPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // 有选中文字(>100 字)就只抓选中的——在 LinkedIn 这类多职位页面能精确控制抓哪个
      const selText = (window.getSelection && window.getSelection().toString()) || "";
      const fromSelection = selText.trim().length > 100;
      const text = fromSelection
        ? selText
        : (document.querySelector("main")?.innerText ||
           document.querySelector("article")?.innerText ||
           document.body.innerText || "");
      return { text: text.slice(0, 40000), url: location.href, title: document.title, fromSelection };
    },
  });
  return result;
}

function renderResult(data) {
  const { job, score, jobId, statusLabel, usage } = data;
  lastJobId = jobId;
  $("score").textContent = score.score;
  $("verdict").textContent = statusLabel ? `${VERDICT_CN[score.verdict] || score.verdict}` : score.verdict;
  $("verdict").className = "verdict " + score.verdict;
  $("title").textContent = `${job.company} — ${job.title}`;
  $("meta").textContent = [job.location, job.visa_sponsorship && `签证 ${job.visa_sponsorship}`, job.salary]
    .filter(Boolean).join(" · ");

  const ul = $("rationale");
  ul.innerHTML = "";
  (score.rationale || []).forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    ul.appendChild(li);
  });

  const next = $("next");
  next.innerHTML = score.verdict === "skip"
    ? `已标记「不投」。想海投就点上方「打开面板」→ 选中它 → 生成材料。`
    : `已落盘。点上方「打开面板」→ 选中它 → 一键生成简历 + cover letter。`;
  const costLine = usage
    ? (Number.isFinite(usage.estUSD)
      ? `  · 本次约 $${usage.estUSD.toFixed(3)}`
      : `  · 成本待配置(${usage.provider}/${usage.model})`)
    : "";
  setStatus(`✅ 已抓取并打分${costLine}`);
  $("result").hidden = false;
}

$("capture").addEventListener("click", async () => {
  const btn = $("capture");
  btn.disabled = true;
  $("result").hidden = true;
  setStatus("抓取页面…");
  try {
    const page = await grabPage();
    if (!page || (page.text || "").trim().length < 50) {
      setStatus("这个页面正文太少,换个招聘详情页试试。");
      return;
    }
    setStatus((page.fromSelection ? "已抓取选中文字," : "已抓取整页,") + "提交中…");
    const resp = await fetch(`${BASE}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(page),
    });
    const data = await resp.json();
    if (data.error) { setStatus("⚠️ " + data.error); return; }
    // 提交即走:服务器后台排队解析+打分,你可以立刻切下一个岗
    setStatus(`✅ 已提交(队列第 ${data.queued || 1} 个)。可以直接抓下一个了,结果在面板看。`);
    $("result").hidden = true;
  } catch (e) {
    setHealth(false);
    setStatus("连不上后台服务。双击项目里的「安装.command」修复。");
  } finally {
    btn.disabled = false;
  }
});

checkHealth();
