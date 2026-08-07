import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyRecordPolicyMigration,
  planRecordPolicyMigration,
} from "../src/record-policy.js";

function makeTempJobs(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superjob-record-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeJob(root, id, status, { material = false, policy = undefined } = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const job = { company: "Fixture Co", title: id, status, sentinel: "preserve" };
  if (policy !== undefined) job.record_policy = policy;
  fs.writeFileSync(path.join(dir, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "raw.txt"), "fixture raw text");
  if (material) fs.writeFileSync(path.join(dir, "resume.md"), "frozen fixture material");
  return dir;
}

test("dry run maps statuses without writing fixture data", (t) => {
  const jobsDir = makeTempJobs(t);
  makeJob(jobsDir, "applied", "applied", { material: true });
  makeJob(jobsDir, "rejected", "rejected", { material: true });
  makeJob(jobsDir, "active", "to-apply");
  makeJob(jobsDir, "skipped", "skip");
  makeJob(jobsDir, "existing", "new", {
    policy: { record_type: "active", frozen: false, frozen_reason: null, material_profile_version: "unknown", migration_version: 1 },
  });

  const result = planRecordPolicyMigration(jobsDir);

  assert.deepEqual(result.summary, { add: 4, unchanged: 1, errors: 0 });
  assert.equal(result.planned.find((entry) => entry.id === "applied").policy.record_type, "historical");
  assert.equal(result.planned.find((entry) => entry.id === "applied").policy.frozen_reason, "submitted");
  assert.equal(result.planned.find((entry) => entry.id === "rejected").policy.frozen_reason, "rejected");
  assert.equal(result.planned.find((entry) => entry.id === "active").policy.record_type, "active");
  assert.equal(result.planned.find((entry) => entry.id === "skipped").policy.record_type, "skipped");
  assert.equal(result.planned.find((entry) => entry.id === "applied").policy.material_profile_version, "legacy-2026");
  assert.equal(fs.readFileSync(path.join(jobsDir, "applied", "job.json"), "utf8").includes("record_policy"), false);
});

test("apply is additive, preserves materials, and is idempotent", (t) => {
  const jobsDir = makeTempJobs(t);
  const appliedDir = makeJob(jobsDir, "applied", "applied", { material: true });
  makeJob(jobsDir, "new", "new");
  const materialBefore = fs.readFileSync(path.join(appliedDir, "resume.md"), "utf8");

  const first = applyRecordPolicyMigration(jobsDir);
  const second = applyRecordPolicyMigration(jobsDir);
  const applied = JSON.parse(fs.readFileSync(path.join(appliedDir, "job.json"), "utf8"));

  assert.deepEqual(first.summary, { add: 2, unchanged: 0, errors: 0 });
  assert.deepEqual(second.summary, { add: 0, unchanged: 2, errors: 0 });
  assert.equal(applied.status, "applied");
  assert.equal(applied.sentinel, "preserve");
  assert.equal(applied.record_policy.record_type, "historical");
  assert.equal(fs.readFileSync(path.join(appliedDir, "resume.md"), "utf8"), materialBefore);
});

test("invalid job records prevent an apply without partial writes", (t) => {
  const jobsDir = makeTempJobs(t);
  const validDir = makeJob(jobsDir, "valid", "new");
  fs.mkdirSync(path.join(jobsDir, "missing-job-json"));

  const plan = planRecordPolicyMigration(jobsDir);
  assert.deepEqual(plan.summary, { add: 1, unchanged: 0, errors: 1 });
  assert.throws(() => applyRecordPolicyMigration(jobsDir), /dry-run errors/);
  assert.equal(fs.readFileSync(path.join(validDir, "job.json"), "utf8").includes("record_policy"), false);
});
