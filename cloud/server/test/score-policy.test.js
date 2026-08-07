import assert from "node:assert/strict";
import test from "node:test";
import { canAutoGenerateMaterials, shouldAutoSkip } from "../src/score-policy.js";

const score = (eligibility, matchScore, verdict, recommendation) => ({
  eligibility: { verdict: eligibility, hard_blockers: eligibility === "ineligible" ? ["明确安全许可要求"] : [], risks: eligibility === "needs-verification" ? ["sponsorship 未说明"] : [], checks: ["fixture"] },
  match: { score: matchScore, verdict, rationale: ["fixture"], gaps: [], strengths: [], resume_angle: "fixture" },
  recommendation,
});

test("cloud status policy only auto-skips explicit ineligibility", () => {
  assert.equal(shouldAutoSkip(score("ineligible", 85, "strong_match", "skip")), true);
  assert.equal(shouldAutoSkip(score("needs-verification", 85, "strong_match", "verify")), false);
});

test("cloud policy leaves stretch and verification material generation to a person", () => {
  assert.equal(canAutoGenerateMaterials(score("eligible", 75, "worth_applying", "main_target")), true);
  assert.equal(canAutoGenerateMaterials(score("eligible", 60, "stretch", "mass_apply")), true);
  assert.equal(canAutoGenerateMaterials(score("eligible", 40, "stretch", "stretch")), false);
  assert.equal(canAutoGenerateMaterials(score("needs-verification", 80, "worth_applying", "verify")), false);
});
