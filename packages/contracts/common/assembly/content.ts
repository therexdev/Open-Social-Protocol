// Hosted body reference v1. Shared with packages/sdk/src/contentStorage.ts.
// References commit to the original bytes, including ciphertext, and their size.
import { System, Crypto } from "@koinos/sdk-as";

export namespace ContentReference {
  export function isReference(bytes: Uint8Array): bool {
    return bytes.length >= 8 && bytes[0] == 79 && bytes[1] == 83 && bytes[2] == 80 && bytes[3] == 82 && bytes[4] == 69 && bytes[5] == 70 && bytes[6] == 49 && bytes[7] == 0;
  }
  export function size(bytes: Uint8Array, max: u32): u32 {
    let length = <u32>bytes.length;
    if (isReference(bytes)) {
      System.require(bytes.length == 44, "invalid hosted content reference");
      length = (<u32>bytes[8] << 24) | (<u32>bytes[9] << 16) | (<u32>bytes[10] << 8) | <u32>bytes[11];
    }
    System.require(length > 0 && length <= max, "invalid hosted content size");
    return length;
  }
  export function hash(bytes: Uint8Array, max: u32): Uint8Array {
    size(bytes, max);
    return isReference(bytes) ? bytes.slice(12) : System.hash(Crypto.multicodec.sha2_256, bytes)!.slice(2);
  }
  export function text(value: string, max: u32 = 16384): bool {
    if (!value.startsWith("osp:content:v1:")) return false;
    const parts = value.split(":");
    System.require(parts.length == 5 && parts[3].length > 0 && parts[3].length <= 5 && parts[4].length == 64, "invalid hosted text reference");
    let length: u32 = 0;
    for (let i = 0; i < parts[3].length; i++) {
      const c = parts[3].charCodeAt(i);
      System.require(c >= 48 && c <= 57 && (i > 0 || c != 48), "invalid hosted text size");
      length = length * 10 + <u32>(c - 48);
    }
    System.require(length > 0 && length <= max, "invalid hosted text size");
    for (let i = 0; i < 64; i++) {
      const c = parts[4].charCodeAt(i);
      System.require((c >= 48 && c <= 57) || (c >= 97 && c <= 102), "invalid hosted text digest");
    }
    return true;
  }
}
