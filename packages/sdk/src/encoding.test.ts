import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import { canonicalJson, canonicalize, concat, decode, encode, fromBase64url, fromHex, lookupType, toBase64url, toHex, toKoilibJson, u32be, u64be } from "./encoding.js";

describe("encoding", () => {
  it("omits default values and keeps ascending field order", () => {
    const zero = encode("osp.envelope.aad", { protocol_version: 0, chain_id: new Uint8Array(0), epoch: 0, audience: 0 });
    expect(zero.length).toBe(0);
    const bytes = encode("osp.envelope.aad", { protocol_version: 1, epoch: 3, audience: 1 });
    expect(toHex(bytes)).toBe("080128013803"); // tags: field 1 (0x08), field 5 (0x28), field 7 (0x38)
  });

  it("round-trips the object model (bytes, addresses, u64 strings, enums)", () => {
    const author = Signer.fromSeed("x").getAddress();
    const args = {
      author,
      post_id: new Uint8Array([1, 2, 3]),
      sequence: 12345678901234567890n,
      audience: 2,
      epoch: 4,
      media: [{ content_hash: new Uint8Array([9]), size: "42", locations: ["ipfs://a", ""] }],
    };
    const decoded = decode<Record<string, unknown>>("publications.publish_arguments", encode("publications.publish_arguments", args));
    expect(decoded.author).toBe(author);
    expect(decoded.device).toBe("");
    expect(decoded.post_id).toEqual(new Uint8Array([1, 2, 3]));
    expect(decoded.sequence).toBe("12345678901234567890");
    expect(decoded.audience).toBe(2);
    expect(decoded.envelope).toEqual(new Uint8Array(0));
    expect((decoded.media as Array<Record<string, unknown>>)[0]).toEqual({
      content_hash: new Uint8Array([9]),
      mime: "",
      size: "42",
      locations: ["ipfs://a", ""],
      key_ref: new Uint8Array(0),
    });
    // decode -> encode is stable
    expect(encode("publications.publish_arguments", decoded)).toEqual(encode("publications.publish_arguments", args));
  });

  it("accepts enum names and rejects wrong scalar types", () => {
    expect(encode("osp.envelope.envelope", { suite: "xchacha20poly1305_x25519" })).toEqual(encode("osp.envelope.envelope", { suite: 1 }));
    expect(() => encode("osp.envelope.envelope", { payload: "not bytes" })).toThrow(/Uint8Array/);
    expect(() => encode("osp.envelope.aad", { epoch: -1 })).toThrow(/out of range/);
    expect(() => encode("osp.envelope.aad", { epoch: 1.5 })).toThrow();
    expect(() => lookupType("osp.nope")).toThrow(/unknown type/);
  });

  it("nested messages present but empty are kept, absent ones dropped", () => {
    const withAvatar = encode("osp.envelope.profile", { version: 1, avatar: {} });
    const without = encode("osp.envelope.profile", { version: 1 });
    expect(withAvatar.length).toBe(without.length + 2);
    const decoded = decode<Record<string, unknown>>("osp.envelope.profile", without);
    expect("avatar" in decoded).toBe(false);
    expect(decoded.links).toEqual([]);
  });

  it("converts to koilib json", () => {
    const author = Signer.fromSeed("x").getAddress();
    const json = toKoilibJson("publications.publish_arguments", { author, post_id: new Uint8Array([1, 2]), sequence: 5 });
    expect(json).toEqual({ author, post_id: toBase64url(new Uint8Array([1, 2])), sequence: "5" });
  });

  it("byte helpers", () => {
    expect(toHex(u32be(0x01020304))).toBe("01020304");
    expect(toHex(u64be(1))).toBe("0000000000000001");
    expect(toHex(u64be("18446744073709551615"))).toBe("ffffffffffffffff");
    expect(() => u64be(-1)).toThrow();
    expect(() => u32be(2 ** 32)).toThrow();
    expect(concat(new Uint8Array([1]), new Uint8Array([2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(fromHex("0x0aff")).toEqual(new Uint8Array([10, 255]));
    expect(fromBase64url(toBase64url(new Uint8Array([250, 251, 252])))).toEqual(new Uint8Array([250, 251, 252]));
    expect(canonicalJson({ b: 1, a: [{ z: 1, y: undefined }], c: "x" })).toBe('{"a":[{"z":1}],"b":1,"c":"x"}');
    const type = lookupType("osp.envelope.content");
    expect(canonicalize(type, { text: "", version: 0, lang: "en" })).toEqual({ lang: "en" });
  });
});
