/**
 * Message router for the service worker. Every incoming message goes through, in order:
 * shape + size, sender identity (this extension only), known type, source classification
 * (extension page vs content script by origin), content-script restrictions (granted host origin,
 * real tab, top frame, allowed types only, per-tab rate limit, user gesture where required),
 * strict payload schema, then the handler. Replies carry the minimum the caller needs.
 */
import { CONTENT_SCRIPT_TYPES, MAX_MESSAGE_BYTES, type Reply } from "../shared/protocol";
import { ValidationError, type Validator } from "../shared/validate";

export type Source = "extension" | "content";

export interface HandlerContext {
  sender: chrome.runtime.MessageSender;
  source: Source;
  tabId?: number;
  origin?: string;
}

export interface HandlerDef<P = unknown, R = unknown> {
  /** Who may send this message. */
  source: Source;
  validate: Validator<P>;
  handle: (payload: P, ctx: HandlerContext) => Promise<R>;
  /** Content-script messages that must come from a user activation. */
  requireGesture?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<string, HandlerDef<any, any>>;

export function defineHandler<P, R>(def: HandlerDef<P, R>): HandlerDef<P, R> {
  return def;
}

export interface RouterOptions {
  runtimeId: string;
  handlers: Handlers;
  /** Host permission patterns currently granted (chrome.permissions.getAll().origins). */
  grantedOrigins: () => Promise<string[]>;
  now?: () => number;
  rateLimit?: { max: number; windowMs: number };
  maxBytes?: number;
}

export class RouterError extends Error {
  override name = "RouterError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** "https://www.facebook.com/*" -> "https://www.facebook.com". */
export function originsFromPatterns(patterns: string[]): string[] {
  const origins = new Set<string>();
  for (const pattern of patterns) {
    const match = /^(https?):\/\/([^/*]+)\/.*$/.exec(pattern);
    if (match && match[2] && !match[2].includes("*")) origins.add(`${match[1]}://${match[2]}`.toLowerCase());
  }
  return [...origins];
}

export function originFromSender(sender: chrome.runtime.MessageSender): string | undefined {
  if (typeof sender.origin === "string" && sender.origin !== "null") return sender.origin.toLowerCase();
  if (typeof sender.url === "string") {
    try {
      return new URL(sender.url).origin.toLowerCase();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function reject(code: string, message: string): Reply {
  return { ok: false, error: { code, message } };
}

export interface Router {
  handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<Reply>;
  /** chrome.runtime.onMessage listener (async reply). */
  listener(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (reply: Reply) => void): boolean;
}

export function createRouter(options: RouterOptions): Router {
  const now = options.now ?? (() => Date.now());
  const limit = options.rateLimit ?? { max: 20, windowMs: 10_000 };
  const maxBytes = options.maxBytes ?? MAX_MESSAGE_BYTES;
  const buckets = new Map<number, number[]>();
  const extensionOrigin = `chrome-extension://${options.runtimeId}`.toLowerCase();

  function rateLimited(tabId: number): boolean {
    const at = now();
    const hits = (buckets.get(tabId) ?? []).filter((t) => at - t < limit.windowMs);
    if (hits.length >= limit.max) {
      buckets.set(tabId, hits);
      return true;
    }
    hits.push(at);
    buckets.set(tabId, hits);
    return false;
  }

  async function handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<Reply> {
    // 1. shape and size
    if (typeof message !== "object" || message === null || Array.isArray(message)) return reject("invalid_message", "Messages must be objects.");
    const record = message as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== "string" || type.length === 0 || type.length > 64 || !/^[a-z][a-zA-Z0-9.]*$/.test(type)) return reject("invalid_message", "Missing message type.");
    for (const key of Object.keys(record)) if (key !== "type" && key !== "payload") return reject("invalid_message", `Unexpected message key ${key}.`);
    let size: number;
    try {
      size = byteLength(JSON.stringify(message));
    } catch {
      return reject("invalid_message", "Message is not serializable.");
    }
    if (size > maxBytes) return reject("too_large", `Message exceeds ${maxBytes} bytes.`);

    // 2. sender identity
    if (!sender || sender.id !== options.runtimeId) return reject("forbidden", "Messages are accepted from this extension only.");

    // 3. known type
    const handler = options.handlers[type];
    if (!handler) return reject("unknown_type", `Unknown message type ${type}.`);

    // 4. source classification
    const origin = originFromSender(sender);
    if (!origin) return reject("forbidden", "Sender origin is unknown.");
    let source: Source;
    let tabId: number | undefined;
    if (origin === extensionOrigin) {
      source = "extension";
    } else {
      source = "content";
      tabId = sender.tab?.id;
      if (typeof tabId !== "number" || tabId < 0) return reject("forbidden", "Content-script messages must come from a tab.");
      if (sender.frameId !== undefined && sender.frameId !== 0) return reject("forbidden", "Only the top frame may send messages.");
      if (!(CONTENT_SCRIPT_TYPES as readonly string[]).includes(type)) return reject("forbidden", `Content scripts may not send ${type}.`);
      const granted = originsFromPatterns(await options.grantedOrigins());
      if (!granted.includes(origin)) return reject("forbidden", `Origin ${origin} is not a granted host.`);
      if (rateLimited(tabId)) return reject("rate_limited", "Too many messages from this tab; try again shortly.");
    }
    if (handler.source !== source) return reject("forbidden", `${type} is not available to ${source === "content" ? "content scripts" : "extension pages"}.`);

    // 5. payload schema
    let payload: unknown;
    try {
      payload = handler.validate(record.payload, "payload");
    } catch (error) {
      if (error instanceof ValidationError) return reject("invalid_payload", error.message);
      return reject("invalid_payload", "Invalid payload.");
    }
    if (source === "content" && handler.requireGesture && (payload as { userGesture?: boolean } | undefined)?.userGesture !== true) {
      return reject("forbidden", "This action requires a user gesture.");
    }

    // 6. handler
    try {
      const result = await handler.handle(payload, { sender, source, tabId, origin });
      return { ok: true, result: result ?? null };
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof RouterError ? error.code : name.replace(/Error$/, "").toLowerCase() || "error";
      return reject(code, message);
    }
  }

  return {
    handle,
    listener(message, sender, sendResponse) {
      handle(message, sender)
        .catch((error: unknown) => reject("internal", error instanceof Error ? error.message : String(error)))
        .then(sendResponse);
      return true;
    },
  };
}
