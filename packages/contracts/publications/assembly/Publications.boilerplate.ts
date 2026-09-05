import { System, Protobuf, authority } from "@koinos/sdk-as";
import { publications } from "./proto/publications";

export class Publications {
  set_identity_contract(
    args: publications.set_identity_contract_arguments
  ): publications.set_identity_contract_result {
    // const address = args.address;

    // YOUR CODE HERE

    const res = new publications.set_identity_contract_result();

    return res;
  }

  set_relationships_contract(
    args: publications.set_relationships_contract_arguments
  ): publications.set_relationships_contract_result {
    // const address = args.address;

    // YOUR CODE HERE

    const res = new publications.set_relationships_contract_result();

    return res;
  }

  publish(args: publications.publish_arguments): publications.publish_result {
    // const author = args.author;
    // const post_id = args.post_id;
    // const previous_version = args.previous_version;
    // const sequence = args.sequence;
    // const audience = args.audience;
    // const audience_id = args.audience_id;
    // const epoch = args.epoch;
    // const envelope = args.envelope;
    // const content_hash = args.content_hash;
    // const media = args.media;
    // const reply_to = args.reply_to;
    // const idempotency_key = args.idempotency_key;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.publish_result();

    return res;
  }

  set_lifecycle(
    args: publications.set_lifecycle_arguments
  ): publications.set_lifecycle_result {
    // const author = args.author;
    // const post_id = args.post_id;
    // const version = args.version;
    // const state = args.state;
    // const reason = args.reason;
    // const replacement_id = args.replacement_id;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.set_lifecycle_result();

    return res;
  }

  react(args: publications.react_arguments): publications.react_result {
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const reaction = args.reaction;
    // const remove = args.remove;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.react_result();

    return res;
  }

  distribute_keys(
    args: publications.distribute_keys_arguments
  ): publications.distribute_keys_result {
    // const author = args.author;
    // const audience_id = args.audience_id;
    // const epoch = args.epoch;
    // const packages = args.packages;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.distribute_keys_result();

    return res;
  }

  record_cross_post(
    args: publications.record_cross_post_arguments
  ): publications.record_cross_post_result {
    // const author = args.author;
    // const idempotency_key = args.idempotency_key;
    // const adapter = args.adapter;
    // const state = args.state;
    // const external_ref = args.external_ref;
    // const post_id = args.post_id;
    // const manifest_hash = args.manifest_hash;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.record_cross_post_result();

    return res;
  }

  get_post(
    args: publications.get_post_arguments
  ): publications.get_post_result {
    // const post_id = args.post_id;

    // YOUR CODE HERE

    const res = new publications.get_post_result();
    // res.value = ;

    return res;
  }

  get_author_state(
    args: publications.get_author_state_arguments
  ): publications.get_author_state_result {
    // const author = args.author;

    // YOUR CODE HERE

    const res = new publications.get_author_state_result();
    // res.value = ;

    return res;
  }

  get_post_by_idempotency_key(
    args: publications.get_post_by_idempotency_key_arguments
  ): publications.get_post_by_idempotency_key_result {
    // const author = args.author;
    // const idempotency_key = args.idempotency_key;

    // YOUR CODE HERE

    const res = new publications.get_post_by_idempotency_key_result();
    // res.value = ;

    return res;
  }

  get_limits(
    args: publications.get_limits_arguments
  ): publications.get_limits_result {
    // YOUR CODE HERE

    const res = new publications.get_limits_result();
    // res.value = ;

    return res;
  }

  get_dependencies(
    args: publications.get_dependencies_arguments
  ): publications.get_dependencies_result {
    // YOUR CODE HERE

    const res = new publications.get_dependencies_result();
    // res.identity = ;
    // res.relationships = ;

    return res;
  }
}
