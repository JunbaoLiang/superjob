import fs from "node:fs";
import path from "node:path";

const HISTORICAL_SUBMITTED = new Set(["applied", "interview", "offer"]);
const ACTIVE = new Set(["new", "to-apply"]);
const SKIPPED = new Set(["skip"]);
const MATERIAL_FILES = [
  "resume.md", "cover-letter.md", "fact-check.json",
  "resume.pdf", "cover-letter.pdf", "resume.docx", "cover-letter.docx",
];

function materialProfileVersion(dir) {
  return MATERIAL_FILES.some((file) => fs.existsSync(path.join(dir, file)))
    ? "legacy-2026"
    : "unknown";
}

export function recordPolicyFor(status, { materialProfile = "unknown" } = {}) {
  if (HISTORICAL_SUBMITTED.has(status)) {
    return {
      record_type: "historical",
      frozen: true,
      frozen_reason: "submitted",
      material_profile_version: materialProfile,
      migration_version: 1,
    };
  }
  if (status === "rejected") {
    return {
      record_type: "historical",
      frozen: true,
      frozen_reason: "rejected",
      material_profile_version: materialProfile,
      migration_version: 1,
    };
  }
  if (ACTIVE.has(status)) {
    return {
      record_type: "active",
      frozen: false,
      frozen_reason: null,
      material_profile_version: materialProfile,
      migration_version: 1,
    };
  }
  if (SKIPPED.has(status)) {
    return {
      record_type: "skipped",
      frozen: false,
      frozen_reason: null,
      material_profile_version: materialProfile,
      migration_version: 1,
    };
  }
  throw new Error(`unsupported status: ${status || "missing"}`);
}

/**
 * Build an additive migration plan without writing to job data.
 * The returned entries retain file paths for the caller, but CLI reporting must use summary only.
 */
export function planRecordPolicyMigration(jobsDir) {
  const result = { summary: { add: 0, unchanged: 0, errors: 0 }, planned: [] };
  if (!fs.existsSync(jobsDir)) return result;

  const dirs = fs.readdirSync(jobsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const id of dirs) {
    const dir = path.join(jobsDir, id);
    const file = path.join(dir, "job.json");
    let job;
    try {
      job = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!job || Array.isArray(job) || typeof job !== "object") throw new Error("not an object");
    } catch {
      result.summary.errors++;
      continue;
    }

    if (Object.hasOwn(job, "record_policy")) {
      result.summary.unchanged++;
      continue;
    }

    try {
      result.planned.push({
        id,
        file,
        job,
        policy: recordPolicyFor(job.status, { materialProfile: materialProfileVersion(dir) }),
      });
      result.summary.add++;
    } catch {
      result.summary.errors++;
    }
  }
  return result;
}

/** Apply a fully validated additive migration. Refuse all writes if any record cannot be planned safely. */
export function applyRecordPolicyMigration(jobsDir) {
  const result = planRecordPolicyMigration(jobsDir);
  if (result.summary.errors) {
    throw new Error(`record-policy migration has ${result.summary.errors} dry-run errors; refusing to write`);
  }
  for (const entry of result.planned) {
    entry.job.record_policy = entry.policy;
    fs.writeFileSync(entry.file, `${JSON.stringify(entry.job, null, 2)}\n`, "utf8");
  }
  return result;
}
