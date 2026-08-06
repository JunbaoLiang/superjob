// 把 markdown 渲染成 PDF/docx(pandoc + xelatex,Docker 镜像里保证可用)。
// 与本地版逻辑一致:Charter 系排版(镜像装的是 XCharter)、居中抬头、年份右对齐、页数探测。
// 差异:输入输出走内存/临时目录,成品字节存回 Postgres(job_files 表)。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { config } from "./config.js";
import { getJob, putFile } from "./jobs.js";

/** 检测某个命令是否可用 */
function have(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 把会让 xelatex 报错/缺字的 unicode 规范化成安全等价物 */
export function normalizeUnicode(text) {
  const sub = "₀₁₂₃₄₅₆₇₈₉", sup = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return text
    .replace(/[₀-₉]/g, (c) => String(sub.indexOf(c)))
    .replace(/[⁰¹²³⁴-⁹]/g, (c) => (sup.indexOf(c) >= 0 ? String(sup.indexOf(c)) : c))
    .replace(/−/g, "-")
    .replace(/′/g, "'")
    .replace(/″/g, "''");
}

function escLatex(s) {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function mdInlineToLatex(s) {
  return escLatex(s)
    .replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}")
    .replace(/\*([^*]+)\*/g, "\\emph{$1}");
}

const CONTACT_LABEL = /^(GitHub|Website|LinkedIn|Portfolio|Email|Phone|Tel|Google Scholar|Scholar)\s*[:：]\s*/i;

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

/** 从 pandoc --verbose 输出里解析页数 */
function parsePages(verboseOutput) {
  const flat = (verboseOutput || "").replace(/\s+/g, " ");
  const m = flat.match(/\((\d+) pages?[,)]/);
  return m ? parseInt(m[1], 10) : null;
}

function pandocPdf(inPath, pdfPath, preamble, from) {
  const args = [inPath, "-o", pdfPath, "--pdf-engine=xelatex", "-V", "fontsize=11pt", "--verbose"];
  if (from) args.push("--from", from);
  if (preamble && fs.existsSync(preamble)) args.push("--include-in-header", preamble);
  const r = spawnSync("pandoc", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const log = (r.stdout || "") + "\n" + (r.stderr || "");
  return { ok: r.status === 0 && fs.existsSync(pdfPath), pages: parsePages(log) };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "superjob-export-"));

/**
 * 渲染一段 markdown 为 PDF(+docx)字节。style: "resume" | "letter"。
 * 返回 { pdf: Buffer|null, docx: Buffer|null, pages, engine }
 */
export function renderMarkdown(mdText, { style = "resume" } = {}) {
  if (!have("pandoc")) {
    return { pdf: null, docx: null, pages: null, engine: "none" };
  }
  const preamble = path.join(config.templatesDir, `${style}.tex`);
  const from = "markdown+hard_line_breaks"; // 单换行即断行,与本地版一致
  const work = tmp();
  try {
    const texInput = style === "resume" ? buildResumeLatexInput(mdText) : normalizeUnicode(mdText);
    const inPath = path.join(work, "in.md");
    fs.writeFileSync(inPath, texInput, "utf8");

    // PDF
    const pdfPath = path.join(work, "out.pdf");
    const res = pandocPdf(inPath, pdfPath, preamble, from);
    let pdfOk = res.ok;
    if (!pdfOk) {
      // 模板渲染失败:回退到无模板默认渲染,保证至少出 PDF
      const r2 = spawnSync("pandoc", [inPath, "-o", pdfPath, "--pdf-engine=xelatex"], { encoding: "utf8" });
      pdfOk = r2.status === 0 && fs.existsSync(pdfPath);
    }
    const pdf = pdfOk ? fs.readFileSync(pdfPath) : null;

    // docx:用原始 markdown(保留 # 姓名 结构),ATS 友好的单栏文档
    let docx = null;
    try {
      const docxIn = path.join(work, "docx.md");
      const docxPath = path.join(work, "out.docx");
      fs.writeFileSync(docxIn, normalizeUnicode(mdText), "utf8");
      execFileSync("pandoc", [docxIn, "-o", docxPath, "--from", from], { stdio: "pipe" });
      docx = fs.readFileSync(docxPath);
    } catch { /* docx 失败不致命 */ }

    return { pdf, docx, pages: res.pages, engine: "pandoc" };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** 只渲染 PDF 并返回页数(供一页闭环快速探测) */
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

/** 导出某职位的简历 + cover letter,成品字节写入 job_files 表 */
export async function exportJob(jobId) {
  const row = await getJob(jobId);
  const results = [];
  const specs = [
    { md: row.resume_md, name: "resume", style: "resume" },
    { md: row.cover_md, name: "cover-letter", style: "letter" },
  ];
  for (const s of specs) {
    if (!s.md) continue;
    const r = renderMarkdown(s.md, { style: s.style });
    const produced = [];
    if (r.pdf) { await putFile(jobId, `${s.name}.pdf`, r.pdf); produced.push(`${s.name}.pdf`); }
    if (r.docx) { await putFile(jobId, `${s.name}.docx`, r.docx); produced.push(`${s.name}.docx`); }
    results.push({ name: s.name, produced, pdf: !!r.pdf, pages: r.pages, engine: r.engine });
  }
  return results;
}
