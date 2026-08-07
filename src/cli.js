#!/usr/bin/env node
// 求职助手 CLI —— M1 核心闭环
//   node src/cli.js add <jd.txt>          解析 + 打分(- 表示从 stdin 读,可配合 pbpaste)
//   node src/cli.js score <job-id>        (重新)打分:改了 target/profile 后重打
//   node src/cli.js status <job-id> <态>  更新投递状态(重命名目录)
//   node src/cli.js gen <job-id>          生成定制简历 + cover letter(含事实核查;skip 岗位走海投模式)
//   node src/cli.js genall [--force]      批量生成所有已打分但缺材料的职位
//   node src/cli.js report [job-id]       (重新)生成人类可读的 match-report.md
//   node src/cli.js list                  列出所有职位
//   node src/cli.js show <job-id>         查看某职位的打分详情
import fs from "node:fs";
import path from "node:path";
import { extractJob, scoreJob, generateMaterials, generateOutreach } from "./pipeline.js";
import { usageSummary } from "./llm.js";
import { writeMatchReport } from "./report.js";
import { exportJob } from "./export.js";
import { startServer } from "./server.js";
import { config } from "./config.js";
import { applyRecordPolicyMigration, planRecordPolicyMigration } from "./record-policy.js";
import {
  applyReadinessInitialization,
  assessMaterialReadiness,
  confirmMaterialReadiness,
  overrideMaterialReadiness,
  planReadinessInitialization,
} from "./material-readiness.js";
import {
  listJobs, loadJobFile, hasJobFile, resolveJobId, jobDir,
  STATUSES, setStatus, jobStatus, deleteJob,
} from "./jobs.js";

const VERDICT_LABEL = {
  strong_match: "🟢 strong_match(优先投)",
  worth_applying: "🟡 worth_applying(值得投)",
  stretch: "🟠 stretch(够得着但吃力)",
  skip: "🔴 skip(跳过,可海投)",
};

function printScore(id, score) {
  console.log(`\n━━━ ${id} ━━━`);
  console.log(`分数:${score.score}  ${VERDICT_LABEL[score.verdict] || score.verdict}`);
  if (score.rationale?.length) {
    console.log(`\n📌 打分理由:`);
    score.rationale.forEach((r) => console.log(`   • ${r}`));
  }
  if (score.hard_blockers?.length) {
    console.log(`\n⛔ 一票否决:`);
    score.hard_blockers.forEach((b) => console.log(`   - ${b}`));
  }
  if (score.gaps?.length) {
    console.log(`\n⚠️  Gaps:`);
    score.gaps.forEach((g) => console.log(`   - ${g}`));
  }
  if (score.strengths?.length) {
    console.log(`\n💪 优势:`);
    score.strengths.forEach((s) => console.log(`   - ${s}`));
  }
  if (score.resume_angle) console.log(`\n🎯 简历角度:${score.resume_angle}`);
}

async function cmdAdd(args) {
  const src = args[0];
  if (!src) {
    console.error("用法: node src/cli.js add <jd.txt>   或   pbpaste | node src/cli.js add -");
    process.exit(1);
  }
  const rawText = src === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(src, "utf8");
  if (rawText.trim().length < 50) {
    console.error("输入内容太短,不像是 JD");
    process.exit(1);
  }

  console.log("① 解析 JD 中...");
  const result = await extractJob(rawText, { pageUrl: getFlag(args, "--url") || "" });
  if (result.error) {
    console.error(`❌ 没有识别到职位信息: ${result.reason || result.error}`);
    process.exit(1);
  }
  const { jobId, job } = result;
  console.log(`   ${job.company} — ${job.title} (${job.location || "?"})`);
  console.log(`   签证: ${job.visa_sponsorship} | 薪资: ${job.salary || "未标注"}`);

  console.log("② 匹配打分中...");
  const score = await scoreJob(jobId);
  // 初始投递状态:skip 直接标「不投」,其余留「待定」等你决定
  const curId = score.verdict === "skip" ? setStatus(jobId, "skip") : jobId;
  writeMatchReport(curId);
  printScore(curId, score);
  console.log(`\n📁 目录: ${curId}  [${STATUSES[jobStatus(curId)]}]`);
  console.log(`📋 匹配报告: ${path.join(jobDir(curId), "match-report.md")}`);

  if (score.verdict === "skip") {
    console.log(`该职位匹配度低;如仍想海投,可跑: node src/cli.js gen ${curId}`);
  } else {
    console.log(`下一步生成投递材料: node src/cli.js gen ${curId}`);
    console.log(`投出去后标记状态: node src/cli.js status ${curId} applied`);
  }
}

/** 生成单个职位的材料,带进度输出;供 gen 和 genall 共用 */
async function generateOne(jobId) {
  const score = loadJobFile(jobId, "score.json");
  if (score.verdict === "skip") {
    console.log(`ℹ️  该职位评分为 skip,启用海投模式:忽略打分角度,突出可迁移技能生成通用材料`);
  }
  console.log(`① 生成定制简历中...`);
  const result = await generateMaterials(jobId, {
    onProgress: (step, detail) => {
      if (step === "resume-done") console.log(`② 事实核查中(虚构/过度拉伸)...`);
      if (step === "fixing") console.log(`   ⚠️ 发现 ${detail} 处问题,自动修正并复查中...`);
      if (step === "factcheck-done") {
        const n = detail.initial.issues.length;
        if (!n) {
          console.log(`   ✅ 核查通过,未发现问题`);
        } else if (!detail.final.issues.length) {
          console.log(`   ✅ 已修正 ${n} 处问题,复查通过`);
        } else {
          console.log(`   ⚠️ 修正后仍有 ${detail.final.issues.length} 处存疑,详见 match-report.md`);
        }
      }
      if (step === "condensing") console.log(`③ 简历渲染为 ${detail} 页,自动压缩到一页中...`);
      if (step === "onepage-done") {
        if (detail.pages === 1) {
          console.log(`③ 排版:${detail.rounds ? `压缩 ${detail.rounds} 轮后 ` : ""}✅ 一页`);
        } else if (detail.pages) {
          console.log(`③ 排版:⚠️ 压缩 ${detail.rounds} 轮后仍 ${detail.pages} 页,请人工精简 resume.md`);
        }
      }
      if (step === "cover-letter-done") console.log(`④ cover letter 已生成,事实核查中...`);
      if (step === "cover-fixing") console.log(`   ⚠️ 发现 ${detail} 处问题,自动修正中...`);
      if (step === "cover-factcheck-done") {
        const n = detail.initial.issues.length;
        if (!n) console.log(`   ✅ 求职信核查通过`);
        else if (!detail.final.issues.length) console.log(`   ✅ 已修正 ${n} 处问题,复查通过`);
        else console.log(`   ⚠️ 修正后仍有 ${detail.final.issues.length} 处存疑,详见 match-report.md`);
      }
      if (step === "export-done") {
        console.log(`⑤ 导出可提交文件(PDF/docx):`);
        printExport(detail);
      }
    },
  });
  console.log(`✅ 已生成 ${jobDir(jobId)}/ 下:resume(.md/.pdf/.docx)、cover-letter(.md/.pdf/.docx)、fact-check.json、match-report.md`);
  return result;
}

/** 打印导出结果;pandoc 缺失导致没有 PDF 时给出提示 */
function printExport(results) {
  if (!results.length) return;
  let pdfMissing = false;
  for (const r of results) {
    const pg = r.name === "resume" && r.pages ? ` (${r.pages} 页)` : "";
    r.produced.forEach((f) => console.log(`     ${f}${f.endsWith(".pdf") ? pg : ""}`));
    if (!r.pdf) pdfMissing = true;
  }
  if (pdfMissing) {
    console.log(`     ⚠️ 未生成 PDF(仅 docx)。装 pandoc 可得 PDF: brew install pandoc`);
  }
}

async function cmdScore(args) {
  const jobId = resolveJobId(args[0] || "");
  if (!hasJobFile(jobId, "job.json")) {
    console.error(`找不到该职位的 job.json;它还没被 add 解析过`);
    process.exit(1);
  }
  const existed = hasJobFile(jobId, "score.json");
  console.log(`${existed ? "重新" : ""}打分中... (${jobId})`);
  const score = await scoreJob(jobId);
  printScore(jobId, score);
  console.log(`\n📋 匹配报告: ${path.join(jobDir(jobId), "match-report.md")}`);
  if (existed && hasJobFile(jobId, "resume.md")) {
    console.log(`⚠️ 该职位已生成过材料;打分/角度可能变了,需要的话重新生成: node src/cli.js gen ${jobId}`);
  } else if (score.verdict !== "skip") {
    console.log(`下一步生成投递材料: node src/cli.js gen ${jobId}`);
  }
}

async function cmdOutreach(args) {
  const jobId = resolveJobId(args[0] || "");
  if (!hasJobFile(jobId, "job.json")) { console.error("找不到该职位"); process.exit(1); }
  console.log("生成外联建议中(该联系谁 + 短信草稿)...");
  const o = await generateOutreach(jobId);
  console.log(`\n📇 该联系谁:`);
  (o.who || []).forEach((w) => console.log(`   • ${w}`));
  console.log(`\n📨 渠道:${o.channel || ""}`);
  console.log(`\n✉️  LinkedIn 连接备注 (${(o.note || "").length}/200):\n${o.note || ""}`);
  console.log(`\n💬 接受后跟进私信/邮件:\n${o.message || ""}`);
  console.log(`\n(已存 ${path.join(jobDir(jobId), "outreach.json")};在面板里可编辑复制)`);
}

function cmdRm(args) {
  const jobId = resolveJobId(args[0] || "");
  let label = jobId;
  try { const j = loadJobFile(jobId, "job.json"); label = `${j.company} — ${j.title}`; } catch { /* keep id */ }
  deleteJob(jobId);
  console.log(`🗑️  已删除: ${label}\n   (${jobId})`);
}

function cmdStatus(args) {
  const jobId = resolveJobId(args[0] || "");
  const target = args[1];
  if (!target) {
    // 不带新状态:只显示当前状态和可选值
    console.log(`${jobId}\n当前状态: ${STATUSES[jobStatus(jobId)]}`);
    console.log(`\n可切换到:`);
    Object.entries(STATUSES).forEach(([k, label]) => console.log(`   ${k.padEnd(10)} ${label}`));
    console.log(`\n用法: node src/cli.js status ${args[0]} applied`);
    return;
  }
  const from = jobStatus(jobId);
  const newId = setStatus(jobId, target);
  writeMatchReport(newId);
  console.log(`✅ ${STATUSES[from]} → ${STATUSES[target]}`);
  console.log(`   目录已更名为: ${newId}`);
}

async function cmdGen(args) {
  const jobId = resolveJobId(args[0] || "");
  if (!hasJobFile(jobId, "score.json")) {
    console.error(`该职位还没打分,先跑 add`);
    process.exit(1);
  }
  const { resume } = await generateOne(jobId);
  console.log(`\n简历预览(前 20 行):\n`);
  console.log(resume.split("\n").slice(0, 20).join("\n"));
}

async function cmdGenAll(args) {
  const force = args.includes("--force");
  const scored = listJobs().filter((id) => hasJobFile(id, "score.json"));
  const todo = force ? scored : scored.filter((id) => !hasJobFile(id, "resume.md"));
  if (!todo.length) {
    console.log("没有待生成的职位(已全部生成过;用 --force 强制全部重新生成)");
    return;
  }
  console.log(`共 ${todo.length} 个职位待生成:`);
  todo.forEach((id) => console.log(`   ${id}`));
  let ok = 0;
  const failed = [];
  for (const id of todo) {
    console.log(`\n━━━ ${id} ━━━`);
    try {
      await generateOne(id);
      ok++;
    } catch (err) {
      console.error(`❌ 失败: ${err.message}`);
      failed.push(id);
    }
  }
  console.log(`\n批量完成:${ok} 成功,${failed.length} 失败`);
  failed.forEach((id) => console.log(`   ❌ ${id}`));
}

function cmdExport(args) {
  const ids = args[0]
    ? [resolveJobId(args[0])]
    : listJobs().filter((id) => hasJobFile(id, "resume.md"));
  if (!ids.length) {
    console.log("没有可导出的职位(先用 gen 生成材料)");
    return;
  }
  for (const id of ids) {
    console.log(`\n━━━ ${id} ━━━`);
    const results = exportJob(id);
    if (!results.length) {
      console.log("   (无 resume.md / cover-letter.md,跳过)");
      continue;
    }
    printExport(results);
  }
}

function cmdReport(args) {
  const ids = args[0]
    ? [resolveJobId(args[0])]
    : listJobs().filter((id) => hasJobFile(id, "job.json"));
  if (!ids.length) {
    console.log("还没有职位。用 add 命令添加第一个。");
    return;
  }
  for (const id of ids) {
    console.log(`✅ ${writeMatchReport(id)}`);
  }
}

function cmdList() {
  const jobs = listJobs();
  if (!jobs.length) {
    console.log("还没有职位。用 add 命令添加第一个。");
    return;
  }
  for (const id of jobs) {
    const status = STATUSES[jobStatus(id)] || jobStatus(id);
    let score = "";
    if (hasJobFile(id, "score.json")) {
      const s = loadJobFile(id, "score.json");
      score = `[${s.score} ${s.verdict}]`;
    }
    const mat = hasJobFile(id, "resume.md") ? "📄" : "  ";
    console.log(`${status}  ${mat} ${score.padEnd(22)} ${id}`);
  }
}

function cmdShow(args) {
  const jobId = resolveJobId(args[0] || "");
  const job = loadJobFile(jobId, "job.json");
  console.log(`${job.company} — ${job.title}`);
  console.log(`状态: ${STATUSES[jobStatus(jobId)]} | 地点: ${job.location} | 远程: ${job.remote_policy} | 签证: ${job.visa_sponsorship}`);
  if (job.url) console.log(`链接: ${job.url}`);
  if (hasJobFile(jobId, "score.json")) {
    printScore(jobId, loadJobFile(jobId, "score.json"));
  } else {
    console.log("(尚未打分)");
  }
}

function cmdMigrateRecordPolicy(args) {
  const apply = args.includes("--apply");
  const result = apply
    ? applyRecordPolicyMigration(config.jobsDir)
    : planRecordPolicyMigration(config.jobsDir);
  const { add, unchanged, errors } = result.summary;
  console.log(`${apply ? "已执行" : "Dry-run"} record_policy 迁移: 将新增 ${add}, 已保留 ${unchanged}, 异常 ${errors}`);
  if (!apply) console.log("未写入任何岗位数据。确认结果后才可运行: node src/cli.js migrate-record-policy --apply");
}

const READINESS_BLOCKER_LABELS = {
  "materials-missing": "缺少简历或求职信草稿",
  "resume-fact-check-not-clean": "简历事实核查未 clean",
  "cover-fact-check-not-clean": "求职信事实核查未 clean",
  "resume-not-one-page": "简历页数未知或不是一页",
  "material-profile-not-active-2027": "材料不是基于 active-2027 档案",
};

/** 只读查看某岗位的当前机器 readiness 评估；不写入 job.json。 */
function cmdReadiness(args) {
  const jobId = resolveJobId(args[0] || "");
  const job = loadJobFile(jobId, "job.json");
  const factCheck = hasJobFile(jobId, "fact-check.json") ? loadJobFile(jobId, "fact-check.json") : null;
  const result = assessMaterialReadiness({
    job,
    hasResume: hasJobFile(jobId, "resume.md"),
    hasCover: hasJobFile(jobId, "cover-letter.md"),
    factCheck,
  });
  const saved = job.material_readiness?.state || "未初始化";
  console.log(`材料 readiness: ${result.state}（已保存: ${saved}）`);
  console.log(`简历事实核查: ${result.assessment.resume_fact_verdict}`);
  console.log(`求职信事实核查: ${result.assessment.cover_fact_verdict}`);
  console.log(`简历页数: ${result.assessment.resume_pages ?? "未知"}`);
  console.log(`材料档案版本: ${result.assessment.material_profile_version}`);
  if (result.blockers.length) {
    console.log("未通过项:");
    result.blockers.forEach((blocker) => console.log(`  - ${READINESS_BLOCKER_LABELS[blocker] || blocker}`));
  } else {
    console.log("机器闸门已通过；仍需在 T08-A2 中执行 confirm-ready 后才可标记为已投。");
  }
}

function printReadinessPlan(summary, { applied = false } = {}) {
  console.log(
    `${applied ? "已新增" : "Dry-run material_readiness 初始化: 将新增"} ${summary.add}, 已保留 ${summary.preserved}, ` +
    `已初始化 ${summary.unchanged}, 异常 ${summary.errors}`,
  );
  console.log(
    `新增状态: not-generated ${summary.states["not-generated"]}, draft ${summary.states.draft}, ` +
    `needs-review ${summary.states["needs-review"]}, ready ${summary.states.ready}`,
  );
  if (!applied) console.log("未写入任何岗位数据；加 --apply 才执行已确认的活跃岗位初始化。");
}

function cmdPlanReadiness(args) {
  const apply = args.includes("--apply");
  const { summary } = apply
    ? applyReadinessInitialization(config.jobsDir)
    : planReadinessInitialization(config.jobsDir);
  printReadinessPlan(summary, { applied: apply });
}

function getFlag(args, name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}

function currentReadinessAssessment(jobId) {
  const job = loadJobFile(jobId, "job.json");
  const factCheck = hasJobFile(jobId, "fact-check.json") ? loadJobFile(jobId, "fact-check.json") : null;
  return {
    job,
    assessment: assessMaterialReadiness({
      job,
      hasResume: hasJobFile(jobId, "resume.md"),
      hasCover: hasJobFile(jobId, "cover-letter.md"),
      factCheck,
    }),
  };
}

function cmdConfirmReady(args) {
  const jobId = resolveJobId(args[0] || "");
  const { job, assessment } = currentReadinessAssessment(jobId);
  confirmMaterialReadiness(job, assessment);
  saveJobFile(jobId, "job.json", job);
  console.log("✅ 材料已人工确认 ready；现在才允许标记为 applied。");
}

function cmdOverrideReady(args) {
  const jobId = resolveJobId(args[0] || "");
  const reason = getFlag(args.slice(1), "--reason") || "";
  const { job, assessment } = currentReadinessAssessment(jobId);
  overrideMaterialReadiness(job, assessment, reason);
  saveJobFile(jobId, "job.json", job);
  console.log("✅ 已记录带理由的 readiness override；现在允许标记为 applied。");
}

/** 打印本次 API 用量与预估成本;没调用过 API 就不打印 */
function printUsage() {
  const u = usageSummary();
  if (!u.calls) return;
  const cost = Number.isFinite(u.estUSD)
    ? (u.estUSD < 0.01 ? "<$0.01" : `$${u.estUSD.toFixed(3)}`)
    : "待配置";
  const priced = u.priceKnown ? "" : `(模型 ${u.provider}/${u.model} 无内置价格)`;
  console.log(
    `\n💰 本次 API:${u.calls} 次调用,${u.inputTokens.toLocaleString()} in + ` +
    `${u.outputTokens.toLocaleString()} out tokens,约 ${cost} ${priced}`
  );
}

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case "add":    await cmdAdd(args); break;
    case "score":  await cmdScore(args); break;
    case "status": cmdStatus(args); break;
    case "outreach": await cmdOutreach(args); break;
    case "rm":     cmdRm(args); break;
    case "serve":  startServer(getFlag(args, "--port") ? Number(getFlag(args, "--port")) : undefined); break;
    case "gen":    await cmdGen(args); break;
    case "genall": await cmdGenAll(args); break;
    case "export": cmdExport(args); break;
    case "report": cmdReport(args); break;
    case "list":   cmdList(); break;
    case "show":   cmdShow(args); break;
    case "migrate-record-policy": cmdMigrateRecordPolicy(args); break;
    case "readiness": cmdReadiness(args); break;
    case "plan-material-readiness": cmdPlanReadiness(args); break;
    case "confirm-ready": cmdConfirmReady(args); break;
    case "override-ready": cmdOverrideReady(args); break;
    default:
      console.log(`求职助手 (M1 命令行版)

用法:
  node src/cli.js add <jd.txt>      解析 JD 并打分(文件或 - 读 stdin)
  node src/cli.js add - --url <链接>  可选附上职位链接
  node src/cli.js score <job-id>    (重新)打分:改了 target/profile 后重打,不必重跑 add
  node src/cli.js gen <job-id>      生成定制简历 + cover letter(自动事实核查;skip 岗位走海投模式)
  node src/cli.js genall [--force]  批量生成所有已打分但缺材料的职位(--force 全部重生成)
  node src/cli.js export [job-id]   把简历+cover letter 导出为 PDF/docx;不带参数则导出全部
  node src/cli.js report [job-id]   (重新)生成 match-report.md;不带参数则全部重生成
  node src/cli.js status <job-id> <状态>  更新投递状态(会重命名目录);不带状态则查看可选值
  node src/cli.js outreach <job-id> 生成外联建议:该联系谁 + 可编辑的短信草稿
  node src/cli.js rm <job-id>       删除一个职位(误抓/重复时清理)
  node src/cli.js serve [--port N]  启动本地抓取服务,配合 Chrome 扩展一键抓取招聘页(默认端口 8787)
  node src/cli.js list              列出所有职位(带投递状态)
  node src/cli.js show <job-id>     查看打分详情
  node src/cli.js migrate-record-policy [--apply] 迁移历史/活跃岗位元数据；默认 dry-run
  node src/cli.js readiness <job-id>       只读查看材料就绪闸门与未通过项
  node src/cli.js plan-material-readiness [--apply] 统计/初始化活跃岗位 readiness
  node src/cli.js confirm-ready <job-id>   人工确认通过全部闸门的材料
  node src/cli.js override-ready <job-id> --reason "…" 记录理由后人工放行

投递状态: new(待定) → to-apply(待投) → applied(已投) → interview(面试) → offer / rejected;skip(不投)
macOS 技巧: 网页上全选复制 JD 后直接  pbpaste | node src/cli.js add -`);
  }
  printUsage();
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
}
