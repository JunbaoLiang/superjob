import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const install = fs.readFileSync(path.join(root, "安装.command"), "utf8");
const uninstall = fs.readFileSync(path.join(root, "卸载.command"), "utf8");

test("installer has one explicit default-port contract and passes it to launchd", () => {
  assert.match(install, /PORT="\$\{SUPERJOB_PORT:-8787\}"/);
  assert.match(install, /只支持默认端口 8787/);
  assert.match(install, /<key>EnvironmentVariables<\/key>/);
  assert.match(install, /<key>SUPERJOB_PORT<\/key><string>\$PORT<\/string>/);
  assert.match(install, /curl -fsS --max-time 1 "http:\/\/127\.0\.0\.1:\$PORT\/health"/);
});

test("installer fails clearly when bootstrap fails instead of silently falling back", () => {
  assert.match(install, /launchctl bootstrap "gui\/\$\(id -u\)" "\$PLIST"/);
  assert.match(install, /❌ LaunchAgent 注册失败/);
  assert.doesNotMatch(install, /launchctl load/);
});

test("uninstaller only removes a marked superjob wrapper and never data", () => {
  assert.match(install, /managed-by: superjob/);
  assert.match(uninstall, /managed-by: superjob/);
  assert.match(uninstall, /superjob\/src\/cli\.js/);
  assert.doesNotMatch(uninstall, /rm\s+-[^\n]*\bdata\b/);
  assert.doesNotMatch(uninstall, /rm\s+-[^\n]*\.env/);
});
