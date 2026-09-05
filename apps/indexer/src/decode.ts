/**
 * Event decoding with a defensive enum-default guard.
 *
 * `@osp/proto` once emitted enum descriptors with their values sorted alphabetically, and
 * `@osp/sdk` decodes with protobufjs `defaults: true`, so an enum field absent from the wire
 * (the canonical encoding of 0) decoded as the alphabetically first value (`audience = everyone`
 * came back as `custom`). `@osp/proto` now keeps enum declaration order and `decode()` returns 0
 * for absent enum fields; `decode.test.ts` pins that. The guard below is kept as belt and braces
 * for the projections: it re-reads the wire bytes and resets enum fields that are *absent* to 0.
 * It never touches a field that is present on the wire, so a real (non-zero, or explicitly
 * encoded zero) value is never overridden.
 */
import { decodeEvent, eventTypeForName, fromBase64url, lookupType, type DecodedEvent, type Deployment, type ProtoObject } from "@osp/sdk";

type Message = Record<string, unknown>;

interface FieldLike {
  name: string;
  repeated: boolean;
  resolvedType: unknown;
  resolve(): FieldLike;
}

interface TypeLike {
  fieldsArray: FieldLike[];
  decode(bytes: Uint8Array): unknown;
}

function isEnum(resolved: unknown): boolean {
  return typeof resolved === "object" && resolved !== null && "values" in resolved && !("fields" in resolved);
}

function isType(resolved: unknown): resolved is TypeLike {
  return typeof resolved === "object" && resolved !== null && "fieldsArray" in resolved;
}

/** Resets enum fields that are not present on the wire to 0, walking nested messages. */
export function fixEnumDefaults(type: TypeLike, message: Message | undefined, obj: ProtoObject | undefined): void {
  if (!obj) return;
  for (const field of type.fieldsArray) {
    field.resolve();
    const resolved = field.resolvedType;
    const present = message !== undefined && Object.prototype.hasOwnProperty.call(message, field.name);
    if (isEnum(resolved)) {
      if (!field.repeated && !present) obj[field.name] = 0;
      continue;
    }
    if (!isType(resolved)) continue;
    const child = obj[field.name];
    if (field.repeated) {
      const rawItems = present ? (message![field.name] as Message[]) : [];
      if (Array.isArray(child)) child.forEach((item, i) => fixEnumDefaults(resolved, rawItems[i], item as ProtoObject));
    } else if (child && typeof child === "object") {
      fixEnumDefaults(resolved, present ? (message![field.name] as Message) : undefined, child as ProtoObject);
    }
  }
}

/** Decodes event data by name with the enum-default correction applied. */
export function decodeEventDataFixed(name: string, raw: string | Uint8Array): ProtoObject | undefined {
  const info = eventTypeForName(name);
  if (!info) return undefined;
  const bytes = typeof raw === "string" ? fromBase64url(raw) : raw;
  const type = lookupType(info.type) as unknown as TypeLike;
  const decoded = decodeEvent("", name, bytes, undefined, {});
  if (!decoded) return undefined;
  fixEnumDefaults(type, type.decode(bytes) as Message, decoded.data);
  return decoded.data;
}

/** `decodeEvent` from the SDK (source check against the deployment included) plus the correction. */
export function decodeProtocolEvent(
  source: string,
  name: string,
  raw: string,
  deployment: Deployment,
  extra: { txId: string; blockHeight: string; blockId: string; impacted: string[]; sequence: number },
): DecodedEvent | undefined {
  const decoded = decodeEvent(source, name, raw, deployment, extra);
  if (!decoded) return undefined;
  const info = eventTypeForName(name);
  if (info) {
    const bytes = fromBase64url(raw);
    const type = lookupType(info.type) as unknown as TypeLike;
    fixEnumDefaults(type, type.decode(bytes) as Message, decoded.data);
  }
  return decoded;
}
