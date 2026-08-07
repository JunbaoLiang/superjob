import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "./config.js";

const PROVIDERS = new Set(["anthropic", "openai"]);
const PROVIDER_LABEL = { anthropic: "Anthropic", openai: "OpenAI" };
const PRICING = {
  anthropic: {
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-sonnet-5": { input: 3, output: 15 },
    "claude-opus-4-8": { input: 5, output: 25 },
    "claude-haiku-4-5": { input: 1, output: 5 },
  },
  openai: {
    "gpt-5.6-sol": { input: 5, output: 30 },
    "gpt-5.6-terra": { input: 2.5, output: 15 },
    "gpt-5.6-luna": { input: 1, output: 6 },
  },
};

function responseText(response) {
  if (typeof response.output_text === "string" && response.output_text) return response.output_text;
  return (response.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n");
}

/** 可注入 clients 的工厂，使测试不需要网络或真实 API key。 */
export function createLlm({ provider = config.llmProvider, model = config.llmModel, env = process.env, clients = {} } = {}) {
  const selectedProvider = String(provider || "").trim().toLowerCase();
  const selectedModel = String(model || "").trim();
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  let anthropicClient = clients.anthropic;
  let openaiClient = clients.openai;

  function validate() {
    if (!PROVIDERS.has(selectedProvider)) throw new Error("LLM_PROVIDER 必须设为 anthropic 或 openai。");
    if (!selectedModel) throw new Error("LLM_MODEL 未设置。");
    const keyName = selectedProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    if (!env[keyName]) throw new Error(`${keyName} 未设置。`);
  }

  function getClient() {
    if (selectedProvider === "anthropic") {
      if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 5 });
      return anthropicClient;
    }
    if (!openaiClient) openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 5 });
    return openaiClient;
  }

  function addUsage(apiUsage) {
    usage.calls++;
    usage.inputTokens += Number(apiUsage?.input_tokens) || 0;
    usage.outputTokens += Number(apiUsage?.output_tokens) || 0;
  }

  function usageSummary() {
    const rate = PRICING[selectedProvider]?.[selectedModel];
    const estUSD = rate
      ? (usage.inputTokens / 1e6) * rate.input + (usage.outputTokens / 1e6) * rate.output
      : null;
    return { ...usage, provider: selectedProvider || null, model: selectedModel || null, estUSD, priceKnown: !!rate };
  }

  async function ask(prompt, { maxTokens = 8000 } = {}) {
    validate();
    try {
      if (selectedProvider === "anthropic") {
        const response = await getClient().messages.create({
          model: selectedModel,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        });
        addUsage(response.usage);
        if (response.stop_reason === "max_tokens") {
          throw new Error(`模型输出被 maxTokens=${maxTokens} 截断。请调大对应调用的 maxTokens。`);
        }
        return (response.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
      }

      const response = await getClient().responses.create({
        model: selectedModel,
        input: prompt,
        max_output_tokens: maxTokens,
      });
      addUsage(response.usage);
      if (response.status === "incomplete") {
        const reason = response.incomplete_details?.reason || "unknown";
        throw new Error(`模型输出未完成(${reason})；请调大对应调用的 maxTokens 或稍后重试。`);
      }
      const text = responseText(response);
      if (!text) throw new Error("OpenAI API 未返回文本输出。");
      return text;
    } catch (err) {
      const status = err?.status;
      const label = PROVIDER_LABEL[selectedProvider] || selectedProvider;
      if (status === 401) throw new Error(`${label} API key 无效。请检查对应环境变量。`);
      if (status === 429) throw new Error(`${label} API 触发限流，请稍后重试。`);
      if (typeof status === "number") throw new Error(`${label} API 错误 (${status}): ${err.message}`);
      throw err;
    }
  }

  function resetUsage() {
    usage.calls = 0;
    usage.inputTokens = 0;
    usage.outputTokens = 0;
  }

  return { ask, resetUsage, usage, usageSummary };
}

const defaultLlm = createLlm();
export const usage = defaultLlm.usage;
export const ask = defaultLlm.ask;
export const resetUsage = defaultLlm.resetUsage;
export const usageSummary = defaultLlm.usageSummary;

export function parseJSONLoose(text) {
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`模型没有返回 JSON，原文开头:${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error(`JSON 解析失败，原文开头:${text.slice(0, 200)}`);
  }
}

export async function askJSON(prompt, opts) {
  return parseJSONLoose(await ask(prompt, opts));
}
