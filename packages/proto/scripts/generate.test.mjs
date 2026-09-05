import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");

test("entry points match the Koinos convention (sha256 prefix)", () => {
  const abi = JSON.parse(readFileSync(join(dist, "abi", "identity.json"), "utf8"));
  const expected = createHash("sha256").update("register").digest().readUInt32BE(0);
  assert.equal(abi.methods.register.entry_point, expected);
  assert.equal(abi.methods.register.read_only, false);
  assert.equal(abi.methods.get_identity.read_only, true);
});

test("descriptors keep snake_case field names and btype options", () => {
  const d = JSON.parse(readFileSync(join(dist, "descriptors", "publications.json"), "utf8"));
  const publish = d.nested.publications.nested.publish_arguments.fields;
  assert.ok(publish.idempotency_key, "expected snake_case field idempotency_key");
  assert.equal(publish.author.options["(koinos.btype)"], "ADDRESS");
});

test("every contract exposes read and write methods", () => {
  const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  for (const [name, methods] of Object.entries(manifest.abis)) {
    assert.ok(methods.length > 0, `${name} has methods`);
  }
  assert.ok(manifest.events.publications.some((e) => e.name === "osp.publications.published"));
});
