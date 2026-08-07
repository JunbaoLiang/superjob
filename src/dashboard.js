// 浏览器面板:Notion 式看板,按投递状态分列,拖卡片改状态追踪进度;点卡片右侧抽屉看详情/生成/预览。
// 由本地服务在 http://127.0.0.1:PORT/ 提供,全部同源 http。内嵌前端 JS 刻意不用反引号/${}。
export function dashboardHTML() {
  return `<!doctype html><html lang=zh><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Job Copilot 面板</title>
<style>
:root{--accent:#22568f;--ink:#1b2027;--muted:#5c6675;--line:#e4e8ee;--bg:#f6f7f9;--card:#fff;
--green:#2e7d5b;--amber:#b0730e;--red:#b4472f;}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 -apple-system,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--bg)}
header{display:flex;align-items:center;gap:10px;padding:11px 18px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:8}
header h1{font-size:16px;color:var(--accent);margin:0}
header .hint{color:var(--muted);font-size:12px;flex:1}
button{font:inherit;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
button.ghost{background:#eef1f5;color:var(--ink)}
button.danger{background:#fff;color:#b4472f;border:1px solid #e3b9af}
button:disabled{opacity:.55;cursor:default}
select{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit}

/* —— 看板 —— */
.board{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding:16px 18px 30px;
  height:calc(100vh - 48px)}
.col{flex:0 0 216px;width:216px;background:#eef1f5;border-radius:12px;padding:8px 8px 12px;max-height:100%;
  display:flex;flex-direction:column}
.col.over{outline:2px dashed var(--accent);outline-offset:-2px;background:#e5edf6}
.colhead{font-size:12.5px;font-weight:700;color:var(--muted);padding:4px 6px 9px;display:flex;align-items:center;gap:6px}
.colhead .cnt{background:#dfe4ea;color:var(--muted);border-radius:20px;padding:0 7px;font-size:11px}
.cards{overflow-y:auto;display:flex;flex-direction:column;gap:8px;min-height:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px;cursor:grab;
  box-shadow:0 1px 2px rgba(0,0,0,.05)}
.card:active{cursor:grabbing}
.card.drag{opacity:.4}
.card .cco{font-weight:650;font-size:13px}
.card .cti{color:var(--muted);font-size:12px;margin-top:1px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .crow{margin-top:6px;display:flex;align-items:center;gap:6px}
.pill{font-size:11px;padding:1px 7px;border-radius:20px;font-weight:600;white-space:nowrap}
.strong_match{color:var(--green);background:rgba(46,125,91,.12)}
.worth_applying,.stretch{color:var(--amber);background:rgba(176,115,14,.13)}
.skip{color:var(--red);background:rgba(180,71,47,.12)}
.empty{color:#9aa4b0;font-size:12px;padding:6px}

/* —— 详情抽屉 —— */
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.34);z-index:15}
.drawer{position:fixed;top:0;right:0;width:min(560px,94vw);height:100vh;background:var(--card);
  box-shadow:-8px 0 40px rgba(0,0,0,.2);z-index:16;overflow:auto;padding:16px 22px 40px}
.drawer .x{position:sticky;top:0;float:right;background:#eef1f5;color:var(--ink);border:none;border-radius:8px;
  width:30px;height:30px;padding:0;font-size:16px;cursor:pointer}
h2{font-size:18px;margin:2px 40px 4px 0}
.meta{color:var(--muted);font-size:13px}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0}
.sec{background:#fbfcfd;border:1px solid var(--line);border-radius:10px;padding:13px 15px;margin:12px 0}
.sec h3{margin:0 0 8px;font-size:13px;color:var(--accent)}
ul.tight{margin:4px 0;padding-left:20px}ul.tight li{margin:3px 0}
.tabs{display:flex;gap:6px;margin:12px 0 8px;flex-wrap:wrap}
.tabs button{background:#eef1f5;color:var(--ink);padding:6px 12px;font-weight:600}
.tabs button.on{background:var(--accent);color:#fff}
.links{margin:6px 0}.links a{color:var(--accent);margin-right:14px;font-size:13px;cursor:pointer}
.viewer{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 20px}
.viewer h1{font-size:19px;text-align:center;margin:.2em 0}
.viewer h2{font-size:14px;color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:3px;margin:13px 0 6px 0}
.viewer h3{font-size:13px;margin:9px 0 3px}
.viewer table{border-collapse:collapse;margin:6px 0}.viewer td,.viewer th{border:1px solid var(--line);padding:3px 9px;text-align:left}
.viewer code{background:#eef1f5;padding:1px 5px;border-radius:4px;font:12px "SF Mono",Menlo,monospace}
.viewer ul{padding-left:20px}
iframe.pdf{width:100%;height:70vh;border:1px solid var(--line);border-radius:10px}
.prog{font-family:"SF Mono",Menlo,monospace;font-size:12px;color:var(--muted);white-space:pre-wrap;margin-top:8px}
.ota{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:13px/1.5 -apple-system,Arial,sans-serif;resize:vertical;color:var(--ink)}
.olabel{display:block;font-size:12px;color:var(--muted);margin:9px 0 3px}
.ocount{font-weight:600;font-variant-numeric:tabular-nums}
.batchpanel{position:fixed;right:18px;top:58px;z-index:10;width:min(520px,calc(100vw - 36px));background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;box-shadow:0 10px 34px rgba(0,0,0,.16)}
.batchpanel h2{font-size:15px;margin:0 0 5px}.batchpanel .meta{margin:0 0 8px}.batchresult{max-height:150px;overflow:auto;margin-top:8px;font-size:12px;color:var(--muted)}
</style></head><body>
<header>
  <h1>Job Copilot</h1>
  <span class=hint id=hint></span>
  <span style="color:#9aa4b0;font-size:12px">拖动卡片改状态 · 点卡片看详情</span>
  <button class=ghost onclick="toggleBatch()">批量导入 JD</button>
  <button class=ghost onclick="loadBoard()">刷新</button>
</header>
<div class=board id=board></div>
<div class=batchpanel id=batchpanel hidden><button class=x onclick="toggleBatch()">✕</button><h2>批量导入 JD</h2>
<p class=meta>每个 JD 用空行分隔。只粘贴 URL 不会自动抓网页；请用浏览器扩展抓取该页，或同时粘贴 JD 正文。</p>
<textarea class=ota id=batchtext rows=11 placeholder="职位 JD 1\n\n职位 JD 2"></textarea><div class=bar><button onclick="submitBatch()">加入队列</button><button class=ghost onclick="refreshCaptureQueue()">查看队列</button></div><div class=batchresult id=batchresult></div></div>
<div class=scrim id=scrim hidden onclick="closeDetail()"></div>
<div class=drawer id=drawer hidden><button class=x onclick="closeDetail()">✕</button><div id=detail></div></div>
<script>
var STATUS={"new":"🆕 待定","to-apply":"📮 待投","applied":"✅ 已投","interview":"🎤 面试中","offer":"🎉 Offer","rejected":"❌ 已拒","skip":"🚫 不投"};
var ORDER=["new","to-apply","applied","interview","offer","rejected","skip"];
var VERDICT={strong_match:"强匹配",worth_applying:"值得投",stretch:"够得着",low_match:"低匹配",skip:"旧版低匹配"};
var ELIGIBILITY={eligible:"可申请","needs-verification":"待核实",ineligible:"明确不符合"};
var RECOMMENDATION={main_target:"主投",mass_apply:"海投",stretch:"Stretch",verify:"先核实",skip:"跳过"};
var READINESS={"not-generated":"未生成",draft:"待确认","needs-review":"需复核",ready:"已就绪"};
var curTab="report", curId=null, dragId=null, gQueue="";

function api(p){return fetch(p).then(function(r){return r.json()});}
function esc(s){return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function scoreView(s){if(!s||!s.match)return {legacy:true,match:s||{},hard_blockers:(s&&s.hard_blockers)||[],risks:[],eligibility:null,recommendation:null};return {legacy:false,match:s.match,hard_blockers:s.eligibility.hard_blockers,risks:s.eligibility.risks,eligibility:s.eligibility.verdict,recommendation:s.recommendation};}

/* —— 批量导入与队列 —— */
function toggleBatch(){var p=document.getElementById("batchpanel");p.hidden=!p.hidden;if(!p.hidden)refreshCaptureQueue();}
function batchItems(text){return text.split(/\\r?\\n\\s*\\r?\\n/g).map(function(x){return x.trim();}).filter(Boolean).map(function(x){return /^https?:\\/\\/\\S+$/i.test(x)?{url:x}:{text:x};});}
function queueHTML(data){var h="";if(!data.items||!data.items.length)return "队列为空。";data.items.forEach(function(x){h+='<div>'+esc(x.id||"—")+' · '+esc(x.state||x.kind||"?")+(x.attempts!=null?" · 第 "+x.attempts+" 次":"")+(x.error?" · ⚠ "+esc(x.error):"")+'</div>';});return h;}
function refreshCaptureQueue(){api("/api/capture-queue").then(function(d){document.getElementById("batchresult").innerHTML=queueHTML(d);});}
function submitBatch(){var text=document.getElementById("batchtext").value,items=batchItems(text),out=document.getElementById("batchresult");if(!items.length){out.textContent="请至少粘贴一个 JD。";return;}out.textContent="正在加入队列…";fetch("/api/import/batch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:items})}).then(function(r){return r.json()}).then(function(d){if(d.error){out.textContent=d.error;return;}var h='已接受 '+d.summary.accepted+'；重复 '+d.summary.duplicates+'；拒绝 '+d.summary.rejected+'。';(d.items||[]).filter(function(x){return x.kind!=="accepted";}).forEach(function(x){h+='<div>⚠ '+esc(x.kind)+': '+esc(x.error||x.id||"")+'</div>';});out.innerHTML=h;document.getElementById("batchtext").value="";loadBoard();setTimeout(refreshCaptureQueue,500);}).catch(function(){out.textContent="本地服务连接失败。";});}

/* —— 看板 —— */
function loadBoard(){
  api("/api/jobs").then(function(js){
    document.getElementById("hint").textContent=js.length+" 个职位"+gQueue;
    var by={}; ORDER.forEach(function(s){by[s]=[]});
    js.forEach(function(j){ if(!by[j.status])by[j.status]=[]; by[j.status].push(j); });
    var h="";
    ORDER.forEach(function(s){
      var col=by[s]||[];
      h+='<div class=col data-s="'+s+'" ondragover="colOver(event)" ondragleave="colLeave(event)" ondrop="colDrop(event,\\''+s+'\\')">';
      h+='<div class=colhead>'+STATUS[s]+'<span class=cnt>'+col.length+'</span></div><div class=cards>';
      col.forEach(function(j){
        var v=j.verdict||"";
        h+='<div class=card draggable=true ondragstart="cardDrag(event,\\''+j.id+'\\')" ondragend="cardEnd(event)" onclick="openDetail(\\''+j.id+'\\')">';
        h+='<div class=cco>'+esc(j.company||j.id)+'</div><div class=cti>'+esc(j.title||"")+'</div>';
        h+='<div class=crow>'+(j.score!=null?'<span class="pill '+v+'">'+j.score+' '+(VERDICT[v]||v)+'</span>':'<span class=empty>未打分</span>')+(j.readiness?'<span class="pill">材料 '+(READINESS[j.readiness]||j.readiness)+'</span>':'')+(j.hasResume?'<span title="已生成材料">📄</span>':'')+'</div>';
        h+='</div>';
      });
      if(!col.length) h+='<div class=empty>—</div>';
      h+='</div></div>';
    });
    document.getElementById("board").innerHTML=h;
  });
}
function cardDrag(e,id){ dragId=id; e.currentTarget.classList.add("drag"); e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain",id); }
function cardEnd(e){ e.currentTarget.classList.remove("drag"); }
function colOver(e){ e.preventDefault(); e.currentTarget.classList.add("over"); }
function colLeave(e){ e.currentTarget.classList.remove("over"); }
function colDrop(e,status){ e.preventDefault(); e.currentTarget.classList.remove("over");
  var id=dragId||e.dataTransfer.getData("text/plain"); dragId=null;
  if(!id) return;
  fetch("/api/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id,to:status})})
    .then(function(r){return r.json()}).then(function(res){ if(res.error){alert(res.error);return;} if(curId===id&&res.id)curId=res.id; loadBoard(); });
}

/* —— 详情抽屉 —— */
function openDetail(id){ curId=id; curTab="report";
  document.getElementById("scrim").hidden=false; document.getElementById("drawer").hidden=false;
  document.getElementById("drawer").scrollTop=0;
  api("/api/job?id="+encodeURIComponent(id)).then(renderDetail);
}
function closeDetail(){ document.getElementById("drawer").hidden=true; document.getElementById("scrim").hidden=true; curId=null; }
function refreshDetail(){ if(curId) api("/api/job?id="+encodeURIComponent(curId)).then(renderDetail); }

function statusOptions(cur){ var h=""; ORDER.forEach(function(k){h+='<option value="'+k+'"'+(k===cur?" selected":"")+'>'+STATUS[k]+'</option>';}); return h; }

function renderDetail(d){
  if(d.error){document.getElementById("detail").innerHTML='<div class=empty>'+esc(d.error)+'</div>';return;}
  curId=d.id; var j=d.job,s=d.score;
  var meta=[j.location,j.visa_sponsorship&&("签证 "+j.visa_sponsorship),j.salary,j.remote_policy].filter(Boolean).join(" · ");
  var h='<h2>'+esc(j.company)+' — '+esc(j.title)+'</h2><div class=meta>'+esc(meta)+'</div>';
  h+='<div class=bar><label>投递状态 </label><select onchange="changeStatus(this.value)">'+statusOptions(d.status)+'</select>';
  if(j.url) h+=' <a class=links href="'+esc(j.url)+'" target=_blank>原始职位 ↗</a>';
  h+=' <button class=danger onclick="delJob()">删除</button></div>';
  var rd=d.readiness;
  h+='<div class=sec><h3>材料就绪</h3>';
  if(!rd){ h+='<p class=meta>尚未初始化 readiness；不能标记为已投。</p>'; }
  else {
    h+='<p><span class=pill>材料 '+(READINESS[rd.state]||rd.state)+'</span></p>';
    if(rd.assessment){ h+='<p class=meta>简历核查 '+esc(rd.assessment.resume_fact_verdict)+' · 求职信核查 '+esc(rd.assessment.cover_fact_verdict)+' · 简历 '+esc(rd.assessment.resume_pages==null?"页数未知":rd.assessment.resume_pages+" 页")+'</p>'; }
    if(rd.confirmation){ h+='<p class=meta>确认方式: '+esc(rd.confirmation.mode)+(rd.confirmation.reason?' · '+esc(rd.confirmation.reason):'')+'</p>'; }
    if(rd.state==="draft") h+='<button onclick="confirmReady()">确认材料 ready</button>';
    if(rd.state==="draft"||rd.state==="needs-review") h+=' <button class=ghost onclick="overrideReady()">人工 override…</button>';
  }
  h+='</div>';
  if(s){
    var sv=scoreView(s);
    h+='<div class=sec><h3>'+(sv.legacy?"旧版评分":"Eligibility "+(ELIGIBILITY[sv.eligibility]||sv.eligibility)+" · "+(RECOMMENDATION[sv.recommendation]||sv.recommendation))+'</h3>';
    h+='<p><span class=pill>Match '+sv.match.score+' / 100 · '+(VERDICT[sv.match.verdict]||sv.match.verdict||"未知")+'</span></p>';
    if(sv.match.rationale&&sv.match.rationale.length){h+='<ul class=tight>';sv.match.rationale.forEach(function(r){h+='<li>'+esc(r)+'</li>';});h+='</ul>';}
    if(sv.risks.length){h+='<div style="color:#b0730e;margin-top:6px">⚠️ 待核实：'+sv.risks.map(esc).join("<br>⚠️ ")+'</div>';}
    if(sv.hard_blockers.length){h+='<div style="color:#b4472f;margin-top:6px">⛔ '+sv.hard_blockers.map(esc).join("<br>⛔ ")+'</div>';}
    h+='</div>';
  }else{
    // 只解析未打分(连抓时可能撞限流)——一键补分
    h+='<div class=sec><h3>还没打分</h3><p class=meta>这个岗只解析了、还没打分(连抓时可能撞了限流)。点下面补上。</p>'
      +'<button id=scorebtn onclick="scoreJob()">打分</button><div class=prog id=sprog></div></div>';
    document.getElementById("detail").innerHTML=h;
    return; // 没打分前不显示材料/外联(生成它们需要分数)
  }
  h+='<div class=sec><h3>投递材料</h3>';
  if(d.hasResume){
    h+='<div class=tabs>'
      +'<button id=t_report class="'+(curTab==="report"?"on":"")+'" onclick="showTab(\\'report\\')">匹配报告</button>'
      +'<button id=t_resume class="'+(curTab==="resume"?"on":"")+'" onclick="showTab(\\'resume\\')">简历</button>'
      +'<button id=t_cover class="'+(curTab==="cover"?"on":"")+'" onclick="showTab(\\'cover\\')">Cover letter</button>'
      +'</div><div id=view></div>';
  }else{
    var sv2=scoreView(s);
    if(sv2.eligibility==="ineligible") h+='<p class=meta>存在明确 eligibility hard block，不能生成材料。</p>';
    else h+='<p class=meta>还没生成材料。'+(sv2.recommendation==="stretch"?"Stretch 岗位，需由你手动确认后生成。":sv2.recommendation==="verify"?"请先核实风险；如仍决定投入，可手动生成。":"")+'</p>'
      +'<button id=genbtn onclick="generate()">生成材料(简历 + Cover letter)</button><div class=prog id=prog></div>';
  }
  h+='</div>';

  // 外联 Reach out
  h+='<div class=sec><h3>外联 Reach out</h3>';
  if(d.outreach){
    h+='<div style="font-weight:600;margin-bottom:3px">该联系谁</div><ul class=tight>';
    (d.outreach.who||[]).forEach(function(w){h+='<li>'+esc(w)+'</li>';});
    h+='</ul>';
    if(d.outreach.channel) h+='<div class=meta style="margin:6px 0">渠道:'+esc(d.outreach.channel)+'</div>';
    h+='<label class=olabel>LinkedIn 连接请求备注(免会员上限 200 字,可改)<span id=oCount class=ocount></span></label>'
      +'<textarea id=oNote class=ota rows=3 oninput="countNote()">'+esc(d.outreach.note||"")+'</textarea>'
      +'<div class=links><a onclick="copyEl(\\'oNote\\')">复制备注</a></div>';
    h+='<label class=olabel>接受连接后的跟进私信 / 邮件(1度好友或有邮箱时用,可改)</label>'
      +'<textarea id=oMsg class=ota rows=7>'+esc(d.outreach.message||"")+'</textarea>'
      +'<div class=links><a onclick="copyEl(\\'oMsg\\')">复制消息</a> <a onclick="genOutreach()">重新生成</a></div>';
  }else{
    h+='<p class=meta>要主动联系时,生成「该找谁 + 短信草稿」(可编辑)。</p>'
      +'<button id=obtn onclick="genOutreach()">生成外联建议</button><div class=prog id=oprog></div>';
  }
  h+='</div>';

  document.getElementById("detail").innerHTML=h;
  if(d.hasResume) showTab(curTab);
  if(d.outreach) countNote();
}

function countNote(){ var el=document.getElementById("oNote"),c=document.getElementById("oCount"); if(!el||!c)return;
  var n=el.value.length; c.textContent=" "+n+"/200"; c.style.color=n>200?"#b4472f":"#5c6675";
  el.style.borderColor=n>200?"#b4472f":"";
}

function genOutreach(){ if(!curId)return; var id=curId;
  var btn=document.getElementById("obtn"); if(btn){btn.disabled=true;btn.textContent="生成中(约 10 秒)…";}
  var p=document.getElementById("oprog"); if(p)p.textContent="";
  fetch("/api/outreach",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})})
    .then(function(r){return r.json()}).then(function(res){
      if(res.error){ if(p)p.textContent="出错: "+res.error; if(btn){btn.disabled=false;btn.textContent="重试";} return; }
      if(curId===id) refreshDetail();
    }).catch(function(){ if(btn){btn.disabled=false;btn.textContent="重试";} });
}
function copyEl(id){ var el=document.getElementById(id); if(!el)return;
  navigator.clipboard.writeText(el.value).then(function(){ el.style.outline="2px solid #2e7d5b"; setTimeout(function(){el.style.outline="";},700); });
}

function changeStatus(to){ if(!curId)return;
  fetch("/api/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:curId,to:to})})
    .then(function(r){return r.json()}).then(function(res){ if(res.error){alert(res.error);refreshDetail();return;} curId=res.id||curId; loadBoard(); refreshDetail(); });
}
function confirmReady(){ if(!curId)return;
  fetch("/api/readiness/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:curId})})
    .then(function(r){return r.json()}).then(function(res){ if(res.error){alert(res.error);return;} loadBoard();refreshDetail(); });
}
function overrideReady(){ if(!curId)return; var reason=prompt("请填写 override 原因（会记录在岗位中）："); if(reason===null)return;
  fetch("/api/readiness/override",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:curId,reason:reason})})
    .then(function(r){return r.json()}).then(function(res){ if(res.error){alert(res.error);return;} loadBoard();refreshDetail(); });
}
function delJob(){ if(!curId)return;
  if(!confirm("确认删除这个职位?材料一并删除,不可恢复。")) return;
  fetch("/api/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:curId})})
    .then(function(r){return r.json()}).then(function(){ closeDetail(); loadBoard(); });
}
function generate(){ if(!curId)return; var id=curId;
  var btn=document.getElementById("genbtn"); if(btn){btn.disabled=true;btn.textContent="生成中…";}
  var prog=document.getElementById("prog"); prog.textContent="";
  var es=new EventSource("/api/gen?id="+encodeURIComponent(id));
  es.onmessage=function(e){ var m=JSON.parse(e.data);
    if(m.log) prog.textContent+=m.log+"\\n";
    if(m.done){ es.close(); loadBoard(); if(curId===id) refreshDetail(); }
    if(m.error){ es.close(); prog.textContent+="出错: "+m.error+"\\n"; if(btn){btn.disabled=false;btn.textContent="重试生成";} }
  };
  es.onerror=function(){ es.close(); if(btn){btn.disabled=false;btn.textContent="重试生成";} };
}
function scoreJob(){ if(!curId)return; var id=curId;
  var btn=document.getElementById("scorebtn"); if(btn){btn.disabled=true;btn.textContent="打分中(约 10 秒)…";}
  fetch("/api/score",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})})
    .then(function(r){return r.json()}).then(function(res){
      if(res.error){ if(btn){btn.disabled=false;btn.textContent="重试打分";} return; }
      curId=res.id||id; loadBoard(); refreshDetail();
    }).catch(function(){ if(btn){btn.disabled=false;btn.textContent="重试打分";} });
}

/* —— 材料预览:简历/CL 默认内嵌 PDF,可切文字版 —— */
function showTab(tab){
  if(["report","resume","cover"].indexOf(tab)<0) tab="report"; curTab=tab; var id=curId;
  ["report","resume","cover"].forEach(function(t){var b=document.getElementById("t_"+t);if(b)b.className=(t===tab?"on":"");});
  var view=document.getElementById("view"); if(!view) return;
  if(tab==="report"){ fetch("/api/file?id="+encodeURIComponent(id)+"&name=match-report.md").then(function(r){return r.text()}).then(function(md){ view.innerHTML='<div class=viewer>'+mdToHtml(md)+'</div>'; }); return; }
  var pref=tab==="resume"?"resume":"cover-letter", base="/api/file?id="+encodeURIComponent(id)+"&name=";
  view.innerHTML='<div class=links><a onclick="matView(\\''+pref+'\\',\\'pdf\\')">PDF 预览</a><a onclick="matView(\\''+pref+'\\',\\'md\\')">文字版</a>'
    +'<a href="'+base+pref+'.pdf" target=_blank>新标签打开 ↗</a><a href="'+base+pref+'.docx">下载 .docx</a></div><div id=matbody></div>';
  matView(pref,"pdf");
}
function matView(pref,mode){ var box=document.getElementById("matbody"); if(!box)return; var base="/api/file?id="+encodeURIComponent(curId)+"&name=";
  if(mode==="pdf"){ box.innerHTML='<iframe class=pdf src="'+base+pref+'.pdf"></iframe>'; return; }
  fetch(base+pref+".md").then(function(r){return r.text()}).then(function(t){ box.innerHTML='<div class=viewer>'+mdToHtml(t)+'</div>'; });
}

/* —— 极简 Markdown → HTML —— */
function mdToHtml(md){
  function inline(s){return esc(s)
    .replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>")
    .replace(/(^|[^*])\\*([^*]+?)\\*(?!\\*)/g,"$1<em>$2</em>")
    .replace(/\`(.+?)\`/g,"<code>$1</code>")
    .replace(/\\[(.+?)\\]\\((.+?)\\)/g,'<a href="$2" target=_blank>$1</a>');}
  var lines=md.replace(/\\r\\n/g,"\\n").split("\\n"),out=[],i=0,inList=false;
  function closeL(){if(inList){out.push("</ul>");inList=false;}}
  while(i<lines.length){
    var ln=lines[i],hm=ln.match(/^(#{1,6})\\s+(.*)$/),bm=ln.match(/^\\s*[-*]\\s+(.*)$/),tbl=/^\\s*\\|.*\\|\\s*$/.test(ln);
    if(/^\\s*---+\\s*$/.test(ln)){closeL();i++;continue;}
    if(hm){closeL();var lv=hm[1].length;out.push("<h"+lv+">"+inline(hm[2])+"</h"+lv+">");i++;}
    else if(tbl){closeL();var rows=[];while(i<lines.length&&/^\\s*\\|.*\\|\\s*$/.test(lines[i])){rows.push(lines[i]);i++;}
      out.push("<table>");rows.forEach(function(r,idx){
        if(/^\\s*\\|?[\\s:|-]+\\|[\\s:|-]*$/.test(r)&&r.indexOf("-")>=0)return;
        var cells=r.trim().replace(/^\\||\\|$/g,"").split("|").map(function(c){return c.trim();});
        var tag=idx===0?"th":"td"; out.push("<tr>"+cells.map(function(c){return "<"+tag+">"+inline(c)+"</"+tag+">";}).join("")+"</tr>");
      });out.push("</table>");}
    else if(bm){if(!inList){out.push("<ul>");inList=true;}out.push("<li>"+inline(bm[1])+"</li>");i++;}
    else if(ln.trim()===""){closeL();i++;}
    else if(/^\\s*>/.test(ln)){closeL();out.push("<blockquote>"+inline(ln.replace(/^\\s*>\\s?/,""))+"</blockquote>");i++;}
    else{closeL();out.push("<p>"+inline(ln)+"</p>");i++;}
  }
  closeL();return out.join("\\n");
}

loadBoard();
var _q=new URLSearchParams(location.search);
if(_q.get("job")) openDetail(_q.get("job"));
// 抓取在后台排队处理时,自动刷新看板让新岗/打分结果冒出来(空闲/拖动时不刷,避免打断)
var _wasBusy=false;
setInterval(function(){ if(dragId) return;
  fetch("/health").then(function(r){return r.json()}).then(function(hh){
    var busy=(hh.queue>0||hh.processing);
    gQueue = busy ? (" · ⏳ 抓取处理中"+(hh.queue?" "+hh.queue:"")) : "";
    if(busy||_wasBusy) loadBoard();
    _wasBusy=busy;
  }).catch(function(){});
}, 4000);
</script></body></html>`;
}
