import test from "node:test";
import assert from "node:assert/strict";
import { ensureReadinessSchema } from "../src/db.js";
import { assertStatusTransition } from "../src/jobs.js";

test("cloud readiness schema upgrade is additive and idempotent SQL", async () => {
  const calls = [];
  await ensureReadinessSchema(async (sql) => { calls.push(sql); });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => /ADD COLUMN IF NOT EXISTS/.test(sql)));
  assert.ok(calls.some((sql) => /record_policy/.test(sql)));
  assert.ok(calls.some((sql) => /material_readiness/.test(sql)));
});

test("cloud status transition guard rejects unconfirmed applied and accepts confirmed ready", () => {
  const base = { status: "to-apply", record_policy: { record_type: "active", frozen: false } };
  assert.throws(() => assertStatusTransition({ ...base, material_readiness: { state: "draft" } }, "applied"), /readiness/);
  assert.doesNotThrow(() => assertStatusTransition({ ...base, material_readiness: { state: "ready", confirmation: { mode: "standard" } } }, "applied"));
  assert.throws(() => assertStatusTransition(base, "invalid"), /未知状态/);
});
