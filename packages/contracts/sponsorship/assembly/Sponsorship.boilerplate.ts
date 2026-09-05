import { System, Protobuf, authority } from "@koinos/sdk-as";
import { sponsorship } from "./proto/sponsorship";

export class Sponsorship {
  set_sponsor(
    args: sponsorship.set_sponsor_arguments
  ): sponsorship.set_sponsor_result {
    // const sponsor = args.sponsor;
    // const endpoint = args.endpoint;
    // const policy_uri = args.policy_uri;
    // const policy_version = args.policy_version;
    // const allowed = args.allowed;
    // const max_rc_per_op = args.max_rc_per_op;
    // const max_ops_per_user_per_day = args.max_ops_per_user_per_day;
    // const max_bytes_per_op = args.max_bytes_per_op;
    // const active = args.active;

    // YOUR CODE HERE

    const res = new sponsorship.set_sponsor_result();

    return res;
  }

  deactivate_sponsor(
    args: sponsorship.deactivate_sponsor_arguments
  ): sponsorship.deactivate_sponsor_result {
    // const sponsor = args.sponsor;

    // YOUR CODE HERE

    const res = new sponsorship.deactivate_sponsor_result();

    return res;
  }

  set_user_grant(
    args: sponsorship.set_user_grant_arguments
  ): sponsorship.set_user_grant_result {
    // const sponsor = args.sponsor;
    // const user = args.user;
    // const daily_ops = args.daily_ops;
    // const expires_at = args.expires_at;

    // YOUR CODE HERE

    const res = new sponsorship.set_user_grant_result();

    return res;
  }

  revoke_user_grant(
    args: sponsorship.revoke_user_grant_arguments
  ): sponsorship.revoke_user_grant_result {
    // const sponsor = args.sponsor;
    // const user = args.user;

    // YOUR CODE HERE

    const res = new sponsorship.revoke_user_grant_result();

    return res;
  }

  get_sponsor(
    args: sponsorship.get_sponsor_arguments
  ): sponsorship.get_sponsor_result {
    // const sponsor = args.sponsor;

    // YOUR CODE HERE

    const res = new sponsorship.get_sponsor_result();
    // res.value = ;

    return res;
  }

  list_sponsors(
    args: sponsorship.list_sponsors_arguments
  ): sponsorship.list_sponsors_result {
    // const start = args.start;
    // const limit = args.limit;

    // YOUR CODE HERE

    const res = new sponsorship.list_sponsors_result();
    // res.values = ;

    return res;
  }

  get_user_grant(
    args: sponsorship.get_user_grant_arguments
  ): sponsorship.get_user_grant_result {
    // const sponsor = args.sponsor;
    // const user = args.user;

    // YOUR CODE HERE

    const res = new sponsorship.get_user_grant_result();
    // res.value = ;

    return res;
  }
}
