import { bytesEqual, contentHash, contentReference, contentReferenceUri, encodeContentReference, fromBase64url, parseContentReference, parseContentReferenceUri, utf8, type ContentLoader, type OperationJson, type ProtoObject, type ProtocolClient } from "@osp/sdk";
import type { SubmitContext } from "../tx/submit";
import { uploadStoredMedia, usesExternalMedia } from "./mediaStorage";

export function configureContentLoader(client: ProtocolClient, loader: ContentLoader) {
  client.contracts.contentLoader = loader;
}
export function contentLoader(client: ProtocolClient): ContentLoader {
  const load = client.contracts.contentLoader;
  if (!load) throw Error("Content hosting is not configured for this network.");
  return load;
}
const byteMethods: Record<string, string> = {
  "publications.publish": "envelope", "publications.save_collection": "envelope", "publications.set_album_item": "envelope",
  "publications.comment_music": "body", "messaging.send_message": "envelope", "messaging.post_private_packet": "envelope",
};
/** Runs after approval, before signing/broadcast, and never falls back to inline
 * content if hosting fails. Existing encrypted drafts remain byte-for-byte intact. */
export async function prepareHostedContent(ctx: SubmitContext, operations: OperationJson[]): Promise<OperationJson[]> {
  if (!usesExternalMedia(ctx.client)) return operations;
  const decoded = operations.map(op => ctx.client.contracts.decodeOperation(op));
  const hasContent = decoded.some(op => op && (byteMethods[`${op.contract}.${op.method}`] || op.method === "begin_music" || op.method === "register" || op.method === "update_profile"));
  if (!hasContent) return operations;
  if (decoded.some(op => op?.contract === "publications" && (byteMethods[`publications.${op.method}`] || op.method === "begin_music"))) {
    const version = await ctx.client.reads.publications.get_library_version({});
    if (version?.content_reference_version !== 1) throw Error("The network's content storage upgrade is not deployed yet. Nothing was published.");
  }
  if (decoded.some(op => op?.contract === "messaging" && byteMethods[`messaging.${op.method}`])) {
    const version = await ctx.client.reads.messaging.get_private_status({});
    if (version?.content_reference_version !== 1) throw Error("The network's message storage upgrade is not deployed yet. Nothing was sent.");
  }
  const uploadCtx = ctx.contentSigner ? { ...ctx, signer: ctx.contentSigner.signer } : ctx;
  const owner = ctx.contentSigner?.account ?? ctx.signer.getAddress();
  async function store(bytes: Uint8Array) {
    const ref = contentReference(bytes);
    await uploadStoredMedia(uploadCtx, owner, bytes);
    return ref;
  }
  const result: OperationJson[] = [];
  for (let i = 0; i < operations.length; i++) {
    const op = decoded[i];
    if (!op) { result.push(operations[i]!); continue; }
    const args: ProtoObject = { ...op.args }, key = `${op.contract}.${op.method}`, field = byteMethods[key];
    if (field && args[field] instanceof Uint8Array && (args[field] as Uint8Array).length) {
      const bytes = args[field] as Uint8Array;
      if (!parseContentReference(bytes)) {
        if (key === "publications.publish" && !bytesEqual(contentHash(bytes), args.content_hash as Uint8Array)) throw Error("Post fingerprint mismatch.");
        args[field] = encodeContentReference(await store(bytes));
      }
    }
    if (key === "publications.publish" && args.poll) {
      const poll = { ...args.poll as ProtoObject };
      if (!parseContentReferenceUri(poll.question as string)) {
        const options = poll.options as string[];
        poll.question = contentReferenceUri(await store(utf8(JSON.stringify({ question: poll.question, options }))));
        poll.options = options.map((_, index) => String(index));
      }
      args.poll = poll;
    }
    if (key === "publications.begin_music" && !parseContentReferenceUri(args.title as string)) {
      args.title = contentReferenceUri(await store(utf8(JSON.stringify({ title: args.title, artist: args.artist ?? "", description: args.description ?? "" }))));
      args.artist = ""; args.description = "";
    }
    if (op.contract === "identity" && (op.method === "register" || op.method === "update_profile") && typeof args.profile_uri === "string" && args.profile_uri.startsWith("data:application/x-osp-profile;base64,")) {
      const bytes = fromBase64url(args.profile_uri.split(",")[1]!);
      if (!bytesEqual(contentHash(bytes), args.profile_hash as Uint8Array)) throw Error("Profile fingerprint mismatch.");
      args.profile_uri = contentReferenceUri(await store(bytes));
    }
    result.push(await ctx.client.contracts.operation(op.contract, op.method, args));
  }
  return result;
}
