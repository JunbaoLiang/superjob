import fs from "node:fs";
import path from "node:path";
import { isSplitScore } from "./score-policy.js";

const BANDS = ["0-39", "40-59", "60-74", "75-100"];
const ELIGIBILITY = ["eligible", "needs-verification", "ineligible"];
const RECOMMENDATIONS = ["main_target", "mass_apply", "stretch", "verify", "skip"];

function zero(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function scoreBand(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) return null;
  if (score < 40) return "0-39";
  if (score < 60) return "40-59";
  if (score < 75) return "60-74";
  return "75-100";
}

/**
 * Read only status/policy/score metadata and return aggregate replay readiness.
 * A legacy combined score cannot truthfully be converted to new Eligibility, so
 * this intentionally never invents an eligibility result or writes a score file.
 */
export function inspectScoreReplay(jobsDir) {
  const summary = {
    jobs: 0, scored: 0, missing_score: 0, invalid_score: 0,
    legacy: { total: 0, by_status: {}, by_verdict: {}, by_band: zero(BANDS) },
    split: { total: 0, by_eligibility: zero(ELIGIBILITY), by_recommendation: zero(RECOMMENDATIONS) },
    replayable_active: 0,
    frozen_historical: 0,
  };
  if (!fs.existsSync(jobsDir)) return summary;

  for (const id of fs.readdirSync(jobsDir).sort()) {
    const dir = path.join(jobsDir, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const jobPath = path.join(dir, "job.json");
    if (!fs.existsSync(jobPath)) continue;
    let job;
    try { job = JSON.parse(fs.readFileSync(jobPath, "utf8")); } catch { continue; }
    summary.jobs++;
    const historical = job.record_policy?.record_type === "historical" || ["applied", "rejected"].includes(job.status);
    if (historical) summary.frozen_historical++;

    const scorePath = path.join(dir, "score.json");
    if (!fs.existsSync(scorePath)) { summary.missing_score++; continue; }
    let score;
    try { score = JSON.parse(fs.readFileSync(scorePath, "utf8")); } catch { summary.invalid_score++; continue; }
    summary.scored++;

    if (isSplitScore(score)) {
      if (!ELIGIBILITY.includes(score.eligibility.verdict) || !RECOMMENDATIONS.includes(score.recommendation)) {
        summary.invalid_score++; continue;
      }
      summary.split.total++;
      summary.split.by_eligibility[score.eligibility.verdict]++;
      summary.split.by_recommendation[score.recommendation]++;
      continue;
    }

    const band = scoreBand(score.score);
    if (!band || typeof score.verdict !== "string") { summary.invalid_score++; continue; }
    summary.legacy.total++;
    summary.legacy.by_status[job.status] = (summary.legacy.by_status[job.status] || 0) + 1;
    summary.legacy.by_verdict[score.verdict] = (summary.legacy.by_verdict[score.verdict] || 0) + 1;
    summary.legacy.by_band[band]++;
    if (!historical && ["new", "to-apply"].includes(job.status)) summary.replayable_active++;
  }
  return summary;
}
