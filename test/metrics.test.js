import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectJobMetrics } from "../src/metrics.js";

test("metrics aggregate only job metadata and preserve fixtures", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superjob-metrics-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const add = (id, job, score) => { const p = path.join(dir, id); fs.mkdirSync(p); fs.writeFileSync(path.join(p, "job.json"), JSON.stringify(job)); if(score) fs.writeFileSync(path.join(p, "score.json"), JSON.stringify(score)); };
  add("one", { status:"to-apply", url:"https://jobs.example.com/a", material_readiness:{state:"ready"} }, { eligibility:{verdict:"eligible"}, recommendation:"main_target" });
  add("two", { status:"applied", url:"https://careers.example.org/b", material_readiness:{state:"draft"} }, { eligibility:{verdict:"needs-verification"}, recommendation:"verify" });
  add("three", { status:"skip" });
  const before = fs.readdirSync(dir).sort().map((id) => fs.readFileSync(path.join(dir,id,"job.json"),"utf8")).join("|");
  assert.deepEqual(collectJobMetrics(dir), { total:3, status:{"to-apply":1,applied:1,skip:1}, readiness:{ready:1,draft:1,unknown:1}, eligibility:{eligible:1,"needs-verification":1,legacy_or_missing:1}, recommendation:{main_target:1,verify:1,legacy_or_missing:1}, sources:{"jobs.example.com":1,"careers.example.org":1,unknown:1}, funnel:{active:1,ready:1,applied:1,interview:0,offer:0,rejected:0} });
  assert.equal(fs.readdirSync(dir).sort().map((id) => fs.readFileSync(path.join(dir,id,"job.json"),"utf8")).join("|"), before);
});
