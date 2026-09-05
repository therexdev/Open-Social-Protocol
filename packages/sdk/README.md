# @osp/sdk

TypeScript SDK for Open Social Protocol v1 on Koinos: canonical encoding, identifiers,
encryption (envelopes, audience keys), key vault, protocol client (contracts, transactions,
sponsorship), event decoding, cross-post reconciliation, proof manifests, profiles and the
golden conformance vectors. ESM only; runs in browsers, extension service workers and Node 22.

The normative rules live in `docs/protocol-spec.md`; section numbers below refer to it.

```ts
import { ProtocolClient, loadDeployment, identityFromSeed, encryptContent } from "@osp/sdk";
```

```sh
npm run build -w packages/sdk       # tsc -> dist/
npm test -w packages/sdk            # vitest (unit tests + vectors)
npm run typecheck -w packages/sdk   # strict typecheck of src, tests and scripts
npm run vectors -w packages/sdk     # regenerate vectors/*.json
```

## Object model (applies everywhere)

Every message follows one model, both when you build values and when the SDK decodes them:

| Proto type | SDK value on input | SDK value on output |
| --- | --- | --- |
| `bytes` | `Uint8Array` | `Uint8Array` |
| `bytes` with `(koinos.btype) = ADDRESS` | Base58 `string` or `Uint8Array` | Base58 `string` (`""` when empty) |
| `uint64` / `int64` | `string`, `number` or `bigint` | decimal `string` |
| `uint32` / enums | `number` (enum names accepted) | `number` |
| nested message | object | object, or absent (`undefined`) |
| repeated | array | array (always present) |

Type aliases: `Address = string | Uint8Array`, `Bytes = Uint8Array`, `U64 = string | number | bigint`.
Decoded messages always carry every scalar field (defaults filled in). Encoding is canonical
(section 2): ascending field numbers, default values omitted, no maps.

All errors are subclasses of `Error` with a stable `name`: `EncodingError`, `EnvelopeError`,
`AudienceError`, `VaultError`, `DeploymentError`, `ContractError`, `ProtocolClientError`,
`SponsorError`, `ManifestError`.

---

## constants

```ts
PROTOCOL_VERSION: 1
CONTRACT_NAMES: readonly ContractName[]         // "identity" | "relationships" | "publications" | "communities" | "sponsorship" | "registry"
DOMAIN = { POST_ID: "osp/v1/post-id", WRAP: "osp/v1/wrap", SEAL: "osp/v1/seal", MANIFEST: "osp/v1/manifest",
           AUDIENCE: "osp/v1/audience", IDEMPOTENCY: "osp/v1/idem", ENCRYPTION_KEY: "osp/v1/enc-key" }
CAPABILITY = { PUBLISH: 1, REACT: 2, COMMENT: 4, RELATIONSHIPS: 8, COMMUNITY: 16, PROFILE: 32 }; ALL_CAPABILITIES = 63
LIMITS = { maxEnvelopeBytes: 4096, maxMediaRefs: 8, maxLocationsPerRef: 4, maxLocationChars: 256,
           maxIdempotencyKeyBytes: 32, maxKeyPackageBytes: 16384, maxReasonChars: 256,
           idempotencyKeyBytes: 16, attemptIdBytes: 16, audienceIdBytes: 16, addressBytes: 25,
           hashBytes: 32, keyBytes: 32, nonceBytes: 24, seedBytes: 32 }
AUDIENCE = { EVERYONE: 0, FRIENDS: 1, CUSTOM: 2 }
SUITE = { PLAINTEXT: 0, XCHACHA20POLY1305_X25519: 1 }
LIFECYCLE = { ACTIVE: 0, AUTHOR_HIDDEN: 1, DELETED: 2, UNAVAILABLE: 3, MIGRATED: 4, SUPERSEDED: 5 }
OUTCOME = { SUCCEEDED: 0, PARTIAL: 1, UNKNOWN: 2, FAILED: 3, RECONCILE_REQUIRED: 4 }
RELATIONSHIP_STATUS = { NONE: 0, PENDING: 1, ACTIVE: 2, INACTIVE: 3 }
COMMUNITY_ROLE = { NONE: 0, GUEST: 1, MEMBER: 2, MODERATOR: 3, ADMIN: 4, OWNER: 5, BANNED: 6 }
CONTRACT_STATUS = { PROPOSED: 0, ACTIVE: 1, DEPRECATED: 2 }
REACTION = { LIKE: 1 }
ENVELOPE_VERSION = 1; KEY_PACKAGE_VERSION = 1; MANIFEST_VERSION = 1; PROFILE_VERSION = 1
EVENT_NAMES: { [contract]: { [short]: fullName } }   // EVENT_NAMES.publications.published === "osp.publications.published"
SPONSOR_ERROR_CATEGORIES; type SponsorErrorCategory = "quota_exceeded" | "method_not_allowed" | "too_large" | "chain_mismatch" | "invalid_signature" | "invalid_transaction" | "temporarily_unavailable"
NETWORKS = { harbinger: { name, rpc: ["https://harbinger-api.koinos.io", "https://api.harbinger.koinos.pro"], expectedChainId: "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==" },
             localnet:  { name, rpc: ["http://localhost:8080"] } }
```

## encoding

```ts
getRoot(): protobuf.Root                                  // every osp namespace, resolved
lookupType(typeName: string): protobuf.Type               // "osp.envelope.aad", "publications.publish_arguments", ...
encode(typeName: string, value: ProtoObject): Uint8Array  // canonical bytes
decode<T = ProtoObject>(typeName: string, bytes: Uint8Array | string /* base64url */): T
canonicalize(type: protobuf.Type, value: ProtoObject): ProtoObject   // non-default fields only, scalars normalized
toKoilibJson(typeName: string, value: ProtoObject): Record<string, unknown>  // koilib serializer shape (base64url/base58/strings)
fieldBtype(field: protobuf.Field): string | undefined

utf8(text): Uint8Array; utf8Decode(bytes): string
concat(...parts: Uint8Array[]): Uint8Array
u32be(n: number): Uint8Array; u64be(n: number | bigint | string): Uint8Array
bytesEqual(a, b): boolean; isBytes(v): v is Uint8Array; asBytes(v): Uint8Array
toHex(bytes): string; fromHex(hex /* optional 0x */): Uint8Array
toBase64url(bytes): string; fromBase64url(s): Uint8Array   // koilib-compatible (padded)
toBase58(bytes): string; fromBase58(s): Uint8Array
canonicalJson(value: unknown): string                     // keys sorted recursively, no whitespace, undefined dropped
```

```ts
const bytes = encode("publications.publish_arguments", { author: "1Abc...", sequence: 7, post_id });
const args = decode<PublishArgs>("publications.publish_arguments", bytes); // args.author is Base58, args.sequence "7"
```

## ids (sections 2.1-2.3)

```ts
type AddressLike = string | Uint8Array; type ChainIdLike = string | Uint8Array
addressToBytes(a: AddressLike): Uint8Array /* 25 */; addressToString(a: AddressLike): string; isAddress(v): v is string
chainIdToBytes(chainId: ChainIdLike): Uint8Array          // base64url RPC value -> raw multihash bytes
contentHash(envelopeBytes: Uint8Array): Uint8Array        // sha256
postId({ chainId, protocolVersion?, author, sequence, contentHash }: PostIdInput): Uint8Array
idempotencyKey(author: AddressLike, attemptId: Uint8Array /* 16 */): Uint8Array /* 16 */
customAudienceId(author: AddressLike, label: string): Uint8Array /* 16 */
newAttemptId(rng?: Rng): Uint8Array /* 16, persist it before submitting */
```

```ts
const attemptId = newAttemptId();
const key = idempotencyKey(account, attemptId);
const id = postId({ chainId: client.chainId, author: account, sequence: nextSequence, contentHash });
```

## crypto/keys (sections 5.2, 5.5)

```ts
type Rng = (length: number) => Uint8Array
randomBytes(length: number): Uint8Array                   // globalThis.crypto.getRandomValues
deriveEncryptionSecret(seed: Uint8Array, keyVersion: number): Uint8Array   // HKDF-SHA256(seed, salt=empty, "osp/v1/enc-key"||u32be(v), 32)
encryptionPublicKey(secretKey: Uint8Array): Uint8Array    // X25519
deriveEncryptionKeyPair(seed, keyVersion): { secretKey, publicKey, keyVersion }
x25519KeyPair(rng?): { secretKey, publicKey }; x25519SharedSecret(secret, pub): Uint8Array
```

## crypto/envelope (section 5.1)

```ts
interface Content { version?, text?, mime?, media?: MediaItem[], lang?, created_at?, external_ref? }
interface Envelope { version, suite, payload, nonce?, wrapped_content_key?, wrap_nonce? }
interface AadInput { protocolVersion?, chainId, author, postId?, audience, audienceId?, epoch, versionNumber }

buildAad(input: AadInput): Uint8Array                     // post_id forced empty when versionNumber === 1
decodeAad(bytes): { protocol_version, chain_id, author, post_id, audience, audience_id, epoch, version_number }
encodeContent(content: Content): Uint8Array; decodeContent(bytes): Content (all fields)
encodeEnvelope(envelope): Uint8Array; decodeEnvelope(bytes): Required<Envelope>
encryptContent({ content, aad?, epochKey?, suite?, rng?, contentKey?, nonce?, wrapNonce? }): { envelope, bytes, contentHash, contentKey? }
decryptContent({ envelope: Uint8Array | Envelope, aad?, epochKey? }): Content
unwrapContentKey(envelope: Envelope, epochKey, aad): Uint8Array
wrapAad(aadBytes): Uint8Array                             // "osp/v1/wrap" || aad
```

Suite is 1 when an `epochKey` is given, else 0 (plaintext, everyone audience only). Wrong key,
tampered ciphertext or a different AAD (author, epoch, version, ...) throw `EnvelopeError`.

```ts
const aad = { chainId: client.chainId, author: me.account, audience: AUDIENCE.FRIENDS, epoch, versionNumber: 1 };
const { bytes: envelope, contentHash } = encryptContent({ content: { version: 1, text: "hi" }, aad, epochKey });
// reader
const content = decryptContent({ envelope, aad, epochKey });
```

## crypto/audience (section 5.2)

```ts
interface SealedKey { recipient, recipient_key_version, ephemeral_public_key, nonce, ciphertext }
interface KeyPackageSet { version, suite, author, audience_id, epoch, keys: SealedKey[] }
interface AudienceContext { author: AddressLike; audienceId?: Uint8Array; epoch: number }
interface Recipient { address: AddressLike; publicKey: Uint8Array; keyVersion: number }

newEpochKey(rng?): Uint8Array /* 32 */
sealAad(context, recipient): Uint8Array                   // author || audience_id || u32be(epoch) || recipient
deriveSealKey(shared, ephemeralPub, recipientPub): Uint8Array
sealEpochKey({ ...context, epochKey, recipient, recipientPublicKey, recipientKeyVersion, rng?, ephemeralSecretKey?, nonce? }): SealedKey
openEpochKey({ ...context, sealed, recipientSecretKey }): Uint8Array   // throws AudienceError
buildKeyPackageSet({ ...context, epochKey, recipients, rng? }): { set, bytes }   // throws above 16 KiB
buildKeyPackageSets(options, maxBytes = LIMITS.maxKeyPackageBytes): { set, bytes }[]  // split per distribute_keys call
encodeKeyPackageSet(set): Uint8Array; parseKeyPackageSet(bytes): KeyPackageSet
findSealedKeyFor(set, recipient): SealedKey | undefined
openEpochKeyFromSet(set, recipient, recipientSecretKey): Uint8Array | undefined
```

```ts
const epochKey = newEpochKey();
const { bytes: packages } = buildKeyPackageSet({ author: me.account, epoch, epochKey, recipients: [me, ...friends] });
const op = await client.ops.publications.distribute_keys({ author: me.account, epoch, packages });
// friend side, from osp.publications.keys_distributed
const key = openEpochKeyFromSet(parseKeyPackageSet(event.data.packages), friend.account, friend.encryption.secretKey);
```

## vault (section 5.5)

```ts
newIdentitySeed(rng?): Uint8Array /* 32 */
signerFromSeed(seed): Signer                              // Signer.fromSeed(hex(seed))
signerFromSecret(secret: Uint8Array): Signer
deviceKeyPair(rng?): { signer, address, secret }
identityFromSeed(seed, keyVersion = 1): { seed, account, keyVersion, signer, encryption: { secretKey, publicKey, keyVersion } }
lockVault(secrets: VaultSecrets, passphrase, { rng?, kdf?, salt?, nonce? }?): Promise<VaultBlob>
unlockVault(blob: VaultBlob, passphrase): Promise<VaultSecrets>     // VaultError on wrong passphrase/tamper
exportIdentity({ seed, keyVersion, account }): string     // JSON { version: 1, seed: hex, keyVersion, account }
importIdentity(json: string | IdentityExport): { seed, keyVersion, account }   // verifies account matches seed
VAULT_KDF_DEFAULT = { name: "scrypt", N: 32768, r: 8, p: 1, dkLen: 32 }
```

`VaultSecrets = { seed, keyVersion, account, deviceSecret?, deviceAddress?, meta? }`;
`VaultBlob = { version: 1, kdf, cipher: "xchacha20poly1305", salt, nonce, ciphertext }` (base64url fields,
header bound as AAD).

```ts
const seed = newIdentitySeed();
const me = identityFromSeed(seed);
const blob = await lockVault({ seed, keyVersion: 1, account: me.account }, passphrase);
const { seed: restored } = await unlockVault(blob, passphrase);
```

## client/deployments

```ts
interface Deployment { network, chainId, rpc: string[], protocolVersion, deployedAt?, deployer?,
                       contracts: Record<ContractName, { address, txId?, block?, wasmSha256?, abiSha256?, rcUsed? }>,
                       startHeight?, indexers?, sponsors? }
loadDeployment(input: string | unknown): Deployment       // validates deployments/<network>.json
contractAddresses(d): Record<ContractName, string>
contractNameForAddress(d, address): ContractName | undefined
```

## client/contracts

```ts
class ProtocolContracts {
  constructor(deployment: Deployment, provider?: ProviderInterface)
  contracts: Record<ContractName, Contract>               // koilib Contract (abi + address)
  ops: { [C]: { [writeMethod]: (args) => Promise<OperationJson> } }      // contract.functions.<m>(args, { onlyOperation: true })
  reads: { [C]: { [readMethod]: (args?) => Promise<Result | undefined> } } // provider.readContract + decode
  get(name): Contract; method(name, method): AbiMethod; methods(name): string[]
  operation(name, method, args): Promise<OperationJson>
  read<T>(name, method, args?): Promise<T | undefined>   // undefined when the node returns an empty result
  decodeOperation(op: OperationJson | CallContractOperationJson): DecodedProtocolOperation | undefined
}
```

Argument and result types for every method are exported from `client/types.ts`
(`RegisterArgs`, `PublishArgs`, `IdentityRecord`, `PostRecord`, ..., `ContractWriteMethods`,
`ContractReadMethods`) plus every event payload (`PublishedEvent`, ..., `EventPayloads`, `EventName`).

## client/protocolClient

```ts
class ProtocolClient {
  constructor({ rpc?: string[] | ProviderInterface, deployment, chainId?, sponsors? })
  provider: ProviderInterface; deployment; chainId: string; chainIdBytes: Uint8Array
  contracts: ProtocolContracts; ops; reads; sponsors: SponsorPool
  read(contract, method, args?)                           // typed overloads per contract/method
  verifyChainId(): Promise<{ ok, actual }>
  prepare(operations, { payee, payer?, rcLimit?, nonce? }): Promise<TransactionJson>
  sign(tx, signer: SignerInterface): Promise<TransactionJson>
  simulate(tx): Promise<{ receipt, rcUsed, events, logs, reverted }>   // sendTransaction(tx, broadcast=false)
  broadcast(tx): Promise<{ transaction, receipt }>
  submit({ operations, signer, sponsor?, selfPayFallback?, waitForReceipt?, waitTimeoutMs?, rcLimit? }): Promise<SubmitResult>
}
interface SubmitResult { transaction, receipt, events: DecodedEvent[], rcUsed, sponsored, sponsor?, refusals: SponsorRefusal[], block? }
```

`prepare` follows koilib `Transaction.prepareTransaction`: `header.payee` = user (nonce source),
`header.payer` = sponsor or the user, `rc_limit` = payer's RC unless overridden, `chain_id` from
the deployment. `submit` tries each sponsor (discover, prepare with `payer = sponsor`, sign as
payee, `POST /v1/sponsor`), moves on after a `SponsorError`, then self-pays unless
`selfPayFallback: false`.

```ts
const client = new ProtocolClient({ rpc: NETWORKS.harbinger.rpc, deployment, sponsors: ["https://sponsor.example.org"] });
const op = await client.ops.identity.register({ account: me.account, encryption_key: me.encryption.publicKey, key_version: 1 });
const { receipt, events, sponsored } = await client.submit({ operations: [op], signer: me.signer });
const identity = await client.reads.identity.get_identity({ account: me.account });
```

## sponsor (section 10)

```ts
class SponsorError extends Error { category: SponsorErrorCategory; status?: number; endpoint?: string }
interface SponsorDiscovery { version, sponsor, network: { chainId, rpc }, policy, signature }
sponsorDiscoveryHash(doc): Uint8Array                    // sha256(canonicalJson(doc without signature))
signSponsorDiscovery(doc: UnsignedSponsorDiscovery, signer): Promise<SponsorDiscovery>
verifySponsorDiscovery(doc): { valid, signer? }          // Signer.recoverAddress === doc.sponsor
class SponsorClient {
  constructor({ endpoint, fetch?, expectedChainId?, timeoutMs? })
  endpoint; address?: string; policy?: SponsorDiscovery
  discover(force?): Promise<SponsorDiscovery>            // GET /.well-known/osp-sponsor.json, signature verified
  prepare(payee, operations): Promise<TransactionJson>   // POST /v1/prepare
  sponsor(transaction): Promise<{ transaction, receipt }> // POST /v1/sponsor
  utilization(): Promise<Record<string, unknown>>        // GET /v1/utilization
}
class SponsorPool {
  constructor(sponsors: (SponsorClient | string)[], options?)
  sponsors: SponsorClient[]
  tryEach<T>(attempt: (sponsor) => Promise<T>): Promise<{ ok: true, value, sponsor, refusals } | { ok: false, refusals }>
}
```

Canonical JSON for the discovery signature: keys sorted recursively, no whitespace, `signature`
removed, UTF-8, sha256, koilib compact recoverable signature (65 bytes) base64url. The sponsor
service should produce it with `signSponsorDiscovery`.

## events (section 12)

```ts
interface DecodedEvent<T = ProtoObject> { contract, name, type, data: T, impacted, source, sequence?, txId?, blockHeight?, blockId? }
eventTypeForName(name): { contract, type } | undefined
isProtocolEventName(name): name is EventName
protocolSource(deployment, source): ContractName | undefined
decodeEventData(name, data: string | Uint8Array): payload          // typed by name
decodeEvent(source, name, data, deployment?, { txId?, blockHeight?, blockId?, impacted?, sequence? }?): DecodedEvent | undefined
decodeReceiptEvents(receipt, deployment, { txId?, blockHeight?, blockId? }?): DecodedEvent[]
decodeBlockEvents(block: { block_id?, block_height?, receipt? }, deployment): DecodedEvent[]
isEvent(event, name): event is DecodedEvent<EventPayloads[name]>
```

With a deployment, an event decodes only when its `source` is the address of the contract its
name belongs to; other names/sources are skipped.

```ts
for (const event of decodeBlockEvents(blockItem, deployment)) {
  if (isEvent(event, "osp.publications.published")) store(event.data.post_id, event.data.envelope);
}
```

## reconcile (section 7)

```ts
type CrossPostState = "draft" | "submitting" | "succeeded" | "partial" | "unknown" | "failed" | "reconcile_required"
interface CrossPostRecord { idempotencyKey, attemptId, hostSite?, audience, state, hostStatus, koinosStatus,
                            hostRef?, koinosTxId?, postId?, lastError?, updatedAt }   // hex for keys/ids
type ReconcileEvent = { type: "retry" } | { type: "hostSucceeded", hostRef } | { type: "hostFailed", error }
  | { type: "koinosSucceeded", txId, postId } | { type: "koinosFailed", error } | { type: "koinosUnknown", error? }
  | { type: "lookupFound", postId, txId? } | { type: "lookupMissing" }          // all accept `at?: number`
newCrossPostRecord({ idempotencyKey, attemptId, hostSite?, audience, now? }): CrossPostRecord
transition(record, event): CrossPostRecord                // pure; conflicts -> reconcile_required (absorbing)
retryPlan(record): { koinos: boolean; host: boolean }     // koinos is false whenever postId is known
class Reconciler {
  constructor({ chain: { getPostByIdempotencyKey }, indexer?: { findByIdempotencyKey }, now? })
  lookup(record, author): Promise<CrossPostRecord>       // chain (authoritative) then indexer
  retry(record, author, { publishKoinos?, publishHost? }): Promise<CrossPostRecord>
}
```

`retry` on an `unknown` record only sets `lastError: "lookup required before retry"`; the
`Reconciler` always looks up first, resolves duplicate-key rejections to the existing post and
never calls `publishKoinos` once a post id is known.

```ts
const reconciler = new Reconciler({ chain: { getPostByIdempotencyKey: (a) => client.reads.publications.get_post_by_idempotency_key(a) } });
record = await reconciler.retry(record, me.account, { publishKoinos, publishHost });
```

## manifest (section 8)

```ts
buildProofManifest({ author, post_id, content_hash, version_number, transaction_id, block_height, audience, audience_id?, epoch?,
                     storage_refs?, adapter, external_ref?, outcome, idempotency_key, created_at? }): ProofManifest
encodeProofManifest(m): Uint8Array; decodeProofManifest(bytes): ProofManifest
manifestSigningHash(m): Uint8Array                       // sha256("osp/v1/manifest" || canonical(m with signature/signer empty))
signProofManifest(m, signer): Promise<ProofManifest>     // fills signature (65 bytes) and signer (25 bytes)
verifyProofManifest(m, expectedSigners?): { valid, signer?, reason? }
manifestHash(m | bytes): Uint8Array                      // sha256(canonical signed bytes) -> record_cross_post.manifest_hash
```

## profile

```ts
encodeProfile({ version?, display_name?, bio?, avatar?, links? }): Uint8Array
decodeProfile(bytes): DecodedProfile
profileHash(profile | bytes): Uint8Array                 // identity.register.profile_hash
```

## Re-exported from koilib

`Signer`, `Provider`, `Contract`, `Transaction`, `Serializer`, `koilibUtils` and the types
`Abi`, `OperationJson`, `CallContractOperationJson`, `TransactionJson`, `TransactionHeaderJson`,
`TransactionReceipt`, `BlockReceipt`, `ProviderInterface`, `SignerInterface`, `KoilibEventData`.

## Golden vectors (`vectors/`)

`keys.json`, `ids.json`, `envelope.json`, `sealed-keys.json`, `manifest.json`, `reconcile.json`
are generated by `scripts/generate-vectors.ts` from fixed seeds, keys and nonces (every random
value is included) and verified by `src/vectors.test.ts`. Independent implementations must
reproduce each output and reject the tampered variants the test exercises.

## End-to-end: friends-only post

```ts
import {
  AUDIENCE, ProtocolClient, buildKeyPackageSet, contentHash, encryptContent, idempotencyKey,
  identityFromSeed, loadDeployment, newAttemptId, newEpochKey, postId,
} from "@osp/sdk";

const client = new ProtocolClient({ deployment: loadDeployment(json), sponsors: deployment.sponsors });
const me = identityFromSeed(seed, 1);

// 1. audience epoch key (rotate when relationships change) sealed to me + friends
const { value: audience } = (await client.reads.relationships.get_audience({ account: me.account })) ?? {};
const epoch = audience?.epoch ?? 0;
const epochKey = newEpochKey();
const { bytes: packages } = buildKeyPackageSet({ author: me.account, epoch, epochKey, recipients });
await client.submit({ operations: [await client.ops.publications.distribute_keys({ author: me.account, epoch, packages })], signer: me.signer });

// 2. envelope, ids, publish
const state = await client.reads.publications.get_author_state({ author: me.account });
const sequence = state?.value?.next_sequence ?? "1";
const aad = { chainId: client.chainId, author: me.account, audience: AUDIENCE.FRIENDS, epoch, versionNumber: 1 };
const { bytes: envelope } = encryptContent({ content: { version: 1, text: "hello" }, aad, epochKey });
const hash = contentHash(envelope);
const attemptId = newAttemptId(); // persist with the cross-post record
const publish = await client.ops.publications.publish({
  author: me.account, post_id: postId({ chainId: client.chainId, author: me.account, sequence, contentHash: hash }),
  sequence, audience: AUDIENCE.FRIENDS, epoch, envelope, content_hash: hash,
  idempotency_key: idempotencyKey(me.account, attemptId),
});
const { events } = await client.submit({ operations: [publish], signer: me.signer });
```
