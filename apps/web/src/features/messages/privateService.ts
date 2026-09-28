import {
  acceptRatchet,
  bytesEqual,
  contentHash,
  createRatchetSetup,
  decryptPrivateMessage,
  encryptPrivateMessage,
  finishRatchet,
  fromBase64url,
  isAddress,
  openPrivateInvitation,
  privateWallet,
  privateConfirmationDepth,
  privateConfirmationHeight,
  randomBytes,
  sealPrivateInvitation,
  signPrivateStatement,
  SponsorClient,
  toBase64url,
  verifyPrivateStatement,
  x25519KeyPair,
  type Identity,
  type OperationJson,
  type PrivatePacketContext,
  type PrivateScope,
  type ProtocolClient,
  type SignerInterface,
  PRIVATE_MESSAGE_LIMIT,
  utf8,
} from "@osp/sdk";
import { ABIS } from "@osp/proto";
import type { IndexerClient, PrivatePacketView } from "../../api/indexer";
import { submitAction } from "../../tx/submit";
import type { PaymentPreference } from "../../stores/settings";
import {
  PrivateStore,
  validId,
  type Acceptance,
  type AcceptanceEnvelope,
  type Closure,
  type Invitation,
  type PrivateChat,
  type PrivateFile,
  type QueuedPrivateMessage,
  type Signed,
} from "./privateStore";

const id = () => toBase64url(randomBytes(32));
const INVITATION_LIFETIME = 7 * 86_400_000;
const RETRY_MS = 20_000;
export interface PrivateSnapshot {
  enabled: boolean;
  registered: boolean;
  autoConnect?: boolean;
  prepareInAdvance?: boolean;
  preparingAllowance?: boolean;
  chats: Array<
    Pick<PrivateChat, "id" | "peer" | "status" | "messages" | "createdAt"> & {
      requestDelivery?: "preparing" | "confirming" | "sent" | "failed";
      closing?: boolean;
      progress?: string;
      error?: string;
    }
  >;
  pending: number;
  error: string;
  devices?: Array<{
    id: string;
    label: string;
    current: boolean;
    updatedAt: string;
  }>;
}
export class PrivateMessagingService {
  readonly scope: PrivateScope;
  private error = "";
  private queued: QueuedPrivateMessage[] = [];
  private lastSnapshot: PrivateSnapshot = { enabled: false, registered: false, chats: [], pending: 0, error: "" };
  private queueErrors = new Map<string, string>();
  private warmRetryAt = 0;
  private running = false;
  private stopped = false;
  private devices: NonNullable<PrivateSnapshot["devices"]> = [];
  private fundingSteps = new Map<string, string>();
  private channelSteps = new Map<string, string>();
  private chatErrors = new Map<string, string>();
  private scanIrreversible = 0n;
  private syncHead: ReturnType<ProtocolClient["provider"]["getHeadInfo"]> | undefined;
  private head() {
    // One conservative boundary per pass avoids an RPC round trip per pending
    // message. A newly mined transaction can advance on the following pass.
    return this.syncHead ??= this.protocol.provider.getHeadInfo();
  }
  constructor(
    readonly me: Identity,
    readonly protocol: ProtocolClient,
    readonly indexer: IndexerClient,
    readonly store: PrivateStore,
    readonly sponsorUrls: string[],
    readonly payment: PaymentPreference,
    readonly changed: (snapshot: PrivateSnapshot) => void,
  ) {
    this.scope = {
      chainId: protocol.chainId,
      contract: protocol.deployment.contracts.messaging.address,
    };
  }
  stop(): void {
    this.stopped = true;
  }
  private active(): void {
    this.store.assertActive();
    if (this.stopped) throw new Error("Messaging session closed");
  }
  private snapshot(data: PrivateFile): void {
    if (this.stopped) return;
    this.lastSnapshot = {
      enabled: data.enabled,
      autoConnect: data.autoConnect !== false,
      prepareInAdvance: data.prepareInAdvance !== false,
      preparingAllowance: data.enabled && !!data.registered && !!data.spareAliasId && !data.spareAliasReady
        && data.prepareInAdvance !== false && Date.now() >= this.warmRetryAt,
      registered: !!data.registered,
      chats: data.chats.map((c) => {
        const request = data.outbox.find(p => p.chatId === c.id && !p.peer && p.kind !== "close");
        const closing = c.status === "closed" && (c.closeNotice === "needed" || c.closeNotice === "queued" || !!c.closeChannelPending);
        const pending = (request && !request.observed ? request : undefined)
          ?? data.outbox.find(p => p.chatId === c.id && !p.observed);
        const error = c.closeError || pending?.error || this.chatErrors.get(c.id);
        const progress = closing ? "Closed on this browser. Notifying the other messaging browser."
          : pending ? this.fundingSteps.get(pending.actor) ?? (pending.lastAttempt ? "Waiting for the network to confirm delivery." : "Preparing the encrypted request.")
          : c.status === "accepting" ? this.channelSteps.get(c.id) ?? "Checking the private connection."
          : undefined;
        const requestDelivery = !request || request.observed ? "sent" : request.error ? "failed"
          : request.lastAttempt ? "confirming" : "preparing";
        return {
          id: c.id,
          peer: c.peer,
          status: c.status,
          messages: structuredClone(c.messages),
          createdAt: c.createdAt,
          ...(c.status === "outgoing" && { requestDelivery }),
          ...(closing && { closing }),
          ...(progress && { progress }),
          ...(error && { error }),
        };
      }),
      // Control packets and already observed ciphertext are not unsent messages.
      // Keep recovery records until finality without a minutes-long sending badge.
      pending: data.outbox.filter(p => p.peer && !p.observed).length,
      error: this.error,
      devices: this.devices,
    };
    this.emit();
  }
  private emit(): void {
    if (this.stopped) return;
    const value = structuredClone(this.lastSnapshot);
    for (const draft of this.queued) {
      if (value.chats.some(c => c.messages.some(m => m.id === draft.id))) continue;
      let chat = value.chats.find(c => c.id === draft.chatId)
        ?? value.chats.find(c => c.peer === draft.peer && c.status !== "closed");
      if (!chat) {
        chat = { id: `pending:${draft.peer}`, peer: draft.peer, status: "outgoing", messages: [], createdAt: draft.createdAt,
          progress: "Preparing your encrypted conversation in the background." };
        value.chats.unshift(chat);
      }
      chat.messages.push({ id: draft.id, text: draft.text, mine: true, timestamp: draft.createdAt, state: chat.status === "closed" ? "not-sent" : "sending" });
      chat.error = this.queueErrors.get(draft.peer) || chat.error;
      if (chat.status !== "closed") value.pending++;
    }
    this.changed(value);
  }
  async queueMessage(peer: string, text: string): Promise<void> {
    this.active();
    if (!isAddress(peer) || peer === this.me.account) throw new Error("Choose another person to message");
    if (!text.trim() || utf8(text).length > PRIVATE_MESSAGE_LIMIT) throw new Error(`Message must contain 1–${PRIVATE_MESSAGE_LIMIT} UTF-8 bytes`);
    const chatId = this.lastSnapshot.chats.find(c => c.peer === peer && c.status !== "closed")?.id;
    this.queued = await this.store.drafts(drafts => {
      if (drafts.filter(d => d.peer === peer).length >= 20) throw new Error("Wait for your pending messages to send");
      drafts.push({ id: id(), peer, chatId, text, createdAt: Date.now() });
      return structuredClone(drafts);
    });
    this.queueErrors.delete(peer);
    this.emit();
    void this.sync();
  }
  async setAutoConnect(value: boolean): Promise<void> {
    await this.store.edit(async (data, save) => { data.autoConnect = value; await save(); this.snapshot(data); });
    void this.sync();
  }
  async setPrepareInAdvance(value: boolean): Promise<void> {
    await this.store.edit(async (data, save) => { data.prepareInAdvance = value; await save(); this.snapshot(data); });
    void this.sync();
  }
  async load(): Promise<void> {
    await this.store.edit(async (data) => this.snapshot(data));
    this.queued = await this.store.drafts(drafts => structuredClone(drafts));
    this.emit();
  }
  private async submit(
    signer: SignerInterface,
    operations: OperationJson[],
    label: string,
  ): Promise<void> {
    this.active();
    await submitAction(
      { client: this.protocol, signer, payment: this.payment },
      operations,
      // This runs in the background already. Hold the account submission queue
      // until inclusion so the next allowance does not reuse its chain nonce.
      { label, quietProgress: true, waitForReceipt: true, beforeSubmit: async () => this.active() },
    );
  }
  async enable(): Promise<void> {
    const status = await this.protocol.reads.messaging.get_private_status({});
    if (status?.version !== 2)
      throw new Error(
        "The messaging upgrade is not available on this network yet.",
      );
    await this.store.edit(async (data, save) => {
      if (!data.enabled) {
        data.enabled = true;
        data.registered = false;
        // The head's sequence is reversible. A fast-mode browser must not skip
        // a future invitation if a reorg reuses a sequence below that head.
        data.inboxAfter = privateConfirmationDepth(this.protocol.deployment.network) ? "0" : status.sequence;
        data.inboxValidation = 2;
      }
      await save();
      this.error = "";
      this.snapshot(data);
    });
    void this.sync();
  }
  async revokeDevice(deviceId: string): Promise<void> {
    if (!validId(deviceId)) throw new Error("Invalid messaging browser");
    await this.store.edit(async (data, save) => {
      await this.submit(
        this.me.signer,
        [
          await this.protocol.ops.messaging.set_private_device({
            account: this.me.account,
            device_id: fromBase64url(deviceId),
          }),
        ],
        "Removing messaging browser",
      );
      if (deviceId === data.deviceId) {
        data.enabled = false;
        data.registered = false;
      }
      this.devices = this.devices.filter((d) => d.id !== deviceId);
      await save();
      this.snapshot(data);
    });
  }
  private async unblocked(peer: string): Promise<boolean> {
    const [a, b] = await Promise.all([
      this.protocol.reads.relationships.is_blocked({
        actor: this.me.account,
        target: peer,
      }),
      this.protocol.reads.relationships.is_blocked({
        actor: peer,
        target: this.me.account,
      }),
    ]);
    if (!a || !b) throw new Error("Could not verify messaging permissions");
    return !a.value && !b.value;
  }
  private async owner(account: string): Promise<string> {
    const identity = (
      await this.protocol.reads.identity.get_identity({ account })
    )?.value;
    return identity?.owner ?? "";
  }
  async start(peer: string): Promise<string> {
    const result = await this.store.edit((data, save) => this.startInFile(data, save, peer));
    void this.sync();
    return result;
  }
  private async startInFile(data: PrivateFile, save: () => Promise<void>, peer: string): Promise<string> {
    if (!isAddress(peer) || peer === this.me.account)
      throw new Error("Enter another person's account address");
    const existingId = data.chats.find(c => c.peer === peer && c.status !== "closed")?.id;
    if (existingId) return existingId;
    if (!(await this.unblocked(peer)))
      throw new Error("This conversation is blocked");
    const devices =
      (
        await this.protocol.reads.messaging.get_private_devices({
          account: peer,
        })
      )?.values ?? [];
    const device = [...devices].sort((a, b) =>
      Number(BigInt(b.updated_at) - BigInt(a.updated_at)),
    )[0];
    if (!device)
      throw new Error(
        "This person needs to enable private messaging on their browser first",
      );
    if (!data.registered)
      throw new Error("Finish enabling this browser first");
    const existing = data.chats.find(
      (c) => c.peer === peer && c.status !== "closed",
    );
    if (existing) return existing.id;
    const channelId = id(),
      aliasId = data.spareAliasId ?? id(),
      packetId = id();
    const wallet = privateWallet(
      this.me.seed,
      this.scope,
      "conversation",
      aliasId,
    );
    const setup = await createRatchetSetup(fromBase64url(data.pickleKey)),
      reply = x25519KeyPair();
    const createdAt = Date.now();
    const value: Invitation = {
      kind: "invite",
      id: channelId,
      from: this.me.account,
      to: peer,
      deviceId: toBase64url(device.device_id),
      alias: wallet.getAddress(),
      identityKey: setup.identityKey,
      oneTimeKey: setup.oneTimeKey,
      returnKey: toBase64url(reply.publicKey),
      createdAt,
      expiresAt: createdAt + INVITATION_LIFETIME,
    };
    const signed: Signed<Invitation> = {
      value,
      signature: await signPrivateStatement(
        this.scope,
        "invite",
        value,
        this.me.signer,
      ),
    };
    const context = this.context(wallet.getAddress(), "", packetId);
    const envelope = sealPrivateInvitation(
      context,
      device.delivery_key,
      signed,
    );
    data.chats.push({
      id: channelId,
      peer,
      aliasId,
      alias: wallet.getAddress(),
      status: "outgoing",
      setup,
      returnSecret: toBase64url(reply.secretKey),
      after: "0",
      messages: [],
      createdAt: Date.now(),
      invitation: value,
    });
    reply.secretKey.fill(0);
    data.outbox.push({
      id: packetId,
      actor: wallet.getAddress(),
      derivationId: aliasId,
      purpose: "conversation",
      peer: "",
      envelope: toBase64url(envelope),
      chatId: channelId,
    });
    delete data.spareAliasId;
    delete data.spareAliasReady;
    await save();
    this.snapshot(data);
    return channelId;
  }
  async accept(chatId: string): Promise<void> {
    await this.store.edit((data, save) => this.acceptInFile(data, save, chatId));
    void this.sync();
  }
  private async acceptInFile(data: PrivateFile, save: () => Promise<void>, chatId: string): Promise<void> {
    const chat = data.chats.find((c) => c.id === chatId);
    if (!chat || chat.status !== "incoming" || !chat.invitation)
      throw new Error("Message request is no longer available");
    if (!(await this.unblocked(chat.peer)))
      throw new Error("This conversation is blocked");
    if (chat.invitation.expiresAt < Date.now())
      throw new Error(
        "This request has expired. Ask them to send a new request.",
      );
    const aliasId = data.spareAliasId ?? chat.aliasId;
    const alias = privateWallet(this.me.seed, this.scope, "conversation", aliasId).getAddress();
    const value: Acceptance = {
      kind: "accept",
      id: chat.id,
      from: this.me.account,
      to: chat.peer,
      alias,
      peerAlias: chat.peerAlias!,
    };
    const signed: Signed<Acceptance> = {
      value,
      signature: await signPrivateStatement(
        this.scope,
        "accept",
        value,
        this.me.signer,
      ),
    };
    const accepted = await acceptRatchet(
      fromBase64url(data.pickleKey),
      chat.invitation,
      signed,
    );
    const packetId = id();
    const reply: AcceptanceEnvelope = {
      kind: "accept",
      id: chat.id,
      identityKey: accepted.identityKey,
      wire: accepted.wire,
    };
    const envelope = sealPrivateInvitation(
      this.context(alias, "", packetId),
      fromBase64url(chat.invitation.returnKey),
      reply,
    );
    chat.aliasId = aliasId;
    chat.alias = alias;
    chat.ratchet = accepted.state;
    chat.status = "accepting";
    delete chat.invitation;
    data.outbox.push({
      id: packetId,
      actor: chat.alias,
      derivationId: chat.aliasId,
      purpose: "conversation",
      peer: "",
      envelope: toBase64url(envelope),
      chatId: chat.id,
    });
    delete data.spareAliasId;
    delete data.spareAliasReady;
    await save();
    this.snapshot(data);
  }
  async send(chatId: string, text: string): Promise<void> {
    await this.store.edit((data, save) => this.sendInFile(data, save, chatId, text, id()));
    void this.sync();
  }
  private async sendInFile(data: PrivateFile, save: () => Promise<void>, chatId: string, text: string, messageId: string): Promise<void> {
    const chat = data.chats.find((c) => c.id === chatId);
    if (!chat || chat.status === "closed" || !chat.ratchet || !chat.peerAlias)
      throw new Error("This conversation is not ready yet");
    // Queue locally without a network round trip. Dispatch checks both block
    // directions immediately before submission and keeps rejected packets local.
    if (data.outbox.filter((p) => p.chatId === chatId && p.peer && !p.observed).length >= 20)
      throw new Error("Wait for your pending messages to send");
    const packetId = messageId,
      context = this.context(chat.alias, chat.peerAlias, packetId);
    const encrypted = await encryptPrivateMessage(
      fromBase64url(data.pickleKey),
      chat.ratchet,
      context,
      text,
    );
    chat.ratchet = encrypted.state;
    chat.messages.push({
      id: packetId,
      text,
      mine: true,
      timestamp: Date.now(),
      state: "sending",
      envelopeHash: toBase64url(contentHash(encrypted.envelope)),
    });
    data.outbox.push({
      id: packetId,
      actor: chat.alias,
      derivationId: chat.aliasId,
      purpose: "conversation",
      peer: chat.peerAlias,
      envelope: toBase64url(encrypted.envelope),
      chatId,
    });
    // This is the commit point. No packet may be submitted before it succeeds.
    await save();
    this.snapshot(data);
  }
  private async prepareQueued(data: PrivateFile, save: () => Promise<void>): Promise<void> {
    this.queued = await this.store.drafts(drafts => structuredClone(drafts));
    if (data.autoConnect !== false) {
      // One active conversation per peer avoids paying for repeated introductions.
      for (const chat of data.chats.filter(c => c.status === "incoming")) {
        const existing = data.chats.find(c => c !== chat && c.peer === chat.peer && c.status !== "closed" && c.status !== "incoming");
        if (existing) {
          if (existing.status !== "outgoing") continue;
          // Simultaneous first messages choose the same introduction on both
          // browsers. Move only unsent drafts; never move an advanced ratchet.
          const loser = this.me.account < chat.peer ? chat : existing;
          const winner = loser === chat ? existing : chat;
          this.markClosed(data, loser);
          loser.closeNotice = "received";
          loser.supersededBy = winner.id;
          await save();
          this.queued = await this.store.drafts(drafts => {
            for (const draft of drafts) if (draft.chatId === loser.id) draft.chatId = winner.id;
            return structuredClone(drafts);
          });
          if (loser === chat) continue;
        }
        try { await this.acceptInFile(data, save, chat.id); }
        catch (error) { this.chatErrors.set(chat.id, error instanceof Error ? error.message : String(error)); }
      }
    }
    for (const draft of [...this.queued]) {
      try {
        if (data.chats.some(c => c.messages.some(m => m.id === draft.id))) {
          await this.removeDraft(draft.id);
          continue;
        }
        let chat = data.chats.find(c => c.peer === draft.peer && c.status !== "closed");
        const previous = data.chats.find(c => c.id === draft.chatId);
        if (previous?.supersededBy) {
          const winner = data.chats.find(c => c.id === previous.supersededBy && c.peer === draft.peer);
          if (!winner) throw new Error("Could not restore the merged conversation");
          draft.chatId = winner.id;
          this.queued = await this.store.drafts(drafts => {
            const saved = drafts.find(d => d.id === draft.id);
            if (saved) saved.chatId = winner.id;
            return structuredClone(drafts);
          });
        }
        const closed = draft.chatId && data.chats.find(c => c.id === draft.chatId && c.status === "closed");
        if (closed) {
          closed.messages.push({ id: draft.id, text: draft.text, mine: true, timestamp: draft.createdAt, state: "not-sent" });
          await save();
          await this.removeDraft(draft.id);
          continue;
        }
        if (!chat) {
          const chatId = await this.startInFile(data, save, draft.peer);
          chat = data.chats.find(c => c.id === chatId)!;
        }
        if (!draft.chatId) {
          const chatId = chat.id;
          this.queued = await this.store.drafts(drafts => {
            const saved = drafts.find(d => d.id === draft.id);
            if (saved) saved.chatId = chatId;
            return structuredClone(drafts);
          });
        }
        if (chat.status === "incoming") await this.acceptInFile(data, save, chat.id);
        if (!chat.ratchet || !chat.peerAlias) continue;
        // A crash after committing the ratchet but before clearing the queue
        // must never encrypt this message a second time.
        if (!data.chats.some(c => c.messages.some(m => m.id === draft.id)))
          await this.sendInFile(data, save, chat.id, draft.text, draft.id);
        await save();
        await this.removeDraft(draft.id);
        this.queueErrors.delete(draft.peer);
      } catch (error) { this.queueErrors.set(draft.peer, error instanceof Error ? error.message : String(error)); }
    }
  }
  private async removeDraft(id: string): Promise<void> {
    this.queued = await this.store.drafts(drafts => {
      const index = drafts.findIndex(d => d.id === id);
      if (index >= 0) drafts.splice(index, 1);
      return structuredClone(drafts);
    });
  }
  private markClosed(data: PrivateFile, chat: PrivateChat): void {
    chat.status = "closed";
    chat.closedAt ??= Date.now();
    delete chat.setup;
    delete chat.returnSecret;
    delete chat.ratchet;
    delete chat.invitation;
    // An attempted broadcast may have succeeded even if its receipt was lost.
    // Only never-encrypted drafts can truthfully be labelled "not sent".
    for (const message of chat.messages) if (message.mine && message.state === "sending") message.state = "stopped";
    this.chatErrors.delete(chat.id);
    // Keep a durable close notification, but never send queued chat messages.
    data.outbox = data.outbox.filter(p => p.chatId !== chat.id || p.kind === "close");
  }
  async close(chatId: string): Promise<void> {
    await this.store.edit(async (data, save) => {
      // A pending placeholder can become a real conversation while close waits
      // for the sync lock. Resolve it again inside that lock before cancelling.
      const peer = chatId.startsWith("pending:") ? chatId.slice(8) : undefined;
      const chat = data.chats.find(c => c.id === chatId || (peer && c.peer === peer && c.status !== "closed"));
      this.queued = await this.store.drafts(drafts => {
        for (let i = drafts.length - 1; i >= 0; i--)
          if (drafts[i]!.chatId === chatId || drafts[i]!.peer === (chat?.peer ?? peer)) drafts.splice(i, 1);
        return structuredClone(drafts);
      });
      if (!chat) { this.snapshot(data); return; }
      if (chat.status === "closed") { this.snapshot(data); return; }
      this.markClosed(data, chat);
      chat.closeNotice = "needed";
      chat.closeChannelPending = !!chat.peerAlias;
      await save();
      this.snapshot(data);
    });
    void this.sync();
  }
  private async closures(data: PrivateFile, save: () => Promise<void>): Promise<void> {
    for (const chat of data.chats) {
      if (chat.status !== "closed") continue;
      // Repair requests closed locally by older builds. No chat keys are restored.
      if (!chat.closeNotice) {
        chat.closeNotice = "needed";
        chat.closedAt ??= Date.now();
        chat.closeChannelPending = !!chat.peerAlias;
      }
      if (!chat.closeChannelPending && ["sent", "received"].includes(chat.closeNotice)) continue;
      delete chat.closeError;
      try {
        if (chat.closeChannelPending && chat.peerAlias) {
          const result = await this.protocol.reads.messaging.get_private_channel({ a: chat.alias, b: chat.peerAlias });
          if (!result) throw new Error("Could not check whether the conversation is closed");
          const channel = result.value;
          if (channel?.status === 3) {
            const head = await this.head();
            if (channel.block && BigInt(channel.block) <= BigInt(head.last_irreversible_block)) chat.closeChannelPending = false;
          } else if (channel && Date.now() - (chat.closeChannelAttempt ?? 0) >= RETRY_MS) {
            chat.closeChannelAttempt = Date.now();
            await save();
            await this.submit(privateWallet(this.me.seed, this.scope, "conversation", chat.aliasId), [
              await this.protocol.ops.messaging.close_private_channel({ actor: chat.alias, peer: chat.peerAlias }),
            ], "Closing conversation");
          } else if (!channel && ["sent", "received"].includes(chat.closeNotice)) {
            chat.closeChannelPending = false;
          }
        }
        if (chat.closeNotice === "needed") {
          const devices = (await this.protocol.reads.messaging.get_private_devices({ account: chat.peer }))?.values;
          if (!devices?.length) throw new Error("The other person has no messaging browser available to receive the cancellation. It will retry automatically.");
          const value: Closure = { kind: "close", id: chat.id, from: this.me.account, to: chat.peer, createdAt: chat.closedAt! };
          const signed: Signed<Closure> = { value, signature: await signPrivateStatement(this.scope, "close", value, this.me.signer) };
          // Invitations are addressed to a browser; notify every currently registered
          // browser so acceptance and cancellation work in either direction.
          const packets = devices.map(device => {
            const derivationId = id(), packetId = id();
            const actor = privateWallet(this.me.seed, this.scope, "invitation", derivationId).getAddress();
            return { id: packetId, actor, derivationId, purpose: "invitation" as const, peer: "", kind: "close" as const,
              envelope: toBase64url(sealPrivateInvitation(this.context(actor, "", packetId), device.delivery_key, signed)), chatId: chat.id };
          });
          data.outbox.push(...packets);
          chat.closeNotice = "queued";
          await save();
        }
      } catch (error) {
        chat.closeError = error instanceof Error ? error.message : String(error);
        this.error = chat.closeError;
      }
      this.snapshot(data);
    }
  }
  private async receiveClosure(data: PrivateFile, signed: Signed<Closure>, timestamp: number): Promise<void> {
    const v = signed.value;
    if (!validId(v.id) || v.to !== this.me.account || v.from === this.me.account || !isAddress(v.from)
      || !Number.isSafeInteger(v.createdAt) || v.createdAt > timestamp + 300_000) return;
    const chat = data.chats.find(c => c.id === v.id);
    if (chat && chat.peer !== v.from) return;
    if (!verifyPrivateStatement(this.scope, "close", v, signed.signature, await this.owner(v.from))) return;
    if (chat) {
      this.markClosed(data, chat);
      chat.closeNotice = "received";
      chat.closeChannelPending = !!chat.peerAlias;
      delete chat.closeError;
      data.outbox = data.outbox.filter(p => p.chatId !== chat.id);
    } else {
      // A cancellation can arrive before its invitation. Keep only authenticated,
      // bounded tombstones so that a delayed invitation cannot resurrect it.
      data.closedRequests = (data.closedRequests ?? []).filter(c => c.expiresAt > Date.now() && !(c.id === v.id && c.peer === v.from));
      data.closedRequests.push({ id: v.id, peer: v.from, expiresAt: Date.now() + INVITATION_LIFETIME });
      data.closedRequests = data.closedRequests.slice(-256);
    }
  }
  private context(
    actor: string,
    peer: string,
    packetId: string,
  ): PrivatePacketContext {
    return { ...this.scope, actor, peer, packetId };
  }
  private async ensureDevice(
    data: PrivateFile,
    save: () => Promise<void>,
  ): Promise<boolean> {
    const devices = (
      await this.protocol.reads.messaging.get_private_devices({
        account: this.me.account,
      })
    )?.values;
    if (!devices)
      throw new Error("Could not read the messaging device directory");
    this.devices = devices.map((d) => ({
      id: toBase64url(d.device_id),
      label: d.label,
      current: toBase64url(d.device_id) === data.deviceId,
      updatedAt: d.updated_at,
    }));
    const found = devices.find(
      (d) =>
        toBase64url(d.device_id) === data.deviceId &&
        toBase64url(d.delivery_key) === data.deliveryPublic,
    );
    if (found) {
      data.registered = true;
      return true;
    }
    if (data.registered) {
      data.enabled = false;
      data.registered = false;
      throw new Error(
        "This messaging browser was revoked. Enable it again to receive new requests.",
      );
    }
    if (Date.now() - (data.deviceAttempt ?? 0) >= RETRY_MS) {
      data.deviceAttempt = Date.now();
      await save();
      await this.submit(
        this.me.signer,
        [
          await this.protocol.ops.messaging.set_private_device({
            account: this.me.account,
            device_id: fromBase64url(data.deviceId),
            delivery_key: fromBase64url(data.deliveryPublic),
            label: "Web browser",
          }),
        ],
        "Enabling private messages",
      );
    }
    return false;
  }
  private async funded(
    data: PrivateFile,
    save: () => Promise<void>,
    actor: string,
    unitsToReserve = 4,
    minimum = 1,
  ): Promise<boolean> {
    const stage = (message: string) => {
      this.fundingSteps.set(actor, message);
      this.snapshot(data);
    };
    if (!this.fundingSteps.has(actor)) stage("Checking message allowance.");
    const units = (
      await this.protocol.reads.messaging.get_private_units({ account: actor })
    )?.units;
    if (units === undefined)
      throw new Error("Could not read private message allowance");
    if (BigInt(units) >= BigInt(minimum)) {
      this.fundingSteps.delete(actor);
      return true;
    }
    let funding = data.funding[actor];
    if (funding?.grantId) {
      const grant = await this.protocol.reads.messaging.get_private_grant({ grant_id: fromBase64url(funding.grantId) });
      if (!grant) throw new Error("Could not check message allowance delivery");
      // An extant, insufficient grant needs a new reservation. An orphaned grant
      // retries its original reservation/id instead of charging a second time.
      if (grant.value) { delete data.funding[actor]; funding = undefined; }
    }
    if (!funding) {
      stage("Connecting to the message sponsor.");
      if (!this.sponsorUrls.length)
        throw new Error("Choose a private messaging sponsor in Settings");
      let chosen: { endpoint: string; sponsor: string } | undefined;
      let discovered = false;
      for (const endpoint of this.sponsorUrls) {
        try {
          const sponsor = new SponsorClient({
            endpoint,
            expectedChainId: this.scope.chainId,
          });
          const doc = await sponsor.discover();
          discovered = true;
          if (
            doc.policy.allowed.some(
              (a) =>
                a.contract === this.scope.contract &&
                a.entryPoints.includes(
                  ABIS.messaging.methods.reserve_private_usage!.entry_point,
                ),
            )
          ) {
            chosen = { endpoint, sponsor: doc.sponsor };
            break;
          }
        } catch {
          /* Try the next configured sponsor before reserving anything. */
        }
      }
      if (!chosen)
        throw new Error(discovered
          ? "Your sponsor needs the private messaging update"
          : "Could not reach a private messaging sponsor. The saved request will retry automatically.");
      funding = { id: id(), ...chosen, units: unitsToReserve };
      data.funding[actor] = funding;
      await save();
    }
    const reservation = (
      await this.protocol.reads.messaging.get_private_reservation({
        reservation_id: fromBase64url(funding.id),
      })
    )?.value;
    if (!reservation) {
      stage("Reserving message allowance. Waiting for network confirmation.");
      if (Date.now() - (funding.lastAttempt ?? 0) < RETRY_MS) return false;
      funding.lastAttempt = Date.now();
      await save();
      await this.submit(
        this.me.signer,
        [
          await this.protocol.ops.messaging.reserve_private_usage({
            account: this.me.account,
            sponsor: funding.sponsor,
            reservation_id: fromBase64url(funding.id),
            units: funding.units,
          }),
        ],
        "Preparing message allowance",
      );
      return false;
    }
    if (
      reservation.account !== this.me.account ||
      reservation.sponsor !== funding.sponsor ||
      reservation.units !== funding.units
    )
      throw new Error("Private usage reservation mismatch");
    const sponsor = new SponsorClient({ endpoint: funding.endpoint, expectedChainId: this.scope.chainId });
    const discovery = await sponsor.discover();
    if (discovery.sponsor !== funding.sponsor)
      throw new Error("The sponsor changed identity; keep this saved reservation for recovery");
    const head = await this.head();
    const fast = privateConfirmationDepth(this.protocol.deployment.network);
    const depth = fast && discovery.policy.privateUsageConfirmations === fast ? fast : 0;
    const boundary = privateConfirmationHeight(head, depth);
    if (BigInt(reservation.block) > boundary) {
      stage(depth
        ? `Confirming message allowance (${BigInt(reservation.block) - boundary} blocks remaining).`
        : `Waiting for message allowance to become final (${BigInt(reservation.block) - boundary} blocks remaining).${fast ? " This sponsor still needs the faster messaging update." : ""}`);
      return false;
    }
    stage("Waiting for the sponsor to activate message allowance.");
    if (Date.now() - (funding.lastAllocationAttempt ?? 0) < RETRY_MS) return false;
    const payload = { reservationId: funding.id, actor };
    funding.lastAllocationAttempt = Date.now();
    await save();
    const grant = await sponsor.allocatePrivateUsage({
      ...payload,
      signature: await signPrivateStatement(
        this.scope,
        "allocate",
        payload,
        this.me.signer,
      ),
    });
    funding.grantId = grant.grantId;
    await save();
    return false;
  }
  private async warmAllowance(data: PrivateFile, save: () => Promise<void>): Promise<void> {
    if (data.prepareInAdvance === false || data.spareAliasReady || !this.sponsorUrls.length || Date.now() < this.warmRetryAt
      || this.queued.length || data.outbox.some(p => !p.observed)
      || data.chats.some(c => c.status !== "closed" && c.status !== "ready")
      // Do not let optional replenishment compete with an active exchange.
      || data.chats.some(c => c.status === "ready" && Date.now() - Math.max(c.createdAt, c.messages.at(-1)?.timestamp ?? 0) < 60_000)) return;
    // At most one unused conversation wallet. It never signs a peer's traffic
    // until claimed, and its persisted reservation is reused after a restart.
    data.spareAliasId ??= id();
    await save();
    const actor = privateWallet(this.me.seed, this.scope, "conversation", data.spareAliasId).getAddress();
    try { data.spareAliasReady = await this.funded(data, save, actor, 4, 4); }
    catch { this.warmRetryAt = Date.now() + 60_000; /* Preparation must not interrupt an existing conversation. */ }
  }
  private async verified(row: PrivatePacketView, irreversible?: string): Promise<boolean> {
    if (!validId(row.packet_id) || !/^(0|[1-9][0-9]{0,19})$/.test(row.sequence))
      throw new Error("Invalid packet record");
    const record = (
      await this.protocol.reads.messaging.get_private_packet({
        actor: row.actor,
        packet_id: fromBase64url(row.packet_id),
      })
    )?.value;
    if (
      !record ||
      record.actor !== row.actor ||
      record.peer !== row.peer ||
      record.sequence !== row.sequence ||
      record.block !== row.block ||
      record.timestamp !== row.timestamp ||
      !bytesEqual(
        record.content_hash,
        contentHash(fromBase64url(row.envelope)),
      ) ||
      !bytesEqual(record.packet_id, fromBase64url(row.packet_id))
    )
      throw new Error("Message could not be verified on chain");
    const lib = irreversible ?? (await this.head()).last_irreversible_block;
    return BigInt(record.block) <= BigInt(lib);
  }
  private async *confirmedPackets(rows: PrivatePacketView[]): AsyncGenerator<PrivatePacketView> {
    if (!rows.length) return;
    // A recovery scan can contain many unrelated invitations. Reuse a conservative
    // finality boundary and bound parallel reads instead of two serial RPCs per row.
    const head = await this.head();
    this.scanIrreversible = BigInt(head.last_irreversible_block);
    // On testnet, authenticated packets can be displayed at inclusion. Their
    // ciphertext and cursors remain recoverable until full irreversibility.
    const boundary = privateConfirmationHeight(head, this.protocol.deployment.network === "harbinger" ? 1 : 0).toString();
    for (let offset = 0; offset < rows.length; offset += 4) {
      const batch = rows.slice(offset, offset + 4);
      const results = await Promise.allSettled(batch.map(row => this.verified(row, boundary)));
      for (const [index, result] of results.entries()) {
        this.active();
        if (result.status === "rejected") throw result.reason;
        if (!result.value) return;
        yield batch[index]!;
      }
    }
  }
  private async invitations(
    data: PrivateFile,
    save: () => Promise<void>,
  ): Promise<void> {
    let scanAfter = data.inboxAfter;
    for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
      const page = await this.indexer.privatePackets(scanAfter);
      for await (const row of this.confirmedPackets(page.items)) {
        this.active();
        if (row.peer || BigInt(row.sequence) <= BigInt(data.inboxAfter))
          throw new Error("Invalid invitation page");
        const context = this.context(row.actor, "", row.packet_id),
          bytes = fromBase64url(row.envelope);
        const opened = openPrivateInvitation<Signed<Invitation | Closure>>(
          context,
          fromBase64url(data.deliverySecret),
          bytes,
        );
        if (opened?.value?.kind === "invite")
          await this.receiveInvitation(data, opened as Signed<Invitation>, Number(row.timestamp));
        else if (opened?.value?.kind === "close" && BigInt(row.block) <= this.scanIrreversible)
          await this.receiveClosure(data, opened as Signed<Closure>, Number(row.timestamp));
        else {
          for (const chat of data.chats) {
            if (chat.status !== "outgoing" || !chat.returnSecret || !chat.setup)
              continue;
            const reply = openPrivateInvitation<AcceptanceEnvelope>(
              context,
              fromBase64url(chat.returnSecret),
              bytes,
            );
            if (reply?.kind !== "accept" || reply.id !== chat.id) continue;
            let accepted: Awaited<
              ReturnType<typeof finishRatchet<Signed<Acceptance>>>
            >;
            try {
              accepted = await finishRatchet<Signed<Acceptance>>(
                fromBase64url(data.pickleKey),
                chat.setup.account,
                reply.identityKey,
                reply.wire,
              );
            } catch {
              continue;
            }
            const value = accepted.payload?.value;
            if (
              !value ||
              value.kind !== "accept" ||
              value.id !== chat.id ||
              value.from !== chat.peer ||
              value.to !== this.me.account ||
              value.peerAlias !== chat.alias ||
              !isAddress(value.alias)
            )
              continue;
            // A temporary RPC failure must leave this packet unread, not discard the acceptance.
            if (
              !verifyPrivateStatement(
                this.scope,
                "accept",
                value,
                accepted.payload.signature,
                await this.owner(chat.peer),
              ) ||
              !(await this.unblocked(chat.peer))
            )
              continue;
            chat.peerAlias = value.alias;
            chat.ratchet = accepted.state;
            chat.status = "accepting";
            delete chat.setup;
            delete chat.returnSecret;
            delete chat.invitation;
          }
        }
        // Keep rescanning the reversible suffix. Already processed request IDs
        // are deduplicated; replaced sequences cannot hide a later invitation.
        if (BigInt(row.block) <= this.scanIrreversible) data.inboxAfter = row.sequence;
        scanAfter = row.sequence;
        await save();
      }
      if (!page.more || scanAfter !== page.items.at(-1)?.sequence) break;
    }
  }
  private async receiveInvitation(
    data: PrivateFile,
    signed: Signed<Invitation>,
    timestamp: number,
  ): Promise<void> {
    const v = signed.value;
    if (
      !validId(v.id) ||
      v.to !== this.me.account ||
      v.from === this.me.account ||
      !isAddress(v.from) ||
      !isAddress(v.alias) ||
      v.deviceId !== data.deviceId ||
      !validId(v.returnKey) ||
      typeof v.identityKey !== "string" ||
      typeof v.oneTimeKey !== "string" ||
      !Number.isSafeInteger(v.createdAt) ||
      !Number.isSafeInteger(v.expiresAt) ||
      // A saved request may legitimately wait for funding/finality or an offline
      // browser. Its signed lifetime is seven days, not five minutes. Reject
      // future-dated and expired invitations, but do not discard delayed ones.
      v.createdAt > timestamp + 300_000 ||
      v.expiresAt <= v.createdAt ||
      v.expiresAt <= timestamp ||
      v.expiresAt <= Date.now() ||
      // Older senders sampled the two timestamps separately.
      v.expiresAt - v.createdAt > INVITATION_LIFETIME + 1_000 ||
      data.chats.some((c) => c.id === v.id)
      || data.closedRequests?.some(c => c.id === v.id && c.peer === v.from && c.expiresAt > Date.now())
    )
      return;
    if (
      !verifyPrivateStatement(
        this.scope,
        "invite",
        v,
        signed.signature,
        await this.owner(v.from),
      ) ||
      !(await this.unblocked(v.from))
    )
      return;
    if (data.chats.filter((c) => c.status === "incoming").length >= 100) return;
    const aliasId = id(),
      alias = privateWallet(
        this.me.seed,
        this.scope,
        "conversation",
        aliasId,
      ).getAddress();
    data.chats.push({
      id: v.id,
      peer: v.from,
      aliasId,
      alias,
      peerAlias: v.alias,
      status: "incoming",
      invitation: v,
      after: "0",
      messages: [],
      createdAt: timestamp,
    });
  }
  private async channels(
    data: PrivateFile,
    save: () => Promise<void>,
  ): Promise<void> {
    for (const chat of data.chats) {
      if (!chat.peerAlias || !chat.ratchet || chat.status === "closed")
        continue;
      try {
        this.chatErrors.delete(chat.id);
        const result = await this.protocol.reads.messaging.get_private_channel({
            a: chat.alias,
            b: chat.peerAlias,
          });
        if (!result) throw new Error("Could not check the private connection");
        const c = result.value;
        if (c?.status === 3) {
          const head = await this.head();
          if (
            c.block &&
            BigInt(c.block) <= BigInt(head.last_irreversible_block)
          ) {
            this.markClosed(data, chat);
            chat.closeNotice = "received";
            chat.closeChannelPending = false;
          }
          continue;
        }
        if (!c || (c.status === 1 && c.requester !== chat.alias)) {
          if (!(await this.unblocked(chat.peer))) continue;
          // Let dispatch combine consent with its first packet in one atomic
          // transaction. Older introduction wallets still use the separate path.
          if (data.outbox.some(p => p.chatId === chat.id && p.actor === chat.alias && p.kind !== "close" && !p.observed
            && (!p.peer || c?.status === 1))) continue;
          this.channelSteps.set(chat.id, "Preparing your side of the private connection.");
          if (await this.funded(data, save, chat.alias)) {
            this.channelSteps.set(chat.id, "Confirming your side of the private connection.");
            this.snapshot(data);
            await this.submit(
              privateWallet(
                this.me.seed,
                this.scope,
                "conversation",
                chat.aliasId,
              ),
              [
                await this.protocol.ops.messaging.open_private_channel({
                  actor: chat.alias,
                  peer: chat.peerAlias,
                }),
              ],
              "Connecting private conversation",
            );
          } else this.channelSteps.set(chat.id, this.fundingSteps.get(chat.alias)!);
          continue;
        }
        if (c.status !== 2) {
          this.channelSteps.set(chat.id, "Your side is ready. Waiting for the other account to finish confirming the connection.");
          continue;
        }
        chat.status = "ready";
        this.channelSteps.delete(chat.id);
        if (!(await this.unblocked(chat.peer))) continue;
        const page = await this.indexer.privatePackets(
          chat.after,
          chat.alias,
          chat.peerAlias,
        );
        for await (const row of this.confirmedPackets(page.items)) {
          if (
            !(
              (row.actor === chat.alias && row.peer === chat.peerAlias) ||
              (row.actor === chat.peerAlias && row.peer === chat.alias)
            ) ||
            BigInt(row.sequence) <= BigInt(chat.after)
          )
            throw new Error("Invalid conversation packet page");
          const previous = chat.messages.find(m => m.id === row.packet_id);
          if (previous?.envelopeHash && previous.envelopeHash !== row.content_hash)
            throw new Error("The network returned conflicting ciphertext for a saved message");
          if (previous && !previous.mine && BigInt(row.block) <= this.scanIrreversible) previous.state = "sent";
          if (
            row.actor === chat.peerAlias &&
            !chat.messages.some((m) => m.id === row.packet_id)
          ) {
            const opened = await decryptPrivateMessage(
              fromBase64url(data.pickleKey),
              chat.ratchet!,
              this.context(row.actor, row.peer, row.packet_id),
              fromBase64url(row.envelope),
            );
            chat.ratchet = opened.state;
            chat.messages.push({
              id: row.packet_id,
              text: opened.text,
              mine: false,
              timestamp: Number(row.timestamp),
              state: BigInt(row.block) <= this.scanIrreversible ? "sent" : "confirming",
              envelopeHash: row.content_hash,
            });
          }
          if (BigInt(row.block) <= this.scanIrreversible) chat.after = row.sequence;
          await save();
        }
      } catch (error) {
        // Keep this chat's cursor/keys intact on failure, but let other chats progress.
        this.error = error instanceof Error ? error.message : String(error);
        this.chatErrors.set(chat.id, this.error);
      }
    }
  }
  private async dispatch(
    data: PrivateFile,
    save: () => Promise<void>,
  ): Promise<void> {
    // Order chat messages, but let independent device cancellation notices progress.
    const visited = new Set<string>();
    for (const packet of [...data.outbox]) {
      const orderKey = packet.kind === "close" ? packet.id : packet.chatId;
      if (visited.has(orderKey)) continue;
      visited.add(orderKey);
      this.active();
      const chat = data.chats.find(c => c.id === packet.chatId);
      if (!chat || (chat.status === "closed" && packet.kind !== "close")) continue;
      try {
        const result = await this.protocol.reads.messaging.get_private_packet({ actor: packet.actor, packet_id: fromBase64url(packet.id) });
        if (!result) throw new Error("Could not check encrypted message delivery");
        const existing = result.value;
        if (existing) {
          if (existing.peer !== packet.peer || !bytesEqual(existing.content_hash, contentHash(fromBase64url(packet.envelope))))
            throw new Error("Saved packet does not match the chain");
          delete packet.error;
          const head = await this.head();
          const message = chat.messages.find(m => m.id === packet.id);
          if (BigInt(existing.block) > BigInt(head.last_irreversible_block)) {
            if (BigInt(existing.block) <= privateConfirmationHeight(head, this.protocol.deployment.network === "harbinger" ? 1 : 0)) {
              packet.observed = true;
              if (message) message.state = "confirming";
            }
            // Retain this exact ciphertext for reorg recovery, but do not make
            // every later message wait for its predecessor's full finality.
            if (packet.kind !== "close") visited.delete(orderKey);
            continue;
          }
          data.outbox = data.outbox.filter(p => p.id !== packet.id);
          this.fundingSteps.delete(packet.actor);
          if (packet.kind === "close" && !data.outbox.some(p => p.chatId === chat.id && p.kind === "close")) chat.closeNotice = "sent";
          if (message) { message.state = "sent"; message.timestamp = Number(existing.timestamp); }
          await save();
          if (packet.kind !== "close") visited.delete(orderKey);
          continue;
        }
        if (packet.observed) {
          delete packet.observed;
          delete packet.lastAttempt;
          const message = chat.messages.find(m => m.id === packet.id);
          if (message) message.state = "sending";
          await save();
        }
        if (packet.kind !== "close" && !(await this.unblocked(chat.peer))) throw new Error("This conversation is blocked");
        let open = false;
        if (chat.peerAlias && packet.actor === chat.alias && packet.kind !== "close") {
          const result = await this.protocol.reads.messaging.get_private_channel({ a: chat.alias, b: chat.peerAlias });
          if (!result) throw new Error("Could not check the private connection");
          const channel = result.value;
          if (channel?.status === 3) continue;
          open = !channel || (channel.status === 1 && channel.requester !== chat.alias);
          // A message can accompany our consent only if their consent is already
          // on chain. The contract checks this again atomically when executing.
          if (packet.peer && channel?.status !== 2 && !(channel?.status === 1 && open)) continue;
        } else if (packet.peer && chat.status !== "ready") continue;
        delete packet.error;
        if (!(await this.funded(data, save, packet.actor, packet.purpose === "invitation" ? 1 : 4, open ? 2 : 1))) continue;
        if (Date.now() - (packet.lastAttempt ?? 0) < RETRY_MS) continue;
        const signer = privateWallet(this.me.seed, this.scope, packet.purpose, packet.derivationId);
        if (signer.getAddress() !== packet.actor) throw new Error("Saved conversation wallet mismatch");
        packet.lastAttempt = Date.now();
        await save();
        this.snapshot(data);
        const operations: OperationJson[] = [];
        if (open) operations.push(await this.protocol.ops.messaging.open_private_channel({ actor: chat.alias, peer: chat.peerAlias! }));
        operations.push(await this.protocol.ops.messaging.post_private_packet({
          actor: packet.actor, ...(packet.peer ? { peer: packet.peer } : {}), packet_id: fromBase64url(packet.id), envelope: fromBase64url(packet.envelope),
        }));
        await this.submit(signer, operations, packet.kind === "close" ? "Notifying conversation closure" : "Sending private message");
      } catch (error) {
        // Funding and lookup failures belong to this packet too; one broken
        // request must not silently stall every newer conversation behind it.
        packet.error = error instanceof Error ? error.message : String(error);
        this.error = packet.error;
      }
      await save();
      this.snapshot(data);
    }
  }
  async sync(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    this.syncHead = undefined;
    try {
      await this.store.edit(async (data, save) => {
        this.error = "";
        try {
          if (data.enabled && (await this.ensureDevice(data, save))) {
            if (data.inboxValidation !== 2) {
              // Older clients skipped delayed invitations and did not understand
              // encrypted cancellations. Rescan once; chat IDs, tombstones, and
              // ratchet state make this replay safe, including staggered upgrades.
              data.inboxAfter = "0";
              data.inboxValidation = 2;
              await save();
            }
            // Receiving can fail independently of sending (for example an
            // indexer outage). Keep the durable outbox and closures moving.
            for (const work of [this.prepareQueued, this.closures, this.dispatch, this.invitations, this.prepareQueued, this.channels, this.dispatch, this.warmAllowance]) {
              try { await work.call(this, data, save); }
              catch (error) { this.error = error instanceof Error ? error.message : String(error); }
              await save();
              this.snapshot(data);
            }
          }
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
        }
        await save();
        this.snapshot(data);
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      if (!this.stopped)
        this.changed({
          enabled: false,
          registered: false,
          chats: [],
          pending: 0,
          error: this.error,
        });
    } finally {
      this.syncHead = undefined;
      this.running = false;
    }
  }
}
