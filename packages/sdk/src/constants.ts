/**
 * Protocol constants (docs/protocol-spec.md sections 2, 3.1, 6, 10, 12).
 */
import {
  PROTOCOL_VERSION as PROTO_PROTOCOL_VERSION,
  CONTRACT_NAMES as PROTO_CONTRACT_NAMES,
  EVENTS,
  type ContractName,
} from "@osp/proto";

import type { EventName } from "./client/types.js";

export type { ContractName };

/** Protocol version pinned by every client (spec section 13). */
export const PROTOCOL_VERSION: 1 = PROTO_PROTOCOL_VERSION;

/** The six protocol contracts, in deployment order. */
export const CONTRACT_NAMES: readonly ContractName[] = PROTO_CONTRACT_NAMES;

/** Domain separators (ASCII) prefixed to every hashed or signed payload (spec section 2). */
export const DOMAIN = {
  POST_ID: "osp/v1/post-id",
  WRAP: "osp/v1/wrap",
  SEAL: "osp/v1/seal",
  MANIFEST: "osp/v1/manifest",
  AUDIENCE: "osp/v1/audience",
  IDEMPOTENCY: "osp/v1/idem",
  ENCRYPTION_KEY: "osp/v1/enc-key",
} as const;

/** Device capability bits (spec section 3.1). */
export const CAPABILITY = {
  PUBLISH: 1,
  REACT: 2,
  COMMENT: 4,
  RELATIONSHIPS: 8,
  COMMUNITY: 16,
  PROFILE: 32,
} as const;

/** Every capability bit set. */
export const ALL_CAPABILITIES = 63;

/** Pilot limits enforced on chain (spec section 6) plus fixed sizes of protocol values. */
export const LIMITS = {
  maxEnvelopeBytes: 4096,
  maxMediaRefs: 8,
  maxLocationsPerRef: 4,
  maxLocationChars: 256,
  maxIdempotencyKeyBytes: 32,
  maxKeyPackageBytes: 16384,
  maxReasonChars: 256,
  idempotencyKeyBytes: 16,
  attemptIdBytes: 16,
  audienceIdBytes: 16,
  addressBytes: 25,
  hashBytes: 32,
  keyBytes: 32,
  nonceBytes: 24,
  seedBytes: 32,
} as const;

/** publications.audience_kind */
export const AUDIENCE = { EVERYONE: 0, FRIENDS: 1, CUSTOM: 2 } as const;
export type AudienceKind = (typeof AUDIENCE)[keyof typeof AUDIENCE];

/** osp.envelope.suite */
export const SUITE = { PLAINTEXT: 0, XCHACHA20POLY1305_X25519: 1 } as const;
export type Suite = (typeof SUITE)[keyof typeof SUITE];

/** publications.lifecycle_state */
export const LIFECYCLE = {
  ACTIVE: 0,
  AUTHOR_HIDDEN: 1,
  DELETED: 2,
  UNAVAILABLE: 3,
  MIGRATED: 4,
  SUPERSEDED: 5,
} as const;

/** publications.outcome_state */
export const OUTCOME = {
  SUCCEEDED: 0,
  PARTIAL: 1,
  UNKNOWN: 2,
  FAILED: 3,
  RECONCILE_REQUIRED: 4,
} as const;

/** relationships.relationship_status */
export const RELATIONSHIP_STATUS = { NONE: 0, PENDING: 1, ACTIVE: 2, INACTIVE: 3 } as const;

/** communities.community_role */
export const COMMUNITY_ROLE = {
  NONE: 0,
  GUEST: 1,
  MEMBER: 2,
  MODERATOR: 3,
  ADMIN: 4,
  OWNER: 5,
  BANNED: 6,
} as const;

/** registry.contract_status */
export const CONTRACT_STATUS = { PROPOSED: 0, ACTIVE: 1, DEPRECATED: 2 } as const;

/** Reaction codes; 1 = like, anything else is client vocabulary. */
export const REACTION = { LIKE: 1 } as const;

/** Envelope version emitted by this SDK. */
export const ENVELOPE_VERSION = 1;
/** Key package set version emitted by this SDK. */
export const KEY_PACKAGE_VERSION = 1;
/** Proof manifest version emitted by this SDK. */
export const MANIFEST_VERSION = 1;
/** Profile document version emitted by this SDK. */
export const PROFILE_VERSION = 1;

/** `{ publications: { published: "osp.publications.published", ... }, ... }` */
export type EventNamesByContract = {
  readonly [C in ContractName]: { readonly [N in EventName as N extends `osp.${C}.${infer S}` ? S : never]: N };
};

/**
 * Full event names grouped by contract and short name, e.g.
 * `EVENT_NAMES.publications.published === "osp.publications.published"` (spec section 12).
 */
export const EVENT_NAMES: EventNamesByContract = (() => {
  const out = {} as Record<ContractName, Record<string, string>>;
  for (const contract of PROTO_CONTRACT_NAMES) {
    const names: Record<string, string> = {};
    for (const event of EVENTS[contract]) {
      names[event.name.slice(`osp.${contract}.`.length)] = event.name;
    }
    out[contract] = names;
  }
  return out as unknown as EventNamesByContract;
})();

/** Stable sponsor refusal categories (spec section 10, docs/sponsor-api.md). */
export const SPONSOR_ERROR_CATEGORIES = [
  "quota_exceeded",
  "method_not_allowed",
  "too_large",
  "chain_mismatch",
  "invalid_signature",
  "invalid_transaction",
  "temporarily_unavailable",
] as const;
export type SponsorErrorCategory = (typeof SPONSOR_ERROR_CATEGORIES)[number];

export interface NetworkPreset {
  name: string;
  rpc: string[];
  /** Chain id (base64url multihash) the RPC is expected to report. Undefined for local devnets. */
  expectedChainId?: string;
}

/** Known networks. */
export const NETWORKS: Readonly<Record<"harbinger" | "localnet", NetworkPreset>> = {
  harbinger: {
    name: "harbinger",
    rpc: ["https://harbinger-api.koinos.io", "https://api.harbinger.koinos.pro"],
    expectedChainId: "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==",
  },
  localnet: {
    name: "localnet",
    rpc: ["http://localhost:8080"],
  },
};
