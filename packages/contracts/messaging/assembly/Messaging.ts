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
  consume(a: Uint8Array): void {
    const call = System.call(
      this.deps().token!,
      0x96f39e35,
      Protobuf.encode(new token.consume_arguments(a, 1), token.consume_arguments.encode)
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
}
