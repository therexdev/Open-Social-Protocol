import { System, Protobuf, authority } from "@koinos/sdk-as";
import { messaging } from "./proto/messaging";

export class Messaging {
  set_dependencies(
    args: messaging.set_dependencies_arguments
  ): messaging.set_dependencies_result {
    // const identity = args.identity;
    // const relationships = args.relationships;
    // const token = args.token;

    // YOUR CODE HERE

    const res = new messaging.set_dependencies_result();

    return res;
  }

  get_dependencies(
    args: messaging.get_dependencies_arguments
  ): messaging.get_dependencies_result {
    // YOUR CODE HERE

    const res = new messaging.get_dependencies_result();
    // res.identity = ;
    // res.relationships = ;
    // res.token = ;

    return res;
  }

  request_conversation(
    args: messaging.request_conversation_arguments
  ): messaging.request_conversation_result {
    // const actor = args.actor;
    // const peer = args.peer;
    // const device = args.device;
    // const generation = args.generation;

    // YOUR CODE HERE

    const res = new messaging.request_conversation_result();

    return res;
  }

  accept_conversation(
    args: messaging.accept_conversation_arguments
  ): messaging.accept_conversation_result {
    // const actor = args.actor;
    // const peer = args.peer;
    // const device = args.device;
    // const generation = args.generation;

    // YOUR CODE HERE

    const res = new messaging.accept_conversation_result();

    return res;
  }

  close_conversation(
    args: messaging.close_conversation_arguments
  ): messaging.close_conversation_result {
    // const actor = args.actor;
    // const peer = args.peer;
    // const device = args.device;
    // const generation = args.generation;

    // YOUR CODE HERE

    const res = new messaging.close_conversation_result();

    return res;
  }

  send_message(
    args: messaging.send_message_arguments
  ): messaging.send_message_result {
    // const sender = args.sender;
    // const recipient = args.recipient;
    // const device = args.device;
    // const message_id = args.message_id;
    // const generation = args.generation;
    // const envelope = args.envelope;

    // YOUR CODE HERE

    const res = new messaging.send_message_result();
    // res.value = ;

    return res;
  }

  get_conversation(
    args: messaging.get_conversation_arguments
  ): messaging.get_conversation_result {
    // const a = args.a;
    // const b = args.b;

    // YOUR CODE HERE

    const res = new messaging.get_conversation_result();
    // res.value = ;

    return res;
  }

  get_message(
    args: messaging.get_message_arguments
  ): messaging.get_message_result {
    // const sender = args.sender;
    // const message_id = args.message_id;

    // YOUR CODE HERE

    const res = new messaging.get_message_result();
    // res.value = ;

    return res;
  }

  set_private_device(
    args: messaging.set_private_device_arguments
  ): messaging.set_private_device_result {
    // const account = args.account;
    // const device_id = args.device_id;
    // const delivery_key = args.delivery_key;
    // const label = args.label;

    // YOUR CODE HERE

    const res = new messaging.set_private_device_result();

    return res;
  }

  get_private_devices(
    args: messaging.get_private_devices_arguments
  ): messaging.get_private_devices_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new messaging.get_private_devices_result();
    // res.values = ;

    return res;
  }

  reserve_private_usage(
    args: messaging.reserve_private_usage_arguments
  ): messaging.reserve_private_usage_result {
    // const account = args.account;
    // const sponsor = args.sponsor;
    // const reservation_id = args.reservation_id;
    // const units = args.units;

    // YOUR CODE HERE

    const res = new messaging.reserve_private_usage_result();

    return res;
  }

  get_private_reservation(
    args: messaging.get_private_reservation_arguments
  ): messaging.get_private_reservation_result {
    // const reservation_id = args.reservation_id;

    // YOUR CODE HERE

    const res = new messaging.get_private_reservation_result();
    // res.value = ;

    return res;
  }

  allocate_private_usage(
    args: messaging.allocate_private_usage_arguments
  ): messaging.allocate_private_usage_result {
    // const sponsor = args.sponsor;
    // const actor = args.actor;
    // const grant_id = args.grant_id;
    // const units = args.units;

    // YOUR CODE HERE

    const res = new messaging.allocate_private_usage_result();

    return res;
  }

  get_private_grant(
    args: messaging.get_private_grant_arguments
  ): messaging.get_private_grant_result {
    // const grant_id = args.grant_id;

    // YOUR CODE HERE

    const res = new messaging.get_private_grant_result();
    // res.value = ;

    return res;
  }

  get_private_units(
    args: messaging.get_private_units_arguments
  ): messaging.get_private_units_result {
    // const account = args.account;
    // const pool = args.pool;

    // YOUR CODE HERE

    const res = new messaging.get_private_units_result();
    // res.units = ;

    return res;
  }

  open_private_channel(
    args: messaging.open_private_channel_arguments
  ): messaging.open_private_channel_result {
    // const actor = args.actor;
    // const peer = args.peer;

    // YOUR CODE HERE

    const res = new messaging.open_private_channel_result();

    return res;
  }

  close_private_channel(
    args: messaging.close_private_channel_arguments
  ): messaging.close_private_channel_result {
    // const actor = args.actor;
    // const peer = args.peer;

    // YOUR CODE HERE

    const res = new messaging.close_private_channel_result();

    return res;
  }

  get_private_channel(
    args: messaging.get_private_channel_arguments
  ): messaging.get_private_channel_result {
    // const a = args.a;
    // const b = args.b;

    // YOUR CODE HERE

    const res = new messaging.get_private_channel_result();
    // res.value = ;

    return res;
  }

  post_private_packet(
    args: messaging.post_private_packet_arguments
  ): messaging.post_private_packet_result {
    // const actor = args.actor;
    // const peer = args.peer;
    // const packet_id = args.packet_id;
    // const envelope = args.envelope;

    // YOUR CODE HERE

    const res = new messaging.post_private_packet_result();
    // res.value = ;

    return res;
  }

  get_private_packet(
    args: messaging.get_private_packet_arguments
  ): messaging.get_private_packet_result {
    // const actor = args.actor;
    // const packet_id = args.packet_id;

    // YOUR CODE HERE

    const res = new messaging.get_private_packet_result();
    // res.value = ;

    return res;
  }

  get_private_status(
    args: messaging.get_private_status_arguments
  ): messaging.get_private_status_result {
    // YOUR CODE HERE

    const res = new messaging.get_private_status_result();
    // res.version = ;
    // res.sequence = ;

    return res;
  }
}
