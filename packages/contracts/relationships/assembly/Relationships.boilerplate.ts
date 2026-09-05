import { System, Protobuf, authority } from "@koinos/sdk-as";
import { relationships } from "./proto/relationships";

export class Relationships {
  set_identity_contract(
    args: relationships.set_identity_contract_arguments
  ): relationships.set_identity_contract_result {
    // const address = args.address;

    // YOUR CODE HERE

    const res = new relationships.set_identity_contract_result();

    return res;
  }

  request_friend(
    args: relationships.request_friend_arguments
  ): relationships.request_friend_result {
    // const requester = args.requester;
    // const recipient = args.recipient;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new relationships.request_friend_result();

    return res;
  }

  accept_friend(
    args: relationships.accept_friend_arguments
  ): relationships.accept_friend_result {
    // const approver = args.approver;
    // const requester = args.requester;
    // const device = args.device;
    // const key_package_ref = args.key_package_ref;

    // YOUR CODE HERE

    const res = new relationships.accept_friend_result();

    return res;
  }

  remove_friend(
    args: relationships.remove_friend_arguments
  ): relationships.remove_friend_result {
    // const actor = args.actor;
    // const peer = args.peer;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new relationships.remove_friend_result();

    return res;
  }

  block(args: relationships.block_arguments): relationships.block_result {
    // const actor = args.actor;
    // const target = args.target;

    // YOUR CODE HERE

    const res = new relationships.block_result();

    return res;
  }

  unblock(args: relationships.unblock_arguments): relationships.unblock_result {
    // const actor = args.actor;
    // const target = args.target;

    // YOUR CODE HERE

    const res = new relationships.unblock_result();

    return res;
  }

  follow(args: relationships.follow_arguments): relationships.follow_result {
    // const follower = args.follower;
    // const target = args.target;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new relationships.follow_result();

    return res;
  }

  unfollow(
    args: relationships.unfollow_arguments
  ): relationships.unfollow_result {
    // const follower = args.follower;
    // const target = args.target;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new relationships.unfollow_result();

    return res;
  }

  rotate_audience(
    args: relationships.rotate_audience_arguments
  ): relationships.rotate_audience_result {
    // const actor = args.actor;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new relationships.rotate_audience_result();

    return res;
  }

  get_relationship(
    args: relationships.get_relationship_arguments
  ): relationships.get_relationship_result {
    // const a = args.a;
    // const b = args.b;

    // YOUR CODE HERE

    const res = new relationships.get_relationship_result();
    // res.value = ;

    return res;
  }

  get_audience(
    args: relationships.get_audience_arguments
  ): relationships.get_audience_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new relationships.get_audience_result();
    // res.value = ;

    return res;
  }

  is_blocked(
    args: relationships.is_blocked_arguments
  ): relationships.is_blocked_result {
    // const actor = args.actor;
    // const target = args.target;

    // YOUR CODE HERE

    const res = new relationships.is_blocked_result();
    // res.value = ;

    return res;
  }

  get_follow(
    args: relationships.get_follow_arguments
  ): relationships.get_follow_result {
    // const follower = args.follower;
    // const target = args.target;

    // YOUR CODE HERE

    const res = new relationships.get_follow_result();
    // res.value = ;

    return res;
  }

  get_identity_contract(
    args: relationships.get_identity_contract_arguments
  ): relationships.get_identity_contract_result {
    // YOUR CODE HERE

    const res = new relationships.get_identity_contract_result();
    // res.value = ;

    return res;
  }
}
