import { ABIS } from "@osp/proto";
import { SponsorClient, type Deployment } from "@osp/sdk";
export const ECONOMY_METHODS = ["vote", "settle_reward", "promote", "cancel_promotion"] as const;
export interface Readiness { ready: boolean; blockers: string[]; indexer?: string; sponsor?: string; site?: string; }
/** Public activation requires real compatible services, not successful local builds. */
export async function economyReadiness(deployment: Deployment, site = "https://opensocial.online", fetchFn: typeof fetch = fetch): Promise<Readiness> {
  const blockers: string[] = [];
  let indexer: string | undefined, sponsor: string | undefined;
  for (const base of deployment.indexers ?? []) {
    try {
      const response = await fetchFn(`${base.replace(/\/$/,"")}/v1/status`, {signal:AbortSignal.timeout(15000)});
      const status = await response.json() as {features?:{tokenEconomy?:number};healthy?:boolean;chainId?:string;contracts?:Record<string,string>};
      if (response.ok && status.healthy && status.chainId===deployment.chainId && status.contracts?.token===deployment.contracts.token.address && status.features?.tokenEconomy===1) { indexer=base; break; }
    } catch { /* Try the next explicitly configured service. */ }
  }
  if (!indexer) blockers.push("Update the live indexer to the economy build and verify features.tokenEconomy=1 with healthy sync.");
  for (const base of deployment.sponsors ?? []) {
    try {
      const doc = await new SponsorClient({endpoint:base,expectedChainId:deployment.chainId,fetch:fetchFn}).discover(true);
      const allowed = doc.policy.allowed.find(a=>a.contract===deployment.contracts.token.address);
      if (allowed && ECONOMY_METHODS.every(m=>allowed.entryPoints.includes(ABIS.token.methods[m]!.entry_point))) { sponsor=base; break; }
    } catch { /* Signature, chain or availability failures are readiness failures. */ }
  }
  if (!sponsor) blockers.push("Update and register the live sponsor policy for vote, settle_reward, promote and cancel_promotion.");
  let currentSite: string | undefined;
  try {
    const response = await fetchFn(`${site.replace(/\/$/,"")}/release.json`, {signal:AbortSignal.timeout(15000),cache:"no-store"});
    const release = await response.json() as {tokenEconomy?:number};
    if (response.ok && release.tokenEconomy===1) currentSite=site;
  } catch { /* An HTML fallback or older frontend is not compatible evidence. */ }
  if (!currentSite) blockers.push("Upload the new website build; release.json must advertise tokenEconomy=1.");
  return {ready:blockers.length===0,blockers,indexer,sponsor,site:currentSite};
}
