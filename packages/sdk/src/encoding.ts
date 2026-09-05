/**
 * Canonical Protobuf encoding for every osp type (spec section 2) and byte helpers.
 *
 * Object model used by the SDK for decoded/encodable messages:
 *  - `bytes` fields are `Uint8Array`, except fields annotated `(koinos.btype) = ADDRESS`
 *    which are Base58 strings (a `Uint8Array` is also accepted on input);
 *  - 64-bit integers are decimal strings (numbers and bigints are accepted on input);
 *  - enums are numbers (enum value names are accepted on input);
 *  - absent nested messages are `undefined`.
 *
 * Canonical rules: ascending field numbers (protobufjs writes fields in declaration order,
 * which the schemas keep ascending), default values omitted, no `map<>` fields.
 */
import protobuf from "protobufjs";
import { DESCRIPTORS } from "@osp/proto";
import { utils } from "koilib";

export type ProtoObject = Record<string, unknown>;

export class EncodingError extends Error {
  override name = "EncodingError";
}

let cachedRoot: protobuf.Root | undefined;

/** The protobufjs root containing every osp namespace (identity, ..., osp.envelope). */
export function getRoot(): protobuf.Root {
  if (!cachedRoot) {
    const nested: Record<string, unknown> = {};
    for (const descriptor of Object.values(DESCRIPTORS)) {
      Object.assign(nested, descriptor.nested);
    }
    const root = protobuf.Root.fromJSON({ nested } as protobuf.INamespace);
    root.resolveAll();
    cachedRoot = root;
  }
  return cachedRoot;
}

/** Look up a message type, e.g. `"osp.envelope.aad"` or `"publications.publish_arguments"`. */
export function lookupType(typeName: string): protobuf.Type {
  try {
    return getRoot().lookupType(typeName);
  } catch (error) {
    throw new EncodingError(`unknown type ${typeName}: ${(error as Error).message}`);
  }
}

/** Returns the `(koinos.btype)` annotation of a field, if any. */
export function fieldBtype(field: protobuf.Field): string | undefined {
  const options = field.options as Record<string, unknown> | undefined;
  const value = options?.["(koinos.btype)"] ?? options?.["(btype)"];
  return typeof value === "string" ? value : undefined;
}

function isAddressField(field: protobuf.Field): boolean {
  const btype = fieldBtype(field);
  return btype === "ADDRESS" || btype === "CONTRACT_ID";
}

const INT32_TYPES = new Set(["int32", "sint32", "sfixed32"]);
const UINT32_TYPES = new Set(["uint32", "fixed32"]);
const INT64_TYPES = new Set(["int64", "sint64", "sfixed64"]);
const UINT64_TYPES = new Set(["uint64", "fixed64"]);

/** Parses an integer given as number, bigint or decimal string (`label` names it in errors). */
export function toBigInt(value: unknown, path: string = "integer"): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new EncodingError(`${path}: expected an integer`);
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === "object" && value !== null && typeof (value as { toString: () => string }).toString === "function") {
    const text = (value as { toString: () => string }).toString();
    if (/^-?\d+$/.test(text)) return BigInt(text);
  }
  throw new EncodingError(`${path}: expected an integer (number, bigint or decimal string)`);
}

function normalizeScalar(field: protobuf.Field, raw: unknown, path: string, omitDefault: boolean): unknown {
  const resolved = field.resolvedType;
  if (resolved instanceof protobuf.Type) {
    if (typeof raw !== "object" || raw === null) throw new EncodingError(`${path}: expected an object`);
    return canonicalize(resolved, raw as ProtoObject, path);
  }
  if (resolved instanceof protobuf.Enum) {
    let n: number;
    if (typeof raw === "string") {
      const v = resolved.values[raw];
      if (v === undefined) throw new EncodingError(`${path}: unknown enum value ${raw}`);
      n = v;
    } else if (typeof raw === "number" && Number.isInteger(raw)) {
      n = raw;
    } else {
      throw new EncodingError(`${path}: expected an enum number or name`);
    }
    return omitDefault && n === 0 ? undefined : n;
  }
  switch (field.type) {
    case "bytes": {
      let bytes: Uint8Array;
      if (raw instanceof Uint8Array) {
        bytes = raw;
      } else if (typeof raw === "string") {
        const btype = fieldBtype(field);
        if (btype === "ADDRESS" || btype === "CONTRACT_ID" || btype === "BASE58") {
          bytes = raw === "" ? new Uint8Array(0) : fromBase58(raw);
        } else if (btype === "HEX" || btype === "BLOCK_ID" || btype === "TRANSACTION_ID") {
          bytes = raw === "" ? new Uint8Array(0) : fromHex(raw);
        } else {
          throw new EncodingError(`${path}: bytes must be a Uint8Array`);
        }
      } else {
        throw new EncodingError(`${path}: bytes must be a Uint8Array`);
      }
      return omitDefault && bytes.length === 0 ? undefined : bytes;
    }
    case "string":
      if (typeof raw !== "string") throw new EncodingError(`${path}: expected a string`);
      return omitDefault && raw === "" ? undefined : raw;
    case "bool":
      if (typeof raw !== "boolean") throw new EncodingError(`${path}: expected a boolean`);
      return omitDefault && !raw ? undefined : raw;
    case "double":
    case "float":
      if (typeof raw !== "number") throw new EncodingError(`${path}: expected a number`);
      return omitDefault && raw === 0 ? undefined : raw;
    default: {
      if (UINT32_TYPES.has(field.type) || INT32_TYPES.has(field.type)) {
        const n = toBigInt(raw, path);
        const [min, max] = UINT32_TYPES.has(field.type) ? [0n, 0xffffffffn] : [-0x80000000n, 0x7fffffffn];
        if (n < min || n > max) throw new EncodingError(`${path}: ${field.type} out of range`);
        return omitDefault && n === 0n ? undefined : Number(n);
      }
      if (UINT64_TYPES.has(field.type) || INT64_TYPES.has(field.type)) {
        const n = toBigInt(raw, path);
        const [min, max] = UINT64_TYPES.has(field.type)
          ? [0n, 0xffffffffffffffffn]
          : [-0x8000000000000000n, 0x7fffffffffffffffn];
        if (n < min || n > max) throw new EncodingError(`${path}: ${field.type} out of range`);
        return omitDefault && n === 0n ? undefined : n.toString();
      }
      throw new EncodingError(`${path}: unsupported field type ${field.type}`);
    }
  }
}

/**
 * Returns a plain object containing only non-default fields of `value` for `type`, with
 * every scalar normalized (bytes as Uint8Array, 64-bit integers as decimal strings, enums as
 * numbers). Unknown keys are ignored; map fields are rejected.
 */
export function canonicalize(type: protobuf.Type, value: ProtoObject, path: string = type.fullName): ProtoObject {
  const out: ProtoObject = {};
  for (const field of type.fieldsArray) {
    field.resolve();
    if (field.map) throw new EncodingError(`${path}.${field.name}: map fields are not allowed`);
    const raw = value[field.name];
    if (raw === undefined || raw === null) continue;
    const fieldPath = `${path}.${field.name}`;
    if (field.repeated) {
      if (!Array.isArray(raw)) throw new EncodingError(`${fieldPath}: expected an array`);
      if (raw.length === 0) continue;
      out[field.name] = raw.map((item, i) => normalizeScalar(field, item, `${fieldPath}[${i}]`, false));
    } else {
      const normalized = normalizeScalar(field, raw, fieldPath, true);
      if (normalized !== undefined) out[field.name] = normalized;
    }
  }
  return out;
}

/** Canonically encodes `value` as `typeName`. */
export function encode(typeName: string, value: ProtoObject): Uint8Array {
  const type = lookupType(typeName);
  const canonical = canonicalize(type, value);
  const message = type.fromObject(canonical);
  return new Uint8Array(type.encode(message).finish());
}

function normalizeDecoded(type: protobuf.Type, obj: ProtoObject): ProtoObject {
  for (const field of type.fieldsArray) {
    field.resolve();
    const raw = obj[field.name];
    const convert = (item: unknown): unknown => {
      if (field.resolvedType instanceof protobuf.Type) {
        if (item === null || item === undefined) return undefined;
        return normalizeDecoded(field.resolvedType, item as ProtoObject);
      }
      if (field.type === "bytes") {
        const bytes = item instanceof Uint8Array ? new Uint8Array(item) : new Uint8Array(0);
        return isAddressField(field) ? (bytes.length === 0 ? "" : toBase58(bytes)) : bytes;
      }
      return item;
    };
    if (field.repeated) {
      obj[field.name] = Array.isArray(raw) ? raw.map(convert) : [];
    } else {
      const converted = convert(raw);
      if (converted === undefined) delete obj[field.name];
      else obj[field.name] = converted;
    }
  }
  return obj;
}

/** Decodes `bytes` as `typeName` into the SDK object model (all scalar fields present). */
export function decode<T = ProtoObject>(typeName: string, bytes: Uint8Array | string): T {
  const type = lookupType(typeName);
  const buffer = typeof bytes === "string" ? fromBase64url(bytes) : bytes;
  let message: protobuf.Message;
  try {
    message = type.decode(buffer);
  } catch (error) {
    throw new EncodingError(`cannot decode ${typeName}: ${(error as Error).message}`);
  }
  const obj = type.toObject(message, { longs: String, enums: Number, defaults: true, arrays: true, objects: true });
  return normalizeDecoded(type, obj as ProtoObject) as T;
}

/**
 * Converts an SDK-model object into the JSON shape expected by koilib's serializer
 * (bytes as base64url strings, addresses as Base58, 64-bit integers as strings).
 */
export function toKoilibJson(typeName: string, value: ProtoObject): Record<string, unknown> {
  const type = lookupType(typeName);
  const walk = (t: protobuf.Type, obj: ProtoObject): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const field of t.fieldsArray) {
      const raw = obj[field.name];
      if (raw === undefined) continue;
      const convert = (item: unknown): unknown => {
        if (field.resolvedType instanceof protobuf.Type) return walk(field.resolvedType, item as ProtoObject);
        if (field.type === "bytes") {
          const bytes = item as Uint8Array;
          return isAddressField(field) ? toBase58(bytes) : toBase64url(bytes);
        }
        return item;
      };
      out[field.name] = field.repeated ? (raw as unknown[]).map(convert) : convert(raw);
    }
    return out;
  };
  return walk(type, canonicalize(type, value));
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** UTF-8 encodes a string. */
export function utf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

/** UTF-8 decodes bytes. */
export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/** Concatenates byte arrays. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Big-endian unsigned 32-bit integer. */
export function u32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new EncodingError(`u32be: ${value} is not an unsigned 32-bit integer`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

/** Big-endian unsigned 64-bit integer. */
export function u64be(value: number | bigint | string): Uint8Array {
  const n = toBigInt(value, "u64be");
  if (n < 0n || n > 0xffffffffffffffffn) throw new EncodingError(`u64be: ${value} is not an unsigned 64-bit integer`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, false);
  return out;
}

/** Constant-time-ish byte equality (length leaks; fine for public data). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export function toHex(bytes: Uint8Array): string {
  return utils.toHexString(bytes);
}

/** Decodes hex (with or without `0x` prefix). */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new EncodingError("invalid hex string");
  return utils.toUint8Array(clean);
}

/** Base64url (koilib-compatible, padded). */
export function toBase64url(bytes: Uint8Array): string {
  return utils.encodeBase64url(bytes);
}

export function fromBase64url(text: string): Uint8Array {
  return new Uint8Array(utils.decodeBase64url(text));
}

/** Base58 (Koinos addresses). */
export function toBase58(bytes: Uint8Array): string {
  return utils.encodeBase58(bytes);
}

export function fromBase58(text: string): Uint8Array {
  return new Uint8Array(utils.decodeBase58(text));
}

/** True when the value is a byte array. */
export function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/** Copies any array-like / ArrayBuffer into a plain Uint8Array. */
export function asBytes(value: Uint8Array | ArrayBuffer | ArrayLike<number>): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return Uint8Array.from(value);
}

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, `undefined` members dropped.
 * Used for signed discovery documents (docs/sponsor-api.md) and vault headers.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}
