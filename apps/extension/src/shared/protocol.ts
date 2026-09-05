/**
 * The message contract between the service worker and its clients (side panel, options page,
 * content scripts). Every message is `{ type, payload? }`; every response is a `Reply`.
 * Content scripts may only send `crosspost.propose` and `feed.request`.
 */
import type { CrossPostRecord } from "@osp/sdk";

export interface Message<T extends string = string, P = unknown> {
  type: T;
  payload?: P;
}

export type Reply<T = unknown> = { ok: true; result: T } | { ok: false; error: { code: string; message: string } };

export const CONTENT_SCRIPT_TYPES = ["crosspost.propose", "feed.request"] as const;
export type ContentScriptType = (typeof CONTENT_SCRIPT_TYPES)[number];

/** Payload size ceiling (bytes of the JSON encoding of the whole message). */
export const MAX_MESSAGE_BYTES = 32 * 1024;
/** Composer text ceiling (envelope limit is 4096 bytes; leave room for metadata). */
export const MAX_POST_CHARS = 3000;

// ---------------------------------------------------------------------------
// Vault / identity
// ---------------------------------------------------------------------------

export type VaultStatus = "empty" | "locked" | "unlocked";
export type VaultMode = "owner" | "device";

export interface DeviceInfo {
  address: string;
  capabilities: number;
  /** ms timestamp (decimal string) */
  expiresAt: string;
  authorizedAt: number;
  txId?: string;
  label: string;
}

export interface VaultStatusView {
  status: VaultStatus;
  account?: string;
  /** owner: the vault still holds the identity seed; device: only the device key + encryption secret. */
  mode?: VaultMode;
  device?: DeviceInfo;
  /** The device was authorized on chain (locally recorded; `device.status` re-checks the chain). */
  deviceAuthorized: boolean;
  /** Whether the unlocked session can sign as the owner (needed to authorize a device). */
  ownerAvailable: boolean;
  encryptionPublicKey?: string;
  network: { name: string; deployed: boolean; message?: string; indexerUrl: string };
  pending: number;
  lastActivity?: number;
  autoLockMinutes: number;
}

export interface DeviceStatusView {
  device?: string;
  registered: boolean;
  authorized: boolean;
  revoked?: boolean;
  expired?: boolean;
  epochMismatch?: boolean;
  expiresAt?: string;
  capabilities?: number;
  checkedAt: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export type FeedScope = "public" | "friends";

export type PostContentStatus = "plain" | "decrypted" | "tombstone" | "hidden" | "unavailable" | "no-key" | "locked" | "error";

export interface FeedItem {
  postId: string;
  author: string;
  audience: number;
  epoch: number;
  createdAt: string;
  versionNumber: number;
  status: PostContentStatus;
  text?: string;
  externalRef?: string;
  message?: string;
  reactions: number;
  replyCount: number;
  labels: Array<{ communityId: string; label: string; reason: string }>;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
  notice?: string;
}

// ---------------------------------------------------------------------------
// Cross-posting
// ---------------------------------------------------------------------------

export type Adapter = "facebook" | "generic" | "sidepanel";

export interface StoredCrossPost extends CrossPostRecord {
  /** Which adapter created the attempt. `sidepanel` posts have no host side. */
  adapter: Adapter;
  author?: string;
  /** Plaintext draft; dropped once the Koinos side succeeded. */
  text?: string;
  /** Page the attempt came from (Facebook composer URL or the shared page). */
  url?: string;
  /** The user activated the host's submit control before proposing (host side initiated by the user). */
  hostSubmitted?: boolean;
  title?: string;
  createdAt: number;
  contentHash?: string;
  versionNumber?: number;
  sequence?: string;
  epoch?: number;
  blockHeight?: string;
  proof?: { manifestHash: string; txId: string; recordedAt: number; outcome: number };
  proofError?: string;
}

export type QueueAction = "confirm" | "retry" | "reconcile" | "markHostPosted" | "markHostFailed" | "recordProof" | "discard";

export interface ProposePayload {
  hostSite: "facebook";
  text: string;
  attemptId: string;
  url: string;
  /** The user activated the host's submit control (the host publication was initiated by the user). */
  submitted: boolean;
  /** navigator.userActivation.isActive at send time. */
  userGesture: boolean;
}

export interface CreatePayload {
  text: string;
  audience: number;
  adapter: "sidepanel" | "generic";
  url?: string;
  title?: string;
}

export interface FeedRequestReply {
  enabled: boolean;
  items: Array<{ postId: string; author: string; text: string; createdAt: string }>;
}

// ---------------------------------------------------------------------------
// Settings / adapters
// ---------------------------------------------------------------------------

export interface AdapterStatusView {
  facebook: { wanted: boolean; granted: boolean; registered: boolean };
  feedInsertion: boolean;
}

export interface SettingsView {
  settings: import("./settings").Settings;
  resolved: { network: string; deployed: boolean; deploymentMessage?: string; chainId?: string; rpcUrls: string[]; indexerUrl: string; sponsorUrls: string[] };
  networks: string[];
}

export interface PageInfo {
  url?: string;
  title?: string;
  message?: string;
}
