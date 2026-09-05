/**
 * Page-side helper: sends a typed message to the service worker and unwraps the reply.
 */
import type { Reply } from "./protocol";

export class RpcError extends Error {
  override name = "RpcError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function rpc<T = unknown>(type: string, payload?: unknown): Promise<T> {
  let reply: Reply<T> | undefined;
  try {
    reply = (await chrome.runtime.sendMessage({ type, payload })) as Reply<T> | undefined;
  } catch (error) {
    throw new RpcError("unreachable", `The extension background is not reachable (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (!reply) throw new RpcError("no_reply", "The extension background did not reply.");
  if (!reply.ok) throw new RpcError(reply.error.code, reply.error.message);
  return reply.result;
}
