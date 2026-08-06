import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  root: ROOT,
  port: Number(process.env.PORT) || 8787, // Render 会注入 PORT
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  token: process.env.APP_TOKEN || "",     // 访问口令:所有 /api/* 与 /capture 都要带
  databaseUrl: process.env.DATABASE_URL || "",
  promptsDir: path.join(ROOT, "prompts"),
  templatesDir: path.join(ROOT, "templates"),
};

if (!config.token) {
  console.warn("⚠️ 未设置 APP_TOKEN,服务将拒绝所有请求。请在环境变量里配置。");
}
if (!config.databaseUrl) {
  console.warn("⚠️ 未设置 DATABASE_URL(Neon 连接串)。");
}
