import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { config } from "../src/config.js";
import {
  STATUSES, hasJobFile, jobSlug, loadJobFile, makeJobId, resolveJobId, saveJobFile, setStatus,
} from "../src/jobs.js";

function withTempJobs(run) {
  const previous = config.jobsDir;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superjob-jobs-test-"));
  config.jobsDir = dir;
  try {
    return run(dir);
  } finally {
    config.jobsDir = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("job slugs are stable and duplicate IDs gain a suffix", () => withTempJobs(() => {
  assert.equal(jobSlug("Acme, Inc.", "ML_Engineer"), "acme-inc-ml-engineer");
  assert.equal(makeJobId("Acme, Inc.", "ML_Engineer"), "acme-inc-ml-engineer-new");
  fs.mkdirSync(path.join(config.jobsDir, "acme-inc-ml-engineer-applied"));
  assert.equal(makeJobId("Acme, Inc.", "ML_Engineer"), "acme-inc-ml-engineer-2-new");
}));

test("status changes preserve job metadata and reject invalid statuses", () => withTempJobs(() => {
  const id = "acme-ml-engineer-new";
  saveJobFile(id, "job.json", { slug: "acme-ml-engineer", status: "new", company: "Acme" });
  const changed = setStatus(id, "to-apply");
  assert.equal(changed, "acme-ml-engineer-to-apply");
  assert.equal(loadJobFile(changed, "job.json").status, "to-apply");
  assert.equal(STATUSES["to-apply"], "📮 待投");
  assert.throws(() => setStatus(changed, "made-up"), /未知状态/);
}));

test("marking a job applied requires a confirmed readiness record", () => withTempJobs(() => {
  const id = "acme-ml-engineer-to-apply";
  saveJobFile(id, "job.json", {
    slug: "acme-ml-engineer", status: "to-apply",
    record_policy: { record_type: "active", frozen: false, material_profile_version: "active-2027" },
    material_readiness: { state: "draft", confirmation: null },
  });
  assert.throws(() => setStatus(id, "applied"), /readiness/);

  const job = loadJobFile(id, "job.json");
  job.material_readiness = {
    state: "ready",
    confirmation: { mode: "standard", confirmed_at: "2026-08-06T00:00:00.000Z", reason: null, unresolved: [] },
  };
  saveJobFile(id, "job.json", job);
  assert.equal(setStatus(id, "applied"), "acme-ml-engineer-applied");
}));

test("job file helpers reject path traversal and resolve only unambiguous IDs", () => withTempJobs(() => {
  saveJobFile("acme-ml-new", "job.json", { captured_at: "2026-01-01" });
  saveJobFile("acme-data-new", "job.json", { captured_at: "2026-01-02" });
  assert.equal(resolveJobId("acme-ml"), "acme-ml-new");
  assert.throws(() => resolveJobId("acme"), /多个职位/);
  assert.throws(() => saveJobFile("../escape", "job.json", {}), /非法 job-id/);
  assert.throws(() => saveJobFile("acme-ml-new", "../escape.json", {}), /非法文件名/);
  assert.equal(hasJobFile("acme-ml-new", "job.json"), true);
}));
