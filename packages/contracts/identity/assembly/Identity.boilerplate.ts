import { System, Protobuf, authority } from "@koinos/sdk-as";
import { identity } from "./proto/identity";

export class Identity {
  register(args: identity.register_arguments): identity.register_result {
    // const account = args.account;
    // const encryption_key = args.encryption_key;
    // const key_version = args.key_version;
    // const profile_hash = args.profile_hash;
    // const profile_uri = args.profile_uri;

    // YOUR CODE HERE

    const res = new identity.register_result();

    return res;
  }

  update_profile(
    args: identity.update_profile_arguments
  ): identity.update_profile_result {
    // const account = args.account;
    // const profile_hash = args.profile_hash;
    // const profile_uri = args.profile_uri;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new identity.update_profile_result();

    return res;
  }

  rotate_encryption_key(
    args: identity.rotate_encryption_key_arguments
  ): identity.rotate_encryption_key_result {
    // const account = args.account;
    // const encryption_key = args.encryption_key;
    // const key_version = args.key_version;

    // YOUR CODE HERE

    const res = new identity.rotate_encryption_key_result();

    return res;
  }

  authorize_device(
    args: identity.authorize_device_arguments
  ): identity.authorize_device_result {
    // const account = args.account;
    // const device = args.device;
    // const capabilities = args.capabilities;
    // const expires_at = args.expires_at;
    // const label = args.label;

    // YOUR CODE HERE

    const res = new identity.authorize_device_result();

    return res;
  }

  revoke_device(
    args: identity.revoke_device_arguments
  ): identity.revoke_device_result {
    // const account = args.account;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new identity.revoke_device_result();

    return res;
  }

  set_recovery_policy(
    args: identity.set_recovery_policy_arguments
  ): identity.set_recovery_policy_result {
    // const account = args.account;
    // const policy = args.policy;

    // YOUR CODE HERE

    const res = new identity.set_recovery_policy_result();

    return res;
  }

  apply_recovery_policy(
    args: identity.apply_recovery_policy_arguments
  ): identity.apply_recovery_policy_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new identity.apply_recovery_policy_result();

    return res;
  }

  cancel_recovery_policy(
    args: identity.cancel_recovery_policy_arguments
  ): identity.cancel_recovery_policy_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new identity.cancel_recovery_policy_result();

    return res;
  }

  propose_recovery(
    args: identity.propose_recovery_arguments
  ): identity.propose_recovery_result {
    // const account = args.account;
    // const guardian = args.guardian;
    // const new_owner = args.new_owner;

    // YOUR CODE HERE

    const res = new identity.propose_recovery_result();

    return res;
  }

  cancel_recovery(
    args: identity.cancel_recovery_arguments
  ): identity.cancel_recovery_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new identity.cancel_recovery_result();

    return res;
  }

  execute_recovery(
    args: identity.execute_recovery_arguments
  ): identity.execute_recovery_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new identity.execute_recovery_result();

    return res;
  }

  get_identity(
    args: identity.get_identity_arguments
  ): identity.get_identity_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new identity.get_identity_result();
    // res.value = ;

    return res;
  }

  get_device(args: identity.get_device_arguments): identity.get_device_result {
    // const account = args.account;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new identity.get_device_result();
    // res.value = ;

    return res;
  }

  get_recovery(
    args: identity.get_recovery_arguments
  ): identity.get_recovery_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new identity.get_recovery_result();
    // res.value = ;

    return res;
  }

  resolve_actor(
    args: identity.resolve_actor_arguments
  ): identity.resolve_actor_result {
    // const account = args.account;
    // const device = args.device;
    // const capability = args.capability;

    // YOUR CODE HERE

    const res = new identity.resolve_actor_result();
    // res.ok = ;
    // res.signer = ;
    // res.reason = ;

    return res;
  }
}
