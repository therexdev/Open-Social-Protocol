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
  type Invitation,
  type PrivateChat,
  type PrivateFile,
  type Signed,
} from "./privateStore";

const id = () => toBase64url(randomBytes(32));
const INVITATION_LIFETIME = 7 * 86_400_000;
const RETRY_MS = 20_000;
export interface PrivateSnapshot {
  enabled: boolean;
  registered: boolean;
  chats: Array<
    Pick<PrivateChat, "id" | "peer" | "status" | "messages" | "createdAt">
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
  private running = false;
  private stopped = false;
  private devices: NonNullable<PrivateSnapshot["devices"]> = [];
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
    this.changed({
      enabled: data.enabled,
      registered: !!data.registered,
      chats: data.chats.map((c) => ({
        id: c.id,
        peer: c.peer,
        status: c.status,
        messages: structuredClone(c.messages),
        createdAt: c.createdAt,
      })),
      pending: data.outbox.length,
      error: this.error,
      devices: this.devices,
    });
  }
  async load(): Promise<void> {
    await this.store.edit(async (data) => this.snapshot(data));
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
      { label, quietProgress: true, waitForReceipt: false },
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
        data.inboxAfter = status.sequence;
      }
      await save();
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
    if (!isAddress(peer) || peer === this.me.account)
      throw new Error("Enter another person's account address");
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
    const chatId = await this.store.edit(async (data, save) => {
      if (!data.registered)
        throw new Error("Finish enabling this browser first");
      const existing = data.chats.find(
        (c) => c.peer === peer && c.status !== "closed",
      );
      if (existing) return existing.id;
      const channelId = id(),
        aliasId = id(),
        introId = id(),
        packetId = id();
      const wallet = privateWallet(
        this.me.seed,
        this.scope,
        "conversation",
        aliasId,
      );
      const intro = privateWallet(
        this.me.seed,
        this.scope,
        "invitation",
        introId,
      );
      const setup = await createRatchetSetup(fromBase64url(data.pickleKey)),
        reply = x25519KeyPair();
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
        createdAt: Date.now(),
        expiresAt: Date.now() + INVITATION_LIFETIME,
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
      const context = this.context(intro.getAddress(), "", packetId);
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
        actor: intro.getAddress(),
        derivationId: introId,
        purpose: "invitation",
        peer: "",
        envelope: toBase64url(envelope),
        chatId: channelId,
      });
      await save();
      this.snapshot(data);
      return channelId;
    });
    void this.sync();
    return chatId;
  }
  async accept(chatId: string): Promise<void> {
    await this.store.edit(async (data, save) => {
      const chat = data.chats.find((c) => c.id === chatId);
      if (!chat || chat.status !== "incoming" || !chat.invitation)
        throw new Error("Message request is no longer available");
      if (!(await this.unblocked(chat.peer)))
        throw new Error("This conversation is blocked");
      if (chat.invitation.expiresAt < Date.now())
        throw new Error(
          "This request has expired. Ask them to send a new request.",
        );
      const value: Acceptance = {
        kind: "accept",
        id: chat.id,
        from: this.me.account,
        to: chat.peer,
        alias: chat.alias,
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
      const introId = id(),
        packetId = id(),
        intro = privateWallet(this.me.seed, this.scope, "invitation", introId);
      const reply: AcceptanceEnvelope = {
        kind: "accept",
        id: chat.id,
        identityKey: accepted.identityKey,
        wire: accepted.wire,
      };
      const envelope = sealPrivateInvitation(
        this.context(intro.getAddress(), "", packetId),
        fromBase64url(chat.invitation.returnKey),
        reply,
      );
      chat.ratchet = accepted.state;
      chat.status = "accepting";
      delete chat.invitation;
      data.outbox.push({
        id: packetId,
        actor: intro.getAddress(),
        derivationId: introId,
        purpose: "invitation",
        peer: "",
        envelope: toBase64url(envelope),
        chatId: chat.id,
      });
      await save();
      this.snapshot(data);
    });
    void this.sync();
  }
  async send(chatId: string, text: string): Promise<void> {
    await this.store.edit(async (data, save) => {
      const chat = data.chats.find((c) => c.id === chatId);
      if (!chat || chat.status !== "ready" || !chat.ratchet || !chat.peerAlias)
        throw new Error("This conversation is not ready yet");
      if (!(await this.unblocked(chat.peer)))
        throw new Error("This conversation is blocked");
      if (data.outbox.filter((p) => p.chatId === chatId && p.peer).length >= 20)
        throw new Error("Wait for your pending messages to send");
      const packetId = id(),
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
    });
    void this.sync();
  }
  async close(chatId: string): Promise<void> {
    await this.store.edit(async (data, save) => {
      const chat = data.chats.find((c) => c.id === chatId);
      if (!chat) return;
      if (chat.peerAlias) {
        const existing = (
          await this.protocol.reads.messaging.get_private_channel({
            a: chat.alias,
            b: chat.peerAlias,
          })
        )?.value;
        if (existing && existing.status !== 3) {
          await this.submit(
            privateWallet(
              this.me.seed,
              this.scope,
              "conversation",
              chat.aliasId,
            ),
            [
              await this.protocol.ops.messaging.close_private_channel({
                actor: chat.alias,
                peer: chat.peerAlias,
              }),
            ],
            "Closing conversation",
          );
        }
      }
      chat.status = "closed";
      delete chat.setup;
      delete chat.returnSecret;
      delete chat.ratchet;
      delete chat.invitation;
      // Submitted packets may still arrive; never create replacement ciphertext for them.
      data.outbox = data.outbox.filter((p) => p.chatId !== chatId);
      await save();
      this.snapshot(data);
    });
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
  ): Promise<boolean> {
    const units = (
      await this.protocol.reads.messaging.get_private_units({ account: actor })
    )?.units;
    if (units === undefined)
      throw new Error("Could not read private message allowance");
    if (BigInt(units) > 0n) {
      delete data.funding[actor];
      return true;
    }
    let funding = data.funding[actor];
    if (!funding) {
      if (!this.sponsorUrls.length)
        throw new Error("Choose a private messaging sponsor in Settings");
      let chosen: { endpoint: string; sponsor: string } | undefined;
      for (const endpoint of this.sponsorUrls) {
        try {
          const sponsor = new SponsorClient({
            endpoint,
            expectedChainId: this.scope.chainId,
          });
          const doc = await sponsor.discover();
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
        throw new Error("Your sponsor needs the private messaging update");
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
    const head = await this.protocol.provider.getHeadInfo();
    if (BigInt(reservation.block) > BigInt(head.last_irreversible_block))
      return false;
    if (Date.now() - (funding.lastAttempt ?? 0) < RETRY_MS) return false;
    const payload = { reservationId: funding.id, actor };
    funding.lastAttempt = Date.now();
    await save();
    const sponsor = new SponsorClient({
      endpoint: funding.endpoint,
      expectedChainId: this.scope.chainId,
    });
    const discovery = await sponsor.discover();
    if (discovery.sponsor !== funding.sponsor)
      throw new Error(
        "The sponsor changed identity; keep this saved reservation for recovery",
      );
    await sponsor.allocatePrivateUsage({
      ...payload,
      signature: await signPrivateStatement(
        this.scope,
        "allocate",
        payload,
        this.me.signer,
      ),
    });
    return false;
  }
  private async verified(row: PrivatePacketView): Promise<boolean> {
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
      record.timestamp !== row.timestamp ||
      !bytesEqual(
        record.content_hash,
        contentHash(fromBase64url(row.envelope)),
      ) ||
      !bytesEqual(record.packet_id, fromBase64url(row.packet_id))
    )
      throw new Error("Message could not be verified on chain");
    const head = await this.protocol.provider.getHeadInfo();
    return BigInt(record.block) <= BigInt(head.last_irreversible_block);
  }
  private async invitations(
    data: PrivateFile,
    save: () => Promise<void>,
  ): Promise<void> {
    const page = await this.indexer.privatePackets(data.inboxAfter);
    for (const row of page.items) {
      this.active();
      if (row.peer || BigInt(row.sequence) <= BigInt(data.inboxAfter))
        throw new Error("Invalid invitation page");
      if (!(await this.verified(row))) break;
      const context = this.context(row.actor, "", row.packet_id),
        bytes = fromBase64url(row.envelope);
      const opened = openPrivateInvitation<Signed<Invitation>>(
        context,
        fromBase64url(data.deliverySecret),
        bytes,
      );
      if (opened?.value?.kind === "invite")
        await this.receiveInvitation(data, opened, Number(row.timestamp));
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
      data.inboxAfter = row.sequence;
      await save();
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
      Math.abs(v.createdAt - timestamp) > 300_000 ||
      v.expiresAt <= Date.now() ||
      v.expiresAt - v.createdAt > INVITATION_LIFETIME ||
      data.chats.some((c) => c.id === v.id)
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
        const c = (
          await this.protocol.reads.messaging.get_private_channel({
            a: chat.alias,
            b: chat.peerAlias,
          })
        )?.value;
        if (c?.status === 3) {
          const head = await this.protocol.provider.getHeadInfo();
          if (
            c.block &&
            BigInt(c.block) <= BigInt(head.last_irreversible_block)
          ) {
            chat.status = "closed";
            delete chat.ratchet;
          }
          continue;
        }
        if (!c || (c.status === 1 && c.requester !== chat.alias)) {
          if (await this.funded(data, save, chat.alias)) {
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
          }
          continue;
        }
        if (c.status !== 2) continue;
        chat.status = "ready";
        if (!(await this.unblocked(chat.peer))) continue;
        const page = await this.indexer.privatePackets(
          chat.after,
          chat.alias,
          chat.peerAlias,
        );
        for (const row of page.items) {
          if (
            !(
              (row.actor === chat.alias && row.peer === chat.peerAlias) ||
              (row.actor === chat.peerAlias && row.peer === chat.alias)
            ) ||
            BigInt(row.sequence) <= BigInt(chat.after)
          )
            throw new Error("Invalid conversation packet page");
          if (!(await this.verified(row))) break;
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
              state: "sent",
            });
          }
          chat.after = row.sequence;
          await save();
        }
      } catch (error) {
        // Keep this chat's cursor/keys intact on failure, but let other chats progress.
        this.error = error instanceof Error ? error.message : String(error);
      }
    }
  }
  private async dispatch(
    data: PrivateFile,
    save: () => Promise<void>,
  ): Promise<void> {
    // One packet per conversation per pass preserves ordering while independent chats progress.
    const visited = new Set<string>();
    for (const packet of [...data.outbox]) {
      if (visited.has(packet.chatId)) continue;
      visited.add(packet.chatId);
      this.active();
      const chat = data.chats.find((c) => c.id === packet.chatId);
      if (!chat || chat.status === "closed") continue;
      const existing = (
        await this.protocol.reads.messaging.get_private_packet({
          actor: packet.actor,
          packet_id: fromBase64url(packet.id),
        })
      )?.value;
      if (existing) {
        if (
          existing.peer !== packet.peer ||
          !bytesEqual(
            existing.content_hash,
            contentHash(fromBase64url(packet.envelope)),
          )
        )
          throw new Error("Saved packet does not match the chain");
        const head = await this.protocol.provider.getHeadInfo();
        if (BigInt(existing.block) > BigInt(head.last_irreversible_block))
          continue;
        data.outbox = data.outbox.filter((p) => p.id !== packet.id);
        const message = chat.messages.find((m) => m.id === packet.id);
        if (message) {
          message.state = "sent";
          message.timestamp = Number(existing.timestamp);
        }
        await save();
        continue;
      }
      if (packet.peer && chat.status !== "ready") continue;
      if (!(await this.unblocked(chat.peer))) {
        packet.error = "This conversation is blocked";
        continue;
      }
      if (
        !(await this.funded(
          data,
          save,
          packet.actor,
          packet.purpose === "invitation" ? 1 : 4,
        ))
      )
        continue;
      if (Date.now() - (packet.lastAttempt ?? 0) < RETRY_MS) continue;
      const signer = privateWallet(
        this.me.seed,
        this.scope,
        packet.purpose,
        packet.derivationId,
      );
      if (signer.getAddress() !== packet.actor)
        throw new Error("Saved conversation wallet mismatch");
      packet.lastAttempt = Date.now();
      delete packet.error;
      await save();
      try {
        await this.submit(
          signer,
          [
            await this.protocol.ops.messaging.post_private_packet({
              actor: packet.actor,
              ...(packet.peer ? { peer: packet.peer } : {}),
              packet_id: fromBase64url(packet.id),
              envelope: fromBase64url(packet.envelope),
            }),
          ],
          "Sending private message",
        );
      } catch (error) {
        packet.error = error instanceof Error ? error.message : String(error);
        this.error = packet.error;
        await save();
      }
    }
  }
  async sync(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.store.edit(async (data, save) => {
        this.error = "";
        try {
          if (data.enabled && (await this.ensureDevice(data, save))) {
            await this.invitations(data, save);
            await this.channels(data, save);
            await this.dispatch(data, save);
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
      this.running = false;
    }
  }
}
