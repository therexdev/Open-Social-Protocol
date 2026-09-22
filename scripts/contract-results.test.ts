import test from "node:test";
import assert from "node:assert/strict";
import { contractTestsPassed } from "../packages/contracts/scripts/test-result.mjs";
test("contract gate rejects failures even when as-pect exits zero", () => {
  assert.equal(contractTestsPassed(0, "[Tests]: 76 / 78\n[Result]: ❌ Fail"), false);
  assert.equal(contractTestsPassed(0, "[Tests]: 0 / 0\n[Result]: ✔ Pass!"), false);
  assert.equal(contractTestsPassed(1, "[Tests]: 8 / 8\n[Result]: ✔ Pass!"), false);
  assert.equal(contractTestsPassed(0, "[Tests]: 8 / 8\n[Result]: ✔ Pass!\n[Tests]: 0 / 1\n[Result]: ❌ Fail"), false);
  assert.equal(contractTestsPassed(0, "[Tests]: 8 / 8\n[Result]: ✔ Pass!"), true);
});
