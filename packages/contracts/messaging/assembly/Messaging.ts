import { System, Storage, Protobuf, authority, Arrays, Crypto } from "@koinos/sdk-as";
import { messaging } from "./proto/messaging";
import { relationships } from "./proto/relationships";
import { token } from "./proto/token";
import { Actor, Capability, IS_BLOCKED_ENTRY_POINT } from "./common/actor";
import { Util } from "./common/util";
System.setSystemBufferSize(32 * 1024);

// Conversation status: 1 requested, 2 accepted, 3 closed. A new request must
// explicitly reference the last generation, preventing stale approvals/retries.
export class Messaging {
  id: Uint8Array = System.getContractId();
  config: Storage.Obj<messaging.get_dependencies_result> = new Storage.Obj<messaging.get_dependencies_result>(
    this.id,
    1,
    messaging.get_dependencies_result.decode,
    messaging.get_dependencies_result.encode,
    null
  );
  conversations: Storage.Map<Uint8Array, messaging.conversation_record> = new Storage.Map<Uint8Array, messaging.conversation_record>(
    this.id,
    2,
    messaging.conversation_record.decode,
    messaging.conversation_record.encode,
    null
  );
  messages: Storage.Map<Uint8Array, messaging.message_record> = new Storage.Map<Uint8Array, messaging.message_record>(
    this.id,
    3,
    messaging.message_record.decode,
    messaging.message_record.encode,
    null
  );
  pair(a: Uint8Array, b: Uint8Array): Uint8Array {
    return Util.compare(a, b) < 0 ? Util.concat([a, b]) : Util.concat([b, a]);
  }
  deps(): messaging.get_dependencies_result {
    const c = this.config.get();
    System.require(c != null, "messaging not configured");
    return c!;
  }
  set_dependencies(args: messaging.set_dependencies_arguments): messaging.set_dependencies_result {
    System.requireAuthority(authority.authorization_type.contract_call, this.id);
    this.config.put(
      new messaging.get_dependencies_result(
        Util.requireAddress(args.identity, "identity"),
        Util.requireAddress(args.relationships, "relationships"),
        Util.requireAddress(args.token, "token")
      )
    );
    return new messaging.set_dependencies_result();
  }
  get_dependencies(args: messaging.get_dependencies_arguments): messaging.get_dependencies_result {
    return this.deps();
  }
  unblocked(a: Uint8Array, b: Uint8Array): void {
    const rel = this.deps().relationships!;
    for (let i = 0; i < 2; i++) {
      const call = System.call(
        rel,
        IS_BLOCKED_ENTRY_POINT,
        Protobuf.encode(new relationships.is_blocked_arguments(i == 0 ? a : b, i == 0 ? b : a), relationships.is_blocked_arguments.encode)
      );
      System.require(call.code == 0 && call.res.object != null, "block check failed");
      const res = Protobuf.decode<relationships.is_blocked_result>(call.res.object!, relationships.is_blocked_result.decode);
      System.require(!res.value, "conversation blocked");
    }
  }
  authorize(a: Uint8Array, b: Uint8Array, device: Uint8Array | null): void {
    Util.requireAddress(a, "actor");
    Util.requireAddress(b, "peer");
    System.require(!Arrays.equal(a, b), "cannot message yourself");
    Actor.requireAuthorized(this.deps().identity!, a, device, Capability.MESSAGING);
  }
  consume(a: Uint8Array, units: u32 = 1): void {
    const call = System.call(
      this.deps().token!,
      0x96f39e35,
      Protobuf.encode(new token.consume_arguments(a, units), token.consume_arguments.encode)
    );
    System.require(call.code == 0, "usage allowance exhausted");
  }
  emit(c: messaging.conversation_record): void {
    System.event(
      "osp.messaging.conversation_changed",
      Protobuf.encode(new messaging.conversation_changed_event(c, Util.now()), messaging.conversation_changed_event.encode),
      [c.a!, c.b!]
    );
  }
  request_conversation(args: messaging.request_conversation_arguments): messaging.request_conversation_result {
    const a = Util.requireAddress(args.actor, "actor"),
      b = Util.requireAddress(args.peer, "peer");
    this.authorize(a, b, args.device);
    this.unblocked(a, b);
    System.require(Actor.exists(this.deps().identity!, b), "peer not registered");
    const key = this.pair(a, b),
      old = this.conversations.get(key);
    System.require(old == null || old.status == 3, "conversation already requested or accepted");
    System.require(args.generation == (old == null ? 0 : old.generation), "conversation changed; refresh");
    System.require(args.generation < u64.MAX_VALUE, "conversation generation exhausted");
    this.consume(a);
    const c = new messaging.conversation_record(
      Util.compare(a, b) < 0 ? a : b,
      Util.compare(a, b) < 0 ? b : a,
      a,
      1,
      args.generation + 1,
      old == null ? 0 : old.sequence,
      Util.now()
    );
    this.conversations.put(key, c);
    this.emit(c);
    return new messaging.request_conversation_result();
  }
  accept_conversation(args: messaging.accept_conversation_arguments): messaging.accept_conversation_result {
    const a = Util.requireAddress(args.actor, "actor"),
      b = Util.requireAddress(args.peer, "peer");
    this.authorize(a, b, args.device);
    this.unblocked(a, b);
    const key = this.pair(a, b),
      c = this.conversations.get(key);
    System.require(c != null && c.status == 1 && c.generation == args.generation, "no matching invitation");
    System.require(Arrays.equal(c!.requester!, b), "only the recipient may accept");
    c!.status = 2;
    c!.updated_at = Util.now();
    this.conversations.put(key, c!);
    this.emit(c!);
    return new messaging.accept_conversation_result();
  }
  close_conversation(args: messaging.close_conversation_arguments): messaging.close_conversation_result {
    const a = Util.requireAddress(args.actor, "actor"),
      b = Util.requireAddress(args.peer, "peer");
    this.authorize(a, b, args.device);
    const key = this.pair(a, b),
      c = this.conversations.get(key);
    System.require(c != null && c.generation == args.generation, "conversation changed; refresh");
    c!.status = 3;
    c!.updated_at = Util.now();
    this.conversations.put(key, c!);
    this.emit(c!);
    return new messaging.close_conversation_result();
  }
  send_message(args: messaging.send_message_arguments): messaging.send_message_result {
    const a = Util.requireAddress(args.sender, "sender"),
      b = Util.requireAddress(args.recipient, "recipient");
    this.authorize(a, b, args.device);
    const id = Util.requireBytes(args.message_id, 32, "message id");
    System.require(id.length == 32, "message id must be 32 bytes");
    const envelope = Util.requireBytes(args.envelope, 4096, "encrypted envelope");
    const hash = System.hash(Crypto.multicodec.sha2_256, envelope)!.slice(2);
    const key = Util.concat([a, id]),
      existing = this.messages.get(key);
    if (existing != null) {
      System.require(
        Arrays.equal(existing.recipient!, b) && existing.generation == args.generation && Arrays.equal(existing.content_hash!, hash),
        "message id already used for different content"
      );
      return new messaging.send_message_result(existing);
    }
    this.unblocked(a, b);
    const pair = this.pair(a, b),
      c = this.conversations.get(pair);
    System.require(c != null && c.status == 2 && c.generation == args.generation, "recipient must accept this conversation first");
    System.require(c!.sequence < u64.MAX_VALUE, "message sequence exhausted");
    this.consume(a);
    c!.sequence += 1;
    c!.updated_at = Util.now();
    this.conversations.put(pair, c!);
    const m = new messaging.message_record(a, b, id, hash, args.generation, c!.sequence, Util.now());
    this.messages.put(key, m);
    System.event(
      "osp.messaging.message_sent",
      Protobuf.encode(new messaging.message_sent_event(m, envelope, Util.now()), messaging.message_sent_event.encode),
      [a, b]
    );
    return new messaging.send_message_result(m);
  }
  get_conversation(args: messaging.get_conversation_arguments): messaging.get_conversation_result {
    return new messaging.get_conversation_result(
      this.conversations.get(this.pair(Util.requireAddress(args.a, "a"), Util.requireAddress(args.b, "b")))
    );
  }
  get_message(args: messaging.get_message_arguments): messaging.get_message_result {
    return new messaging.get_message_result(
      this.messages.get(Util.concat([Util.requireAddress(args.sender, "sender"), Util.requireBytes(args.message_id, 32, "message id")]))
    );
  }

  // V2 uses separate spaces; legacy messages are never treated as ratcheted packets.
  privateDevices: Storage.Map<Uint8Array, messaging.get_private_devices_result> = new Storage.Map<Uint8Array, messaging.get_private_devices_result>(this.id, 20, messaging.get_private_devices_result.decode, messaging.get_private_devices_result.encode, null);
  reservations: Storage.Map<Uint8Array, messaging.private_reservation> = new Storage.Map<Uint8Array, messaging.private_reservation>(this.id, 21, messaging.private_reservation.decode, messaging.private_reservation.encode, null);
  pools: Storage.Map<Uint8Array, messaging.private_units> = new Storage.Map<Uint8Array, messaging.private_units>(this.id, 22, messaging.private_units.decode, messaging.private_units.encode, null);
  allowances: Storage.Map<Uint8Array, messaging.private_units> = new Storage.Map<Uint8Array, messaging.private_units>(this.id, 23, messaging.private_units.decode, messaging.private_units.encode, null);
  grants: Storage.Map<Uint8Array, messaging.private_grant> = new Storage.Map<Uint8Array, messaging.private_grant>(this.id, 24, messaging.private_grant.decode, messaging.private_grant.encode, null);
  privateChannels: Storage.Map<Uint8Array, messaging.conversation_record> = new Storage.Map<Uint8Array, messaging.conversation_record>(this.id, 25, messaging.conversation_record.decode, messaging.conversation_record.encode, null);
  privatePackets: Storage.Map<Uint8Array, messaging.private_packet> = new Storage.Map<Uint8Array, messaging.private_packet>(this.id, 26, messaging.private_packet.decode, messaging.private_packet.encode, null);
  privateSequence: Storage.Obj<messaging.private_units> = new Storage.Obj<messaging.private_units>(this.id, 27, messaging.private_units.decode, messaging.private_units.encode, null);

  bytes32(value: Uint8Array | null): Uint8Array {
    System.require(value != null && value!.length == 32, "identifier must be 32 bytes");
    return value!;
  }
  privateAuth(actor: Uint8Array | null): Uint8Array {
    const a = Util.requireAddress(actor, "alias");
    System.requireAuthority(authority.authorization_type.contract_call, a);
    return a;
  }
  debitPrivate(actor: Uint8Array): void {
    const old = this.allowances.get(actor);
    System.require(old != null && old!.units > 0, "private usage allowance exhausted");
    old!.units -= 1;
    this.allowances.put(actor, old!);
  }
  set_private_device(args: messaging.set_private_device_arguments): messaging.set_private_device_result {
    const a = Util.requireAddress(args.account, "account");
    Actor.requireAuthorized(this.deps().identity!, a, null, Capability.MESSAGING);
    const id = this.bytes32(args.device_id);
    const key = args.delivery_key;
    System.require(key == null || key!.length == 0 || key!.length == 32, "invalid delivery key");
    System.require(args.label == null || args.label!.length <= 80, "device label too long");
    let current = this.privateDevices.get(a);
    if (current == null) current = new messaging.get_private_devices_result();
    const kept = new Array<messaging.private_device>();
    for (let i = 0; i < current!.values.length; i++) {
      const d = current!.values[i];
      if (!Arrays.equal(d.device_id!, id)) kept.push(d);
    }
    if (key != null && key!.length == 32) {
      System.require(kept.length < 8, "revoke an old browser before adding another");
      kept.push(new messaging.private_device(id, key, args.label, Util.now()));
      this.consume(a);
    }
    this.privateDevices.put(a, new messaging.get_private_devices_result(kept));
    return new messaging.set_private_device_result();
  }
  get_private_devices(args: messaging.get_private_devices_arguments): messaging.get_private_devices_result {
    const value = this.privateDevices.get(Util.requireAddress(args.account, "account"));
    return value == null ? new messaging.get_private_devices_result() : value!;
  }
  reserve_private_usage(args: messaging.reserve_private_usage_arguments): messaging.reserve_private_usage_result {
    const a = Util.requireAddress(args.account, "account"), sponsor = Util.requireAddress(args.sponsor, "sponsor"), id = this.bytes32(args.reservation_id);
    Actor.requireAuthorized(this.deps().identity!, a, null, Capability.MESSAGING);
    System.require(args.units > 0 && args.units <= 20, "reserve 1 to 20 units");
    const old = this.reservations.get(id);
    if (old != null) {
      System.require(Arrays.equal(old!.account!, a) && Arrays.equal(old!.sponsor!, sponsor) && old!.units == args.units, "reservation id collision");
      return new messaging.reserve_private_usage_result();
    }
    const pool = this.pools.get(sponsor), units: u64 = pool == null ? 0 : pool!.units;
    System.require(units <= u64.MAX_VALUE - args.units, "pool overflow");
    this.consume(a, args.units);
    this.pools.put(sponsor, new messaging.private_units(units + args.units));
    this.reservations.put(id, new messaging.private_reservation(System.getHeadInfo().head_topology!.height + 1, a, sponsor, id, args.units));
    return new messaging.reserve_private_usage_result();
  }
  get_private_reservation(args: messaging.get_private_reservation_arguments): messaging.get_private_reservation_result {
    return new messaging.get_private_reservation_result(this.reservations.get(this.bytes32(args.reservation_id)));
  }
  allocate_private_usage(args: messaging.allocate_private_usage_arguments): messaging.allocate_private_usage_result {
    const sponsor = this.privateAuth(args.sponsor), a = Util.requireAddress(args.actor, "alias"), id = this.bytes32(args.grant_id);
    System.require(args.units > 0 && args.units <= 20, "allocate 1 to 20 units");
    const old = this.grants.get(id);
    if (old != null) {
      System.require(Arrays.equal(old!.sponsor!, sponsor) && Arrays.equal(old!.actor!, a) && old!.units == args.units, "grant id collision");
      return new messaging.allocate_private_usage_result();
    }
    const pool = this.pools.get(sponsor), balance = this.allowances.get(a), units: u64 = balance == null ? 0 : balance!.units;
    System.require(pool != null && pool!.units >= args.units, "sponsor pool exhausted");
    System.require(units <= u64.MAX_VALUE - args.units, "allowance overflow");
    this.pools.put(sponsor, new messaging.private_units(pool!.units - args.units));
    this.allowances.put(a, new messaging.private_units(units + args.units));
    this.grants.put(id, new messaging.private_grant(sponsor, a, id, args.units));
    return new messaging.allocate_private_usage_result();
  }
  get_private_grant(args: messaging.get_private_grant_arguments): messaging.get_private_grant_result {
    return new messaging.get_private_grant_result(this.grants.get(this.bytes32(args.grant_id)));
  }
  get_private_units(args: messaging.get_private_units_arguments): messaging.get_private_units_result {
    const a = Util.requireAddress(args.account, "account"), balance = args.pool ? this.pools.get(a) : this.allowances.get(a);
    return new messaging.get_private_units_result(balance == null ? 0 : balance!.units);
  }
  open_private_channel(args: messaging.open_private_channel_arguments): messaging.open_private_channel_result {
    const a = this.privateAuth(args.actor), b = Util.requireAddress(args.peer, "peer");
    System.require(!Arrays.equal(a, b), "cannot message yourself");
    const key = this.pair(a, b);
    let c = this.privateChannels.get(key);
    if (c != null) {
      System.require(c!.status != 3, "channel closed; create new aliases");
      if (c!.status == 2 || Arrays.equal(c!.requester!, a)) return new messaging.open_private_channel_result();
      c!.status = 2;
    } else {
      c = new messaging.conversation_record(Util.compare(a, b) < 0 ? a : b, Util.compare(a, b) < 0 ? b : a, a, 1, 1, 0, Util.now());
    }
    this.debitPrivate(a);
    c!.updated_at = Util.now();
    c!.block = System.getHeadInfo().head_topology!.height + 1;
    this.privateChannels.put(key, c!);
    System.event("osp.messaging.private_channel", Protobuf.encode(new messaging.private_channel_event(c), messaging.private_channel_event.encode), [a, b]);
    return new messaging.open_private_channel_result();
  }
  close_private_channel(args: messaging.close_private_channel_arguments): messaging.close_private_channel_result {
    const a = this.privateAuth(args.actor), b = Util.requireAddress(args.peer, "peer"), key = this.pair(a, b), c = this.privateChannels.get(key);
    System.require(c != null, "channel not found");
    c!.status = 3; c!.updated_at = Util.now();
    c!.block = System.getHeadInfo().head_topology!.height + 1;
    this.privateChannels.put(key, c!);
    System.event("osp.messaging.private_channel", Protobuf.encode(new messaging.private_channel_event(c), messaging.private_channel_event.encode), [a, b]);
    return new messaging.close_private_channel_result();
  }
  get_private_channel(args: messaging.get_private_channel_arguments): messaging.get_private_channel_result {
    return new messaging.get_private_channel_result(this.privateChannels.get(this.pair(Util.requireAddress(args.a, "alias"), Util.requireAddress(args.b, "peer"))));
  }
  post_private_packet(args: messaging.post_private_packet_arguments): messaging.post_private_packet_result {
    const a = this.privateAuth(args.actor), id = this.bytes32(args.packet_id), envelope = Util.requireBytes(args.envelope, 6144, "packet");
    const peer = args.peer == null ? new Uint8Array(0) : args.peer!;
    if (peer.length > 0) Util.requireAddress(peer, "peer");
    else System.require(envelope.length == 4168, "invitation must use fixed padding");
    const hash = System.hash(Crypto.multicodec.sha2_256, envelope)!.slice(2), key = Util.concat([a, id]), old = this.privatePackets.get(key);
    if (old != null) {
      System.require(Arrays.equal(old!.content_hash!, hash) && Arrays.equal(old!.peer!, peer), "packet id collision");
      return new messaging.post_private_packet_result(old);
    }
    if (peer.length > 0) {
      const c = this.privateChannels.get(this.pair(a, peer));
      System.require(c != null && c!.status == 2, "both participants must accept the channel");
    }
    const counter = this.privateSequence.get(), sequence: u64 = counter == null ? 0 : counter!.units;
    System.require(sequence < u64.MAX_VALUE, "sequence exhausted");
    this.debitPrivate(a);
    const record = new messaging.private_packet(System.getHeadInfo().head_topology!.height + 1, a, peer, id, hash, sequence + 1, Util.now());
    this.privateSequence.put(new messaging.private_units(sequence + 1));
    this.privatePackets.put(key, record);
    const impacted = peer.length > 0 ? [a, peer] : [a];
    System.event("osp.messaging.private_packet", Protobuf.encode(new messaging.private_packet_event(record, envelope), messaging.private_packet_event.encode), impacted);
    return new messaging.post_private_packet_result(record);
  }
  get_private_packet(args: messaging.get_private_packet_arguments): messaging.get_private_packet_result {
    return new messaging.get_private_packet_result(this.privatePackets.get(Util.concat([Util.requireAddress(args.actor, "alias"), this.bytes32(args.packet_id)])));
  }
  get_private_status(args: messaging.get_private_status_arguments): messaging.get_private_status_result {
    const value = this.privateSequence.get();
    return new messaging.get_private_status_result(2, value == null ? 0 : value!.units);
  }
}
