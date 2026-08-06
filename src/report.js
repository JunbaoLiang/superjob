import path from "node:path";
import { loadJobFile, hasJobFile, saveJobFile, jobDir, jobStatus, STATUSES } from "./jobs.js";

const VERDICT_CN = {
  strong_match: "🟢 强匹配(优先投)",
  worth_applying: "🟡 值得投",
  stretch: "🟠 够得着但吃力",
  skip: "🔴 匹配度低(仅海投)",
};

function section(lines, title, items) {
  if (!items?.length) return;
  lines.push(`### ${title}`, "");
  items.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
}

/**
 * 功能:把 job.json / score.json / fact-check.json 汇总成人类可读的 match-report.md
 * 纯本地模板渲染,不调用 API;数据变化后可随时重新生成
 */
export function writeMatchReport(jobId) {
  const job = loadJobFile(jobId, "job.json");
  const score = hasJobFile(jobId, "score.json") ? loadJobFile(jobId, "score.json") : null;
  const check = hasJobFile(jobId, "fact-check.json") ? loadJobFile(jobId, "fact-check.json") : null;

  const lines = [];
  lines.push(`# 匹配报告 — ${job.company} · ${job.title}`, "");
  lines.push(`> 投递状态:${STATUSES[jobStatus(jobId)] || jobStatus(jobId)} · 更新于 ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "");

  lines.push("## 岗位信息", "");
  lines.push("| 项目 | 内容 |");
  lines.push("| --- | --- |");
  lines.push(`| 公司 | ${job.company || "?"} |`);
  lines.push(`| 职位 | ${job.title || "?"} |`);
  lines.push(`| 地点 | ${job.location || "未标注"} |`);
  lines.push(`| 远程政策 | ${job.remote_policy || "未标注"} |`);
  lines.push(`| 签证支持 | ${job.visa_sponsorship || "未知"} |`);
  lines.push(`| 薪资 | ${job.salary || "未标注"} |`);
  if (job.url) lines.push(`| 链接 | ${job.url} |`);
  lines.push("");

  if (score) {
    lines.push(`## 评分:${score.score} / 100 — ${VERDICT_CN[score.verdict] || score.verdict}`, "");
    if (score.rationale?.length) {
      lines.push("**打分理由:**", "");
      score.rationale.forEach((r) => lines.push(`- ${r}`));
      lines.push("");
    }
    section(lines, "⛔ 一票否决", score.hard_blockers);
    section(lines, "💪 优势", score.strengths);
    section(lines, "⚠️ 差距", score.gaps);
    if (score.resume_angle) {
      lines.push("### 🎯 简历主打角度", "", score.resume_angle, "");
    }
  } else {
    lines.push("## 评分", "", "(尚未打分,先跑 `add`)", "");
  }

  lines.push("## 投递材料", "");
  const massApply = score?.verdict === "skip" && hasJobFile(jobId, "resume.md");
  lines.push(hasJobFile(jobId, "resume.md")
    ? `- ✅ 定制简历:\`resume.md\`${massApply ? "(海投模式:突出可迁移技能的通用版)" : ""}`
    : "- ⬜ 定制简历:未生成");
  lines.push(hasJobFile(jobId, "cover-letter.md")
    ? "- ✅ Cover letter:`cover-letter.md`"
    : "- ⬜ Cover letter:未生成");
  lines.push("");

  if (check) {
    lines.push("## 简历事实核查", "");
    const initial = check.initial?.issues || [];
    if (!initial.length) {
      lines.push("✅ 首轮核查通过:未发现虚构或过度拉伸。", "");
    } else {
      lines.push(`⚠️ 首轮核查发现 ${initial.length} 处问题,已自动修正:`, "");
      initial.forEach((i) => {
        lines.push(`- **[${i.type}]** 「${i.quote}」`);
        lines.push(`  - 问题:${i.problem}`);
        lines.push(`  - 处理:${i.fix === "DELETE" ? "已删除" : `改为「${i.fix}」`}`);
      });
      lines.push("");
      const finalIssues = check.final?.issues || [];
      lines.push(finalIssues.length
        ? `⚠️ 复查仍有 ${finalIssues.length} 处存疑,请人工确认:${finalIssues.map((i) => `「${i.quote}」`).join(";")}`
        : "✅ 修正后复查通过。");
      lines.push("");
    }

    // 求职信核查
    const cl = check.cover_letter;
    if (cl) {
      const clInit = cl.initial?.issues || [];
      const clFinal = cl.final?.issues || [];
      lines.push("**Cover letter:** " + (
        !clInit.length ? "✅ 核查通过,未发现关于我的虚构/拉伸。"
          : !clFinal.length ? `⚠️ 发现 ${clInit.length} 处并已自动修正,复查通过。`
            : `⚠️ 修正后仍有 ${clFinal.length} 处存疑:${clFinal.map((i) => `「${i.quote}」`).join(";")}`
      ), "");
    }
  }

  const text = lines.join("\n") + "\n";
  saveJobFile(jobId, "match-report.md", text);
  return path.join(jobDir(jobId), "match-report.md");
}
