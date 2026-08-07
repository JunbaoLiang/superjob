import assert from "node:assert/strict";
import test from "node:test";
import { createLlm, parseJSONLoose } from "../src/llm.js";

test("Anthropic adapter sends Messages request and records usage", async () => {
  let request;
  const anthropic = { messages: { create: async (input) => {
    request = input;
    return { content: [{ type: "text", text: "anthropic reply" }], usage: { input_tokens: 12, output_tokens: 7 } };
  } } };
  const llm = createLlm({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    env: { ANTHROPIC_API_KEY: "test-key" },
    clients: { anthropic },
  });
  assert.equal(await llm.ask("hello", { maxTokens: 123 }), "anthropic reply");
  assert.deepEqual(request, {
    model: "claude-sonnet-4-6", max_tokens: 123, messages: [{ role: "user", content: "hello" }],
  });
  assert.deepEqual(llm.usageSummary(), {
    calls: 1, inputTokens: 12, outputTokens: 7, provider: "anthropic", model: "claude-sonnet-4-6",
    estUSD: 0.000141, priceKnown: true,
  });
});

test("OpenAI adapter sends Responses request and records usage", async () => {
  let request;
  const openai = { responses: { create: async (input) => {
    request = input;
    return { status: "completed", output_text: "openai reply", usage: { input_tokens: 12, output_tokens: 7 } };
  } } };
  const llm = createLlm({
    provider: "openai",
    model: "gpt-5.6-terra",
    env: { OPENAI_API_KEY: "test-key" },
    clients: { openai },
  });
  assert.equal(await llm.ask("hello", { maxTokens: 123 }), "openai reply");
  assert.deepEqual(request, { model: "gpt-5.6-terra", input: "hello", max_output_tokens: 123 });
  assert.deepEqual(llm.usageSummary(), {
    calls: 1, inputTokens: 12, outputTokens: 7, provider: "openai", model: "gpt-5.6-terra",
    estUSD: 0.000135, priceKnown: true,
  });
});

test("LLM configuration fails clearly before any provider call", async () => {
  await assert.rejects(createLlm({ provider: "other", model: "x", env: {} }).ask("hello"), /LLM_PROVIDER/);
  await assert.rejects(createLlm({ provider: "openai", model: "", env: {} }).ask("hello"), /LLM_MODEL/);
  await assert.rejects(createLlm({ provider: "openai", model: "gpt-test", env: {} }).ask("hello"), /OPENAI_API_KEY/);
});

test("OpenAI incomplete responses and provider errors remain explicit", async () => {
  const incomplete = createLlm({
    provider: "openai", model: "gpt-5.6-terra", env: { OPENAI_API_KEY: "test-key" },
    clients: { openai: { responses: { create: async () => ({
      status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: {},
    }) } } },
  });
  await assert.rejects(incomplete.ask("hello"), /模型输出未完成\(max_output_tokens\)/);

  const unauthorized = createLlm({
    provider: "openai", model: "gpt-5.6-terra", env: { OPENAI_API_KEY: "test-key" },
    clients: { openai: { responses: { create: async () => {
      throw Object.assign(new Error("bad key"), { status: 401 });
    } } } },
  });
  await assert.rejects(unauthorized.ask("hello"), /OpenAI API key 无效/);
});

test("JSON parsing accepts fenced objects and rejects non-JSON output", () => {
  assert.deepEqual(parseJSONLoose("```json\n{\"ok\": true}\n```"), { ok: true });
  assert.throws(() => parseJSONLoose("not json"), /没有返回 JSON/);
});

test("JSON parsing errors do not echo model source text", () => {
  assert.throws(
    () => parseJSONLoose("PRIVATE RESUME TEXT"),
    (error) => /没有返回 JSON/.test(error.message) && !error.message.includes("PRIVATE"),
  );
});
