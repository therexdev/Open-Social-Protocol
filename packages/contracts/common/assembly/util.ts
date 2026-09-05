// Shared small helpers for OSP contracts (copied into assembly/common/ by scripts/build.mjs).
import { System, StringBytes } from "@koinos/sdk-as";

export namespace Util {
  /** Current head block time in milliseconds. */
  export function now(): u64 {
    return System.getHeadInfo().head_block_time;
  }

  /** Concatenate byte arrays. */
  export function concat(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (let i = 0; i < parts.length; i++) total += parts[i].length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], offset);
      offset += parts[i].length;
    }
    return out;
  }

  /** Big-endian u32. */
  export function u32be(v: u32): Uint8Array {
    const out = new Uint8Array(4);
    out[0] = <u8>((v >> 24) & 0xff);
    out[1] = <u8>((v >> 16) & 0xff);
    out[2] = <u8>((v >> 8) & 0xff);
    out[3] = <u8>(v & 0xff);
    return out;
  }

  /** Big-endian u64. */
  export function u64be(v: u64): Uint8Array {
    const out = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      out[i] = <u8>(v & 0xff);
      v = v >> 8;
    }
    return out;
  }

  /** Bytes of an ASCII/UTF-8 string. */
  export function str(s: string): Uint8Array {
    return StringBytes.stringToBytes(s);
  }

  /** Lexicographic byte comparison: -1, 0, 1. */
  export function compare(a: Uint8Array, b: Uint8Array): i32 {
    const n = a.length < b.length ? a.length : b.length;
    for (let i = 0; i < n; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;
    return 0;
  }

  /** Empty-or-null check for optional bytes fields. */
  export function isEmpty(v: Uint8Array | null): bool {
    return v == null || v!.length == 0;
  }

  /** Require a bytes field to be non-empty and at most `max` bytes. */
  export function requireBytes(v: Uint8Array | null, max: i32, what: string): Uint8Array {
    System.require(!isEmpty(v), what + " is required");
    System.require(v!.length <= max, what + " too large");
    return v!;
  }

  /** Require an address-like field (25 bytes Koinos address). */
  export function requireAddress(v: Uint8Array | null, what: string): Uint8Array {
    System.require(!isEmpty(v), what + " is required");
    System.require(v!.length == 25, what + " must be a 25-byte address");
    return v!;
  }

  /** Require a string to be at most `max` characters (may be empty). */
  export function requireString(v: string | null, max: i32, what: string): string {
    if (v == null) return "";
    System.require(v!.length <= max, what + " too long");
    return v!;
  }
}
