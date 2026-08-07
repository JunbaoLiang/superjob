import assert from "node:assert/strict";
import test from "node:test";
import { applyOutreachEdit } from "../src/outreach-edit.js";

test("outreach edits preserve generation provenance and reject empty or overlong content", () => {
  const before={who:["Fixture"],note:"old",message:"old message",generated_at:"2026-01-01T00:00:00.000Z"};
  const saved=applyOutreachEdit(before,{note:"new",message:"new message"},"2026-02-01T00:00:00.000Z");
  assert.equal(saved.generated_at,before.generated_at); assert.equal(saved.edited_at,"2026-02-01T00:00:00.000Z"); assert.equal(saved.note,"new");
  assert.throws(()=>applyOutreachEdit(before,{note:"",message:"x"}),/不能为空/);
  assert.throws(()=>applyOutreachEdit(before,{note:"x".repeat(201),message:"x"}),/200/);
});
