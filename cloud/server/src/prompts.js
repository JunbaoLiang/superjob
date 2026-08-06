import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { q } from "./db.js";

/** 读取 prompt 文件(打包在镜像里),剥掉顶部给人看的 <!-- --> 注释块 */
export function loadPrompt(name) {
  const file = path.join(config.promptsDir, `${name}.md`);
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  return text;
}

/**
 * 填充 {{VAR}} 模板变量。
 * 双向严格:模板缺变量 → 报错;传入的变量模板里没用到 → 也报错
 */
export function fill(template, vars) {
  const used = new Set();
  const out = template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in vars)) throw new Error(`Prompt 模板缺少变量: ${key}`);
    used.add(key);
    const v = vars[key];
    return v == null ? "null" : String(v);
  });
  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length) {
    throw new Error(
      `Prompt 模板未使用传入的变量: ${unused.join(", ")}。` +
      `多半是占位符 {{${unused[0]}}} 写错或漏写——请检查对应的 prompts/*.md 模板。`
    );
  }
  return out;
}

export const PROFILE_DOCS = ["resume-master", "target", "preferences"];

/** 个人档案存数据库(面板里可编辑);为空时给出可操作的报错 */
export async function loadProfile(name) {
  const { rows } = await q(`SELECT content FROM profile WHERE name = $1`, [name]);
  const content = rows[0]?.content || "";
  if (!content.trim()) {
    throw new Error(`档案「${name}」还没填写。请打开面板右上角「档案」填写后再试`);
  }
  return content;
}

export async function getProfileAll() {
  const { rows } = await q(`SELECT name, content, updated_at FROM profile`);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  return PROFILE_DOCS.map((name) => ({
    name,
    content: by[name]?.content || "",
    updatedAt: by[name]?.updated_at || null,
  }));
}

export async function saveProfile(name, content) {
  if (!PROFILE_DOCS.includes(name)) throw new Error(`未知档案: ${name}`);
  await q(
    `INSERT INTO profile (name, content) VALUES ($1,$2)
     ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [name, content]
  );
}
