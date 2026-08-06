import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { config } from "./config.js";
import { jobDir, hasJobFile } from "./jobs.js";

/** 检测某个命令是否可用(用 which,不经过 shell) */
function have(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 把会让 xelatex 报错/缺字的 unicode 规范化成安全等价物。
 * 下标/上标 → 普通数字;减号(U+2212)、prime(U+2032)→ ASCII。
 * (— – ≤ ≈ Å × 等标准字体自带,保留原样)
 */
export function normalizeUnicode(text) {
  const sub = "₀₁₂₃₄₅₆₇₈₉", sup = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return text
    .replace(/[₀-₉]/g, (c) => String(sub.indexOf(c)))
    .replace(/[⁰¹²³⁴-⁹]/g, (c) => (sup.indexOf(c) >= 0 ? String(sup.indexOf(c)) : c))
    .replace(/−/g, "-")   // 减号 → 连字符
    .replace(/′/g, "'")   // prime → 单引号
    .replace(/″/g, "''"); // double prime
}

/** 转义 LaTeX 特殊字符(用于把联系人抬头塞进 raw LaTeX) */
function escLatex(s) {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/** 转义 LaTeX 后,再把 markdown 的 **粗** / *斜* 记号转成 LaTeX(escLatex 不动星号,故仍可匹配) */
function mdInlineToLatex(s) {
  return escLatex(s)
    .replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}")
    .replace(/\*([^*]+)\*/g, "\\emph{$1}");
}

/**
 * 把简历 markdown 拆成「居中抬头块 + 正文」:
 * 取第一段(首个 ## 之前)里的 `# 姓名` 和其后的联系人行,生成居中 raw LaTeX 抬头,
 * 正文从第一个 ## 开始。这样姓名/联系方式居中且紧凑,正文各 ## 变成带分隔线的小节标题。
 */
const CONTACT_LABEL = /^(GitHub|Website|LinkedIn|Portfolio|Email|Phone|Tel|Google Scholar|Scholar)\s*[:：]\s*/i;

/**
 * 把联系人抬头里的一段渲染成 LaTeX:
 *  - markdown 链接 [文字](url) → 可点击的 \href
 *  - 含 Google Scholar 链接的 → 显示成干净的「Google Scholar」而不是 ?user= 长串
 *  - 其它带 URL 的 → 去 scheme/标签后原样显示(短链好看)
 *  - 纯文本(城市/邮箱/电话)→ 转义显示
 */
function contactToken(t) {
  const md = t.match(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/);
  if (md) return `\\href{${md[2]}}{${escLatex(md[1])}}`;
  const url = (t.match(/https?:\/\/[^\s|]+/) || [])[0];
  if (url && /scholar\.google\./i.test(url)) return `\\href{${url}}{Google Scholar}`;
  return escLatex(t.replace(CONTACT_LABEL, "").replace(/https?:\/\//g, "").trim());
}

function buildResumeLatexInput(md) {
  const norm = normalizeUnicode(md).replace(/\r\n/g, "\n");
  const idx = norm.search(/^\s*##\s/m);
  const head = idx === -1 ? norm : norm.slice(0, idx);
  const body = idx === -1 ? "" : rightAlignEntryDates(norm.slice(idx));

  const headLines = head.split("\n").map((l) => l.trim()).filter(Boolean);
  const nameLine = headLines.find((l) => /^#\s+/.test(l));
  const name = nameLine ? nameLine.replace(/^#\s+/, "") : "";
  // 联系方式:拆成小块 → 用居中圆点连成一行
  const tokens = headLines
    .filter((l) => l !== nameLine)
    .join(" | ")
    .split(/\s*\|\s*/)
    .map((t) => contactToken(t.replace(/^#+\s*/, "").trim()))
    .filter(Boolean);
  const contact = tokens.join(" $\\cdot$ ");

  const headerLatex =
    "\\begin{center}\n" +
    `{\\fontsize{21}{24}\\selectfont\\bfseries ${escLatex(name)}}\\\\[4pt]\n` +
    (contact ? `{\\small ${contact}}\n` : "") +
    "\\end{center}\n\\vspace{-2pt}\n";

  return `${headerLatex}\n${body}`;
}

/**
 * 把项目/经历标题里结尾的日期抽出来右对齐:
 *   `### Title (Dec 2022 – May 2025)` → \subsubsection{Title \hfill {灰色小字 日期}}
 * 没有可识别年份的标题保持整行标题。
 */
function rightAlignEntryDates(body) {
  return body.replace(/^###\s+(.+?)\s*$/gm, (m, rest) => {
    const dm = rest.match(/^(.*?)\s*[（(]([^（）()]*\b(?:19|20)\d{2}\b[^（）()]*)[)）]\s*$/);
    if (dm) {
      const title = mdInlineToLatex(dm[1].trim());
      const date = mdInlineToLatex(dm[2].trim());
      return `\n\n\\subsubsection{${title}\\hfill{\\normalfont\\small\\color{datecolor}${date}}}\n\n`;
    }
    return `\n\n\\subsubsection{${mdInlineToLatex(rest.trim())}}\n\n`;
  });
}

/** 从 pandoc --verbose 输出里解析页数(TeX 日志会折行,先合并空白再匹配) */
function parsePages(verboseOutput) {
  const flat = (verboseOutput || "").replace(/\s+/g, " ");
  const m = flat.match(/\((\d+) pages?[,)]/);
  return m ? parseInt(m[1], 10) : null;
}

/** 跑 pandoc 生成 PDF 并解析页数;--verbose 的 TeX 日志在 stderr,需 spawnSync 捕获 */
function pandocPdf(inPath, pdfPath, preamble, from) {
  const args = [inPath, "-o", pdfPath, "--pdf-engine=xelatex", "-V", "fontsize=11pt", "--verbose"];
  if (from) args.push("--from", from);
  if (preamble && fs.existsSync(preamble)) args.push("--include-in-header", preamble);
  const r = spawnSync("pandoc", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const log = (r.stdout || "") + "\n" + (r.stderr || "");
  return { ok: r.status === 0 && fs.existsSync(pdfPath), pages: parsePages(log) };
}

const tmp = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "superjob-export-"));

/**
 * 渲染一份 markdown 为 PDF(+docx)。style: "resume" | "letter"。
 * 返回 { produced:[路径], engine, pdf:bool, pages:number|null }
 */
export function exportMarkdownFile(mdPath, { style = "resume" } = {}) {
  const dir = path.dirname(mdPath);
  const base = path.basename(mdPath, ".md");
  const produced = [];
  const rawMd = fs.readFileSync(mdPath, "utf8");

  if (!have("pandoc")) {
    // 兜底:没有 pandoc 就用 macOS 自带 textutil 出 docx(经 HTML 中转)
    const html = mdToHtml(normalizeUnicode(rawMd), base);
    const htmlPath = path.join(dir, `${base}.html`);
    fs.writeFileSync(htmlPath, html, "utf8");
    produced.push(htmlPath);
    if (have("textutil")) {
      const docx = path.join(dir, `${base}.docx`);
      execFileSync("textutil", ["-convert", "docx", "-output", docx, htmlPath], { stdio: "pipe" });
      produced.push(docx);
    }
    return { produced, engine: "textutil", pdf: false, pages: null };
  }

  const preamble = path.join(config.templatesDir, `${style}.tex`);
  // 单换行即断行:信件让抬头/签名各占一行;简历让教育/联系等逐条内容不被合并成一段
  // (生成的每个 bullet / 段落都是单物理行,故不会被从中截断)
  const from = "markdown+hard_line_breaks";
  const work = tmp();
  let pages = null;
  try {
    // PDF
    const texInput = style === "resume"
      ? buildResumeLatexInput(rawMd)
      : normalizeUnicode(rawMd);
    const inPath = path.join(work, "in.md");
    fs.writeFileSync(inPath, texInput, "utf8");
    const pdf = path.join(dir, `${base}.pdf`);
    const res = pandocPdf(inPath, pdf, preamble, from);
    let pdfOk = res.ok;
    pages = res.pages;
    if (!pdfOk) {
      // 模板渲染失败:回退到无模板默认渲染,保证至少出 PDF
      const r2 = spawnSync("pandoc", [inPath, "-o", pdf, "--pdf-engine=xelatex"], { encoding: "utf8" });
      pdfOk = r2.status === 0 && fs.existsSync(pdf);
    }
    if (pdfOk) produced.push(pdf);

    // docx:用原始 markdown(保留 # 姓名 结构),ATS 友好的单栏文档
    const docx = path.join(dir, `${base}.docx`);
    const docxIn = path.join(work, "docx.md");
    fs.writeFileSync(docxIn, normalizeUnicode(rawMd), "utf8");
    const docxArgs = [docxIn, "-o", docx];
    if (from) docxArgs.push("--from", from);
    try {
      execFileSync("pandoc", docxArgs, { stdio: "pipe" });
      produced.push(docx);
    } catch { /* docx 失败不致命 */ }

    return { produced, engine: "pandoc", pdf: pdfOk, pages };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** 只渲染 PDF 并返回页数(供一页闭环快速探测,不写 docx) */
export function renderResumePdfPages(mdText) {
  if (!have("pandoc") || !have("xelatex")) return null;
  const work = tmp();
  try {
    const inPath = path.join(work, "in.md");
    fs.writeFileSync(inPath, buildResumeLatexInput(mdText), "utf8");
    const preamble = path.join(config.templatesDir, "resume.tex");
    return pandocPdf(inPath, path.join(work, "o.pdf"), preamble, "markdown+hard_line_breaks").pages;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** 导出某职位的简历(resume 样式)+ cover letter(letter 样式) */
export function exportJob(jobId) {
  const dir = jobDir(jobId);
  const results = [];
  if (hasJobFile(jobId, "resume.md")) {
    results.push({ name: "resume", ...exportMarkdownFile(path.join(dir, "resume.md"), { style: "resume" }) });
  }
  if (hasJobFile(jobId, "cover-letter.md")) {
    results.push({ name: "cover-letter", ...exportMarkdownFile(path.join(dir, "cover-letter.md"), { style: "letter" }) });
  }
  return results;
}

/** 极简 Markdown → HTML(仅 textutil 兜底路径用) */
export function mdToHtml(md, title = "Document") {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
    else if (b) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(b[1])}</li>`); }
    else if (line.trim() === "") { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.4;max-width:7.5in;margin:0.5in auto;}
h1{font-size:20pt;text-align:center;margin:0 0 2pt;} h2{font-size:12pt;border-bottom:1px solid #888;margin:12pt 0 4pt;}
h3{font-size:11pt;margin:8pt 0 2pt;} ul{margin:3pt 0 3pt 18pt;} li{margin:2pt 0;} a{color:#0645ad;}</style>
</head><body>\n${out.join("\n")}\n</body></html>`;
}
