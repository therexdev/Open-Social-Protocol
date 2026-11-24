// Read-only funding check, run after mainnet-accounts has produced public addresses.
import { Contract, utils } from "koilib";
import { isAddress } from "@osp/sdk";
import { networkFromArgs, providerFor, readDeployment, formatMana } from "./common.ts";

const { preset } = networkFromArgs({ network:"mainnet" });
const provider = providerFor(preset);
if (await provider.getChainId() !== preset.expectedChainId) throw new Error("Funding check RPC is on the wrong chain");
const sponsor = process.env.OSP_MAINNET_SPONSOR_ADDRESS, deployer = process.env.OSP_MAINNET_DEPLOYER_ADDRESS;
if (!isAddress(sponsor) || !isAddress(deployer)) throw new Error("Run the public mainnet accounts step first");
const native = (await provider.invokeGetContractAddress("koin"))?.value?.address;
if (!isAddress(native)) throw new Error("Cannot resolve native KOIN from the mainnet name service");
const contract = new Contract({ id: native, abi: utils.tokenAbi, provider });
const balance = (await contract.functions.balanceOf!({ owner: sponsor })).result as { value?: string } | undefined;
if (!balance?.value || !/^\d+$/.test(balance.value)) throw new Error("Cannot read sponsor's native KOIN balance");
console.log(`Sponsor ${sponsor}: ${formatMana(balance.value)} maximum capacity`);
if (!readDeployment("mainnet") && BigInt(balance.value) < 1000000000000n) throw new Error("Initial mainnet sponsor funding target is 10,000 KOIN; fund the verified sponsor wallet before deployment");
const rc = await provider.getAccountRc(deployer);
console.log(`Deployer ${deployer}: ${formatMana(rc)} available for deployment`);
if (BigInt(rc) <= 0n) throw new Error("Fund the deployer wallet or wait for its Mana to regenerate");
