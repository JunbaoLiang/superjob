import assert from "node:assert/strict";
import test from "node:test";
import { fill } from "../src/prompts.js";

test("prompt variables are fully and exactly substituted", () => {
  assert.equal(fill("Hello {{NAME}} — {{ROLE}}", { NAME: "Junbao", ROLE: "Scientist" }), "Hello Junbao — Scientist");
  assert.equal(fill("{{EMPTY}}", { EMPTY: null }), "null");
});

test("prompt variable mistakes fail loudly", () => {
  assert.throws(() => fill("Hello {{NAME}}", {}), /缺少变量/);
  assert.throws(() => fill("Hello {{NAME}}", { NAME: "Junbao", ROLE: "Scientist" }), /未使用传入/);
  assert.throws(() => fill("Hello {{BAD-NAME}}", { "BAD-NAME": "x" }), /非法占位符/);
});
