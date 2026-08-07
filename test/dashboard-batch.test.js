import assert from "node:assert/strict";
import test from "node:test";
import { dashboardHTML } from "../src/dashboard.js";

test("dashboard exposes local batch import and visible queue controls", () => {
  const html = dashboardHTML();
  assert.match(html, /批量导入 JD/);
  assert.match(html, /\/api\/import\/batch/);
  assert.match(html, /\/api\/capture-queue/);
  assert.match(html, /只粘贴 URL/);
  assert.match(html, /\/api\/metrics/);
  assert.match(html, /本地指标/);
});
