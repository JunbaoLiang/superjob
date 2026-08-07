import fs from "node:fs";
import path from "node:path";

const ACTIVE_STATUSES = new Set(["new", "to-apply"]);
const HISTORICAL_STATUSES = new Set(["applied", "rejected"]);
const READINESS_STATES = ["not-generated", "draft", "needs-review", "ready"];

function factVerdict(value) {
  return ["clean", "issues", "needs-review"].includes(value) ? value : "unknown";
}

function profileVersion(job) {
  const version = job?.record_policy?.material_profile_version;
  return ["active-2027", "legacy-2026"].includes(version) ? version : "unknown";
}

function readOptionalJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function emptyStates() {
  return Object.fromEntries(READINESS_STATES.map((state) => [state, 0]));
}

function assertActiveRecord(job) {
  if (!job || !ACTIVE_STATUSES.has(job.status) || job.record_policy?.record_type !== "active" || job.record_policy?.frozen !== false) {
    throw new Error("仅未冻结的活跃岗位可以更新材料 readiness。");
  }
}

export function assertActiveMaterialRecord(job) {
  assertActiveRecord(job);
}

function readinessRecord(assessment, { now = new Date().toISOString(), confirmation = null } = {}) {
  return {
    state: assessment.state,
    assessment: { ...assessment.assessment, checked_at: now },
    confirmation,
  };
}

/**
 * Pure machine assessment. `draft` is intentionally not ready: the user must
 * later confirm it or record a reasoned override in T08-A2.
 */
export function assessMaterialReadiness({ job, hasResume, hasCover, factCheck = null } = {}) {
  const resumeFactVerdict = factVerdict(factCheck?.final?.verdict);
  const coverFactVerdict = factVerdict(factCheck?.cover_letter?.final?.verdict);
  const resumePages = Number.isInteger(factCheck?.pages) ? factCheck.pages : null;
  const materialProfileVersion = profileVersion(job);
  const assessment = {
    resume_fact_verdict: resumeFactVerdict,
    cover_fact_verdict: coverFactVerdict,
    resume_pages: resumePages,
    material_profile_version: materialProfileVersion,
  };

  if (!hasResume || !hasCover) {
    return { state: "not-generated", assessment, blockers: ["materials-missing"] };
  }

  const blockers = [];
  if (resumeFactVerdict !== "clean") blockers.push("resume-fact-check-not-clean");
  if (coverFactVerdict !== "clean") blockers.push("cover-fact-check-not-clean");
  if (resumePages !== 1) blockers.push("resume-not-one-page");
  if (materialProfileVersion !== "active-2027") blockers.push("material-profile-not-active-2027");
  return { state: blockers.length ? "needs-review" : "draft", assessment, blockers };
}

/**
 * Build an aggregate-only migration plan. It never writes a job file; apply
 * behavior is intentionally deferred until T08-A2 has explicit approval.
 */
export function planReadinessInitialization(jobsDir) {
  const result = {
    summary: { add: 0, unchanged: 0, preserved: 0, errors: 0, states: emptyStates() },
    planned: [],
  };
  if (!fs.existsSync(jobsDir)) return result;

  const dirs = fs.readdirSync(jobsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const id of dirs) {
    const dir = path.join(jobsDir, id);
    const jobFile = path.join(dir, "job.json");
    const job = readOptionalJson(jobFile);
    if (!job || Array.isArray(job) || typeof job !== "object") {
      result.summary.errors++;
      continue;
    }

    const status = job.status;
    if (HISTORICAL_STATUSES.has(status) || job.record_policy?.record_type === "historical") {
      result.summary.preserved++;
      continue;
    }
    if (!ACTIVE_STATUSES.has(status)) {
      result.summary.preserved++;
      continue;
    }
    if (job.record_policy?.record_type !== "active" || job.record_policy?.frozen !== false) {
      result.summary.errors++;
      continue;
    }
    if (job.material_readiness) {
      result.summary.unchanged++;
      continue;
    }

    const assessment = assessMaterialReadiness({
      job,
      hasResume: fs.existsSync(path.join(dir, "resume.md")),
      hasCover: fs.existsSync(path.join(dir, "cover-letter.md")),
      factCheck: readOptionalJson(path.join(dir, "fact-check.json")),
    });
    result.planned.push({ id, jobFile, job, readiness: assessment });
    result.summary.add++;
    result.summary.states[assessment.state]++;
  }
  return result;
}

/** Apply the already-reviewed additive initialization plan; no historical record is written. */
export function applyReadinessInitialization(jobsDir, { now = new Date().toISOString() } = {}) {
  const result = planReadinessInitialization(jobsDir);
  if (result.summary.errors) {
    throw new Error(`material-readiness 初始化有 ${result.summary.errors} 个异常；拒绝写入。`);
  }
  for (const entry of result.planned) {
    entry.job.material_readiness = readinessRecord(entry.readiness, { now });
    fs.writeFileSync(entry.jobFile, `${JSON.stringify(entry.job, null, 2)}\n`, "utf8");
  }
  return result;
}

/** Refresh material provenance and assessment after a new active-job generation. */
export function refreshActiveMaterialReadiness(job, {
  hasResume, hasCover, factCheck, now = new Date().toISOString(),
} = {}) {
  assertActiveRecord(job);
  job.record_policy = { ...job.record_policy, material_profile_version: "active-2027" };
  const assessment = assessMaterialReadiness({ job, hasResume, hasCover, factCheck });
  job.material_readiness = readinessRecord(assessment, { now });
  return job.material_readiness;
}

/** Record a standard human confirmation only after every automatic gate passes. */
export function confirmMaterialReadiness(job, assessment, { now = new Date().toISOString() } = {}) {
  assertActiveRecord(job);
  if (assessment?.state !== "draft") {
    throw new Error("只有通过全部自动闸门的 draft 材料才能确认 ready。");
  }
  job.material_readiness = readinessRecord(assessment, {
    now,
    confirmation: { confirmed_at: now, mode: "standard", reason: null, unresolved: [] },
  });
  job.material_readiness.state = "ready";
  return job.material_readiness;
}

/** Record a user-owned exception. Missing material cannot be overridden into a submittable record. */
export function overrideMaterialReadiness(job, assessment, reason, { now = new Date().toISOString() } = {}) {
  assertActiveRecord(job);
  if (typeof reason !== "string" || !reason.trim()) throw new Error("override reason 必须是非空原因。 ");
  if (!assessment || assessment.state === "not-generated") {
    throw new Error("缺少完整材料时不能 override 为 ready。");
  }
  job.material_readiness = readinessRecord(assessment, {
    now,
    confirmation: {
      confirmed_at: now,
      mode: "override",
      reason: reason.trim(),
      unresolved: [...assessment.blockers],
    },
  });
  job.material_readiness.state = "ready";
  return job.material_readiness;
}

/** The single local policy used by every transition into `applied`. */
export function assertCanMarkApplied(job) {
  const readiness = job?.material_readiness;
  const confirmation = readiness?.confirmation;
  if (readiness?.state !== "ready" || !["standard", "override"].includes(confirmation?.mode)) {
    throw new Error("材料 readiness 不是 ready；请先确认材料或记录带理由的 override，不能标记为已投。");
  }
  if (confirmation.mode === "override" && (!confirmation.reason || !String(confirmation.reason).trim())) {
    throw new Error("override 缺少原因，不能标记为已投。");
  }
}
