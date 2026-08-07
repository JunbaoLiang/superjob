import assert from "node:assert/strict";
import test from "node:test";
import { editFileColumn, readFilePolicy } from "../src/file-policy.js";

test("cloud file policy only permits known material names", () => {
  assert.deepEqual(readFilePolicy("resume.md"), { kind: "markdown", column: "resume_md" });
  assert.deepEqual(readFilePolicy("cover-letter.pdf"), { kind: "binary" });
  assert.equal(readFilePolicy("../profile.md"), null);
  assert.equal(readFilePolicy("job.json"), null);
  assert.equal(editFileColumn("resume.md"), "resume_md");
  assert.equal(editFileColumn("cover-letter.md"), "cover_md");
  assert.equal(editFileColumn("match-report.md"), null);
});
