// Unit tests for the identity contract (as-pect 8 + Koinos mock VM).
//
// Conventions: as-pect cannot reflect generated protobuf classes, so every
// assertion is on primitives; byte fields are compared with Arrays.equal.
// A revert rolls the mock database back to the last MockVM.commitTransaction(),
// so happy-path calls that later tests depend on are committed explicitly.
import { Arrays, Base58, MockVM, Protobuf, system_calls } from "@koinos/sdk-as";
import { Identity } from "../Identity";
import { identity } from "../proto/identity";
import { Testing } from "../common/testing";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTRACT_ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu");
const ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"); // the identity
const BOB = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH"); // recovery new owner / stranger
const DEVICE = Base58.decode("161DDwJNQyHqYJbP4C7Y8BTULrkjgC4U6g"); // device key
const G1 = Base58.decode("1GXe3r3VmkKAEhj6C156jPxQC8p1xbQD2i");
const G2 = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
const G3 = syntheticAddress(0x33);
const DEVICE2 = syntheticAddress(0x44);

const T0: u64 = Testing.DEFAULT_TIME;
const DAY: u64 = 86_400_000;

const KEY1 = filled(32, 0x11);
const KEY2 = filled(32, 0x22);
const HASH1 = filled(32, 0xaa);

const PUBLISH: u32 = 1;
const REACT: u32 = 2;
const PROFILE: u32 = 32;

let contract!: Identity;

function filled(n: i32, v: u8): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = v;
  return out;
}

/** A structurally valid 25-byte address (the contract only checks the length). */
function syntheticAddress(v: u8): Uint8Array {
  return filled(25, v);
}

function repeat(ch: string, n: i32): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ch;
  return s;
}

function setup(): void {
  Testing.setup(CONTRACT_ID);
  // Testing.setup writes contract id / entry point / arguments after the mock
  // VM's reset commit; commit again so a revert cannot roll that metadata away.
  MockVM.commitTransaction();
  contract = new Identity();
}

function registerAlice(): void {
  Testing.authorize([ALICE]);
  contract.register(new identity.register_arguments(ALICE, KEY1, 1, null, "ipfs://profile"));
  MockVM.commitTransaction();
}

function authorizeDevice(device: Uint8Array, caps: u32, expiresAt: u64): void {
  Testing.authorize([ALICE]);
  contract.authorize_device(new identity.authorize_device_arguments(ALICE, device, caps, expiresAt, "laptop"));
  MockVM.commitTransaction();
}

function policy(guardians: Uint8Array[], threshold: u32, delayMs: u64): identity.recovery_policy {
  return new identity.recovery_policy(guardians, threshold, delayMs);
}

function setPolicyAsOwner(owner: Uint8Array, p: identity.recovery_policy): void {
  Testing.authorize([owner]);
  contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, p));
  MockVM.commitTransaction();
}

function propose(guardian: Uint8Array, newOwner: Uint8Array): void {
  Testing.authorize([guardian]);
  contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, guardian, newOwner));
  MockVM.commitTransaction();
}

function getIdentity(): identity.identity_record {
  const rec = contract.get_identity(new identity.get_identity_arguments(ALICE)).value;
  expect(rec == null).toBe(false, "identity record missing");
  return rec!;
}

function getDevice(device: Uint8Array): identity.device_record {
  const dev = contract.get_device(new identity.get_device_arguments(ALICE, device)).value;
  expect(dev == null).toBe(false, "device record missing");
  return dev!;
}

function getRecovery(): identity.recovery_state {
  const st = contract.get_recovery(new identity.get_recovery_arguments(ALICE)).value;
  expect(st == null).toBe(false, "recovery state missing");
  return st!;
}

function resolve(device: Uint8Array | null, capability: u32): identity.resolve_actor_result {
  return contract.resolve_actor(new identity.resolve_actor_arguments(ALICE, device, capability));
}

function lastEvent(): system_calls.event_arguments {
  const events = MockVM.getEvents();
  expect(events.length > 0).toBe(true, "no events emitted");
  return events[events.length - 1];
}

function expectRevert(substr: string): void {
  const err = Testing.lastError();
  expect(err.includes(substr)).toBe(true, "expected revert containing '" + substr + "' but got '" + err + "'");
}

function expectImpacted(ev: system_calls.event_arguments, expected: Uint8Array[]): void {
  expect(ev.impacted.length).toBe(expected.length, "impacted length");
  for (let i = 0; i < expected.length; i++) {
    expect(Arrays.equal(ev.impacted[i], expected[i])).toBe(true, "impacted[" + i.toString() + "]");
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("identity: register", () => {
  beforeEach(() => {
    setup();
  });

  it("registers an identity and emits osp.identity.registered", () => {
    Testing.authorize([ALICE]);
    contract.register(new identity.register_arguments(ALICE, KEY1, 1, HASH1, "ipfs://profile"));

    const rec = getIdentity();
    expect(Arrays.equal(rec.account!, ALICE)).toBe(true);
    expect(Arrays.equal(rec.owner!, ALICE)).toBe(true);
    expect(Arrays.equal(rec.encryption_key!, KEY1)).toBe(true);
    expect(rec.key_version).toBe(1);
    expect(Arrays.equal(rec.profile_hash!, HASH1)).toBe(true);
    expect(rec.profile_uri!).toBe("ipfs://profile");
    expect(rec.protocol_version).toBe(1);
    expect(rec.device_epoch).toBe(0);
    expect(rec.registered_at).toBe(T0);
    expect(rec.updated_at).toBe(T0);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.registered");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<identity.registered_event>(ev.data, identity.registered_event.decode);
    expect(Arrays.equal(data.account!, ALICE)).toBe(true);
    expect(Arrays.equal(data.encryption_key!, KEY1)).toBe(true);
    expect(data.key_version).toBe(1);
    expect(data.protocol_version).toBe(1);
    expect(data.timestamp).toBe(T0);
  });

  it("accepts an empty profile hash and uri", () => {
    Testing.authorize([ALICE]);
    contract.register(new identity.register_arguments(ALICE, KEY1, 3, new Uint8Array(0), ""));
    const rec = getIdentity();
    expect(rec.profile_hash == null).toBe(true);
    expect(rec.profile_uri == null).toBe(true);
    expect(rec.key_version).toBe(3);
  });

  it("rejects duplicate registration", () => {
    registerAlice();
    expect(() => {
      contract.register(new identity.register_arguments(ALICE, KEY2, 2, null, null));
    }).toThrow();
    expectRevert("identity already registered");
    // state unchanged
    expect(getIdentity().key_version).toBe(1);
  });

  it("rejects registration not signed by the account", () => {
    Testing.authorize([BOB]);
    expect(() => {
      contract.register(new identity.register_arguments(ALICE, KEY1, 1, null, null));
    }).toThrow();
    expectRevert("authorization failed");
    expect(contract.get_identity(new identity.get_identity_arguments(ALICE)).value == null).toBe(true);
  });

  it("rejects a malformed account", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.register(new identity.register_arguments(filled(10, 1), KEY1, 1, null, null));
    }).toThrow();
    expectRevert("account must be a 25-byte address");
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.register(new identity.register_arguments(ALICE, filled(31, 1), 1, null, null));
    }).toThrow();
    expectRevert("encryption_key must be 32 bytes");
    expect(() => {
      contract.register(new identity.register_arguments(ALICE, null, 1, null, null));
    }).toThrow();
    expectRevert("encryption_key is required");
  });

  it("rejects key_version 0", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.register(new identity.register_arguments(ALICE, KEY1, 0, null, null));
    }).toThrow();
    expectRevert("key_version must be >= 1");
  });

  it("rejects a profile hash that is neither empty nor 32 bytes", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.register(new identity.register_arguments(ALICE, KEY1, 1, filled(20, 1), null));
    }).toThrow();
    expectRevert("profile_hash must be empty or 32 bytes");
  });

  it("rejects a profile uri longer than 512 characters", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.register(new identity.register_arguments(ALICE, KEY1, 1, null, repeat("u", 513)));
    }).toThrow();
    expectRevert("profile_uri too long");
  });

  it("read methods return null for unknown accounts", () => {
    expect(contract.get_identity(new identity.get_identity_arguments(ALICE)).value == null).toBe(true);
    expect(contract.get_identity(new identity.get_identity_arguments(null)).value == null).toBe(true);
    expect(contract.get_device(new identity.get_device_arguments(ALICE, DEVICE)).value == null).toBe(true);
    expect(contract.get_recovery(new identity.get_recovery_arguments(ALICE)).value == null).toBe(true);
    const res = resolve(null, 0);
    expect(res.ok).toBe(false);
    expect(res.reason!).toBe("unregistered");
  });
});

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

describe("identity: devices", () => {
  beforeEach(() => {
    setup();
    registerAlice();
  });

  it("authorizes a device and emits osp.identity.device_authorized", () => {
    authorizeDevice(DEVICE, PUBLISH | REACT, T0 + 30 * DAY);

    const dev = getDevice(DEVICE);
    expect(Arrays.equal(dev.account!, ALICE)).toBe(true);
    expect(Arrays.equal(dev.device!, DEVICE)).toBe(true);
    expect(dev.capabilities).toBe(PUBLISH | REACT);
    expect(dev.expires_at).toBe(T0 + 30 * DAY);
    expect(dev.device_epoch).toBe(0);
    expect(dev.revoked).toBe(false);
    expect(dev.label!).toBe("laptop");
    expect(dev.authorized_at).toBe(T0);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.device_authorized");
    expectImpacted(ev, [ALICE, DEVICE]);
    const data = Protobuf.decode<identity.device_authorized_event>(ev.data, identity.device_authorized_event.decode);
    expect(data.capabilities).toBe(PUBLISH | REACT);
    expect(data.expires_at).toBe(T0 + 30 * DAY);
    expect(data.device_epoch).toBe(0);
    expect(data.label!).toBe("laptop");
    expect(data.timestamp).toBe(T0);
  });

  it("resolves the device as signer when the capability is granted", () => {
    authorizeDevice(DEVICE, PUBLISH | REACT, T0 + DAY);
    const res = resolve(DEVICE, PUBLISH);
    expect(res.ok).toBe(true);
    expect(Arrays.equal(res.signer!, DEVICE)).toBe(true);
    expect(res.reason == null).toBe(true);
    // capability 0 means "any authorized device"
    const any = resolve(DEVICE, 0);
    expect(any.ok).toBe(true);
    expect(Arrays.equal(any.signer!, DEVICE)).toBe(true);
  });

  it("resolves the owner when the device is empty or equals the account", () => {
    const empty = resolve(null, PUBLISH);
    expect(empty.ok).toBe(true);
    expect(Arrays.equal(empty.signer!, ALICE)).toBe(true);
    const zero = resolve(new Uint8Array(0), PROFILE);
    expect(zero.ok).toBe(true);
    expect(Arrays.equal(zero.signer!, ALICE)).toBe(true);
    const self = resolve(ALICE, PROFILE);
    expect(self.ok).toBe(true);
    expect(Arrays.equal(self.signer!, ALICE)).toBe(true);
  });

  it("rejects a capability the device does not hold", () => {
    authorizeDevice(DEVICE, PUBLISH, T0 + DAY);
    const res = resolve(DEVICE, PROFILE);
    expect(res.ok).toBe(false);
    expect(res.signer == null).toBe(true);
    expect(res.reason!).toBe("capability not granted");
  });

  it("rejects an unknown device", () => {
    const res = resolve(DEVICE, PUBLISH);
    expect(res.ok).toBe(false);
    expect(res.reason!).toBe("unknown device");
  });

  it("rejects an expired device (time advanced)", () => {
    authorizeDevice(DEVICE, PUBLISH, T0 + DAY);
    Testing.setTime(T0 + DAY - 1);
    expect(resolve(DEVICE, PUBLISH).ok).toBe(true);
    Testing.setTime(T0 + DAY);
    const res = resolve(DEVICE, PUBLISH);
    expect(res.ok).toBe(false);
    expect(res.reason!).toBe("device expired");
  });

  it("revokes a device and emits osp.identity.device_revoked", () => {
    authorizeDevice(DEVICE, PUBLISH, T0 + DAY);
    Testing.authorize([ALICE]);
    contract.revoke_device(new identity.revoke_device_arguments(ALICE, DEVICE));
    MockVM.commitTransaction();

    expect(getDevice(DEVICE).revoked).toBe(true);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.device_revoked");
    expectImpacted(ev, [ALICE, DEVICE]);
    const res = resolve(DEVICE, PUBLISH);
    expect(res.ok).toBe(false);
    expect(res.reason!).toBe("device revoked");

    expect(() => {
      contract.revoke_device(new identity.revoke_device_arguments(ALICE, DEVICE));
    }).toThrow();
    expectRevert("device already revoked");
  });

  it("re-authorizing an existing device overwrites it", () => {
    authorizeDevice(DEVICE, PUBLISH, T0 + DAY);
    Testing.authorize([ALICE]);
    contract.revoke_device(new identity.revoke_device_arguments(ALICE, DEVICE));
    MockVM.commitTransaction();
    authorizeDevice(DEVICE, REACT, T0 + 2 * DAY);
    const dev = getDevice(DEVICE);
    expect(dev.revoked).toBe(false);
    expect(dev.capabilities).toBe(REACT);
    expect(dev.expires_at).toBe(T0 + 2 * DAY);
    expect(resolve(DEVICE, REACT).ok).toBe(true);
  });

  it("only the owner can authorize or revoke devices", () => {
    Testing.authorize([BOB, DEVICE]);
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE, PUBLISH, T0 + DAY, ""));
    }).toThrow();
    expectRevert("authorization failed");
    expect(contract.get_device(new identity.get_device_arguments(ALICE, DEVICE)).value == null).toBe(true);

    authorizeDevice(DEVICE, PUBLISH, T0 + DAY);
    Testing.authorize([DEVICE]);
    expect(() => {
      contract.revoke_device(new identity.revoke_device_arguments(ALICE, DEVICE));
    }).toThrow();
    expectRevert("authorization failed");
    expect(getDevice(DEVICE).revoked).toBe(false);
  });

  it("rejects revoking an unknown device", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.revoke_device(new identity.revoke_device_arguments(ALICE, DEVICE));
    }).toThrow();
    expectRevert("unknown device");
  });

  it("validates device arguments", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, ALICE, PUBLISH, T0 + DAY, ""));
    }).toThrow();
    expectRevert("device must differ from account");
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, filled(24, 1), PUBLISH, T0 + DAY, ""));
    }).toThrow();
    expectRevert("device must be a 25-byte address");
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE, 0, T0 + DAY, ""));
    }).toThrow();
    expectRevert("capabilities must not be empty");
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE, 64, T0 + DAY, ""));
    }).toThrow();
    expectRevert("unknown capability bits");
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE, PUBLISH, T0, ""));
    }).toThrow();
    expectRevert("expires_at must be in the future");
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE, PUBLISH, T0 + 366 * DAY + 1, ""));
    }).toThrow();
    expectRevert("expires_at too far in the future");
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE, PUBLISH, T0 + DAY, repeat("l", 65)));
    }).toThrow();
    expectRevert("label too long");
    // boundary: exactly 366 days and all six capability bits are accepted
    contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE, 63, T0 + 366 * DAY, repeat("l", 64)));
    expect(getDevice(DEVICE).capabilities).toBe(63);
  });

  it("rejects device operations for an unregistered identity", () => {
    Testing.authorize([BOB]);
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(BOB, DEVICE, PUBLISH, T0 + DAY, ""));
    }).toThrow();
    expectRevert("identity not registered");
    const res = contract.resolve_actor(new identity.resolve_actor_arguments(BOB, DEVICE, PUBLISH));
    expect(res.ok).toBe(false);
    expect(res.reason!).toBe("unregistered");
  });
});

// ---------------------------------------------------------------------------
// Profile updates and key rotation
// ---------------------------------------------------------------------------

describe("identity: update_profile", () => {
  beforeEach(() => {
    setup();
    registerAlice();
  });

  it("owner updates the profile and emits osp.identity.profile_updated", () => {
    Testing.setTime(T0 + 1000);
    Testing.authorize([ALICE]);
    contract.update_profile(new identity.update_profile_arguments(ALICE, HASH1, "ipfs://v2", null));

    const rec = getIdentity();
    expect(Arrays.equal(rec.profile_hash!, HASH1)).toBe(true);
    expect(rec.profile_uri!).toBe("ipfs://v2");
    expect(rec.updated_at).toBe(T0 + 1000);
    expect(rec.registered_at).toBe(T0);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.profile_updated");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<identity.profile_updated_event>(ev.data, identity.profile_updated_event.decode);
    expect(Arrays.equal(data.profile_hash!, HASH1)).toBe(true);
    expect(data.profile_uri!).toBe("ipfs://v2");
    expect(data.timestamp).toBe(T0 + 1000);
  });

  it("a device with the profile capability can update the profile", () => {
    authorizeDevice(DEVICE, PROFILE | PUBLISH, T0 + DAY);
    Testing.authorize([DEVICE]); // owner did not sign
    contract.update_profile(new identity.update_profile_arguments(ALICE, HASH1, "ipfs://device", DEVICE));
    const rec = getIdentity();
    expect(rec.profile_uri!).toBe("ipfs://device");
    expect(lastEvent().name).toBe("osp.identity.profile_updated");
  });

  it("a device without the profile capability is rejected", () => {
    authorizeDevice(DEVICE, PUBLISH, T0 + DAY);
    Testing.authorize([DEVICE, ALICE]);
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(ALICE, HASH1, "ipfs://device", DEVICE));
    }).toThrow();
    expectRevert("capability not granted");
    expect(getIdentity().profile_uri!).toBe("ipfs://profile");
  });

  it("the resolved device must sign, not the owner", () => {
    authorizeDevice(DEVICE, PROFILE, T0 + DAY);
    Testing.authorize([ALICE]);
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(ALICE, HASH1, "ipfs://device", DEVICE));
    }).toThrow();
    expectRevert("authorization failed");
  });

  it("rejects unknown, revoked and expired devices", () => {
    Testing.authorize([DEVICE]);
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(ALICE, null, "x", DEVICE));
    }).toThrow();
    expectRevert("unknown device");

    authorizeDevice(DEVICE, PROFILE, T0 + DAY);
    Testing.setTime(T0 + DAY);
    Testing.authorize([DEVICE]);
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(ALICE, null, "x", DEVICE));
    }).toThrow();
    expectRevert("device expired");
  });

  it("rejects when the identity is unregistered or the owner did not sign", () => {
    Testing.authorize([BOB]);
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(BOB, null, "x", null));
    }).toThrow();
    expectRevert("unregistered");
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(ALICE, null, "x", null));
    }).toThrow();
    expectRevert("authorization failed");
  });

  it("validates profile fields", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(ALICE, filled(5, 1), "x", null));
    }).toThrow();
    expectRevert("profile_hash must be empty or 32 bytes");
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(ALICE, null, repeat("u", 513), null));
    }).toThrow();
    expectRevert("profile_uri too long");
  });
});

describe("identity: rotate_encryption_key", () => {
  beforeEach(() => {
    setup();
    registerAlice();
  });

  it("rotates to a higher version and emits osp.identity.key_rotated", () => {
    Testing.setTime(T0 + 5);
    Testing.authorize([ALICE]);
    contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(ALICE, KEY2, 2));

    const rec = getIdentity();
    expect(Arrays.equal(rec.encryption_key!, KEY2)).toBe(true);
    expect(rec.key_version).toBe(2);
    expect(rec.updated_at).toBe(T0 + 5);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.key_rotated");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<identity.key_rotated_event>(ev.data, identity.key_rotated_event.decode);
    expect(data.previous_version).toBe(1);
    expect(data.key_version).toBe(2);
    expect(Arrays.equal(data.encryption_key!, KEY2)).toBe(true);
    expect(data.timestamp).toBe(T0 + 5);

    // versions may skip but never repeat or decrease
    contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(ALICE, KEY1, 10));
    expect(getIdentity().key_version).toBe(10);
  });

  it("rejects a version that does not increase", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(ALICE, KEY2, 1));
    }).toThrow();
    expectRevert("key_version must increase");
    expect(() => {
      contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(ALICE, KEY2, 0));
    }).toThrow();
    expectRevert("key_version must increase");
    expect(Arrays.equal(getIdentity().encryption_key!, KEY1)).toBe(true);
  });

  it("rejects a malformed key", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(ALICE, filled(33, 1), 2));
    }).toThrow();
    expectRevert("encryption_key must be 32 bytes");
  });

  it("devices and strangers cannot rotate keys", () => {
    authorizeDevice(DEVICE, 63, T0 + DAY);
    Testing.authorize([DEVICE, BOB]);
    expect(() => {
      contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(ALICE, KEY2, 2));
    }).toThrow();
    expectRevert("authorization failed");
    expect(getIdentity().key_version).toBe(1);
  });

  it("rejects an unregistered identity", () => {
    Testing.authorize([BOB]);
    expect(() => {
      contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(BOB, KEY2, 2));
    }).toThrow();
    expectRevert("identity not registered");
  });
});

// ---------------------------------------------------------------------------
// Recovery policy
// ---------------------------------------------------------------------------

describe("identity: recovery policy", () => {
  beforeEach(() => {
    setup();
    registerAlice();
  });

  it("the first policy applies immediately and emits osp.identity.recovery_policy_set", () => {
    setPolicyAsOwner(ALICE, policy([G1, G2, G3], 2, DAY));

    const st = getRecovery();
    expect(st.policy == null).toBe(false);
    expect(st.policy!.guardians.length).toBe(3);
    expect(Arrays.equal(st.policy!.guardians[0], G1)).toBe(true);
    expect(Arrays.equal(st.policy!.guardians[2], G3)).toBe(true);
    expect(st.policy!.threshold).toBe(2);
    expect(st.policy!.delay_ms).toBe(DAY);
    expect(st.pending_policy == null).toBe(true);
    expect(st.pending_recovery == null).toBe(true);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.recovery_policy_set");
    expectImpacted(ev, [ALICE, G1, G2, G3]);
    const data = Protobuf.decode<identity.recovery_policy_set_event>(ev.data, identity.recovery_policy_set_event.decode);
    expect(data.policy!.threshold).toBe(2);
    expect(data.policy!.guardians.length).toBe(3);
    expect(data.timestamp).toBe(T0);
  });

  it("validates the policy", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, null));
    }).toThrow();
    expectRevert("policy is required");
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([], 1, 0)));
    }).toThrow();
    expectRevert("at least one guardian is required");
    expect(() => {
      const many: Uint8Array[] = [];
      for (let i = 0; i < 17; i++) many.push(syntheticAddress(<u8>(100 + i)));
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy(many, 1, 0)));
    }).toThrow();
    expectRevert("too many guardians");
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G1, ALICE], 1, 0)));
    }).toThrow();
    expectRevert("guardian must differ from account");
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G1, G2, G1], 1, 0)));
    }).toThrow();
    expectRevert("guardians must be distinct");
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G1, filled(3, 1)], 1, 0)));
    }).toThrow();
    expectRevert("guardian must be a 25-byte address");
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G1, G2], 0, 0)));
    }).toThrow();
    expectRevert("threshold must be >= 1");
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G1, G2], 3, 0)));
    }).toThrow();
    expectRevert("threshold exceeds guardian count");
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G1, G2], 2, 365 * DAY + 1)));
    }).toThrow();
    expectRevert("delay_ms too large");
    expect(contract.get_recovery(new identity.get_recovery_arguments(ALICE)).value == null).toBe(true);

    // boundaries: 16 guardians, threshold == count, delay == 365 days
    const sixteen: Uint8Array[] = [];
    for (let i = 0; i < 16; i++) sixteen.push(syntheticAddress(<u8>(100 + i)));
    contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy(sixteen, 16, 365 * DAY)));
    expect(getRecovery().policy!.guardians.length).toBe(16);
  });

  it("only the owner can set the policy", () => {
    authorizeDevice(DEVICE, 63, T0 + DAY);
    Testing.authorize([DEVICE, BOB, G1]);
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G1], 1, 0)));
    }).toThrow();
    expectRevert("authorization failed");
    Testing.authorize([BOB]);
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(BOB, policy([G1], 1, 0)));
    }).toThrow();
    expectRevert("identity not registered");
  });

  it("a later change is delayed by the current policy and can be applied after the delay", () => {
    setPolicyAsOwner(ALICE, policy([G1, G2, G3], 2, DAY));
    Testing.setTime(T0 + 10);
    setPolicyAsOwner(ALICE, policy([G1, G2], 1, 2 * DAY));

    let st = getRecovery();
    expect(st.policy!.threshold).toBe(2); // unchanged
    expect(st.policy!.guardians.length).toBe(3);
    expect(st.pending_policy == null).toBe(false);
    expect(st.pending_policy!.effective_at).toBe(T0 + 10 + DAY);
    expect(st.pending_policy!.policy!.threshold).toBe(1);
    expect(st.pending_policy!.policy!.guardians.length).toBe(2);

    let ev = lastEvent();
    expect(ev.name).toBe("osp.identity.recovery_policy_proposed");
    expectImpacted(ev, [ALICE, G1, G2]);
    const proposed = Protobuf.decode<identity.recovery_policy_proposed_event>(ev.data, identity.recovery_policy_proposed_event.decode);
    expect(proposed.effective_at).toBe(T0 + 10 + DAY);
    expect(proposed.policy!.delay_ms).toBe(2 * DAY);

    // too early (anyone may call)
    Testing.setTime(T0 + 10 + DAY - 1);
    Testing.authorize([]);
    expect(() => {
      contract.apply_recovery_policy(new identity.apply_recovery_policy_arguments(ALICE));
    }).toThrow();
    expectRevert("recovery policy delay not elapsed");

    // on time, by a stranger
    Testing.setTime(T0 + 10 + DAY);
    Testing.authorize([BOB]);
    MockVM.clearEvents(); // keep the mock event log inside the system-call buffer
    contract.apply_recovery_policy(new identity.apply_recovery_policy_arguments(ALICE));
    MockVM.commitTransaction();
    st = getRecovery();
    expect(st.policy!.threshold).toBe(1);
    expect(st.policy!.delay_ms).toBe(2 * DAY);
    expect(st.policy!.guardians.length).toBe(2);
    expect(st.pending_policy == null).toBe(true);
    ev = lastEvent();
    expect(ev.name).toBe("osp.identity.recovery_policy_set");
    expectImpacted(ev, [ALICE, G1, G2]);
    const applied = Protobuf.decode<identity.recovery_policy_set_event>(ev.data, identity.recovery_policy_set_event.decode);
    expect(applied.timestamp).toBe(T0 + 10 + DAY);

    // the next change waits for the *new* delay
    Testing.authorize([ALICE]);
    contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G3], 1, 0)));
    expect(getRecovery().pending_policy!.effective_at).toBe(T0 + 10 + DAY + 2 * DAY);
  });

  it("a newer proposal replaces the pending one", () => {
    setPolicyAsOwner(ALICE, policy([G1, G2, G3], 2, DAY));
    setPolicyAsOwner(ALICE, policy([G1], 1, 0));
    setPolicyAsOwner(ALICE, policy([G2, G3], 2, 0));
    const st = getRecovery();
    expect(st.pending_policy!.policy!.guardians.length).toBe(2);
    expect(Arrays.equal(st.pending_policy!.policy!.guardians[0], G2)).toBe(true);
    expect(st.policy!.guardians.length).toBe(3);
  });

  it("the owner can cancel a pending change", () => {
    setPolicyAsOwner(ALICE, policy([G1, G2, G3], 2, DAY));
    setPolicyAsOwner(ALICE, policy([G1], 1, 0));

    Testing.authorize([G1, BOB]);
    expect(() => {
      contract.cancel_recovery_policy(new identity.cancel_recovery_policy_arguments(ALICE));
    }).toThrow();
    expectRevert("authorization failed");

    Testing.setTime(T0 + 7);
    Testing.authorize([ALICE]);
    contract.cancel_recovery_policy(new identity.cancel_recovery_policy_arguments(ALICE));
    MockVM.commitTransaction();
    const st = getRecovery();
    expect(st.pending_policy == null).toBe(true);
    expect(st.policy!.threshold).toBe(2);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.recovery_policy_cancelled");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<identity.recovery_policy_cancelled_event>(ev.data, identity.recovery_policy_cancelled_event.decode);
    expect(data.timestamp).toBe(T0 + 7);

    // the cancelled change can no longer be applied
    Testing.setTime(T0 + 10 * DAY);
    expect(() => {
      contract.apply_recovery_policy(new identity.apply_recovery_policy_arguments(ALICE));
    }).toThrow();
    expectRevert("no pending recovery policy");
  });

  it("cancel and apply require a pending change", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.cancel_recovery_policy(new identity.cancel_recovery_policy_arguments(ALICE));
    }).toThrow();
    expectRevert("no pending recovery policy");
    expect(() => {
      contract.apply_recovery_policy(new identity.apply_recovery_policy_arguments(ALICE));
    }).toThrow();
    expectRevert("no pending recovery policy");
    setPolicyAsOwner(ALICE, policy([G1], 1, 0));
    expect(() => {
      contract.apply_recovery_policy(new identity.apply_recovery_policy_arguments(ALICE));
    }).toThrow();
    expectRevert("no pending recovery policy");
    expect(() => {
      contract.apply_recovery_policy(new identity.apply_recovery_policy_arguments(BOB));
    }).toThrow();
    expectRevert("identity not registered");
  });
});

// ---------------------------------------------------------------------------
// Guardian recovery (2 of 3, one day delay)
// ---------------------------------------------------------------------------

describe("identity: guardian recovery", () => {
  beforeEach(() => {
    setup();
    registerAlice();
    setPolicyAsOwner(ALICE, policy([G1, G2, G3], 2, DAY));
  });

  it("a guardian proposes a new owner", () => {
    Testing.setTime(T0 + 100);
    propose(G1, BOB);

    const st = getRecovery();
    expect(st.pending_recovery == null).toBe(false);
    const pending = st.pending_recovery!;
    expect(Arrays.equal(pending.new_owner!, BOB)).toBe(true);
    expect(pending.approvals.length).toBe(1);
    expect(Arrays.equal(pending.approvals[0], G1)).toBe(true);
    expect(pending.effective_at).toBe(0);
    expect(pending.proposed_at).toBe(T0 + 100);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.recovery_proposed");
    expectImpacted(ev, [ALICE, G1, BOB]);
    const data = Protobuf.decode<identity.recovery_proposed_event>(ev.data, identity.recovery_proposed_event.decode);
    expect(Arrays.equal(data.guardian!, G1)).toBe(true);
    expect(Arrays.equal(data.new_owner!, BOB)).toBe(true);
    expect(data.approvals).toBe(1);
    expect(data.threshold).toBe(2);
    expect(data.effective_at).toBe(0);
    expect(data.timestamp).toBe(T0 + 100);

    // owner is untouched until execution
    expect(Arrays.equal(getIdentity().owner!, ALICE)).toBe(true);
  });

  it("rejects proposals from non-guardians, unsigned guardians and bad new owners", () => {
    Testing.authorize([BOB, ALICE]);
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, BOB, DEVICE));
    }).toThrow();
    expectRevert("not a guardian");
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, ALICE, DEVICE));
    }).toThrow();
    expectRevert("not a guardian");
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, G1, BOB));
    }).toThrow();
    expectRevert("authorization failed");

    Testing.authorize([G1]);
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, G1, ALICE));
    }).toThrow();
    expectRevert("new_owner must differ from current owner");
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, G1, filled(2, 1)));
    }).toThrow();
    expectRevert("new_owner must be a 25-byte address");
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, G1, null));
    }).toThrow();
    expectRevert("new_owner is required");
    expect(getRecovery().pending_recovery == null).toBe(true);
  });

  it("rejects proposals when there is no policy or no identity", () => {
    Testing.authorize([BOB, G1]);
    contract.register(new identity.register_arguments(BOB, KEY1, 1, null, null));
    MockVM.commitTransaction();
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(BOB, G1, DEVICE));
    }).toThrow();
    expectRevert("no recovery policy");
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(DEVICE, G1, BOB));
    }).toThrow();
    expectRevert("identity not registered");
  });

  it("rejects a duplicate approval from the same guardian", () => {
    propose(G1, BOB);
    Testing.authorize([G1]);
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, G1, BOB));
    }).toThrow();
    expectRevert("already approved");
    expect(getRecovery().pending_recovery!.approvals.length).toBe(1);
  });

  it("reaching the threshold fixes effective_at; extra approvals do not move it", () => {
    propose(G1, BOB);
    Testing.setTime(T0 + 500);
    MockVM.clearEvents(); // keep the mock event log inside the system-call buffer
    propose(G2, BOB);

    let pending = getRecovery().pending_recovery!;
    expect(pending.approvals.length).toBe(2);
    expect(pending.effective_at).toBe(T0 + 500 + DAY);
    let data = Protobuf.decode<identity.recovery_proposed_event>(lastEvent().data, identity.recovery_proposed_event.decode);
    expect(data.approvals).toBe(2);
    expect(data.threshold).toBe(2);
    expect(data.effective_at).toBe(T0 + 500 + DAY);

    Testing.setTime(T0 + 900);
    MockVM.clearEvents();
    propose(G3, BOB);
    pending = getRecovery().pending_recovery!;
    expect(pending.approvals.length).toBe(3);
    expect(pending.effective_at).toBe(T0 + 500 + DAY);
    data = Protobuf.decode<identity.recovery_proposed_event>(lastEvent().data, identity.recovery_proposed_event.decode);
    expect(data.approvals).toBe(3);
  });

  it("a proposal for a different new owner restarts the approval set", () => {
    propose(G1, BOB);
    propose(G2, DEVICE);
    const pending = getRecovery().pending_recovery!;
    expect(Arrays.equal(pending.new_owner!, DEVICE)).toBe(true);
    expect(pending.approvals.length).toBe(1);
    expect(Arrays.equal(pending.approvals[0], G2)).toBe(true);
    expect(pending.effective_at).toBe(0);
    // G1 can now approve the new target
    propose(G1, DEVICE);
    expect(getRecovery().pending_recovery!.approvals.length).toBe(2);
    expect(getRecovery().pending_recovery!.effective_at).toBe(T0 + DAY);
  });

  it("execute is rejected before the threshold and before the delay", () => {
    Testing.authorize([]);
    expect(() => {
      contract.execute_recovery(new identity.execute_recovery_arguments(ALICE));
    }).toThrow();
    expectRevert("no pending recovery");

    propose(G1, BOB);
    Testing.setTime(T0 + 10 * DAY);
    Testing.authorize([]);
    expect(() => {
      contract.execute_recovery(new identity.execute_recovery_arguments(ALICE));
    }).toThrow();
    expectRevert("recovery threshold not reached");

    Testing.setTime(T0);
    propose(G2, BOB);
    Testing.setTime(T0 + DAY - 1);
    Testing.authorize([BOB]);
    expect(() => {
      contract.execute_recovery(new identity.execute_recovery_arguments(ALICE));
    }).toThrow();
    expectRevert("recovery delay not elapsed");
    expect(Arrays.equal(getIdentity().owner!, ALICE)).toBe(true);
    expect(getIdentity().device_epoch).toBe(0);
  });

  it("the current owner can cancel a pending recovery", () => {
    propose(G1, BOB);
    propose(G2, BOB);

    Testing.authorize([BOB, G1, G2]);
    expect(() => {
      contract.cancel_recovery(new identity.cancel_recovery_arguments(ALICE));
    }).toThrow();
    expectRevert("authorization failed");

    Testing.setTime(T0 + 3);
    Testing.authorize([ALICE]);
    MockVM.clearEvents(); // keep the mock event log inside the system-call buffer
    contract.cancel_recovery(new identity.cancel_recovery_arguments(ALICE));
    MockVM.commitTransaction();
    expect(getRecovery().pending_recovery == null).toBe(true);
    expect(getRecovery().policy!.threshold).toBe(2);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.recovery_cancelled");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<identity.recovery_cancelled_event>(ev.data, identity.recovery_cancelled_event.decode);
    expect(data.timestamp).toBe(T0 + 3);

    // nothing left to execute or cancel
    Testing.setTime(T0 + 10 * DAY);
    expect(() => {
      contract.execute_recovery(new identity.execute_recovery_arguments(ALICE));
    }).toThrow();
    expectRevert("no pending recovery");
    expect(() => {
      contract.cancel_recovery(new identity.cancel_recovery_arguments(ALICE));
    }).toThrow();
    expectRevert("no pending recovery");
    expect(Arrays.equal(getIdentity().owner!, ALICE)).toBe(true);
  });

  it("executes after the delay: owner replaced, devices voided, old owner locked out", () => {
    authorizeDevice(DEVICE, 63, T0 + 300 * DAY);
    expect(resolve(DEVICE, PUBLISH).ok).toBe(true);

    propose(G1, BOB);
    propose(G2, BOB);
    Testing.setTime(T0 + DAY);
    Testing.authorize([]); // anyone (even nobody) may execute
    MockVM.clearEvents(); // keep the mock event log inside the system-call buffer
    contract.execute_recovery(new identity.execute_recovery_arguments(ALICE));
    MockVM.commitTransaction();

    const rec = getIdentity();
    expect(Arrays.equal(rec.account!, ALICE)).toBe(true);
    expect(Arrays.equal(rec.owner!, BOB)).toBe(true);
    expect(rec.device_epoch).toBe(1);
    expect(rec.updated_at).toBe(T0 + DAY);
    expect(rec.key_version).toBe(1); // encryption key untouched
    expect(getRecovery().pending_recovery == null).toBe(true);
    expect(getRecovery().policy!.threshold).toBe(2); // policy survives

    const ev = lastEvent();
    expect(ev.name).toBe("osp.identity.recovered");
    expectImpacted(ev, [ALICE, ALICE, BOB]);
    const data = Protobuf.decode<identity.recovered_event>(ev.data, identity.recovered_event.decode);
    expect(Arrays.equal(data.account!, ALICE)).toBe(true);
    expect(Arrays.equal(data.previous_owner!, ALICE)).toBe(true);
    expect(Arrays.equal(data.new_owner!, BOB)).toBe(true);
    expect(data.device_epoch).toBe(1);
    expect(data.timestamp).toBe(T0 + DAY);

    // devices from the previous epoch are void
    const voided = resolve(DEVICE, PUBLISH);
    expect(voided.ok).toBe(false);
    expect(voided.reason!).toBe("device epoch expired");
    expect(getDevice(DEVICE).device_epoch).toBe(0);
    expect(getDevice(DEVICE).revoked).toBe(false);

    // the owner signer is now BOB
    const ownerRes = resolve(null, PROFILE);
    expect(ownerRes.ok).toBe(true);
    expect(Arrays.equal(ownerRes.signer!, BOB)).toBe(true);

    // the old owner key can no longer administer the identity
    Testing.authorize([ALICE]);
    expect(() => {
      contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE2, PUBLISH, T0 + 2 * DAY, ""));
    }).toThrow();
    expectRevert("authorization failed");
    expect(() => {
      contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(ALICE, KEY2, 2));
    }).toThrow();
    expectRevert("authorization failed");
    expect(() => {
      contract.update_profile(new identity.update_profile_arguments(ALICE, HASH1, "ipfs://old-owner", null));
    }).toThrow();
    expectRevert("authorization failed");
    expect(() => {
      contract.revoke_device(new identity.revoke_device_arguments(ALICE, DEVICE));
    }).toThrow();
    expectRevert("authorization failed");
    expect(() => {
      contract.set_recovery_policy(new identity.set_recovery_policy_arguments(ALICE, policy([G1], 1, 0)));
    }).toThrow();
    expectRevert("authorization failed");

    // the new owner administers the identity and its devices carry the new epoch
    Testing.authorize([BOB]);
    contract.update_profile(new identity.update_profile_arguments(ALICE, HASH1, "ipfs://new-owner", null));
    contract.rotate_encryption_key(new identity.rotate_encryption_key_arguments(ALICE, KEY2, 2));
    contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE2, PUBLISH, T0 + 2 * DAY, "phone"));
    MockVM.commitTransaction();
    expect(getIdentity().profile_uri!).toBe("ipfs://new-owner");
    expect(getIdentity().key_version).toBe(2);
    expect(getDevice(DEVICE2).device_epoch).toBe(1);
    const fresh = resolve(DEVICE2, PUBLISH);
    expect(fresh.ok).toBe(true);
    expect(Arrays.equal(fresh.signer!, DEVICE2)).toBe(true);
    // re-authorizing the old device under the new owner revives it in the new epoch
    contract.authorize_device(new identity.authorize_device_arguments(ALICE, DEVICE, REACT, T0 + 2 * DAY, ""));
    expect(getDevice(DEVICE).device_epoch).toBe(1);
    expect(resolve(DEVICE, REACT).ok).toBe(true);
  });

  it("a second recovery increments the epoch again and targets the current owner", () => {
    propose(G1, BOB);
    propose(G2, BOB);
    Testing.setTime(T0 + DAY);
    Testing.authorize([]);
    contract.execute_recovery(new identity.execute_recovery_arguments(ALICE));
    MockVM.commitTransaction();

    // BOB is the owner now, so BOB cannot be proposed again but ALICE can
    Testing.authorize([G1]);
    expect(() => {
      contract.propose_recovery(new identity.propose_recovery_arguments(ALICE, G1, BOB));
    }).toThrow();
    expectRevert("new_owner must differ from current owner");
    propose(G1, ALICE);
    propose(G3, ALICE);
    Testing.setTime(T0 + 2 * DAY);
    Testing.authorize([]);
    contract.execute_recovery(new identity.execute_recovery_arguments(ALICE));
    const rec = getIdentity();
    expect(Arrays.equal(rec.owner!, ALICE)).toBe(true);
    expect(rec.device_epoch).toBe(2);
  });
});
