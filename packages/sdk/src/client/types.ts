/**
 * Typed arguments, results and event payloads for every contract method
 * (packages/proto/osp/*.proto). Input values follow the SDK object model
 * (see encoding.ts): addresses as Base58 strings (raw bytes accepted), other bytes as
 * Uint8Array, 64-bit integers as decimal strings (numbers/bigints accepted), enums as numbers.
 * Decoded results always carry every scalar field (defaults filled in).
 */

export type Address = string | Uint8Array;
export type Bytes = Uint8Array;
export type U64 = string | number | bigint;

export interface ValueResult<T> {
  /** Absent when the record does not exist. */
  value?: T;
}
export interface ValuesResult<T> {
  values: T[];
}

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

export interface RegisterArgs {
  account: Address;
  /** X25519 public key (32 bytes). */
  encryption_key: Bytes;
  key_version: number;
  profile_hash?: Bytes;
  profile_uri?: string;
}
export interface UpdateProfileArgs {
  account: Address;
  profile_hash?: Bytes;
  profile_uri?: string;
  device?: Address;
}
export interface RotateEncryptionKeyArgs {
  account: Address;
  encryption_key: Bytes;
  key_version: number;
}
export interface AuthorizeDeviceArgs {
  account: Address;
  device: Address;
  /** Capability bitmask (CAPABILITY). */
  capabilities: number;
  /** Block timestamp (ms) after which the device is void. */
  expires_at: U64;
  label?: string;
}
export interface RevokeDeviceArgs {
  account: Address;
  device: Address;
}
export interface RecoveryPolicyInput {
  guardians: Address[];
  threshold: number;
  delay_ms: U64;
}
export interface SetRecoveryPolicyArgs {
  account: Address;
  policy: RecoveryPolicyInput;
}
export interface AccountArgs {
  account: Address;
}
export interface ProposeRecoveryArgs {
  account: Address;
  guardian: Address;
  new_owner: Address;
}
export interface GetDeviceArgs {
  account: Address;
  device: Address;
}
export interface ResolveActorArgs {
  account: Address;
  device?: Address;
  capability: number;
}

export interface IdentityRecord {
  account: string;
  owner: string;
  encryption_key: Uint8Array;
  key_version: number;
  profile_hash: Uint8Array;
  profile_uri: string;
  protocol_version: number;
  device_epoch: number;
  registered_at: string;
  updated_at: string;
}
export interface DeviceRecord {
  account: string;
  device: string;
  capabilities: number;
  expires_at: string;
  device_epoch: number;
  revoked: boolean;
  label: string;
  authorized_at: string;
}
export interface RecoveryPolicy {
  guardians: string[];
  threshold: number;
  delay_ms: string;
}
export interface PendingPolicy {
  policy?: RecoveryPolicy;
  effective_at: string;
}
export interface PendingRecovery {
  new_owner: string;
  approvals: string[];
  effective_at: string;
  proposed_at: string;
}
export interface RecoveryState {
  policy?: RecoveryPolicy;
  pending_policy?: PendingPolicy;
  pending_recovery?: PendingRecovery;
}
export interface ResolveActorResult {
  ok: boolean;
  signer: string;
  reason: string;
}

export interface IdentityWriteMethods {
  register: RegisterArgs;
  update_profile: UpdateProfileArgs;
  rotate_encryption_key: RotateEncryptionKeyArgs;
  authorize_device: AuthorizeDeviceArgs;
  revoke_device: RevokeDeviceArgs;
  set_recovery_policy: SetRecoveryPolicyArgs;
  apply_recovery_policy: AccountArgs;
  cancel_recovery_policy: AccountArgs;
  propose_recovery: ProposeRecoveryArgs;
  cancel_recovery: AccountArgs;
  execute_recovery: AccountArgs;
}
export interface IdentityReadMethods {
  get_identity: [AccountArgs, ValueResult<IdentityRecord>];
  get_device: [GetDeviceArgs, ValueResult<DeviceRecord>];
  get_recovery: [AccountArgs, ValueResult<RecoveryState>];
  resolve_actor: [ResolveActorArgs, ResolveActorResult];
}

// ---------------------------------------------------------------------------
// relationships
// ---------------------------------------------------------------------------

export interface SetContractAddressArgs {
  address: Address;
}
export interface RequestFriendArgs {
  requester: Address;
  recipient: Address;
  device?: Address;
}
export interface AcceptFriendArgs {
  approver: Address;
  requester: Address;
  device?: Address;
  key_package_ref?: Bytes;
}
export interface RemoveFriendArgs {
  actor: Address;
  peer: Address;
  device?: Address;
}
export interface BlockArgs {
  actor: Address;
  target: Address;
}
export interface FollowArgs {
  follower: Address;
  target: Address;
  device?: Address;
}
export interface RotateAudienceArgs {
  actor: Address;
  device?: Address;
}
export interface PairArgs {
  a: Address;
  b: Address;
}
export interface ActorTargetArgs {
  actor: Address;
  target: Address;
}
export interface FollowerTargetArgs {
  follower: Address;
  target: Address;
}

export interface RelationshipRecord {
  a: string;
  b: string;
  status: number;
  requester: string;
  nonce: string;
  updated_at: string;
}
export interface AudienceState {
  epoch: number;
  updated_at: string;
}
export interface FollowRecord {
  active: boolean;
  updated_at: string;
}
export interface BoolResult {
  value: boolean;
}
export interface AddressResult {
  value: string;
}

export interface RelationshipsWriteMethods {
  set_identity_contract: SetContractAddressArgs;
  request_friend: RequestFriendArgs;
  accept_friend: AcceptFriendArgs;
  remove_friend: RemoveFriendArgs;
  block: BlockArgs;
  unblock: BlockArgs;
  follow: FollowArgs;
  unfollow: FollowArgs;
  rotate_audience: RotateAudienceArgs;
}
export interface RelationshipsReadMethods {
  get_relationship: [PairArgs, ValueResult<RelationshipRecord>];
  get_audience: [AccountArgs, ValueResult<AudienceState>];
  is_blocked: [ActorTargetArgs, BoolResult];
  get_follow: [FollowerTargetArgs, ValueResult<FollowRecord>];
  get_identity_contract: [Record<string, never>, AddressResult];
}

// ---------------------------------------------------------------------------
// publications
// ---------------------------------------------------------------------------

export interface MediaRefInput {
  content_hash: Bytes;
  mime?: string;
  size?: U64;
  locations?: string[];
  key_ref?: Bytes;
}
export interface MediaRef {
  content_hash: Uint8Array;
  mime: string;
  size: string;
  locations: string[];
  key_ref: Uint8Array;
}
export interface PublishArgs {
  author: Address;
  post_id: Bytes;
  /** Empty for the first version; previous content_hash for edits. */
  previous_version?: Bytes;
  /** Author's next_sequence for a first version; ignored for edits. */
  sequence?: U64;
  audience?: number;
  audience_id?: Bytes;
  epoch?: number;
  envelope: Bytes;
  content_hash: Bytes;
  media?: MediaRefInput[];
  reply_to?: Bytes;
  idempotency_key?: Bytes;
  device?: Address;
}
export interface SetLifecycleArgs {
  author: Address;
  post_id: Bytes;
  version: Bytes;
  state: number;
  reason?: string;
  replacement_id?: Bytes;
  device?: Address;
}
export interface ReactArgs {
  actor: Address;
  post_id: Bytes;
  reaction: number;
  remove?: boolean;
  device?: Address;
}
export interface DistributeKeysArgs {
  author: Address;
  audience_id?: Bytes;
  epoch: number;
  /** Encoded osp.envelope.key_package_set. */
  packages: Bytes;
  device?: Address;
}
export interface RecordCrossPostArgs {
  author: Address;
  idempotency_key: Bytes;
  adapter: string;
  state: number;
  external_ref?: string;
  post_id?: Bytes;
  manifest_hash?: Bytes;
  device?: Address;
}
export interface PostIdArgs {
  post_id: Bytes;
}
export interface AuthorArgs {
  author: Address;
}
export interface PostByIdempotencyKeyArgs {
  author: Address;
  idempotency_key: Bytes;
}

export interface PostRecord {
  author: string;
  sequence: string;
  version_count: number;
  latest_version: Uint8Array;
  state: number;
  reply_to: Uint8Array;
  audience: number;
  created_at: string;
  updated_at: string;
}
export interface AuthorState {
  next_sequence: string;
  last_publish_at: string;
  post_count: string;
}
export interface PostRef {
  post_id: Uint8Array;
}
export interface Limits {
  max_envelope_bytes: number;
  max_media_refs: number;
  max_key_package_bytes: number;
  max_idempotency_key_bytes: number;
  max_location_chars: number;
  protocol_version: number;
}
export interface PublicationsDependencies {
  identity: string;
  relationships: string;
}

export interface PublicationsWriteMethods {
  set_identity_contract: SetContractAddressArgs;
  set_relationships_contract: SetContractAddressArgs;
  publish: PublishArgs;
  set_lifecycle: SetLifecycleArgs;
  react: ReactArgs;
  distribute_keys: DistributeKeysArgs;
  record_cross_post: RecordCrossPostArgs;
}
export interface PublicationsReadMethods {
  get_post: [PostIdArgs, ValueResult<PostRecord>];
  get_author_state: [AuthorArgs, ValueResult<AuthorState>];
  get_post_by_idempotency_key: [PostByIdempotencyKeyArgs, ValueResult<PostRef>];
  get_limits: [Record<string, never>, ValueResult<Limits>];
  get_dependencies: [Record<string, never>, PublicationsDependencies];
}

// ---------------------------------------------------------------------------
// communities
// ---------------------------------------------------------------------------

export interface CreateCommunityArgs {
  creator: Address;
  id: Bytes;
  name: string;
  policy_hash?: Bytes;
  policy_uri?: string;
  transfer_delay_ms?: U64;
  device?: Address;
}
export interface SetRoleArgs {
  community_id: Bytes;
  actor: Address;
  subject: Address;
  role: number;
  scope?: Bytes;
  expires_at?: U64;
  device?: Address;
}
export interface SetPolicyArgs {
  community_id: Bytes;
  actor: Address;
  policy_hash?: Bytes;
  policy_uri?: string;
  device?: Address;
}
export interface ProposeOwnerTransferArgs {
  community_id: Bytes;
  owner: Address;
  new_owner: Address;
}
export interface CancelOwnerTransferArgs {
  community_id: Bytes;
  owner: Address;
}
export interface CommunityIdArgs {
  community_id: Bytes;
}
export interface SetLabelArgs {
  community_id: Bytes;
  actor: Address;
  post_id: Bytes;
  label: string;
  reason?: string;
  device?: Address;
}
export interface GetCommunityArgs {
  id: Bytes;
}
export interface GetRoleArgs {
  community_id: Bytes;
  subject: Address;
}

export interface CommunityRecord {
  id: Uint8Array;
  owner: string;
  name: string;
  policy_hash: Uint8Array;
  policy_uri: string;
  transfer_delay_ms: string;
  pending_owner: string;
  transfer_effective_at: string;
  created_at: string;
  updated_at: string;
}
export interface RoleRecord {
  role: number;
  scope: Uint8Array;
  expires_at: string;
  granted_by: string;
  granted_at: string;
}

export interface CommunitiesWriteMethods {
  set_identity_contract: SetContractAddressArgs;
  create_community: CreateCommunityArgs;
  set_role: SetRoleArgs;
  set_policy: SetPolicyArgs;
  propose_owner_transfer: ProposeOwnerTransferArgs;
  cancel_owner_transfer: CancelOwnerTransferArgs;
  execute_owner_transfer: CommunityIdArgs;
  set_label: SetLabelArgs;
}
export interface CommunitiesReadMethods {
  get_community: [GetCommunityArgs, ValueResult<CommunityRecord>];
  get_role: [GetRoleArgs, ValueResult<RoleRecord>];
  get_identity_contract: [Record<string, never>, AddressResult];
}

// ---------------------------------------------------------------------------
// sponsorship
// ---------------------------------------------------------------------------

export interface AllowedCallInput {
  contract_id: Address;
  /** Empty = every entry point. */
  entry_points?: number[];
}
export interface AllowedCall {
  contract_id: string;
  entry_points: number[];
}
export interface SetSponsorArgs {
  sponsor: Address;
  endpoint: string;
  policy_uri?: string;
  policy_version?: number;
  allowed?: AllowedCallInput[];
  max_rc_per_op?: U64;
  max_ops_per_user_per_day?: number;
  max_bytes_per_op?: number;
  active?: boolean;
}
export interface SponsorArgs {
  sponsor: Address;
}
export interface SetUserGrantArgs {
  sponsor: Address;
  user: Address;
  daily_ops: number;
  expires_at: U64;
}
export interface SponsorUserArgs {
  sponsor: Address;
  user: Address;
}
export interface ListSponsorsArgs {
  start?: Address;
  limit?: number;
}

export interface SponsorRecord {
  sponsor: string;
  endpoint: string;
  policy_uri: string;
  policy_version: number;
  allowed: AllowedCall[];
  max_rc_per_op: string;
  max_ops_per_user_per_day: number;
  max_bytes_per_op: number;
  active: boolean;
  registered_at: string;
  updated_at: string;
}
export interface UserGrant {
  sponsor: string;
  user: string;
  daily_ops: number;
  expires_at: string;
  revoked: boolean;
  updated_at: string;
}

export interface SponsorshipWriteMethods {
  set_sponsor: SetSponsorArgs;
  deactivate_sponsor: SponsorArgs;
  set_user_grant: SetUserGrantArgs;
  revoke_user_grant: SponsorUserArgs;
}
export interface SponsorshipReadMethods {
  get_sponsor: [SponsorArgs, ValueResult<SponsorRecord>];
  list_sponsors: [ListSponsorsArgs, ValuesResult<SponsorRecord>];
  get_user_grant: [SponsorUserArgs, ValueResult<UserGrant>];
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

export interface RegistryInitArgs {
  admin: Address;
  upgrade_delay_ms: U64;
  protocol_version: number;
}
export interface ProposeContractArgs {
  name: string;
  address: Address;
  version: number;
  abi_hash?: Bytes;
  notes?: string;
}
export interface ContractNameArgs {
  name: string;
}
export interface DeprecateContractArgs {
  name: string;
  notes?: string;
}
export interface ProposeAdminArgs {
  new_admin: Address;
}

export interface ContractEntry {
  name: string;
  address: string;
  version: number;
  abi_hash: Uint8Array;
  status: number;
  effective_at: string;
  notes: string;
  updated_at: string;
}
export interface RegistryConfig {
  admin: string;
  upgrade_delay_ms: string;
  protocol_version: number;
  pending_admin: string;
  admin_transfer_effective_at: string;
}

export interface RegistryWriteMethods {
  init: RegistryInitArgs;
  propose_contract: ProposeContractArgs;
  apply_contract: ContractNameArgs;
  cancel_contract: ContractNameArgs;
  deprecate_contract: DeprecateContractArgs;
  propose_admin: ProposeAdminArgs;
  cancel_admin: Record<string, never>;
  execute_admin: Record<string, never>;
}
export interface RegistryReadMethods {
  get_contract: [ContractNameArgs, ValueResult<ContractEntry>];
  get_proposed_contract: [ContractNameArgs, ValueResult<ContractEntry>];
  list_contracts: [Record<string, never>, ValuesResult<ContractEntry>];
  get_config: [Record<string, never>, ValueResult<RegistryConfig>];
}

// ---------------------------------------------------------------------------
// Method tables
// ---------------------------------------------------------------------------

export interface ContractWriteMethods {
  identity: IdentityWriteMethods;
  relationships: RelationshipsWriteMethods;
  publications: PublicationsWriteMethods;
  communities: CommunitiesWriteMethods;
  sponsorship: SponsorshipWriteMethods;
  registry: RegistryWriteMethods;
}
export interface ContractReadMethods {
  identity: IdentityReadMethods;
  relationships: RelationshipsReadMethods;
  publications: PublicationsReadMethods;
  communities: CommunitiesReadMethods;
  sponsorship: SponsorshipReadMethods;
  registry: RegistryReadMethods;
}

// ---------------------------------------------------------------------------
// Event payloads (osp.<contract>.<event>)
// ---------------------------------------------------------------------------

export interface RegisteredEvent {
  account: string;
  encryption_key: Uint8Array;
  key_version: number;
  profile_hash: Uint8Array;
  profile_uri: string;
  protocol_version: number;
  timestamp: string;
}
export interface ProfileUpdatedEvent {
  account: string;
  profile_hash: Uint8Array;
  profile_uri: string;
  timestamp: string;
}
export interface KeyRotatedEvent {
  account: string;
  previous_version: number;
  encryption_key: Uint8Array;
  key_version: number;
  timestamp: string;
}
export interface DeviceAuthorizedEvent {
  account: string;
  device: string;
  capabilities: number;
  expires_at: string;
  label: string;
  device_epoch: number;
  timestamp: string;
}
export interface DeviceRevokedEvent {
  account: string;
  device: string;
  timestamp: string;
}
export interface RecoveryPolicyProposedEvent {
  account: string;
  policy?: RecoveryPolicy;
  effective_at: string;
}
export interface RecoveryPolicySetEvent {
  account: string;
  policy?: RecoveryPolicy;
  timestamp: string;
}
export interface AccountTimestampEvent {
  account: string;
  timestamp: string;
}
export interface RecoveryProposedEvent {
  account: string;
  guardian: string;
  new_owner: string;
  approvals: number;
  threshold: number;
  effective_at: string;
  timestamp: string;
}
export interface RecoveredEvent {
  account: string;
  previous_owner: string;
  new_owner: string;
  device_epoch: number;
  timestamp: string;
}

export interface FriendRequestedEvent {
  requester: string;
  recipient: string;
  nonce: string;
  timestamp: string;
}
export interface FriendAcceptedEvent {
  approver: string;
  requester: string;
  nonce: string;
  key_package_ref: Uint8Array;
  timestamp: string;
}
export interface FriendRemovedEvent {
  actor: string;
  peer: string;
  nonce: string;
  new_epoch: number;
  timestamp: string;
}
export interface BlockedEvent {
  actor: string;
  target: string;
  new_epoch: number;
  timestamp: string;
}
export interface UnblockedEvent {
  actor: string;
  target: string;
  timestamp: string;
}
export interface FollowEvent {
  follower: string;
  target: string;
  timestamp: string;
}
export interface AudienceRotatedEvent {
  account: string;
  new_epoch: number;
  reason: string;
  timestamp: string;
}

export interface PublishedEvent {
  author: string;
  post_id: Uint8Array;
  content_hash: Uint8Array;
  previous_version: Uint8Array;
  version_number: number;
  sequence: string;
  audience: number;
  audience_id: Uint8Array;
  epoch: number;
  envelope: Uint8Array;
  media: MediaRef[];
  reply_to: Uint8Array;
  idempotency_key: Uint8Array;
  protocol_version: number;
  timestamp: string;
}
export interface LifecycleEvent {
  author: string;
  post_id: Uint8Array;
  version: Uint8Array;
  state: number;
  reason: string;
  replacement_id: Uint8Array;
  timestamp: string;
}
export interface ReactionEvent {
  actor: string;
  post_id: Uint8Array;
  post_author: string;
  reaction: number;
  removed: boolean;
  timestamp: string;
}
export interface KeysDistributedEvent {
  author: string;
  audience_id: Uint8Array;
  epoch: number;
  packages: Uint8Array;
  timestamp: string;
}
export interface CrossPostOutcomeEvent {
  author: string;
  idempotency_key: Uint8Array;
  adapter: string;
  state: number;
  external_ref: string;
  post_id: Uint8Array;
  manifest_hash: Uint8Array;
  timestamp: string;
}

export interface CommunityCreatedEvent {
  id: Uint8Array;
  owner: string;
  name: string;
  policy_hash: Uint8Array;
  policy_uri: string;
  transfer_delay_ms: string;
  timestamp: string;
}
export interface RoleSetEvent {
  community_id: Uint8Array;
  actor: string;
  subject: string;
  role: number;
  scope: Uint8Array;
  expires_at: string;
  timestamp: string;
}
export interface PolicySetEvent {
  community_id: Uint8Array;
  actor: string;
  policy_hash: Uint8Array;
  policy_uri: string;
  timestamp: string;
}
export interface OwnerTransferProposedEvent {
  community_id: Uint8Array;
  owner: string;
  new_owner: string;
  effective_at: string;
}
export interface OwnerTransferCancelledEvent {
  community_id: Uint8Array;
  timestamp: string;
}
export interface OwnerTransferredEvent {
  community_id: Uint8Array;
  previous_owner: string;
  new_owner: string;
  timestamp: string;
}
export interface LabelSetEvent {
  community_id: Uint8Array;
  actor: string;
  post_id: Uint8Array;
  label: string;
  reason: string;
  timestamp: string;
}

export interface SponsorSetEvent {
  sponsor: string;
  endpoint: string;
  policy_version: number;
  active: boolean;
  timestamp: string;
}
export interface SponsorDeactivatedEvent {
  sponsor: string;
  timestamp: string;
}
export interface UserGrantSetEvent {
  sponsor: string;
  user: string;
  daily_ops: number;
  expires_at: string;
  timestamp: string;
}
export interface UserGrantRevokedEvent {
  sponsor: string;
  user: string;
  timestamp: string;
}

export interface ContractProposedEvent {
  name: string;
  address: string;
  version: number;
  abi_hash: Uint8Array;
  effective_at: string;
}
export interface ContractActivatedEvent {
  name: string;
  address: string;
  version: number;
  timestamp: string;
}
export interface ContractCancelledEvent {
  name: string;
  timestamp: string;
}
export interface AdminProposedEvent {
  new_admin: string;
  effective_at: string;
}
export interface AdminChangedEvent {
  previous_admin: string;
  new_admin: string;
  timestamp: string;
}

/** Event payload types keyed by full event name. */
export interface EventPayloads {
  "osp.identity.registered": RegisteredEvent;
  "osp.identity.profile_updated": ProfileUpdatedEvent;
  "osp.identity.key_rotated": KeyRotatedEvent;
  "osp.identity.device_authorized": DeviceAuthorizedEvent;
  "osp.identity.device_revoked": DeviceRevokedEvent;
  "osp.identity.recovery_policy_proposed": RecoveryPolicyProposedEvent;
  "osp.identity.recovery_policy_set": RecoveryPolicySetEvent;
  "osp.identity.recovery_policy_cancelled": AccountTimestampEvent;
  "osp.identity.recovery_proposed": RecoveryProposedEvent;
  "osp.identity.recovery_cancelled": AccountTimestampEvent;
  "osp.identity.recovered": RecoveredEvent;
  "osp.relationships.friend_requested": FriendRequestedEvent;
  "osp.relationships.friend_accepted": FriendAcceptedEvent;
  "osp.relationships.friend_removed": FriendRemovedEvent;
  "osp.relationships.blocked": BlockedEvent;
  "osp.relationships.unblocked": UnblockedEvent;
  "osp.relationships.followed": FollowEvent;
  "osp.relationships.unfollowed": FollowEvent;
  "osp.relationships.audience_rotated": AudienceRotatedEvent;
  "osp.publications.published": PublishedEvent;
  "osp.publications.lifecycle": LifecycleEvent;
  "osp.publications.reaction": ReactionEvent;
  "osp.publications.keys_distributed": KeysDistributedEvent;
  "osp.publications.cross_post_outcome": CrossPostOutcomeEvent;
  "osp.communities.community_created": CommunityCreatedEvent;
  "osp.communities.role_set": RoleSetEvent;
  "osp.communities.policy_set": PolicySetEvent;
  "osp.communities.owner_transfer_proposed": OwnerTransferProposedEvent;
  "osp.communities.owner_transfer_cancelled": OwnerTransferCancelledEvent;
  "osp.communities.owner_transferred": OwnerTransferredEvent;
  "osp.communities.label_set": LabelSetEvent;
  "osp.sponsorship.sponsor_set": SponsorSetEvent;
  "osp.sponsorship.sponsor_deactivated": SponsorDeactivatedEvent;
  "osp.sponsorship.user_grant_set": UserGrantSetEvent;
  "osp.sponsorship.user_grant_revoked": UserGrantRevokedEvent;
  "osp.registry.contract_proposed": ContractProposedEvent;
  "osp.registry.contract_activated": ContractActivatedEvent;
  "osp.registry.contract_cancelled": ContractCancelledEvent;
  "osp.registry.contract_deprecated": ContractActivatedEvent;
  "osp.registry.admin_proposed": AdminProposedEvent;
  "osp.registry.admin_changed": AdminChangedEvent;
}
export type EventName = keyof EventPayloads;
