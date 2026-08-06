// 云端版抓取:服务地址(Render)、面板地址(Vercel)、访问口令都在扩展「选项」里配置。
const $ = (id) => document.getElementById(id);
let cfg = { apiUrl: "", panelUrl: "", token: "" };

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["apiUrl", "panelUrl", "token"], (v) => {
      cfg = {
        apiUrl: (v.apiUrl || "").replace(/\/+$/, ""),
        panelUrl: (v.panelUrl || "").replace(/\/+$/, ""),
        token: v.token || "",
      };
      resolve(cfg);
    });
  });
}
const configured = () => cfg.apiUrl && cfg.token;

function setStatus(msg) { $("status").textContent = msg || ""; }

function setHealth(online) {
  const dot = $("health");
  dot.className = "dot " + (online ? "on" : "off");
  dot.title = online ? "云端服务在线" : "云端服务无响应";
  $("hint").textContent = online
    ? "抓取会发到你的云端服务解析+打分,结果在面板看。"
    : configured()
      ? "服务无响应。免费版休眠后首次唤醒约 1 分钟,稍等重试;或右键扩展图标 →「选项」检查地址。"
      : "还没配置。右键扩展图标 →「选项」,填入服务地址和口令。";
}

async function checkHealth() {
  if (!configured()) { setHealth(false); return; }
  try {
    const r = await fetch(cfg.apiUrl + "/health", { method: "GET" });
    setHealth(r.ok);
  } catch {
    setHealth(false);
  }
}

$("panel").addEventListener("click", () => {
  if (cfg.panelUrl) chrome.tabs.create({ url: cfg.panelUrl });
  else chrome.runtime.openOptionsPage();
});

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

$("capture").addEventListener("click", async () => {
  const btn = $("capture");
  if (!configured()) { setStatus("请先在扩展「选项」里配置服务地址和口令。"); chrome.runtime.openOptionsPage(); return; }
  btn.disabled = true;
  $("result").hidden = true;
  setStatus("抓取页面…");
  try {
    const page = await grabPage();
    if (!page || (page.text || "").trim().length < 50) {
      setStatus("这个页面正文太少,换个招聘详情页试试。");
      return;
    }
    setStatus((page.fromSelection ? "已抓取选中文字," : "已抓取整页,") + "提交中…(服务若在休眠要等约 1 分钟)");
    const resp = await fetch(cfg.apiUrl + "/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.token },
      body: JSON.stringify({ text: page.text, url: page.url, title: page.title }),
    });
    const data = await resp.json();
    if (data.error) { setStatus("⚠️ " + data.error); return; }
    // 提交即走:云端后台排队解析+打分,可以立刻抓下一个
    setStatus(`✅ 已提交(队列第 ${data.queued || 1} 个)。可以直接抓下一个了,结果在面板看。`);
  } catch (e) {
    setHealth(false);
    setStatus("连不上云端服务。免费版休眠唤醒约 1 分钟,稍等重试;或检查扩展「选项」。");
  } finally {
    btn.disabled = false;
  }
});

loadConfig().then(checkHealth);
