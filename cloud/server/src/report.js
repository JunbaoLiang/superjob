// 把 job / score / fact_check 汇总成人类可读的 match-report.md(纯模板渲染,不调 API)
import { getJob, saveFields, STATUSES } from "./jobs.js";
import { scoreView, usesMassApplyAngle } from "./score-policy.js";

const VERDICT_CN = {
  strong_match: "🟢 强匹配(优先投)",
  worth_applying: "🟡 值得投",
  stretch: "🟠 够得着但吃力",
  low_match: "🔴 匹配度低",
};
const ELIGIBILITY_CN = { eligible: "可申请", "needs-verification": "待核实", ineligible: "明确不符合" };
const RECOMMENDATION_CN = { main_target: "主投", mass_apply: "海投", stretch: "Stretch（需手动生成）", verify: "先核实", skip: "跳过" };

function section(lines, title, items) {
  if (!items?.length) return;
  lines.push(`### ${title}`, "");
  items.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
}

export function buildMatchReport(row) {
  const job = row.job || {};
  const score = row.score;
  const check = row.fact_check;

  const lines = [];
  lines.push(`# 匹配报告 — ${row.company} · ${row.title}`, "");
  lines.push(`> 投递状态:${STATUSES[row.status] || row.status} · 更新于 ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "");

  lines.push("## 岗位信息", "");
  lines.push("| 项目 | 内容 |");
  lines.push("| --- | --- |");
  lines.push(`| 公司 | ${row.company || "?"} |`);
  lines.push(`| 职位 | ${row.title || "?"} |`);
  lines.push(`| 地点 | ${job.location || "未标注"} |`);
  lines.push(`| 远程政策 | ${job.remote_policy || "未标注"} |`);
  lines.push(`| 签证支持 | ${job.visa_sponsorship || "未知"} |`);
  lines.push(`| 薪资 | ${job.salary || "未标注"} |`);
  if (job.url) lines.push(`| 链接 | ${job.url} |`);
  lines.push("");

  if (score) {
    const view = scoreView(score);
    lines.push(view.legacy ? "> ⚠️ 旧版评分记录，仅供历史参考。" : `## Eligibility：${ELIGIBILITY_CN[view.eligibility] || view.eligibility} · 建议：${RECOMMENDATION_CN[view.recommendation] || view.recommendation}`, "");
    lines.push(`## Match：${view.match.score} / 100 — ${VERDICT_CN[view.match.verdict] || view.match.verdict}`, "");
    section(lines, "🔎 Eligibility 核对", view.checks);
    section(lines, "⚠️ 待核实风险", view.risks);
    if (view.match.rationale?.length) {
      lines.push("**打分理由:**", "");
      view.match.rationale.forEach((r) => lines.push(`- ${r}`));
      lines.push("");
    }
    section(lines, "⛔ 一票否决", view.hard_blockers);
    section(lines, "💪 优势", view.match.strengths);
    section(lines, "⚠️ 差距", view.match.gaps);
    if (view.match.resume_angle) {
      lines.push("### 🎯 简历主打角度", "", view.match.resume_angle, "");
    }
  } else {
    lines.push("## 评分", "", "(尚未打分)", "");
  }

  lines.push("## 投递材料", "");
  const hasResume = !!row.resume_md;
  const massApply = usesMassApplyAngle(score) && hasResume;
  lines.push(hasResume
    ? `- ✅ 定制简历:\`resume.md\`${massApply ? "(海投模式:突出可迁移技能的通用版)" : ""}`
    : "- ⬜ 定制简历:未生成");
  lines.push(row.cover_md
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

  return lines.join("\n") + "\n";
}

/** 重新生成并落库某职位的 match_report */
export async function writeMatchReport(jobId) {
  const row = await getJob(jobId);
  const text = buildMatchReport(row);
  await saveFields(jobId, { match_report: text });
  return text;
}
