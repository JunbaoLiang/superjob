import assert from "node:assert/strict";
import test from "node:test";
import { canAutoGenerateMaterials, shouldAutoSkip } from "../src/score-policy.js";

const base = (eligibility, score, verdict, recommendation) => ({
  eligibility: { verdict: eligibility, hard_blockers: eligibility === "ineligible" ? ["明确国籍限制"] : [], risks: eligibility === "needs-verification" ? ["sponsorship 未说明"] : [], checks: ["fixture"] },
  match: { score, verdict, rationale: ["fixture"], gaps: [], strengths: [], resume_angle: "fixture" },
  recommendation,
});

test("only explicit ineligibility auto-skips; unspecified sponsorship remains active", () => {
  assert.equal(shouldAutoSkip(base("ineligible", 90, "strong_match", "skip")), true);
  assert.equal(shouldAutoSkip(base("needs-verification", 90, "strong_match", "verify")), false);
  assert.equal(shouldAutoSkip(base("eligible", 20, "low_match", "skip")), false);
});

test("75/60 thresholds and stretch manual-material rule are explicit", () => {
  assert.equal(canAutoGenerateMaterials(base("eligible", 76, "worth_applying", "main_target")), true);
  assert.equal(canAutoGenerateMaterials(base("eligible", 60, "stretch", "mass_apply")), true);
  assert.equal(canAutoGenerateMaterials(base("eligible", 59, "stretch", "stretch")), false);
  assert.equal(canAutoGenerateMaterials(base("needs-verification", 80, "worth_applying", "verify")), false);
});
