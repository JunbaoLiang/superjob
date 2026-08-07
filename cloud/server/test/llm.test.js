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
  assert.equal(llm.usageSummary().provider, "anthropic");
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
  assert.equal(llm.usageSummary().provider, "openai");
});

test("LLM configuration fails clearly before any provider call", async () => {
  await assert.rejects(createLlm({ provider: "other", model: "x", env: {} }).ask("hello"), /LLM_PROVIDER/);
  await assert.rejects(createLlm({ provider: "anthropic", model: "x", env: {} }).ask("hello"), /ANTHROPIC_API_KEY/);
});

test("OpenAI incomplete response fails without a network retry", async () => {
  const llm = createLlm({
    provider: "openai", model: "gpt-5.6-terra", env: { OPENAI_API_KEY: "test-key" },
    clients: { openai: { responses: { create: async () => ({
      status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: {},
    }) } } },
  });
  await assert.rejects(llm.ask("hello"), /模型输出未完成\(max_output_tokens\)/);
});

test("cloud JSON parsing errors do not echo model source text", () => {
  assert.throws(
    () => parseJSONLoose("PRIVATE RESUME TEXT"),
    (error) => /没有返回 JSON/.test(error.message) && !error.message.includes("PRIVATE"),
  );
});
