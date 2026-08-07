import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveActiveArtifacts } from "../src/material-archive.js";

test("archive copies only active generated artifacts and preserves frozen history", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superjob-archive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const active = path.join(root, "active-new");
  const historical = path.join(root, "history-applied");
  fs.mkdirSync(active); fs.mkdirSync(historical);
  fs.writeFileSync(path.join(active, "job.json"), JSON.stringify({ status: "new", record_policy: { record_type: "active", frozen: false } }));
  fs.writeFileSync(path.join(active, "score.json"), "legacy score");
  fs.writeFileSync(path.join(active, "resume.md"), "legacy resume");
  fs.writeFileSync(path.join(historical, "job.json"), JSON.stringify({ status: "applied", record_policy: { record_type: "historical", frozen: true } }));
  fs.writeFileSync(path.join(historical, "resume.md"), "frozen resume");

  const result = archiveActiveArtifacts(root, { archiveName: "2027-refresh" });

  assert.deepEqual(result, { jobs: 1, files: 2, bytes: 25, skipped_historical: 1 });
  assert.equal(fs.readFileSync(path.join(active, "archive", "2027-refresh", "resume.md"), "utf8"), "legacy resume");
  assert.equal(fs.readFileSync(path.join(active, "resume.md"), "utf8"), "legacy resume");
  assert.equal(fs.existsSync(path.join(historical, "archive")), false);
});
