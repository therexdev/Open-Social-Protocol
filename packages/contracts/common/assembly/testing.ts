// Shared mock-VM setup for contract unit tests (copied into assembly/common/ by scripts/build.mjs).
//
// Usage in a spec:
//   import { Testing } from "../common/testing";
//   beforeEach(() => { Testing.setup(CONTRACT_ID); Testing.authorize([ALICE]); });
//
// as-pect 8 cannot reflect on generated protobuf classes: assert on primitive
// fields (numbers, strings, bools) and compare bytes with Arrays.equal.
import { MockVM, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { identity } from "../proto/identity";

export namespace Testing {
  export const DEFAULT_TIME: u64 = 1_800_000_000_000;

  /** Reset the mock VM with a contract id, head time and a top-level (empty) caller. */
  export function setup(contractId: Uint8Array, headTime: u64 = DEFAULT_TIME): void {
    MockVM.reset();
    MockVM.setContractId(contractId);
    setTime(headTime);
    MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
    // get_arguments must be non-empty or the mock VM returns an empty message.
    MockVM.setEntryPoint(1);
    MockVM.setContractArguments(new Uint8Array(1));
    MockVM.setAuthorities([]);
  }

  export function setTime(headTime: u64): void {
    const head = new chain.head_info();
    head.head_block_time = headTime;
    head.last_irreversible_block = 1;
    MockVM.setHeadInfo(head);
  }

  /** Mark the given accounts as having signed the transaction (contract_call authority). */
  export function authorize(accounts: Uint8Array[]): void {
    const auths: MockVM.MockAuthority[] = [];
    for (let i = 0; i < accounts.length; i++) {
      auths.push(new MockVM.MockAuthority(authority.authorization_type.contract_call, accounts[i], true));
    }
    MockVM.setAuthorities(auths);
  }

  /** Stub the identity contract's resolve_actor answer for the next cross-contract call(s). */
  export function mockResolveActor(ok: bool, signer: Uint8Array | null, reason: string, times: i32 = 1): void {
    const results: system_calls.exit_arguments[] = [];
    for (let i = 0; i < times; i++) {
      const res = new identity.resolve_actor_result(ok, signer, reason);
      const bytes = Protobuf.encode(res, identity.resolve_actor_result.encode);
      results.push(new system_calls.exit_arguments(0, new chain.result(bytes)));
    }
    MockVM.setCallContractResults(results);
  }

  /** Names of events emitted so far. */
  export function eventNames(): string[] {
    const events = MockVM.getEvents();
    const names: string[] = [];
    for (let i = 0; i < events.length; i++) names.push(events[i].name);
    return names;
  }

  export function lastError(): string {
    const msg = MockVM.getErrorMessage();
    return msg == null ? "" : msg!.toString();
  }
}
