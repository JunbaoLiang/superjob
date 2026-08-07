import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { scoreView } from "../src/score-policy.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("local and cloud share identical score contracts", () => {
  assert.equal(read("data/prompts/score.md"), read("cloud/server/prompts/score.md"));
  assert.equal(read("src/output-validation.js"), read("cloud/server/src/output-validation.js"));
  assert.equal(read("src/score-policy.js"), read("cloud/server/src/score-policy.js"));
});

test("legacy scores remain displayable without being rewritten", () => {
  const legacy = { score: 72, verdict: "worth_applying", rationale: ["fixture"], hard_blockers: [], gaps: [], strengths: [], resume_angle: "fixture" };
  const view = scoreView(legacy);
  assert.equal(view.legacy, true);
  assert.equal(view.match.score, 72);
  assert.equal(view.eligibility, null);
});

test("local and cloud scoring routes only auto-skip through explicit eligibility policy", () => {
  for (const file of ["src/server.js", "cloud/server/src/index.js", "cloud/server/src/tasks.js"]) {
    const source = read(file);
    assert.match(source, /shouldAutoSkip\(score\)/, `${file} must use the explicit policy`);
    assert.doesNotMatch(source, /score\.verdict\s*===\s*["']skip["']\)\s*(?:await )?setStatus/, `${file} must not auto-skip a low match`);
  }
  assert.match(read("src/cli.js"), /canAutoGenerateMaterials\(loadJobFile\(id, "score\.json"\)\)/);
});
