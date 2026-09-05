// Shared cross-contract actor resolution (copied into each dependent contract's
// assembly/common/ directory by scripts/build.mjs; do not edit the copies).
//
// A protocol action is authorized when the *signer* resolved by the identity
// contract has signed the transaction. The signer is either the identity's
// current owner (device empty) or an authorized, unexpired device key holding
// the required capability. The identity contract only *resolves*; the
// authority check itself runs here, in the top-level contract, so the SDK's
// enhanced-security caller checks apply (System.requireAuthority).
import { System, Protobuf, authority, Arrays } from "@koinos/sdk-as";
import { identity } from "../proto/identity";

// Entry points = first 4 bytes of sha256(method name), big-endian.
export const RESOLVE_ACTOR_ENTRY_POINT: u32 = 0x9f7b95a1; // identity.resolve_actor
export const GET_IDENTITY_ENTRY_POINT: u32 = 0xf63829c0; // identity.get_identity
export const IS_BLOCKED_ENTRY_POINT: u32 = 0x10bf8d3f; // relationships.is_blocked
export const GET_AUDIENCE_ENTRY_POINT: u32 = 0xfea150b5; // relationships.get_audience

// Capability bits (see identity.proto header).
export namespace Capability {
  export const PUBLISH: u32 = 1;
  export const REACT: u32 = 2;
  export const COMMENT: u32 = 4;
  export const RELATIONSHIPS: u32 = 8;
  export const COMMUNITY: u32 = 16;
  export const PROFILE: u32 = 32;
}

export namespace Actor {
  /**
   * Resolve and require the signer for (account, device, capability).
   * Reverts when the identity is unknown, the device is invalid, or the
   * resolved signer did not sign the transaction. Returns the signer.
   */
  export function requireAuthorized(
    identityContract: Uint8Array,
    account: Uint8Array,
    device: Uint8Array | null,
    capability: u32
  ): Uint8Array {
    System.require(identityContract.length > 0, "identity contract not configured");
    const dev: Uint8Array | null = device != null && device!.length > 0 ? device : null;
    const args = new identity.resolve_actor_arguments(account, dev, capability);
    const call = System.call(
      identityContract,
      RESOLVE_ACTOR_ENTRY_POINT,
      Protobuf.encode(args, identity.resolve_actor_arguments.encode)
    );
    System.require(call.code == 0, "identity resolution failed");
    const res = Protobuf.decode<identity.resolve_actor_result>(
      call.res.object!,
      identity.resolve_actor_result.decode
    );
    System.require(res.ok, res.reason != null ? res.reason! : "actor not authorized");
    const signer = res.signer!;
    System.requireAuthority(authority.authorization_type.contract_call, signer);
    return signer;
  }

  /**
   * True when the identity contract knows `account` (registered). Uses
   * resolve_actor with an empty device and capability 0; never checks signatures.
   */
  export function exists(identityContract: Uint8Array, account: Uint8Array): bool {
    System.require(identityContract.length > 0, "identity contract not configured");
    const args = new identity.resolve_actor_arguments(account, null, 0);
    const call = System.call(
      identityContract,
      RESOLVE_ACTOR_ENTRY_POINT,
      Protobuf.encode(args, identity.resolve_actor_arguments.encode)
    );
    if (call.code != 0 || call.res.object == null) return false;
    const res = Protobuf.decode<identity.resolve_actor_result>(
      call.res.object!,
      identity.resolve_actor_result.decode
    );
    return res.ok;
  }

  /** True when a and b are the same address bytes. */
  export function same(a: Uint8Array | null, b: Uint8Array | null): bool {
    if (a == null || b == null) return false;
    return Arrays.equal(a!, b!);
  }
}
