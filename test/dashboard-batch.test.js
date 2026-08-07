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
  assert.match(html, /download=1/);
  assert.match(html, /downloadName\(pref,"pdf"\)/);
  assert.match(html, /下载 \.docx/);
  assert.match(html, /safeHref/);
  assert.match(html, /noopener noreferrer/);
  assert.doesNotMatch(html, /href="\$2"/);
  const cloud = fs.readFileSync(new URL("../cloud/web/app.js", import.meta.url), "utf8");
  assert.match(cloud, /a\.download = downloadName\(name\)/);
  assert.match(cloud, /safeHref/);
  assert.match(cloud, /noopener noreferrer/);

  const localServer = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const cloudServer = fs.readFileSync(new URL("../cloud/server/src/index.js", import.meta.url), "utf8");
  for (const source of [localServer, cloudServer]) {
    assert.match(source, /Content-Disposition/);
    assert.match(source, /downloadName\(name\)/);
  }
});
