import { readFileSync } from "node:fs";
import { Signer, ProtocolClient, loadDeployment, encryptMedia, contentHash, toBase64url,
  utf8, openMedia, createContentLoader, contentReference, encodeContentReference, parseContentReference, signMediaUpload, type MediaUploadStatement } from "@osp/sdk";

const deployment = loadDeployment(JSON.parse(readFileSync(new URL("../deployments/harbinger.json", import.meta.url), "utf8")));
if (deployment.network !== "harbinger") throw Error("This check is restricted to the testnet deployment.");
const client = new ProtocolClient({ rpc: deployment.rpc, deployment });
if (await client.provider.getChainId() !== deployment.chainId) throw Error("Wrong chain.");
const library = await client.reads.publications.get_library_version({});
const music = (await client.reads.publications.get_music_config({}))?.value;
if (library?.external_media_version !== 1 || music?.external_media_version !== 1) throw Error("Deploy the external media Publications upgrade first.");
const messaging = await client.reads.messaging.get_private_status({});
if (library.content_reference_version !== 1 || messaging?.content_reference_version !== 1) throw Error("Deploy the Publications and Messaging content-storage upgrades first.");
const endpoint = process.env.OSP_MEDIA_ENDPOINT || `${deployment.sponsors?.[0]?.replace(/\/+$/, "")}/v1/media`;
const response = await fetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(15000) });
if (!response.ok) throw Error(`Media discovery returned ${response.status}`);
const discovery = await response.json() as { provider: string; enabled: boolean; chainId: string; contract: string; publicUrl: string };
if (!discovery.enabled || discovery.provider !== "r2" || discovery.chainId !== deployment.chainId || discovery.contract !== deployment.contracts.identity.address) throw Error("R2 discovery does not match this testnet.");
if (process.argv.includes("--upload")) {
  if (!process.env.OSP_MEDIA_TEST_WIF || !process.env.OSP_MEDIA_TEST_ACCOUNT) throw Error("Set OSP_MEDIA_TEST_WIF and OSP_MEDIA_TEST_ACCOUNT for a registered test account.");
  const signer = Signer.fromWif(process.env.OSP_MEDIA_TEST_WIF), account = process.env.OSP_MEDIA_TEST_ACCOUNT;
  const sample = encryptMedia(utf8("Open Social encrypted R2 test"));
  try {
    const proof: MediaUploadStatement = { chainId: deployment.chainId, contract: deployment.contracts.identity.address,
      endpoint, account, signer: signer.getAddress(), hash: toBase64url(contentHash(sample.ciphertext)), size: sample.ciphertext.length,
      mime: "application/octet-stream", expires: Date.now() + 120000 };
    const signature = await signMediaUpload(proof, signer);
    const upload = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(90000),
      headers: { "content-type": "application/octet-stream", "x-osp-media-proof": toBase64url(utf8(JSON.stringify({ ...proof, signature }))) }, body: new Uint8Array(sample.ciphertext) });
    if (!upload.ok) throw Error(`Encrypted upload returned ${upload.status}`);
    const receipt = await upload.json() as { url: string; hash: string; size: number };
    if (receipt.hash !== proof.hash || receipt.size !== proof.size || !receipt.url.startsWith(`${discovery.publicUrl}/osp/`)) throw Error("Invalid receipt.");
    const reference = parseContentReference(encodeContentReference(contentReference(sample.ciphertext)))!;
    const stored = await createContentLoader({ publicUrl: discovery.publicUrl, chainId: deployment.chainId, identityContract: deployment.contracts.identity.address })(reference);
    const plain = openMedia(stored, sample.contentHash, { key: sample.key, nonce: sample.nonce });
    if (new TextDecoder().decode(plain) !== "Open Social encrypted R2 test") throw Error("Decryption failed.");
    console.log(JSON.stringify({ ok: true, encryptedUploadVerified: true, contentReferenceVersion: 1, referenceBytes: 44, bytes: proof.size }));
  } finally { sample.key.fill(0); }
} else console.log(JSON.stringify({ ok: true, provider: "r2", externalMediaVersion: 1, contentReferenceVersion: 1, liveUploadTested: false }));
