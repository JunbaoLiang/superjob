export const MD_COLUMNS = {
  "match-report.md": "match_report",
  "resume.md": "resume_md",
  "cover-letter.md": "cover_md",
};

export const BIN_FILES = new Set(["resume.pdf", "resume.docx", "cover-letter.pdf", "cover-letter.docx"]);

export function readFilePolicy(name) {
  if (MD_COLUMNS[name]) return { kind: "markdown", column: MD_COLUMNS[name] };
  if (BIN_FILES.has(name)) return { kind: "binary" };
  return null;
}

export function editFileColumn(name) {
  return { "resume.md": "resume_md", "cover-letter.md": "cover_md" }[name] || null;
}
