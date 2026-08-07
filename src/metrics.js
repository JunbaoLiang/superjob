import fs from "node:fs";
import path from "node:path";

const inc = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };
function sourceHost(url) { try { return new URL(url).hostname || "unknown"; } catch { return "unknown"; } }

/** Read only aggregate metadata: no JD, profile, material, company/title, or full URL leaves this function. */
export function collectJobMetrics(jobsDir) {
  const result = { total:0, status:{}, readiness:{}, eligibility:{}, recommendation:{}, sources:{}, funnel:{active:0,ready:0,applied:0,interview:0,offer:0,rejected:0} };
  if (!fs.existsSync(jobsDir)) return result;
  for (const id of fs.readdirSync(jobsDir)) {
    try {
      const base = path.join(jobsDir,id); if (!fs.statSync(base).isDirectory()) continue;
      const job = JSON.parse(fs.readFileSync(path.join(base,"job.json"),"utf8"));
      let score = null; try { score = JSON.parse(fs.readFileSync(path.join(base,"score.json"),"utf8")); } catch {}
      result.total++; inc(result.status, job.status || "unknown"); inc(result.readiness, job.material_readiness?.state || "unknown");
      inc(result.sources, sourceHost(job.url));
      inc(result.eligibility, score?.eligibility?.verdict || "legacy_or_missing"); inc(result.recommendation, score?.recommendation || "legacy_or_missing");
      if (["new","to-apply"].includes(job.status)) result.funnel.active++;
      if (job.material_readiness?.state === "ready") result.funnel.ready++;
      for (const state of ["applied","interview","offer","rejected"]) if (job.status === state) result.funnel[state]++;
    } catch { /* malformed records are excluded rather than exposing their content */ }
  }
  return result;
}
