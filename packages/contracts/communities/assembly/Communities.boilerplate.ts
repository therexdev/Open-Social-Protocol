import { System, Protobuf, authority } from "@koinos/sdk-as";
import { communities } from "./proto/communities";

export class Communities {
  set_identity_contract(
    args: communities.set_identity_contract_arguments
  ): communities.set_identity_contract_result {
    // const address = args.address;

    // YOUR CODE HERE

    const res = new communities.set_identity_contract_result();

    return res;
  }

  create_community(
    args: communities.create_community_arguments
  ): communities.create_community_result {
    // const creator = args.creator;
    // const id = args.id;
    // const name = args.name;
    // const policy_hash = args.policy_hash;
    // const policy_uri = args.policy_uri;
    // const transfer_delay_ms = args.transfer_delay_ms;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new communities.create_community_result();

    return res;
  }

  set_role(args: communities.set_role_arguments): communities.set_role_result {
    // const community_id = args.community_id;
    // const actor = args.actor;
    // const subject = args.subject;
    // const role = args.role;
    // const scope = args.scope;
    // const expires_at = args.expires_at;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new communities.set_role_result();

    return res;
  }

  set_policy(
    args: communities.set_policy_arguments
  ): communities.set_policy_result {
    // const community_id = args.community_id;
    // const actor = args.actor;
    // const policy_hash = args.policy_hash;
    // const policy_uri = args.policy_uri;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new communities.set_policy_result();

    return res;
  }

  propose_owner_transfer(
    args: communities.propose_owner_transfer_arguments
  ): communities.propose_owner_transfer_result {
    // const community_id = args.community_id;
    // const owner = args.owner;
    // const new_owner = args.new_owner;

    // YOUR CODE HERE

    const res = new communities.propose_owner_transfer_result();

    return res;
  }

  cancel_owner_transfer(
    args: communities.cancel_owner_transfer_arguments
  ): communities.cancel_owner_transfer_result {
    // const community_id = args.community_id;
    // const owner = args.owner;

    // YOUR CODE HERE

    const res = new communities.cancel_owner_transfer_result();

    return res;
  }

  execute_owner_transfer(
    args: communities.execute_owner_transfer_arguments
  ): communities.execute_owner_transfer_result {
    // const community_id = args.community_id;

    // YOUR CODE HERE

    const res = new communities.execute_owner_transfer_result();

    return res;
  }

  set_label(
    args: communities.set_label_arguments
  ): communities.set_label_result {
    // const community_id = args.community_id;
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const label = args.label;
    // const reason = args.reason;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new communities.set_label_result();

    return res;
  }

  get_community(
    args: communities.get_community_arguments
  ): communities.get_community_result {
    // const id = args.id;

    // YOUR CODE HERE

    const res = new communities.get_community_result();
    // res.value = ;

    return res;
  }

  get_role(args: communities.get_role_arguments): communities.get_role_result {
    // const community_id = args.community_id;
    // const subject = args.subject;

    // YOUR CODE HERE

    const res = new communities.get_role_result();
    // res.value = ;

    return res;
  }

  get_identity_contract(
    args: communities.get_identity_contract_arguments
  ): communities.get_identity_contract_result {
    // YOUR CODE HERE

    const res = new communities.get_identity_contract_result();
    // res.value = ;

    return res;
  }
}
