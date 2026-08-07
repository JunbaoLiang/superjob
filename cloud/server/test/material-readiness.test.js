import test from "node:test";
import assert from "node:assert/strict";
import {
  assessMaterialReadiness,
  assertCanMarkApplied,
  confirmMaterialReadiness,
  overrideMaterialReadiness,
  refreshActiveMaterialReadiness,
} from "../src/material-readiness.js";

const active = { record_type: "active", frozen: false, material_profile_version: "active-2027" };
const historical = { record_type: "historical", frozen: true, material_profile_version: "legacy-2026" };
const facts = { final: { verdict: "clean", issues: [] }, pages: 1, cover_letter: { final: { verdict: "clean", issues: [] } } };

test("cloud assessment keeps a clean one-page material in draft until confirmation", () => {
  const job = { status: "to-apply", record_policy: active };
  const assessment = assessMaterialReadiness({ job, hasResume: true, hasCover: true, factCheck: facts });
  assert.equal(assessment.state, "draft");
  assert.throws(() => assertCanMarkApplied(job), /readiness/);
  confirmMaterialReadiness(job, assessment, { now: "2026-08-06T00:00:00.000Z" });
  assert.doesNotThrow(() => assertCanMarkApplied(job));
});

test("cloud legacy or incomplete output requires review and override records a reason", () => {
  const job = { status: "new", record_policy: { ...active, material_profile_version: "legacy-2026" } };
  const assessment = assessMaterialReadiness({ job, hasResume: true, hasCover: true, factCheck: facts });
  assert.equal(assessment.state, "needs-review");
  assert.throws(() => overrideMaterialReadiness(job, assessment, ""), /reason/);
  overrideMaterialReadiness(job, assessment, "人工核对旧材料", { now: "2026-08-06T00:00:00.000Z" });
  assert.equal(job.material_readiness.confirmation.mode, "override");
  assert.doesNotThrow(() => assertCanMarkApplied(job));
});

test("cloud generation refresh clears confirmation and refuses frozen history", () => {
  const job = { status: "new", record_policy: { ...active, material_profile_version: "legacy-2026" }, material_readiness: { state: "ready" } };
  refreshActiveMaterialReadiness(job, { hasResume: true, hasCover: true, factCheck: facts, now: "2026-08-06T00:00:00.000Z" });
  assert.equal(job.material_readiness.state, "draft");
  assert.equal(job.material_readiness.confirmation, null);
  assert.throws(() => refreshActiveMaterialReadiness({ status: "applied", record_policy: historical }, {}), /冻结|活跃/);
});
