import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/** 读取 prompt 文件,剥掉顶部给人看的 <!-- --> 注释块 */
export function loadPrompt(name) {
  const file = path.join(config.promptsDir, `${name}.md`);
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  return text;
}

/**
 * 填充 {{VAR}} 模板变量。
 * 双向严格:模板缺变量 → 报错;传入的变量模板里没用到 → 也报错
 * (后者能挡住「占位符漏写导致内容被静默丢弃」这类隐蔽 bug)。
 */
export function fill(template, vars) {
  const invalid = [...template.matchAll(/\{\{[^{}]*\}\}/g)]
    .map((match) => match[0])
    .find((placeholder) => !/^\{\{\w+\}\}$/.test(placeholder));
  if (invalid) throw new Error(`Prompt 模板含非法占位符: ${invalid}`);
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
      `多半是占位符 {{${unused[0]}}} 写错或漏写,内容会被静默丢弃——请检查对应的 .md 模板。`
    );
  }
  return out;
}

/** 读取个人档案文件 */
export function loadProfile(name) {
  const file = path.join(config.profileDir, `${name}.md`);
  if (!fs.existsSync(file)) {
    throw new Error(`档案文件不存在: ${file}\n请先填写 data/profile/ 下的三个文件`);
  }
  return fs.readFileSync(file, "utf8");
}
