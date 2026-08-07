import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyReadinessInitialization,
  assertCanMarkApplied,
  assessMaterialReadiness,
  confirmMaterialReadiness,
  overrideMaterialReadiness,
  planReadinessInitialization,
  refreshActiveMaterialReadiness,
} from "../src/material-readiness.js";

const activePolicy = {
  record_type: "active",
  frozen: false,
  material_profile_version: "active-2027",
};
const historicalPolicy = {
  record_type: "historical",
  frozen: true,
  material_profile_version: "legacy-2026",
};
const cleanFactCheck = {
  final: { verdict: "clean", issues: [] },
  pages: 1,
  cover_letter: { final: { verdict: "clean", issues: [] } },
};

function withTempJobs(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superjob-readiness-test-"));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(dir, id, job, { resume = false, cover = false, factCheck = null } = {}) {
  const jobDir = path.join(dir, id);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
  if (resume) fs.writeFileSync(path.join(jobDir, "resume.md"), "fixture resume");
  if (cover) fs.writeFileSync(path.join(jobDir, "cover-letter.md"), "fixture cover");
  if (factCheck) fs.writeFileSync(path.join(jobDir, "fact-check.json"), `${JSON.stringify(factCheck, null, 2)}\n`);
}

test("readiness is not-generated until both material drafts exist", () => {
  const result = assessMaterialReadiness({ job: { record_policy: activePolicy }, hasResume: false, hasCover: true });
  assert.equal(result.state, "not-generated");
  assert.deepEqual(result.blockers, ["materials-missing"]);
});

test("clean one-page active-2027 material remains draft until user confirmation", () => {
  const result = assessMaterialReadiness({
    job: { record_policy: activePolicy }, hasResume: true, hasCover: true, factCheck: cleanFactCheck,
  });
  assert.equal(result.state, "draft");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.assessment.resume_pages, 1);
});

test("legacy, failed, or unknown checks require review", () => {
  const legacy = assessMaterialReadiness({
    job: { record_policy: { ...activePolicy, material_profile_version: "legacy-2026" } },
    hasResume: true, hasCover: true, factCheck: cleanFactCheck,
  });
  assert.equal(legacy.state, "needs-review");
  assert.ok(legacy.blockers.includes("material-profile-not-active-2027"));

  const failed = assessMaterialReadiness({
    job: { record_policy: activePolicy }, hasResume: true, hasCover: true,
    factCheck: { ...cleanFactCheck, final: { verdict: "needs-review", issues: [] }, pages: null },
  });
  assert.equal(failed.state, "needs-review");
  assert.ok(failed.blockers.includes("resume-fact-check-not-clean"));
  assert.ok(failed.blockers.includes("resume-not-one-page"));
});

test("initialization dry run only plans active records and preserves historical records", () => withTempJobs((dir) => {
  writeFixture(dir, "active-draft-new", { status: "new", record_policy: activePolicy }, {
    resume: true, cover: true, factCheck: cleanFactCheck,
  });
  writeFixture(dir, "active-empty-to-apply", { status: "to-apply", record_policy: activePolicy });
  writeFixture(dir, "historical-applied", { status: "applied", record_policy: historicalPolicy }, {
    resume: true, cover: true, factCheck: cleanFactCheck,
  });
  const before = fs.readFileSync(path.join(dir, "active-draft-new", "job.json"));

  const plan = planReadinessInitialization(dir);
  assert.deepEqual(plan.summary, {
    add: 2, unchanged: 0, preserved: 1, errors: 0,
    states: { "not-generated": 1, draft: 1, "needs-review": 0, ready: 0 },
  });
  assert.equal(plan.planned.length, 2);
  assert.deepEqual(fs.readFileSync(path.join(dir, "active-draft-new", "job.json")), before);
}));

test("initialization is idempotent in planning mode and refuses unsafe active records", () => withTempJobs((dir) => {
  writeFixture(dir, "already-ready-new", {
    status: "new", record_policy: activePolicy, material_readiness: { state: "ready" },
  });
  writeFixture(dir, "missing-policy-to-apply", { status: "to-apply" });

  const plan = planReadinessInitialization(dir);
  assert.equal(plan.summary.unchanged, 1);
  assert.equal(plan.summary.errors, 1);
  assert.equal(plan.planned.length, 0);
}));

test("confirmed dry-run apply writes only active readiness metadata and is idempotent", () => withTempJobs((dir) => {
  writeFixture(dir, "active-empty-new", { status: "new", record_policy: activePolicy });
  writeFixture(dir, "historical-applied", { status: "applied", record_policy: historicalPolicy }, { resume: true });
  const historicalBefore = fs.readFileSync(path.join(dir, "historical-applied", "job.json"));

  const applied = applyReadinessInitialization(dir, { now: "2026-08-06T00:00:00.000Z" });
  assert.equal(applied.summary.add, 1);
  const active = JSON.parse(fs.readFileSync(path.join(dir, "active-empty-new", "job.json"), "utf8"));
  assert.equal(active.status, "new");
  assert.equal(active.material_readiness.state, "not-generated");
  assert.equal(active.material_readiness.assessment.checked_at, "2026-08-06T00:00:00.000Z");
  assert.deepEqual(fs.readFileSync(path.join(dir, "historical-applied", "job.json")), historicalBefore);

  const second = applyReadinessInitialization(dir, { now: "2026-08-06T00:00:01.000Z" });
  assert.equal(second.summary.add, 0);
  assert.equal(second.summary.unchanged, 1);
}));

test("only a recorded confirmation or reasoned override can permit applied", () => {
  const job = { status: "to-apply", record_policy: activePolicy };
  const draft = assessMaterialReadiness({ job, hasResume: true, hasCover: true, factCheck: cleanFactCheck });
  assert.throws(() => assertCanMarkApplied(job), /readiness/);
  confirmMaterialReadiness(job, draft, { now: "2026-08-06T00:00:00.000Z" });
  assert.equal(job.material_readiness.state, "ready");
  assert.equal(job.material_readiness.confirmation.mode, "standard");
  assert.doesNotThrow(() => assertCanMarkApplied(job));

  const reviewJob = { status: "new", record_policy: activePolicy };
  const review = assessMaterialReadiness({ job: reviewJob, hasResume: true, hasCover: true, factCheck: { ...cleanFactCheck, pages: 2 } });
  assert.throws(() => overrideMaterialReadiness(reviewJob, review, "  "), /reason/);
  overrideMaterialReadiness(reviewJob, review, "已人工核对招聘方接受两页简历", { now: "2026-08-06T00:00:00.000Z" });
  assert.equal(reviewJob.material_readiness.confirmation.mode, "override");
  assert.deepEqual(reviewJob.material_readiness.confirmation.unresolved, ["resume-not-one-page"]);
  assert.doesNotThrow(() => assertCanMarkApplied(reviewJob));
});

test("refreshing generated material resets confirmation and rejects frozen history", () => {
  const active = {
    status: "new",
    record_policy: { ...activePolicy, material_profile_version: "legacy-2026" },
    material_readiness: { state: "ready", confirmation: { mode: "standard" } },
  };
  refreshActiveMaterialReadiness(active, {
    hasResume: true, hasCover: true, factCheck: cleanFactCheck, now: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(active.record_policy.material_profile_version, "active-2027");
  assert.equal(active.material_readiness.state, "draft");
  assert.equal(active.material_readiness.confirmation, null);

  assert.throws(
    () => refreshActiveMaterialReadiness({ status: "applied", record_policy: historicalPolicy }, {}),
    /冻结|活跃/,
  );
});
