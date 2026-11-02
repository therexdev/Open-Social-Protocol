// Read-only release check. No wallet keys or write transactions are needed.
// node --import tsx scripts/verify-photo-library.ts --network harbinger --contracts-only
// node --import tsx scripts/verify-photo-library.ts --network harbinger --indexer http://127.0.0.1:8787 --sponsor http://127.0.0.1:8788
import assert from 'node:assert/strict';
import { ProtocolClient, loadDeployment, requirePhotoLibrary, verifySponsorDiscovery, type SponsorDiscovery } from '@osp/sdk';
import { ABIS } from '@osp/proto';
import { networkFromArgs, parseArgs, readDeployment } from './common.ts';

const args = parseArgs(process.argv.slice(2));
const {name: network} = networkFromArgs(args);
async function json(url: string): Promise<any> {
  const response = await fetch(url, {signal: AbortSignal.timeout(20_000), cache: 'no-store'});
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return response.json();
}
async function main(): Promise<void> {
  const raw = readDeployment(network);
  assert(raw, `Missing deployments/${network}.json`);
  const deployment = loadDeployment(raw), client = new ProtocolClient({deployment});
  assert.equal(await client.provider.getChainId(), deployment.chainId, 'RPC chain does not match the deployment');
  await requirePhotoLibrary(client);
  assert.equal((await client.reads.publications.get_token_contract({}))?.value, deployment.contracts.token.address, 'Photo usage is not wired to the token contract');
  console.log(`OK photo library v1 at ${deployment.contracts.publications.address}; usage contract verified`);
  if (args['contracts-only']) return;
  const indexer = typeof args.indexer === 'string' ? args.indexer : deployment.indexers?.[0];
  const sponsor = typeof args.sponsor === 'string' ? args.sponsor : deployment.sponsors?.[0];
  assert(indexer && sponsor, 'Specify --indexer and --sponsor endpoints');
  const [status,health,discovery] = await Promise.all([
    json(`${indexer.replace(/\/+$/, '')}/v1/status`),
    json(`${sponsor.replace(/\/+$/, '')}/healthz`),
    json(`${sponsor.replace(/\/+$/, '')}/.well-known/osp-sponsor.json`),
  ]);
  assert.equal(status.features?.photoLibrary, 1, 'Indexer needs the photo-library update');
  assert.equal(status.chainId, deployment.chainId, 'Indexer is on another chain');
  assert.equal(status.chainIdMatch, true, 'Indexer RPC chain is not verified');
  assert.equal(status.contracts?.publications, deployment.contracts.publications.address, 'Indexer uses another publications contract');
  assert.equal(status.healthy, true, 'Indexer is catching up or unhealthy; wait, then retry this command');
  const upgradeBlock = deployment.contracts.publications.block;
  assert(upgradeBlock, 'Publications deployment block is missing from the manifest');
  assert(BigInt(status.indexed?.height ?? 0) >= BigInt(upgradeBlock), 'Indexer has not reached the photo-library upgrade');
  console.log(`OK indexer photoLibrary=1, chain verified, indexed height ${status.indexed.height}`);
  assert.equal(health.ok, true, 'Sponsor is not serving');
  assert.equal(health.chainId, deployment.chainId, 'Sponsor is on another chain');
  assert(verifySponsorDiscovery(discovery as SponsorDiscovery).valid, 'Sponsor discovery signature is invalid');
  assert.equal(discovery.network?.chainId, deployment.chainId, 'Sponsor discovery uses another chain');
  const policy = discovery.policy;
  assert(policy?.maxBytesPerOp >= 24576, 'Sponsor arguments limit must be at least 24576');
  assert(policy?.maxOpsPerTx >= 4, 'Sponsor must allow four operations per transaction');
  assert(policy?.perUser?.burstOps >= 180, 'Sponsor burst quota must be at least 180 for eight large photos');
  const allowed = policy.allowed.find((entry: any) => entry.contract === deployment.contracts.publications.address);
  for (const method of ['begin_photo','append_photo','save_collection','set_album_item']) {
    assert(allowed?.entryPoints.includes(ABIS.publications.methods[method]!.entry_point), `Sponsor is missing publications.${method}; refresh its allowlist and restart`);
  }
  const registered = (await client.reads.sponsorship.get_sponsor({sponsor:discovery.sponsor}))?.value;
  assert(registered?.active && registered.max_bytes_per_op >= 24576, 'Sponsor on-chain policy is not updated; check registration logs and restart it');
  const onChainAllowed = registered.allowed.find(entry => entry.contract_id === deployment.contracts.publications.address);
  for (const method of ['begin_photo','append_photo','save_collection','set_album_item']) {
    assert(onChainAllowed && (!onChainAllowed.entry_points.length || onChainAllowed.entry_points.includes(ABIS.publications.methods[method]!.entry_point)), `On-chain sponsor policy is missing publications.${method}`);
  }
  console.log('OK signed and on-chain sponsor policies support archive chunks and collections');
  console.log('PHOTO LIBRARY READY — upload the frontend package. Confirm one private photo and one membership change with your own accounts.');
}
main().catch(error => {console.error(`NOT READY: ${error instanceof Error ? error.message : String(error)}`);process.exitCode=1;});
