import assert from "node:assert/strict";
import test from "node:test";
import { authorizeHeader, tokenOk, UNAUTHORIZED_ERROR } from "../src/auth.js";

test("cloud authorization returns 401 before any database or job access", () => {
  assert.equal(tokenOk("secret", "secret"), true);
  assert.equal(tokenOk("wrong", "secret"), false);
  assert.deepEqual(authorizeHeader(undefined, "secret"), {
    ok: false, status: 401, error: UNAUTHORIZED_ERROR,
  });
  assert.deepEqual(authorizeHeader("Basic abc", "secret"), {
    ok: false, status: 401, error: UNAUTHORIZED_ERROR,
  });
  assert.deepEqual(authorizeHeader("Bearer wrong", "secret"), {
    ok: false, status: 401, error: UNAUTHORIZED_ERROR,
  });
  assert.deepEqual(authorizeHeader("Bearer secret", "secret"), { ok: true });
});
