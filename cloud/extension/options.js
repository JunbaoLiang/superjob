const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(["apiUrl", "panelUrl", "token"], (v) => {
  $("apiUrl").value = v.apiUrl || "";
  $("panelUrl").value = v.panelUrl || "";
  $("token").value = v.token || "";
});

$("save").addEventListener("click", async () => {
  const btn = $("save"), msg = $("msg");
  let apiUrl = $("apiUrl").value.trim().replace(/\/+$/, "");
  let panelUrl = $("panelUrl").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  if (apiUrl && !/^https?:\/\//.test(apiUrl)) apiUrl = "https://" + apiUrl;
  if (panelUrl && !/^https?:\/\//.test(panelUrl)) panelUrl = "https://" + panelUrl;
  if (!apiUrl || !token) { msg.className = "err"; msg.textContent = "API 地址和口令必填"; return; }

  btn.disabled = true; btn.textContent = "测试连接中…(服务休眠时约 1 分钟)";
  msg.textContent = "";
  try {
    const r = await fetch(apiUrl + "/api/state", { headers: { "Authorization": "Bearer " + token } });
    if (r.status === 401) { msg.className = "err"; msg.textContent = "口令不对(和 Render 的 APP_TOKEN 比对一下)"; return; }
    if (!r.ok) { msg.className = "err"; msg.textContent = "服务响应异常: " + r.status; return; }
    chrome.storage.sync.set({ apiUrl, panelUrl, token }, () => {
      msg.className = "ok"; msg.textContent = "✅ 连接成功,已保存";
    });
  } catch (e) {
    msg.className = "err"; msg.textContent = "连不上:" + e.message + "(冷启动约 1 分钟,可稍等重试)";
  } finally {
    btn.disabled = false; btn.textContent = "测试并保存";
  }
});
