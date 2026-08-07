import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 加载 .env(Node 20.12+ 原生支持,无需 dotenv)
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // .env 不存在时静默跳过,允许直接用环境变量
}

export const config = {
  root: ROOT,
  llmProvider: (process.env.LLM_PROVIDER || "").trim().toLowerCase(),
  llmModel: (process.env.LLM_MODEL || "").trim(),
  port: Number(process.env.SUPERJOB_PORT) || 8787, // 本地抓取服务端口(与 Chrome 扩展里的端口保持一致)
  dataDir: path.join(ROOT, "data"),
  profileDir: path.join(ROOT, "data", "profile"),
  promptsDir: path.join(ROOT, "data", "prompts"),
  templatesDir: path.join(ROOT, "data", "templates"),
  jobsDir: path.join(ROOT, "data", "jobs"),
};
