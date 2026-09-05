/**
 * protobufjs without code generation.
 *
 * protobufjs (used by @osp/sdk for canonical encoding and by koilib for transactions) builds
 * every encoder, decoder and converter at runtime with `Function(...)` (@protobufjs/codegen).
 * A Manifest V3 service worker runs under `script-src 'self'` and cannot relax to
 * `'unsafe-eval'`, so the first `encode()` would throw an EvalError. This module replaces
 * `Type.prototype.setup` (and the generated message constructor) with reflection-driven
 * implementations that follow the generated code line by line, so bytes are identical
 * (src/shared/protobufNoEval.test.ts proves byte parity against the generated code).
 *
 * Install it before anything encodes: `installNoEvalProtobuf()` is the first statement of the
 * service worker. It is safe to call in Node too (tests) and is idempotent.
 */
import protobuf from "protobufjs";

type AnyRecord = Record<string, unknown>;
type Reader = protobuf.Reader;
type Writer = protobuf.Writer;
type Field = protobuf.Field;
type MessageType = protobuf.Type;

const { Type, Enum, Reader: ReaderClass, Writer: WriterClass, util, types } = protobuf;

const basic = types.basic as unknown as Record<string, number | undefined>;
const packed = types.packed as unknown as Record<string, number | undefined>;
const mapKey = types.mapKey as unknown as Record<string, number | undefined>;
const long = types.long as unknown as Record<string, number | undefined>;

interface Utils {
  Long: (LongCtor & { fromValue(v: unknown, unsigned?: boolean): LongLike; fromBits(l: number, h: number, u?: boolean): LongLike; prototype: { toString(): string } }) | null;
  LongBits: new (lo: number, hi: number) => { toNumber(unsigned?: boolean): number };
  base64: { decode(s: string, buf: Uint8Array, offset: number): number; encode(buf: Uint8Array, start: number, end: number): string; length(s: string): number };
  newBuffer(size: number | number[]): Uint8Array;
  isObject(v: unknown): boolean;
  compareFieldsById(a: Field, b: Field): number;
  recursionLimit: number;
  makeProp?(obj: AnyRecord, key: string): void;
  ProtocolError: new (message: string, props?: AnyRecord) => Error;
}
interface LongLike {
  low: number;
  high: number;
  unsigned: boolean;
  toString(): string;
  toNumber(): number;
  toBigInt?(): bigint;
}
type LongCtor = new (low: number, high: number, unsigned?: boolean) => LongLike;

const u = util as unknown as Utils;

interface ExtField extends Field {
  keyType: string;
}
interface ExtType extends MessageType {
  _ctor?: new (properties?: AnyRecord) => AnyRecord;
  _fieldsArray: Field[];
}

let installed = false;
const original = {
  setup: Type.prototype.setup,
  generateConstructor: Type.generateConstructor,
};

/** True when the current context can run generated code (false under an MV3 CSP). */
export function canEval(): boolean {
  try {
    // eslint-disable-next-line no-new-func
    return Function("return 1")() === 1;
  } catch {
    return false;
  }
}

/**
 * Replaces protobufjs code generation with interpreted equivalents. Idempotent.
 *
 * Two hooks cover every code path that would otherwise call `Function(...)`:
 *  - `Type.prototype.setup` builds encode/decode/verify/fromObject/toObject (encoder.js,
 *    decoder.js, verifier.js, converter.js all use codegen);
 *  - `Type.generateConstructor` builds the message constructor. The `Type#ctor` accessor is
 *    defined non-configurable by protobufjs, so it cannot be redefined; it does not need to be,
 *    because its getter delegates to `Type.generateConstructor(this)()` and its setter only
 *    wires the prototype/static helpers (no code generation).
 */
export function installNoEvalProtobuf(): void {
  if (installed) return;
  installed = true;
  Type.prototype.setup = function setup(this: MessageType) {
    return interpretedSetup(this as ExtType);
  };
  Type.generateConstructor = ((mtype: MessageType) => () => plainConstructor(mtype as ExtType)) as unknown as typeof Type.generateConstructor;
}

/** Restores the generated-code behaviour (tests only). Types already set up keep their functions. */
export function uninstallNoEvalProtobuf(): void {
  if (!installed) return;
  installed = false;
  Type.prototype.setup = original.setup;
  Type.generateConstructor = original.generateConstructor;
}

/** True once `installNoEvalProtobuf()` has run. */
export function isNoEvalProtobufInstalled(): boolean {
  return installed;
}

type Codegen = (...args: unknown[]) => unknown;
const utilWithCodegen = util as unknown as { codegen: Codegen };
const originalCodegen = utilWithCodegen.codegen;
let codegenForbidden = false;

/**
 * Test aid: makes every remaining protobufjs code-generation path throw, so a test suite run
 * with the interpreted runtime proves that no `Function(...)` call is ever needed (the exact
 * situation of the MV3 service worker). Returns a function that lifts the ban.
 */
export function forbidProtobufCodegen(): () => void {
  codegenForbidden = true;
  utilWithCodegen.codegen = function forbidden() {
    throw new Error("protobufjs tried to generate code after installNoEvalProtobuf(); this would throw under the MV3 CSP");
  };
  return () => {
    codegenForbidden = false;
    utilWithCodegen.codegen = originalCodegen;
  };
}

/** Runs `fn` with the original code generator available (reference encoders in tests). */
export function withProtobufCodegen<T>(fn: () => T): T {
  const wasForbidden = codegenForbidden;
  utilWithCodegen.codegen = originalCodegen;
  try {
    return fn();
  } finally {
    if (wasForbidden) forbidProtobufCodegen();
  }
}

export const originalProtobuf = original;

// ---------------------------------------------------------------------------
// Constructor (Type.generateConstructor)
// ---------------------------------------------------------------------------

function plainConstructor(mtype: ExtType): new (properties?: AnyRecord) => AnyRecord {
  const fields = mtype.fieldsArray;
  function GeneratedMessage(this: AnyRecord, properties?: AnyRecord) {
    for (const field of fields) {
      if (field.map) this[field.name] = {};
      else if (field.repeated) this[field.name] = [];
    }
    if (properties) {
      for (const key of Object.keys(properties)) {
        if (properties[key] != null) this[key] = properties[key];
      }
    }
  }
  Object.defineProperty(GeneratedMessage, "name", { value: mtype.name });
  return GeneratedMessage as unknown as new (properties?: AnyRecord) => AnyRecord;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

function interpretedSetup(mtype: ExtType): MessageType {
  for (const field of mtype.fieldsArray) field.resolve();
  const target = mtype as unknown as AnyRecord;
  target.encode = (message: AnyRecord, writer?: Writer, depth?: number) => encodeMessage(mtype, message, writer, depth);
  target.decode = (reader: Reader | Uint8Array, length?: number, end?: number, depth?: number) => decodeMessage(mtype, reader, length, end, depth);
  target.verify = (message: AnyRecord) => verifyMessage(mtype, message);
  target.fromObject = (object: AnyRecord, depth?: number) => fromObject(mtype, object, depth);
  target.toObject = (message: AnyRecord, options?: protobuf.IConversionOptions, depth?: number) => toObject(mtype, message, options, depth);
  const wrapper = (protobuf.wrappers as Record<string, protobuf.IWrapper | undefined>)[mtype.fullName];
  if (wrapper) {
    const originalThis = Object.create(mtype) as AnyRecord;
    originalThis.fromObject = target.fromObject;
    if (wrapper.fromObject) target.fromObject = wrapper.fromObject.bind(originalThis as unknown as MessageType);
    originalThis.toObject = target.toObject;
    if (wrapper.toObject) target.toObject = wrapper.toObject.bind(originalThis as unknown as MessageType);
  }
  return mtype;
}

function scalarType(field: Field): string {
  return field.resolvedType instanceof Enum ? "int32" : field.type;
}

function sortedFields(mtype: MessageType): ExtField[] {
  return mtype.fieldsArray.slice().sort(u.compareFieldsById) as ExtField[];
}

// ---------------------------------------------------------------------------
// encoder
// ---------------------------------------------------------------------------

function writeScalar(w: Writer, type: string, value: unknown): void {
  (w as unknown as Record<string, (v: unknown) => Writer>)[type]!(value);
}

function encodePartial(field: ExtField, value: unknown, w: Writer, depth: number): void {
  const nested = field.resolvedType as ExtType;
  if (field.delimited) {
    encodeMessage(nested, value as AnyRecord, w.uint32(((field.id << 3) | 3) >>> 0), depth + 1).uint32(((field.id << 3) | 4) >>> 0);
  } else {
    encodeMessage(nested, value as AnyRecord, w.uint32(((field.id << 3) | 2) >>> 0).fork(), depth + 1).ldelim();
  }
}

function encodeMessage(mtype: ExtType, m: AnyRecord, w?: Writer, depth = 0): Writer {
  if (!w) w = WriterClass.create();
  if (depth > u.recursionLimit) throw Error("max depth exceeded");
  for (const field of sortedFields(mtype)) {
    field.resolve();
    const type = scalarType(field);
    const wireType = basic[type];
    const value = m[field.name];
    if (field.map) {
      if (value != null && Object.prototype.hasOwnProperty.call(m, field.name)) {
        const map = value as AnyRecord;
        for (const key of Object.keys(map)) {
          w.uint32(((field.id << 3) | 2) >>> 0)
            .fork()
            .uint32(8 | (mapKey[field.keyType] as number));
          writeScalar(w, field.keyType, key);
          if (wireType === undefined) {
            encodeMessage(field.resolvedType as ExtType, map[key] as AnyRecord, w.uint32(18).fork(), depth + 1).ldelim().ldelim();
          } else {
            w.uint32(16 | wireType);
            writeScalar(w, type, map[key]);
            w.ldelim();
          }
        }
      }
    } else if (field.repeated) {
      const list = value as unknown[] | undefined;
      if (list != null && list.length) {
        if (field.packed && packed[type] !== undefined) {
          w.uint32(((field.id << 3) | 2) >>> 0).fork();
          for (const item of list) writeScalar(w, type, item);
          w.ldelim();
        } else {
          for (const item of list) {
            if (wireType === undefined) encodePartial(field, item, w, depth);
            else {
              w.uint32(((field.id << 3) | wireType) >>> 0);
              writeScalar(w, type, item);
            }
          }
        }
      }
    } else {
      if (field.optional && !(value != null && Object.prototype.hasOwnProperty.call(m, field.name))) continue;
      if (wireType === undefined) encodePartial(field, value, w, depth);
      else {
        w.uint32(((field.id << 3) | wireType) >>> 0);
        writeScalar(w, type, value);
      }
    }
  }
  return w;
}

// ---------------------------------------------------------------------------
// decoder
// ---------------------------------------------------------------------------

function readScalar(r: Reader, type: string): unknown {
  return (r as unknown as Record<string, () => unknown>)[type]!();
}

function decodePartial(field: ExtField, r: Reader, tag: number, depth: number): AnyRecord {
  const nested = field.resolvedType as ExtType;
  return field.delimited ? decodeMessage(nested, r, undefined, (tag & ~7) | 4, depth + 1) : decodeMessage(nested, r, r.uint32(), undefined, depth + 1);
}

function fieldsById(mtype: ExtType): Map<number, ExtField> {
  const map = new Map<number, ExtField>();
  for (const field of mtype.fieldsArray) map.set(field.id, field.resolve() as ExtField);
  return map;
}

function decodeMessage(mtype: ExtType, input: Reader | Uint8Array, l?: number, e?: number, depth = 0): AnyRecord {
  const r = input instanceof ReaderClass ? input : ReaderClass.create(input as Uint8Array);
  if (depth > ReaderClass.recursionLimit) throw Error("maximum nesting depth exceeded");
  let c: number;
  if (l === undefined) c = r.len;
  else {
    c = r.pos + l;
    if (c > r.len) throw RangeError("index out of range");
    l = r.len;
    r.len = c;
  }
  const m = new mtype.ctor() as AnyRecord;
  const byId = fieldsById(mtype);
  while (r.pos < c) {
    const t = r.uint32();
    if (t === e) break;
    const field = byId.get(t >>> 3);
    if (!field) {
      r.skipType(t & 7, depth);
      continue;
    }
    const type = scalarType(field);
    if (field.map) {
      if (m[field.name] === undefined || m[field.name] === (util as unknown as { emptyObject: unknown }).emptyObject) m[field.name] = {};
      const c2 = r.uint32() + r.pos;
      if (c2 > r.len) throw RangeError("index out of range");
      r.len = c2;
      let k: unknown = (types.defaults as unknown as Record<string, unknown>)[field.keyType] ?? null;
      let value: unknown = (types.defaults as unknown as Record<string, unknown>)[type] ?? null;
      while (r.pos < c2) {
        const tag2 = r.uint32();
        switch (tag2 >>> 3) {
          case 1:
            k = readScalar(r, field.keyType);
            break;
          case 2:
            value = basic[type] === undefined ? decodeMessage(field.resolvedType as ExtType, r, r.uint32(), undefined, depth + 1) : readScalar(r, type);
            break;
          default:
            r.skipType(tag2 & 7, depth);
            break;
        }
      }
      if (r.pos !== c2) throw RangeError("index out of range");
      r.len = c;
      const target = m[field.name] as AnyRecord;
      const key = long[field.keyType] !== undefined && typeof k === "object" ? (util as unknown as { longToHash(v: unknown): string }).longToHash(k) : (k as string);
      if (key === "__proto__" && u.makeProp) u.makeProp(target, key);
      target[key] = value;
    } else if (field.repeated) {
      const existing = m[field.name] as unknown[] | undefined;
      if (!(existing && existing.length)) m[field.name] = [];
      const list = m[field.name] as unknown[];
      if (packed[type] !== undefined && (t & 7) === 2) {
        const c2 = r.uint32() + r.pos;
        if (c2 > r.len) throw RangeError("index out of range");
        r.len = c2;
        while (r.pos < c2) list.push(readScalar(r, type));
        if (r.pos !== c2) throw RangeError("index out of range");
        r.len = c;
      } else if (basic[type] === undefined) list.push(decodePartial(field, r, t, depth));
      else list.push(readScalar(r, type));
    } else if (basic[type] === undefined) m[field.name] = decodePartial(field, r, t, depth);
    else m[field.name] = readScalar(r, type);
  }
  if (l !== undefined) {
    if (r.pos !== c) throw RangeError("index out of range");
    r.len = l;
  }
  for (const rfield of mtype._fieldsArray) {
    if (rfield.required && !Object.prototype.hasOwnProperty.call(m, rfield.name)) {
      throw new u.ProtocolError(`missing required '${rfield.name}'`, { instance: m });
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// verifier (lenient but faithful to the generated checks for the types the protocol uses)
// ---------------------------------------------------------------------------

function isInteger(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v);
}
function isLongLike(v: unknown): boolean {
  return (
    isInteger(v) ||
    (typeof v === "object" && v !== null && typeof (v as LongLike).low === "number" && typeof (v as LongLike).high === "number")
  );
}

function verifyScalar(field: Field, value: unknown): string | null {
  const type = scalarType(field);
  const path = field.name;
  if (field.resolvedType instanceof Type) return verifyMessage(field.resolvedType as ExtType, value as AnyRecord);
  if (field.resolvedType instanceof Enum) {
    if (!isInteger(value) || !(value as number in field.resolvedType.valuesById)) return `${path}: enum value expected`;
    return null;
  }
  switch (type) {
    case "int32":
    case "uint32":
    case "sint32":
    case "fixed32":
    case "sfixed32":
      return isInteger(value) ? null : `${path}: integer expected`;
    case "int64":
    case "uint64":
    case "sint64":
    case "fixed64":
    case "sfixed64":
      return isLongLike(value) ? null : `${path}: integer|Long expected`;
    case "float":
    case "double":
      return typeof value === "number" ? null : `${path}: number expected`;
    case "bool":
      return typeof value === "boolean" ? null : `${path}: boolean expected`;
    case "string":
      return typeof value === "string" ? null : `${path}: string expected`;
    case "bytes":
      return (value instanceof Uint8Array || typeof value === "string") ? null : `${path}: buffer expected`;
    default:
      return null;
  }
}

function verifyMessage(mtype: ExtType, m: AnyRecord): string | null {
  if (typeof m !== "object" || m === null) return "object expected";
  for (const field of mtype.fieldsArray) {
    field.resolve();
    const value = m[field.name];
    if (value == null || !Object.prototype.hasOwnProperty.call(m, field.name)) {
      if (field.required) return `${field.name}: required`;
      continue;
    }
    if (field.map) {
      if (!u.isObject(value)) return `${field.name}: object expected`;
      for (const key of Object.keys(value as AnyRecord)) {
        const reason = verifyScalar(field, (value as AnyRecord)[key]);
        if (reason) return reason;
      }
    } else if (field.repeated) {
      if (!Array.isArray(value)) return `${field.name}: array expected`;
      for (const item of value) {
        const reason = verifyScalar(field, item);
        if (reason) return reason;
      }
    } else {
      const reason = verifyScalar(field, value);
      if (reason) return reason;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// converter.fromObject
// ---------------------------------------------------------------------------

function enumFromObject(field: Field, value: unknown, repeated: boolean): unknown {
  const values = (field.resolvedType as protobuf.Enum).values;
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(values, value)) return values[value];
  if (typeof value === "number") {
    for (const key of Object.keys(values)) if (values[key] === value) return value;
    return value; // unknown numbers pass through
  }
  // unknown strings: arrays fall back to the default value (no holes), single fields are ignored
  return repeated ? field.typeDefault : undefined;
}

function scalarFromObject(field: Field, value: unknown, depth: number): unknown {
  if (field.resolvedType instanceof Type) {
    if (!u.isObject(value)) throw TypeError(`${field.fullName}: object expected`);
    return fromObject(field.resolvedType as ExtType, value as AnyRecord, depth + 1);
  }
  switch (field.type) {
    case "double":
    case "float":
      return Number(value);
    case "uint32":
    case "fixed32":
      return (value as number) >>> 0;
    case "int32":
    case "sint32":
    case "sfixed32":
      return (value as number) | 0;
    case "uint64":
    case "fixed64":
    case "int64":
    case "sint64":
    case "sfixed64": {
      const unsigned = field.type === "uint64" || field.type === "fixed64";
      if (u.Long) return u.Long.fromValue(value, unsigned);
      if (typeof value === "string") return parseInt(value, 10);
      if (typeof value === "number") return value;
      if (typeof value === "object" && value !== null) {
        const v = value as LongLike;
        return new u.LongBits(v.low >>> 0, v.high >>> 0).toNumber(unsigned);
      }
      return value;
    }
    case "bytes": {
      if (typeof value === "string") {
        const buf = u.newBuffer(u.base64.length(value));
        u.base64.decode(value, buf, 0);
        return buf;
      }
      if ((value as ArrayLike<number>).length >= 0) return value;
      return value;
    }
    case "string":
      return String(value);
    case "bool":
      return Boolean(value);
    default:
      return value;
  }
}

function fromObject(mtype: ExtType, d: AnyRecord, depth = 0): AnyRecord {
  if (d instanceof mtype.ctor) return d as unknown as AnyRecord;
  const fields = mtype.fieldsArray;
  if (!fields.length) return new mtype.ctor() as AnyRecord;
  if (!u.isObject(d)) throw TypeError(`${mtype.fullName}: object expected`);
  if (depth > u.recursionLimit) throw Error("maximum nesting depth exceeded");
  const m = new mtype.ctor() as AnyRecord;
  for (const field of fields) {
    field.resolve();
    const value = d[field.name];
    const isEnum = field.resolvedType instanceof Enum;
    if (field.map) {
      if (value) {
        if (!u.isObject(value)) throw TypeError(`${field.fullName}: object expected`);
        const out: AnyRecord = {};
        m[field.name] = out;
        for (const key of Object.keys(value as AnyRecord)) {
          if (key === "__proto__" && u.makeProp) u.makeProp(out, key);
          const converted = isEnum ? enumFromObject(field, (value as AnyRecord)[key], true) : scalarFromObject(field, (value as AnyRecord)[key], depth);
          if (converted !== undefined) out[key] = converted;
        }
      }
    } else if (field.repeated) {
      if (value) {
        if (!Array.isArray(value)) throw TypeError(`${field.fullName}: array expected`);
        const out: unknown[] = [];
        m[field.name] = out;
        for (let i = 0; i < value.length; i++) {
          const converted = isEnum ? enumFromObject(field, value[i], true) : scalarFromObject(field, value[i], depth);
          if (converted !== undefined) out[i] = converted;
        }
      }
    } else if (isEnum) {
      const converted = enumFromObject(field, value, false);
      if (converted !== undefined) m[field.name] = converted;
    } else if (value != null) {
      m[field.name] = scalarFromObject(field, value, depth);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// converter.toObject
// ---------------------------------------------------------------------------

function scalarToObject(field: Field, value: unknown, o: protobuf.IConversionOptions, depth: number): unknown {
  if (field.resolvedType instanceof Enum) {
    if (o.enums === String) {
      const name = field.resolvedType.valuesById[value as number];
      return name === undefined ? value : name;
    }
    return value;
  }
  if (field.resolvedType instanceof Type) return toObject(field.resolvedType as ExtType, value as AnyRecord, o, depth + 1);
  switch (field.type) {
    case "double":
    case "float":
      return o.json && !isFinite(value as number) ? String(value) : value;
    case "uint64":
    case "fixed64":
    case "int64":
    case "sint64":
    case "sfixed64": {
      const unsigned = field.type === "uint64" || field.type === "fixed64";
      if (typeof BigInt !== "undefined" && (o.longs as unknown) === BigInt) {
        if (typeof value === "number") return BigInt(value);
        const v = value as LongLike;
        return u.Long!.fromBits(v.low >>> 0, v.high >>> 0, unsigned).toBigInt!();
      }
      if (typeof value === "number") return o.longs === String ? String(value) : value;
      const v = value as LongLike;
      if (o.longs === String) return u.Long!.prototype.toString.call(v);
      if (o.longs === Number) return new u.LongBits(v.low >>> 0, v.high >>> 0).toNumber(unsigned);
      return value;
    }
    case "bytes": {
      const bytes = value as Uint8Array;
      if (o.bytes === String) return u.base64.encode(bytes, 0, bytes.length);
      if (o.bytes === Array) return Array.prototype.slice.call(bytes);
      return value;
    }
    default:
      return value;
  }
}

function defaultToObject(field: Field, o: protobuf.IConversionOptions): unknown {
  if (field.resolvedType instanceof Enum) {
    return o.enums === String ? field.resolvedType.valuesById[field.typeDefault as number] : field.typeDefault;
  }
  if (field.long) {
    const def = field.typeDefault as LongLike;
    if (u.Long) {
      const n = new u.Long(def.low, def.high, def.unsigned);
      if (o.longs === String) return n.toString();
      if (o.longs === Number) return n.toNumber();
      if (typeof BigInt !== "undefined" && (o.longs as unknown) === BigInt) return n.toBigInt!();
      return n;
    }
    if (o.longs === String) return def.toString();
    if (typeof BigInt !== "undefined" && (o.longs as unknown) === BigInt) return BigInt(def.toString());
    return def.toNumber();
  }
  if (field.bytes) {
    const def = field.typeDefault as Uint8Array;
    if (o.bytes === String) return String.fromCharCode.apply(String, Array.from(def));
    const arr = Array.prototype.slice.call(def) as number[];
    return o.bytes === Array ? arr : u.newBuffer(arr);
  }
  return field.typeDefault;
}

function toObject(mtype: ExtType, m: AnyRecord, o: protobuf.IConversionOptions = {}, depth = 0): AnyRecord {
  const fields = sortedFields(mtype);
  if (!fields.length) return {};
  if (depth > u.recursionLimit) throw Error("max depth exceeded");
  const d: AnyRecord = {};
  const repeatedFields: ExtField[] = [];
  const mapFields: ExtField[] = [];
  const normalFields: ExtField[] = [];
  for (const field of fields) {
    if (field.partOf) continue;
    field.resolve();
    (field.repeated ? repeatedFields : field.map ? mapFields : normalFields).push(field);
  }
  if (repeatedFields.length && (o.arrays || o.defaults)) for (const field of repeatedFields) d[field.name] = [];
  if (mapFields.length && (o.objects || o.defaults)) for (const field of mapFields) d[field.name] = {};
  if (normalFields.length && o.defaults) for (const field of normalFields) d[field.name] = defaultToObject(field, o);
  for (const field of fields) {
    const value = m[field.name];
    if (field.map) {
      const keys = value ? Object.keys(value as AnyRecord) : [];
      if (value && keys.length) {
        const out: AnyRecord = {};
        d[field.name] = out;
        for (const key of keys) {
          if (key === "__proto__" && u.makeProp) u.makeProp(out, key);
          out[key] = scalarToObject(field, (value as AnyRecord)[key], o, depth);
        }
      }
    } else if (field.repeated) {
      const list = value as unknown[] | undefined;
      if (list && list.length) {
        const out: unknown[] = [];
        d[field.name] = out;
        for (const item of list) out.push(scalarToObject(field, item, o, depth));
      }
    } else if (value != null && Object.prototype.hasOwnProperty.call(m, field.name)) {
      d[field.name] = scalarToObject(field, value, o, depth);
      if (field.partOf && o.oneofs) d[field.partOf.name] = field.name;
    }
  }
  return d;
}
