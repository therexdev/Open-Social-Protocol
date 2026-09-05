import { System, Protobuf, authority } from "@koinos/sdk-as";
import { registry } from "./proto/registry";

export class Registry {
  init(args: registry.init_arguments): registry.init_result {
    // const admin = args.admin;
    // const upgrade_delay_ms = args.upgrade_delay_ms;
    // const protocol_version = args.protocol_version;

    // YOUR CODE HERE

    const res = new registry.init_result();

    return res;
  }

  propose_contract(
    args: registry.propose_contract_arguments
  ): registry.propose_contract_result {
    // const name = args.name;
    // const address = args.address;
    // const version = args.version;
    // const abi_hash = args.abi_hash;
    // const notes = args.notes;

    // YOUR CODE HERE

    const res = new registry.propose_contract_result();

    return res;
  }

  apply_contract(
    args: registry.apply_contract_arguments
  ): registry.apply_contract_result {
    // const name = args.name;

    // YOUR CODE HERE

    const res = new registry.apply_contract_result();

    return res;
  }

  cancel_contract(
    args: registry.cancel_contract_arguments
  ): registry.cancel_contract_result {
    // const name = args.name;

    // YOUR CODE HERE

    const res = new registry.cancel_contract_result();

    return res;
  }

  deprecate_contract(
    args: registry.deprecate_contract_arguments
  ): registry.deprecate_contract_result {
    // const name = args.name;
    // const notes = args.notes;

    // YOUR CODE HERE

    const res = new registry.deprecate_contract_result();

    return res;
  }

  propose_admin(
    args: registry.propose_admin_arguments
  ): registry.propose_admin_result {
    // const new_admin = args.new_admin;

    // YOUR CODE HERE

    const res = new registry.propose_admin_result();

    return res;
  }

  cancel_admin(
    args: registry.cancel_admin_arguments
  ): registry.cancel_admin_result {
    // YOUR CODE HERE

    const res = new registry.cancel_admin_result();

    return res;
  }

  execute_admin(
    args: registry.execute_admin_arguments
  ): registry.execute_admin_result {
    // YOUR CODE HERE

    const res = new registry.execute_admin_result();

    return res;
  }

  get_contract(
    args: registry.get_contract_arguments
  ): registry.get_contract_result {
    // const name = args.name;

    // YOUR CODE HERE

    const res = new registry.get_contract_result();
    // res.value = ;

    return res;
  }

  get_proposed_contract(
    args: registry.get_proposed_contract_arguments
  ): registry.get_proposed_contract_result {
    // const name = args.name;

    // YOUR CODE HERE

    const res = new registry.get_proposed_contract_result();
    // res.value = ;

    return res;
  }

  list_contracts(
    args: registry.list_contracts_arguments
  ): registry.list_contracts_result {
    // YOUR CODE HERE

    const res = new registry.list_contracts_result();
    // res.values = ;

    return res;
  }

  get_config(args: registry.get_config_arguments): registry.get_config_result {
    // YOUR CODE HERE

    const res = new registry.get_config_result();
    // res.value = ;

    return res;
  }
}
