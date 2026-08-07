import assert from "node:assert/strict";
import test from "node:test";
import { captureAllowed, localOrigin } from "../src/server.js";

test("local capture and dashboard origin boundaries are explicit", () => {
  assert.equal(captureAllowed("chrome-extension://abc", "wrong", "secret"), true);
  assert.equal(captureAllowed("https://example.com", "secret", "secret"), true);
  assert.equal(captureAllowed("https://example.com", "wrong", "secret"), false);
  assert.equal(localOrigin(undefined, 8787), true);
  assert.equal(localOrigin("http://127.0.0.1:8787", 8787), true);
  assert.equal(localOrigin("http://localhost:8787", 8787), true);
  assert.equal(localOrigin("https://example.com", 8787), false);
});
