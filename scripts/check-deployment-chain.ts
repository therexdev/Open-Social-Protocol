import { networkFromArgs, parseArgs, providerFor } from "./common.ts";
import { requireFreshDeploymentHead } from "./deployment-confirmation.ts";

const { name, preset } = networkFromArgs(parseArgs(process.argv.slice(2)));
const provider = providerFor(preset);
const chainId = await provider.getChainId();
if (preset.expectedChainId && chainId !== preset.expectedChainId) throw Error(`Wrong chain: expected ${preset.expectedChainId}, received ${chainId}`);
const head = await requireFreshDeploymentHead(provider);
console.log(`${name}: fresh head ${head.head_topology.height}, last block ${new Date(Number(head.head_block_time)).toISOString()}`);
