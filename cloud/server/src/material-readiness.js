const ACTIVE_STATUSES = new Set(["new", "to-apply"]);

function factVerdict(value) {
  return ["clean", "issues", "needs-review"].includes(value) ? value : "unknown";
}

function assertActiveRecord(job) {
  if (!job || !ACTIVE_STATUSES.has(job.status) || job.record_policy?.record_type !== "active" || job.record_policy?.frozen !== false) {
    throw new Error("仅未冻结的活跃岗位可以更新材料 readiness。");
  }
}

function readinessRecord(assessment, { now = new Date().toISOString(), confirmation = null } = {}) {
  return { state: assessment.state, assessment: { ...assessment.assessment, checked_at: now }, confirmation };
}

export function recordPolicyFor(status, { materialProfile = "unknown" } = {}) {
  if (["applied", "interview", "offer"].includes(status)) return { record_type: "historical", frozen: true, frozen_reason: "submitted", material_profile_version: materialProfile, migration_version: 1 };
  if (status === "rejected") return { record_type: "historical", frozen: true, frozen_reason: "rejected", material_profile_version: materialProfile, migration_version: 1 };
  if (ACTIVE_STATUSES.has(status)) return { record_type: "active", frozen: false, frozen_reason: null, material_profile_version: materialProfile, migration_version: 1 };
  return { record_type: "skipped", frozen: false, frozen_reason: null, material_profile_version: materialProfile, migration_version: 1 };
}

export function assessMaterialReadiness({ job, hasResume, hasCover, factCheck = null } = {}) {
  const assessment = {
    resume_fact_verdict: factVerdict(factCheck?.final?.verdict),
    cover_fact_verdict: factVerdict(factCheck?.cover_letter?.final?.verdict),
    resume_pages: Number.isInteger(factCheck?.pages) ? factCheck.pages : null,
    material_profile_version: ["active-2027", "legacy-2026"].includes(job?.record_policy?.material_profile_version) ? job.record_policy.material_profile_version : "unknown",
  };
  if (!hasResume || !hasCover) return { state: "not-generated", assessment, blockers: ["materials-missing"] };
  const blockers = [];
  if (assessment.resume_fact_verdict !== "clean") blockers.push("resume-fact-check-not-clean");
  if (assessment.cover_fact_verdict !== "clean") blockers.push("cover-fact-check-not-clean");
  if (assessment.resume_pages !== 1) blockers.push("resume-not-one-page");
  if (assessment.material_profile_version !== "active-2027") blockers.push("material-profile-not-active-2027");
  return { state: blockers.length ? "needs-review" : "draft", assessment, blockers };
}

export function refreshActiveMaterialReadiness(job, { hasResume, hasCover, factCheck, now } = {}) {
  assertActiveRecord(job);
  job.record_policy = { ...job.record_policy, material_profile_version: "active-2027" };
  job.material_readiness = readinessRecord(assessMaterialReadiness({ job, hasResume, hasCover, factCheck }), { now });
  return job.material_readiness;
}

export function confirmMaterialReadiness(job, assessment, { now } = {}) {
  assertActiveRecord(job);
  if (assessment?.state !== "draft") throw new Error("只有通过全部自动闸门的 draft 材料才能确认 ready。");
  job.material_readiness = readinessRecord(assessment, { now, confirmation: { confirmed_at: now || new Date().toISOString(), mode: "standard", reason: null, unresolved: [] } });
  job.material_readiness.state = "ready";
  return job.material_readiness;
}

export function overrideMaterialReadiness(job, assessment, reason, { now } = {}) {
  assertActiveRecord(job);
  if (typeof reason !== "string" || !reason.trim()) throw new Error("override reason 必须是非空原因。");
  if (!assessment || assessment.state === "not-generated") throw new Error("缺少完整材料时不能 override 为 ready。");
  job.material_readiness = readinessRecord(assessment, { now, confirmation: { confirmed_at: now || new Date().toISOString(), mode: "override", reason: reason.trim(), unresolved: [...assessment.blockers] } });
  job.material_readiness.state = "ready";
  return job.material_readiness;
}

export function assertCanMarkApplied(job) {
  const readiness = job?.material_readiness;
  const confirmation = readiness?.confirmation;
  if (readiness?.state !== "ready" || !["standard", "override"].includes(confirmation?.mode)) throw new Error("材料 readiness 不是 ready；请先确认材料或记录带理由的 override，不能标记为已投。");
  if (confirmation.mode === "override" && (!confirmation.reason || !String(confirmation.reason).trim())) throw new Error("override 缺少原因，不能标记为已投。");
}
