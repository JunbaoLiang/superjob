import fs from "node:fs";
import path from "node:path";

const ARTIFACTS = new Set([
  "score.json", "match-report.md", "fact-check.json", "outreach.json",
  "resume.md", "resume.pdf", "resume.docx",
  "cover-letter.md", "cover-letter.pdf", "cover-letter.docx",
]);

function active(job) {
  return job?.record_policy?.record_type === "active" && job.record_policy?.frozen === false && ["new", "to-apply"].includes(job.status);
}

/** Copy existing active artifacts into a named per-job archive before regeneration. */
export function archiveActiveArtifacts(jobsDir, { archiveName }) {
  if (!/^[A-Za-z0-9._-]+$/.test(archiveName || "")) throw new Error("archiveName 非法");
  const summary = { jobs: 0, files: 0, bytes: 0, skipped_historical: 0 };
  for (const id of fs.readdirSync(jobsDir).sort()) {
    const dir = path.join(jobsDir, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const jobPath = path.join(dir, "job.json");
    if (!fs.existsSync(jobPath)) continue;
    const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    if (!active(job)) {
      if (job.record_policy?.record_type === "historical" || ["applied", "rejected"].includes(job.status)) summary.skipped_historical++;
      continue;
    }
    const files = fs.readdirSync(dir).filter((name) => ARTIFACTS.has(name));
    if (!files.length) continue;
    const target = path.join(dir, "archive", archiveName);
    if (fs.existsSync(target)) throw new Error(`归档已存在: ${id}`);
    fs.mkdirSync(target, { recursive: true });
    summary.jobs++;
    for (const name of files) {
      const source = path.join(dir, name);
      const stat = fs.statSync(source);
      if (!stat.isFile()) continue;
      fs.copyFileSync(source, path.join(target, name), fs.constants.COPYFILE_EXCL);
      summary.files++;
      summary.bytes += stat.size;
    }
  }
  return summary;
}
