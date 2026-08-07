import assert from "node:assert/strict";
import test from "node:test";
import {
  BatchImportQueue,
  classifyDuplicate,
  normalizeJobUrl,
  parseBatchInput,
} from "../src/batch-import.js";

test("batch input parses URLs and JD blocks without retaining blank items", () => {
  const parsed = parseBatchInput(`
https://jobs.example.com/opening/42?utm_source=feed#details

Acme Labs — Research Engineer
Location: Boston, MA
Build molecular simulation models and production ML tools.

https://jobs.example.org/roles/7
`);
  assert.deepEqual(parsed.map((item) => item.kind), ["url", "text", "url"]);
  assert.equal(parsed[0].url, "https://jobs.example.com/opening/42?utm_source=feed#details");
  assert.match(parsed[1].text, /Research Engineer/);
});

test("URL normalization removes fragments and tracking parameters but keeps material queries", () => {
  assert.equal(
    normalizeJobUrl(" HTTPS://Jobs.Example.com:443/a/?utm_source=x&ref=mail&team=ml#apply "),
    "https://jobs.example.com/a?team=ml"
  );
  assert.equal(normalizeJobUrl("not a url"), null);
});

test("duplicate classification is conservative about company/title collisions", () => {
  const existing = [
    { id: "same-url", url: "https://jobs.example.com/a?team=ml", company: "Acme", title: "ML Engineer", location: "Boston" },
    { id: "no-url", url: null, company: "Beta Labs", title: "Scientist", location: "New York" },
    { id: "other-location", url: "https://jobs.example.com/b", company: "Acme", title: "ML Engineer", location: "Seattle" },
  ];
  assert.deepEqual(classifyDuplicate({ url: "https://jobs.example.com/a?utm_campaign=x&team=ml", company: "Else", title: "Else" }, existing), {
    kind: "duplicate", match: "url", id: "same-url",
  });
  assert.deepEqual(classifyDuplicate({ url: null, company: " beta labs ", title: "SCIENTIST", location: "new york" }, existing), {
    kind: "duplicate", match: "identity", id: "no-url",
  });
  assert.deepEqual(classifyDuplicate({ url: "https://jobs.example.com/c", company: "Acme", title: "ML Engineer", location: "Boston" }, existing), {
    kind: "possible-duplicate", match: "company-title", ids: ["same-url", "other-location"],
  });
  assert.deepEqual(classifyDuplicate({ url: "https://jobs.example.com/c", company: "New", title: "Role", location: "Boston" }, existing), {
    kind: "new",
  });
});

test("batch queue exposes failures, continues, and only retries when requested", async () => {
  const calls = [];
  const queue = new BatchImportQueue(async (item) => {
    calls.push(item.id);
    if (item.payload.fail) throw new Error("fixture failure");
    return { imported: item.payload.name };
  });
  const [first, second] = queue.enqueueMany([{ name: "bad", fail: true }, { name: "good" }]);
  await queue.drain();
  assert.deepEqual(queue.get(first.id), { ...first, state: "failed", result: null, error: "fixture failure", attempts: 1 });
  assert.deepEqual(queue.get(second.id), { ...second, state: "succeeded", result: { imported: "good" }, error: null, attempts: 1 });
  assert.deepEqual(calls, [first.id, second.id]);
  assert.throws(() => queue.retry(second.id), /only failed/);
  queue.retry(first.id);
  queue.get(first.id).payload.fail = false;
  await queue.drain();
  assert.equal(queue.get(first.id).state, "succeeded");
  assert.equal(queue.get(first.id).attempts, 2);
});
