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

  activate_recharge(
    args: token.activate_recharge_arguments
  ): token.activate_recharge_result {
    // YOUR CODE HERE

    const res = new token.activate_recharge_result();

    return res;
  }

  activate_economy(
    args: token.activate_economy_arguments
  ): token.activate_economy_result {
    // const test_period_blocks = args.test_period_blocks;

    // YOUR CODE HERE

    const res = new token.activate_economy_result();

    return res;
  }

  grant_test_tokens(
    args: token.grant_test_tokens_arguments
  ): token.grant_test_tokens_result {
    // const account = args.account;
    // const value = args.value;

    // YOUR CODE HERE

    const res = new token.grant_test_tokens_result();

    return res;
  }

  vote(args: token.vote_arguments): token.vote_result {
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const version = args.version;
    // const direction = args.direction;
    // const weight = args.weight;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new token.vote_result();

    return res;
  }

  settle_reward(
    args: token.settle_reward_arguments
  ): token.settle_reward_result {
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new token.settle_reward_result();
    // res.reward = ;

    return res;
  }

  promote(args: token.promote_arguments): token.promote_result {
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const version = args.version;
    // const nonce = args.nonce;
    // const slot = args.slot;
    // const opportunities = args.opportunities;
    // const burn_amount = args.burn_amount;

    // YOUR CODE HERE

    const res = new token.promote_result();

    return res;
  }

  cancel_promotion(
    args: token.cancel_promotion_arguments
  ): token.cancel_promotion_result {
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const nonce = args.nonce;

    // YOUR CODE HERE

    const res = new token.cancel_promotion_result();

    return res;
  }

  get_economy(args: token.get_economy_arguments): token.get_economy_result {
    // YOUR CODE HERE

    const res = new token.get_economy_result();
    // res.value = ;
    // res.block = ;
    // res.current_epoch = ;

    return res;
  }

  get_post_economy(
    args: token.get_post_economy_arguments
  ): token.get_post_economy_result {
    // const post_id = args.post_id;
    // const viewer = args.viewer;

    // YOUR CODE HERE

    const res = new token.get_post_economy_result();
    // res.reward = ;
    // res.vote = ;
    // res.epoch = ;
    // res.promotion = ;
    // res.block = ;

    return res;
  }

  get_promotions(
    args: token.get_promotions_arguments
  ): token.get_promotions_result {
    // YOUR CODE HERE

    const res = new token.get_promotions_result();
    // res.values = ;
    // res.block = ;

    return res;
  }
}
