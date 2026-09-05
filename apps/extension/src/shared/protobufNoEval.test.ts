import { describe, expect, it } from "vitest";
import protobuf from "protobufjs";
import { DESCRIPTORS } from "@osp/proto";
import { canonicalize, encode, identityFromSeed, toKoilibJson, Serializer, buildProofManifest, encodeProofManifest } from "@osp/sdk";
import { deterministicRng } from "../../../../packages/sdk/src/testing/fixtures";
import { originalProtobuf } from "./protobufNoEval";

const rng = deterministicRng("protobuf-parity");
const me = identityFromSeed(rng(32));

/** A root whose types use the original generated code (reference), independent of the installed runtime. */
function referenceRoot(): protobuf.Root {
  const nested: Record<string, unknown> = {};
  for (const descriptor of Object.values(DESCRIPTORS)) Object.assign(nested, descriptor.nested);
  const root = protobuf.Root.fromJSON({ nested } as protobuf.INamespace);
  root.resolveAll();
  return root;
}

function referenceType(root: protobuf.Root, name: string): protobuf.Type {
  const type = root.lookupType(name);
  // generated constructor + generated encoder/decoder/converters
  type.ctor = (originalProtobuf.generateConstructor(type) as unknown as () => protobuf.Constructor<object>)();
  originalProtobuf.setup.call(type);
  return type;
}

function interpretedRoot(): protobuf.Root {
  return referenceRoot(); // the installed runtime (setup.ts) makes every new type interpreted
}

const samples: Array<[string, Record<string, unknown>]> = [
  [
    "publications.publish_arguments",
    { author: me.account, post_id: rng(32), sequence: "7", audience: 1, epoch: 3, envelope: rng(90), content_hash: rng(32), idempotency_key: rng(16), device: me.account, media: [{ content_hash: rng(32), mime: "image/png", size: "12345", locations: ["ipfs://a", "https://b"] }] },
  ],
  ["osp.envelope.aad", { protocol_version: 1, chain_id: rng(34), author: me.account, audience: 2, audience_id: rng(16), epoch: 4294967295, version_number: 2 }],
  ["identity.authorize_device_arguments", { account: me.account, device: me.account, capabilities: 15, expires_at: "1893456000000", label: "Chrome extension" }],
  ["publications.published_event", { author: me.account, post_id: rng(32), content_hash: rng(32), version_number: 1, sequence: "18446744073709551615", audience: 0, epoch: 0, envelope: rng(10), idempotency_key: rng(16), protocol_version: 1, timestamp: "1700000000000" }],
  ["relationships.get_audience_result", { value: { epoch: 9, updated_at: "1" } }],
  ["identity.get_identity_result", {}],
];

describe("protobuf runtime without code generation", () => {
  it("encodes byte-for-byte like the generated encoders", () => {
    const ref = referenceRoot();
    const interp = interpretedRoot();
    for (const [name, value] of samples) {
      const refType = referenceType(ref, name);
      const intType = interp.lookupType(name);
      const canonical = canonicalize(intType, value);
      const expected = new Uint8Array(refType.encode(refType.fromObject(canonical)).finish());
      const actual = new Uint8Array(intType.encode(intType.fromObject(canonical)).finish());
      expect(Buffer.from(actual).toString("hex"), name).toBe(Buffer.from(expected).toString("hex"));
      // the SDK's own encode (already interpreted through setup.ts) agrees too
      expect(Buffer.from(encode(name, value)).toString("hex"), `sdk ${name}`).toBe(Buffer.from(expected).toString("hex"));
    }
  });

  it("decodes and converts like the generated code", () => {
    const ref = referenceRoot();
    const interp = interpretedRoot();
    const options = { longs: String, enums: Number, defaults: true, arrays: true, objects: true };
    for (const [name, value] of samples) {
      const refType = referenceType(ref, name);
      const intType = interp.lookupType(name);
      const bytes = encode(name, value);
      const expected = refType.toObject(refType.decode(bytes), options);
      const actual = intType.toObject(intType.decode(bytes), options);
      expect(JSON.stringify(actual), name).toBe(JSON.stringify(expected));
      expect(intType.verify(intType.fromObject(canonicalize(intType, value)))).toBeNull();
    }
  });

  it("rejects truncated input like the generated decoder", () => {
    const interp = interpretedRoot();
    const type = interp.lookupType("publications.publish_arguments");
    const bytes = encode("publications.publish_arguments", samples[0]![1]);
    expect(() => type.decode(bytes.subarray(0, bytes.length - 5))).toThrow(RangeError);
  });

  it("serves koilib's serializer and the manifest encoder", async () => {
    const serializer = new Serializer({ nested: { koinos: { nested: { chain: { nested: { value_type: { fields: { uint64_value: { type: "uint64", id: 4, options: { jstype: "JS_STRING" } } } } } } } } } });
    const encoded = await serializer.serialize({ uint64_value: "42" }, "koinos.chain.value_type");
    expect(Buffer.from(encoded).toString("hex")).toBe("202a");
    const decoded = await serializer.deserialize(encoded, "koinos.chain.value_type");
    expect(decoded.uint64_value).toBe("42");
    const manifest = buildProofManifest({ author: me.account, post_id: rng(32), content_hash: rng(32), version_number: 1, transaction_id: "0x1220" + "ab".repeat(32), block_height: 5, audience: 0, adapter: "facebook", outcome: 0, idempotency_key: rng(16), created_at: 1 });
    expect(encodeProofManifest(manifest).length).toBeGreaterThan(100);
    expect(toKoilibJson("identity.authorize_device_arguments", { account: me.account, device: me.account, capabilities: 15, expires_at: 5 })).toMatchObject({ account: me.account, capabilities: 15, expires_at: "5" });
  });
});
