import { System, Protobuf, authority } from "@koinos/sdk-as";
import { token } from "./proto/token";

export class Token {
  init(args: token.init_arguments): token.init_result {
    // const identity = args.identity;
    // const relationships = args.relationships;
    // const publications = args.publications;
    // const messaging = args.messaging;

    // YOUR CODE HERE

    const res = new token.init_result();

    return res;
  }

  set_reward_policy(
    args: token.set_reward_policy_arguments
  ): token.set_reward_policy_result {
    // const reward_amount = args.reward_amount;
    // const daily_reward_cap = args.daily_reward_cap;
    // const recipient_daily_cap = args.recipient_daily_cap;

    // YOUR CODE HERE

    const res = new token.set_reward_policy_result();

    return res;
  }

  get_config(args: token.get_config_arguments): token.get_config_result {
    // YOUR CODE HERE

    const res = new token.get_config_result();
    // res.value = ;

    return res;
  }

  get_account(args: token.get_account_arguments): token.get_account_result {
    // const account = args.account;

    // YOUR CODE HERE

    const res = new token.get_account_result();
    // res.value = ;
    // res.capacity = ;

    return res;
  }

  support(args: token.support_arguments): token.support_result {
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new token.support_result();
    // res.reward = ;

    return res;
  }

  transfer(args: token.transfer_arguments): token.transfer_result {
    // const from = args.from;
    // const to = args.to;
    // const value = args.value;

    // YOUR CODE HERE

    const res = new token.transfer_result();

    return res;
  }

  burn(args: token.burn_arguments): token.burn_result {
    // const from = args.from;
    // const value = args.value;

    // YOUR CODE HERE

    const res = new token.burn_result();

    return res;
  }

  consume(args: token.consume_arguments): token.consume_result {
    // const account = args.account;
    // const units = args.units;

    // YOUR CODE HERE

    const res = new token.consume_result();

    return res;
  }

  balance_of(args: token.balance_of_arguments): token.balance_of_result {
    // const owner = args.owner;

    // YOUR CODE HERE

    const res = new token.balance_of_result();
    // res.value = ;

    return res;
  }

  total_supply(args: token.total_supply_arguments): token.total_supply_result {
    // YOUR CODE HERE

    const res = new token.total_supply_result();
    // res.value = ;

    return res;
  }

  name(args: token.name_arguments): token.name_result {
    // YOUR CODE HERE

    const res = new token.name_result();
    // res.value = ;

    return res;
  }

  symbol(args: token.symbol_arguments): token.symbol_result {
    // YOUR CODE HERE

    const res = new token.symbol_result();
    // res.value = ;

    return res;
  }

  decimals(args: token.decimals_arguments): token.decimals_result {
    // YOUR CODE HERE

    const res = new token.decimals_result();
    // res.value = ;

    return res;
  }
}
