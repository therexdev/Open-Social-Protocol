// Prints public addresses only. Never creates/transfers funds or prints keys.
import { appendFileSync } from "node:fs";
import { Signer } from "koilib";
import { NETWORKS, CONTRACT_ORDER, contractSigner, deployerSigner, providerFor, requireSeed } from "./common.ts";

const provider = providerFor(NETWORKS.mainnet!);
const deployer = deployerSigner(NETWORKS.mainnet!, provider).getAddress();
const seed = requireSeed("mainnet");
if (seed.length < 32) throw new Error("OSP_MAINNET_CONTRACT_SEED must contain at least 32 random characters");
const wif = process.env.OSP_MAINNET_SPONSOR_WIF;
if (!wif) throw new Error("Configure OSP_MAINNET_SPONSOR_WIF in the mainnet GitHub environment");
const sponsor = Signer.fromWif(wif).getAddress();
const rows = [["Deployer (deployment Mana)", deployer], ["Sponsor (10,000 KOIN funding target)", sponsor],
  ...CONTRACT_ORDER.map(name => [`${name}${name === "token" ? " (reserved; not deployed)" : ""}`, contractSigner("mainnet", name, seed, provider).getAddress()])];
const report = "## Mainnet public addresses\n\n| Account | Address |\n| --- | --- |\n" + rows.map(([name,address]) => `| ${name} | ${address} |`).join("\n") +
  "\n\nFund only your verified sponsor/deployer wallets. Contract addresses do not need a KOIN transfer. No OSAT token is deployed by this launch.\n";
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `OSP_MAINNET_SPONSOR_ADDRESS=${sponsor}\nOSP_MAINNET_DEPLOYER_ADDRESS=${deployer}\n`);
