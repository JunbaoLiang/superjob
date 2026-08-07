import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("the root install provides pg for the standalone readiness-backfill script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const script = fs.readFileSync(path.join(root, "cloud/migrate/readiness-backfill.js"), "utf8");

  assert.match(script, /from "pg"/);
  assert.ok(pkg.dependencies.pg, "root package.json must declare pg for cloud/migrate/readiness-backfill.js");
});
