import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { dashboardHTML } from "../src/dashboard.js";

test("dashboard exposes local batch import and visible queue controls", () => {
  const html = dashboardHTML();
  assert.match(html, /批量导入 JD/);
  assert.match(html, /\/api\/import\/batch/);
  assert.match(html, /\/api\/capture-queue/);
  assert.match(html, /只粘贴 URL/);
  assert.match(html, /\/api\/metrics/);
  assert.match(html, /本地指标/);
  assert.match(html, /下载 PDF/);
  assert.match(html, /pref\+'\.pdf" download/);
  assert.match(html, /下载 \.docx/);
  assert.match(html, /safeHref/);
  assert.match(html, /noopener noreferrer/);
  assert.doesNotMatch(html, /href="\$2"/);
  const cloud = fs.readFileSync(new URL("../cloud/web/app.js", import.meta.url), "utf8");
  assert.match(cloud, /safeHref/);
  assert.match(cloud, /noopener noreferrer/);
});
