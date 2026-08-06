import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

// maxRetries 调高:连抓多个岗时突发限流(429/529)由 SDK 自动退避重试,少丢打分
const client = new Anthropic({ maxRetries: 5 });

/**
 * 本进程内累计的 API 用量(每次 CLI 调用是新进程,自然从零开始)。
 * 供命令结束时打印「本次成本」。
 */
export const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };

/** 归零用量计数(长驻服务里每次抓取前调用,好单独统计这一单的成本) */
export function resetUsage() {
  usage.calls = 0;
  usage.inputTokens = 0;
  usage.outputTokens = 0;
}

/** 各模型每 100 万 token 的美元价格(如换模型或调价,改这里即可;来源:Claude 定价) */
const PRICING = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** 汇总本次用量 + 估算美元成本(按当前模型价格;未知模型退回 sonnet 价格并注明) */
export function usageSummary() {
  const known = PRICING[config.model];
  const rate = known || PRICING["claude-sonnet-4-6"];
  const estUSD = (usage.inputTokens / 1e6) * rate.input + (usage.outputTokens / 1e6) * rate.output;
  return { ...usage, model: config.model, estUSD, priceKnown: !!known };
}

/** 调用 Claude,返回纯文本。截断(stop_reason=max_tokens)时抛清晰错误 */
export async function ask(prompt, { maxTokens = 8000 } = {}) {
  try {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    usage.calls++;
    usage.inputTokens += response.usage?.input_tokens || 0;
    usage.outputTokens += response.usage?.output_tokens || 0;
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        `模型输出被 max_tokens=${maxTokens} 截断(生成了 ${response.usage?.output_tokens ?? "?"} tokens)。` +
        `请调大对应调用的 maxTokens。`
      );
    }
    return text;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("API key 无效或未设置。请在 .env 里填 ANTHROPIC_API_KEY(参考 .env.example)");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("触发 API 限流,稍等一分钟再试");
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Claude API 错误 (${err.status}): ${err.message}`);
    }
    throw err;
  }
}

/** 容错解析模型返回的 JSON:剥离 markdown 围栏、截取首尾大括号 */
export function parseJSONLoose(text) {
  let t = text.trim();
  // 去掉 ```json ... ``` 围栏
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // 截取第一个 { 到最后一个 }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`模型没有返回 JSON,原文开头:${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new Error(`JSON 解析失败,原文开头:${text.slice(0, 200)}`);
  }
}

/** 调用 Claude 并解析为 JSON 对象 */
export async function askJSON(prompt, opts) {
  const text = await ask(prompt, opts);
  return parseJSONLoose(text);
}
