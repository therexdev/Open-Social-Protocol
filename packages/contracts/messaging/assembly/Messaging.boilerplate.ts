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
}
