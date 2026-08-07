import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectScoreReplay } from "../src/score-replay.js";

function withFixtures(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superjob-score-replay-"));
  try { return run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function fixture(root, id, status, score = undefined) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ status, record_policy: { record_type: ["applied", "rejected"].includes(status) ? "historical" : "active" } }));
  if (score !== undefined) fs.writeFileSync(path.join(dir, "score.json"), JSON.stringify(score));
}

test("score replay reports aggregates without exposing fixture content or changing files", () => withFixtures((dir) => {
  fixture(dir, "legacy-applied", "applied", { score: 82, verdict: "worth_applying" });
  fixture(dir, "legacy-active", "to-apply", { score: 35, verdict: "skip" });
  fixture(dir, "split-active", "new", {
    eligibility: { verdict: "needs-verification", hard_blockers: [], risks: ["fixture"], checks: ["fixture"] },
    match: { score: 80, verdict: "worth_applying", rationale: ["fixture"], gaps: [], strengths: [], resume_angle: "fixture" },
    recommendation: "verify",
  });
  fixture(dir, "unscored", "new");
  const before = fs.readdirSync(dir).sort().map((id) => fs.readFileSync(path.join(dir, id, "job.json"), "utf8")).join("|");

  const result = inspectScoreReplay(dir);

  assert.deepEqual(result, {
    jobs: 4, scored: 3, missing_score: 1, invalid_score: 0,
    legacy: { total: 2, by_status: { applied: 1, "to-apply": 1 }, by_verdict: { worth_applying: 1, skip: 1 }, by_band: { "0-39": 1, "40-59": 0, "60-74": 0, "75-100": 1 } },
    split: { total: 1, by_eligibility: { eligible: 0, "needs-verification": 1, ineligible: 0 }, by_recommendation: { main_target: 0, mass_apply: 0, stretch: 0, verify: 1, skip: 0 } },
    replayable_active: 1,
    frozen_historical: 1,
  });
  const after = fs.readdirSync(dir).sort().map((id) => fs.readFileSync(path.join(dir, id, "job.json"), "utf8")).join("|");
  assert.equal(after, before);
}));
