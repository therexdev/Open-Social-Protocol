import { utils } from "koilib";
import type { ContractName } from "./common.ts";

/** Read-only calls that are valid even before dependencies or registry state exist. */
export function deploymentProbe(name: ContractName, address: string): { name: string; args: Record<string, unknown> } {
  switch (name) {
    case "identity": return { name: "get_identity", args: { account: address } };
    case "relationships": case "communities": return { name: "get_identity_contract", args: {} };
    case "publications": return { name: "get_limits", args: {} };
    case "sponsorship": return { name: "list_sponsors", args: { limit: 1 } };
    case "registry": case "token": return { name: "get_config", args: {} };
    case "messaging": return { name: "get_message", args: { sender: address, message_id: utils.encodeBase64url(new Uint8Array(32)) } };
  }
}
